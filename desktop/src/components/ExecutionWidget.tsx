import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { ExecutionPlan, ToolUsed } from '../types/executionPlan';
import { cancelExecutionPlan, confirmExecutionPlan, executeMcpTool, ExecutionPlanRequestError } from '../lib/api';
import { usePermissions } from '../hooks/usePermissions';
import SpendingApprovalModal from './SpendingApprovalModal';
import ToolPreviewModal from './ToolPreviewModal';
import { fetchFromApi, getToken } from '../lib/storage';
import DesktopAsyncState from './DesktopAsyncState';

interface ExecutionWidgetProps {
  planId: string;
}

function formatLight(amount: number): string {
  if (amount <= 0) return 'Free';
  if (amount < 1) return `✦${amount.toFixed(2)}`;
  return `✦${amount.toFixed(amount % 1 === 0 ? 0 : 2)}`;
}

function formatRemaining(ms: number): string {
  if (ms <= 0) return '0s';
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function summarizeArgs(args: Record<string, unknown>): string {
  if ('_source' in args && typeof args._source === 'string') {
    return args._source.length > 72 ? args._source.slice(0, 72) + '...' : args._source;
  }

  const entries = Object.entries(args);
  if (entries.length === 0) return 'No args';

  return entries
    .slice(0, 3)
    .map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join(' • ');
}

function buildCancelledResult(reason: 'cancelled' | 'timed_out'): string {
  return reason === 'timed_out'
    ? 'Execution window expired before approval.'
    : 'Execution was cancelled before any tools ran.';
}

function isExecutionPlanRequestError(error: unknown): error is ExecutionPlanRequestError {
  return error instanceof ExecutionPlanRequestError;
}

export default function ExecutionWidget({ planId }: ExecutionWidgetProps) {
  const [plan, setPlan] = useState<ExecutionPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [actionPending, setActionPending] = useState(false);
  const [likedByApp, setLikedByApp] = useState<Record<string, boolean>>({});
  const [ownedByApp, setOwnedByApp] = useState<Record<string, boolean>>({});
  const [previewTool, setPreviewTool] = useState<ToolUsed | null>(null);
  const planRef = useRef<ExecutionPlan | null>(null);
  const confirmInFlightRef = useRef(false);
  const autoRunBlockedRef = useRef(false);
  const {
    pendingSpending,
    checkSpending,
    approveSpending,
    denySpending,
  } = usePermissions();

  const loadPlan = useCallback(async () => {
    try {
      const next = await invoke<ExecutionPlan | null>('db_get_execution_plan', { id: planId });
      setPlan(next);
      planRef.current = next;
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load execution plan');
    } finally {
      setLoading(false);
    }
  }, [planId]);

  useEffect(() => {
    loadPlan();
  }, [loadPlan]);

  useEffect(() => {
    if (!plan) return;

    const token = getToken();
    if (!token) return;

    const uniqueAppIds = [...new Set(plan.tools_used.map((tool) => tool.appId))];
    if (uniqueAppIds.length === 0) return;

    let cancelled = false;
    const loadLibraryStates = async () => {
      try {
        const responses = await Promise.all(
          uniqueAppIds.map(async (appId) => {
            const res = await fetchFromApi(`/api/apps/${appId}/library-status`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) {
              return [appId, null] as const;
            }
            const data = await res.json() as { inLibrary?: boolean; isOwner?: boolean };
            return [appId, data] as const;
          }),
        );

        if (cancelled) return;

        const nextLiked: Record<string, boolean> = {};
        const nextOwned: Record<string, boolean> = {};
        for (const [appId, status] of responses) {
          nextLiked[appId] = !!status?.inLibrary;
          nextOwned[appId] = !!status?.isOwner;
        }
        setLikedByApp(nextLiked);
        setOwnedByApp(nextOwned);
      } catch {
        // Non-fatal; button can still optimistically toggle.
      }
    };

    void loadLibraryStates();
    return () => {
      cancelled = true;
    };
  }, [plan]);

  useEffect(() => {
    if (!plan || (plan.status !== 'pending' && plan.status !== 'executing')) return;

    const interval = setInterval(() => {
      void loadPlan();
    }, 1000);

    return () => clearInterval(interval);
  }, [loadPlan, plan]);

  useEffect(() => {
    if (plan?.status !== 'pending') return;

    const interval = setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => clearInterval(interval);
  }, [plan?.status]);

  const remainingMs = useMemo(() => {
    if (!plan || plan.status !== 'pending') return 0;
    if (plan.window_seconds === -1) return Infinity;
    const fireAt = plan.fire_at ?? (plan.created_at + Math.max(plan.window_seconds, 0) * 1000);
    return Math.max(0, fireAt - now);
  }, [now, plan]);

  const updateLocalPlan = useCallback(async (
    status: ExecutionPlan['status'],
    updates?: Partial<Pick<ExecutionPlan, 'fire_at' | 'fired_at' | 'completed_at' | 'result'>>,
  ) => {
    const next = await invoke<ExecutionPlan>('db_update_execution_plan_status', {
      id: planId,
      status,
      result: updates?.result ?? null,
      fireAt: updates?.fire_at ?? null,
      firedAt: updates?.fired_at ?? null,
      completedAt: updates?.completed_at ?? null,
    });
    setPlan(next);
    planRef.current = next;
    return next;
  }, [planId]);

  const fire = useCallback(async (manual = false) => {
    const currentPlan = planRef.current;
    if (!currentPlan || currentPlan.status !== 'pending' || confirmInFlightRef.current) {
      return;
    }
    if (!manual && autoRunBlockedRef.current) {
      return;
    }

    if (manual) {
      autoRunBlockedRef.current = false;
    }
    confirmInFlightRef.current = true;
    setActionPending(true);
    setError(null);

    try {
      const approved = await checkSpending(
        `Run ${currentPlan.tools_used.length || 1} tool${currentPlan.tools_used.length === 1 ? '' : 's'}`,
        currentPlan.total_cost_light,
      );
      if (!approved) {
        autoRunBlockedRef.current = true;
        return;
      }

      await confirmExecutionPlan(currentPlan.id);
      await updateLocalPlan('executing', {
        fired_at: Date.now(),
      });
    } catch (err) {
      if (isExecutionPlanRequestError(err)) {
        if (err.status === 404 || err.status === 410) {
          await updateLocalPlan('cancelled', {
            completed_at: Date.now(),
            result: buildCancelledResult('timed_out'),
          });
          return;
        }
        if (err.status === 409) {
          if (/already confirmed/i.test(err.message)) {
            await updateLocalPlan('executing', {
              fired_at: Date.now(),
            });
            return;
          }
          if (/already cancelled/i.test(err.message)) {
            await updateLocalPlan('cancelled', {
              completed_at: Date.now(),
              result: buildCancelledResult('cancelled'),
            });
            return;
          }
        }
      }

      autoRunBlockedRef.current = true;
      setError(err instanceof Error ? err.message : 'Failed to start execution');
    } finally {
      confirmInFlightRef.current = false;
      setActionPending(false);
    }
  }, [checkSpending, updateLocalPlan]);

  const cancel = useCallback(async () => {
    const currentPlan = planRef.current;
    if (!currentPlan || currentPlan.status !== 'pending') return;

    setActionPending(true);
    setError(null);
    try {
      await cancelExecutionPlan(currentPlan.id);
      await updateLocalPlan('cancelled', {
        completed_at: Date.now(),
        result: buildCancelledResult('cancelled'),
      });
    } catch (err) {
      if (isExecutionPlanRequestError(err)) {
        if (err.status === 404 || err.status === 410) {
          await updateLocalPlan('cancelled', {
            completed_at: Date.now(),
            result: buildCancelledResult('timed_out'),
          });
          return;
        }
        if (err.status === 409) {
          if (/already confirmed/i.test(err.message)) {
            await updateLocalPlan('executing', {
              fired_at: Date.now(),
            });
            return;
          }
          if (/already cancelled/i.test(err.message)) {
            await updateLocalPlan('cancelled', {
              completed_at: Date.now(),
              result: buildCancelledResult('cancelled'),
            });
            return;
          }
        }
      }
      setError(err instanceof Error ? err.message : 'Failed to cancel execution');
    } finally {
      setActionPending(false);
    }
  }, [updateLocalPlan]);

  const extend = useCallback(async (seconds: number) => {
    const currentPlan = planRef.current;
    if (!currentPlan || currentPlan.status !== 'pending' || currentPlan.window_seconds < 0) {
      return;
    }

    setActionPending(true);
    setError(null);
    try {
      const baseFireAt = Math.max(currentPlan.fire_at ?? Date.now(), Date.now());
      autoRunBlockedRef.current = false;
      await updateLocalPlan('pending', { fire_at: baseFireAt + seconds * 1000 });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to extend countdown');
    } finally {
      setActionPending(false);
    }
  }, [updateLocalPlan]);

  useEffect(() => {
    if (!plan || plan.status !== 'pending' || plan.window_seconds === -1 || remainingMs !== 0) {
      return;
    }
    void fire();
  }, [fire, plan, remainingMs]);

  const toggleLike = useCallback(async (tool: ToolUsed) => {
    const currentlyLiked = !!likedByApp[tool.appId];
    setError(null);

    try {
      const result = await executeMcpTool('ul.rate', {
        app_id: tool.appId,
        rating: currentlyLiked ? 'none' : 'like',
      });
      if (result.isError) {
        throw new Error(result.content?.[0]?.text || 'Failed to update tool preference');
      }
      setLikedByApp((prev) => ({ ...prev, [tool.appId]: !currentlyLiked }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update tool preference');
    }
  }, [likedByApp]);

  if (loading) {
    return (
      <div className="my-3 min-h-[116px] rounded-xl border border-ul-border bg-white">
        <DesktopAsyncState
          kind="loading"
          title="Loading execution approval"
          message="Checking the latest status for this tool run."
          compact
        />
      </div>
    );
  }

  if (!plan) {
    return (
      <div className="my-3 min-h-[116px] rounded-xl border border-ul-border bg-white">
        <DesktopAsyncState
          kind="empty"
          title="Execution approval unavailable"
          message="This approval card is no longer available in local state."
          actionLabel="Reload"
          onAction={() => {
            setLoading(true);
            void loadPlan();
          }}
          compact
        />
      </div>
    );
  }

  const isPending = plan.status === 'pending';
  const isExecuting = plan.status === 'executing';
  const isCompleted = plan.status === 'completed';
  const isCancelled = plan.status === 'cancelled';
  const toolCount = plan.tools_used.length || 1;

  return (
    <>
      <div className={`my-3 min-h-[116px] rounded-xl border px-4 py-3 transition-colors ${
        isPending ? 'border-amber-200 bg-amber-50/70'
          : isExecuting ? 'border-blue-200 bg-blue-50/70'
            : isCompleted ? 'border-emerald-200 bg-emerald-50/70'
              : 'border-gray-200 bg-gray-50'
      }`}>
        <div className="flex items-start gap-3">
          <div className={`mt-0.5 flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold ${
            isPending ? 'bg-amber-100 text-amber-700'
              : isExecuting ? 'bg-blue-100 text-blue-700'
                : isCompleted ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-gray-200 text-gray-700'
          }`}>
            {isPending ? '●' : isExecuting ? '~' : isCompleted ? '✓' : '×'}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-small font-medium text-ul-text">
                {isPending && plan.window_seconds === -1
                  ? `Waiting to run ${toolCount} tool${toolCount === 1 ? '' : 's'}`
                  : isPending
                    ? `Executes in ${formatRemaining(remainingMs)}`
                    : isExecuting
                      ? `Running ${toolCount} tool${toolCount === 1 ? '' : 's'}...`
                      : isCompleted
                        ? `Ran ${toolCount} tool${toolCount === 1 ? '' : 's'}`
                        : `Cancelled ${toolCount} tool${toolCount === 1 ? '' : 's'}`}
              </span>
              <span className="text-caption text-ul-text-muted">
                {formatLight(plan.total_cost_light)}
              </span>
            </div>

            {isPending && plan.window_seconds >= 0 && (
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/80">
                <div
                  className={`h-full rounded-full transition-[width] duration-700 ${
                    remainingMs <= 3000 ? 'bg-amber-500' : 'bg-amber-300'
                  }`}
                  style={{
                    width: `${Math.max(
                      0,
                      Math.min(
                        100,
                        ((plan.fire_at ?? (plan.created_at + plan.window_seconds * 1000)) - now)
                          / Math.max(plan.window_seconds * 1000, 1)
                          * 100,
                      ),
                    )}%`,
                  }}
                />
              </div>
            )}

            <div className="mt-3 space-y-2">
              {plan.tools_used.map((tool, index) => (
                <div
                  key={`${tool.appId}-${tool.fnName}-${index}`}
                  className="rounded-lg border border-white/70 bg-white/80 px-3 py-2"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-small font-medium text-ul-text">{tool.appName}</span>
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                      tool.origin === 'marketplace'
                        ? 'bg-slate-200 text-slate-700'
                        : 'bg-emerald-100 text-emerald-700'
                    }`}>
                      {tool.origin === 'marketplace' ? 'Marketplace' : 'Library'}
                    </span>
                    <span className="font-mono text-[11px] text-ul-text-muted">{tool.fnName}</span>
                    <span className="ml-auto text-[11px] text-ul-text-muted">{formatLight(tool.cost_light)}</span>
                  </div>
                  <p className="mt-1 text-caption text-ul-text-muted">
                    {summarizeArgs(tool.args)}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => setPreviewTool(tool)}
                      className="rounded-full border border-ul-border bg-white px-2.5 py-1 text-[11px] font-medium text-ul-text-muted transition-colors hover:text-ul-text"
                    >
                      Preview
                    </button>
                    {!ownedByApp[tool.appId] && (
                      <button
                        onClick={() => void toggleLike(tool)}
                        className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                          likedByApp[tool.appId]
                            ? 'border-rose-200 bg-rose-50 text-rose-700'
                            : 'border-ul-border bg-white text-ul-text-muted hover:text-ul-text'
                        }`}
                      >
                        {likedByApp[tool.appId] ? 'Liked' : 'Like'}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {error && (
              <div className="mt-3 rounded-lg border border-red-200 bg-red-50/80">
                <DesktopAsyncState
                  kind="error"
                  title="Action unavailable"
                  message={error}
                  compact
                />
              </div>
            )}

            {plan.result && (isCompleted || isCancelled) && (
              <pre className="mt-3 max-h-48 overflow-auto rounded-lg border border-white/70 bg-white/80 p-3 text-[11px] text-ul-text-muted whitespace-pre-wrap">
                {plan.result}
              </pre>
            )}

            {isPending && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  onClick={() => void cancel()}
                  disabled={actionPending}
                  className="rounded-lg border border-ul-border bg-white px-3 py-1.5 text-small text-ul-text-muted transition-colors hover:text-ul-error disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Cancel
                </button>
                {plan.window_seconds >= 0 && (
                  <button
                    onClick={() => void extend(30)}
                    disabled={actionPending}
                    className="rounded-lg border border-ul-border bg-white px-3 py-1.5 text-small text-ul-text-muted transition-colors hover:text-ul-text disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    +30s
                  </button>
                )}
                <button
                  onClick={() => void fire(true)}
                  disabled={actionPending}
                  className="rounded-lg bg-ul-accent px-3 py-1.5 text-small font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Run now
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {pendingSpending && (
        <SpendingApprovalModal
          request={pendingSpending}
          onApprove={approveSpending}
          onDeny={denySpending}
        />
      )}

      {previewTool && (
        <ToolPreviewModal
          tool={previewTool}
          onClose={() => setPreviewTool(null)}
        />
      )}
    </>
  );
}
