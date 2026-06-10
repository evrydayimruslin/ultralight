import {
  AlertTriangle,
  Clock,
  Pause,
  Play,
  RefreshCw,
  RotateCw,
  Wallet,
} from "lucide-react";
import type { RoutineMonitorItem, RoutineMonitorResponse } from "../lib/api";

interface RoutineMonitorPanelProps {
  monitor: RoutineMonitorResponse | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onPause: (routineId: string) => void;
  onResume: (routineId: string) => void;
  onRunNow: (routineId: string) => void;
}

function formatLight(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return "0";
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(2)}M`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(1)}K`;
  if (amount >= 10) return amount.toFixed(0);
  if (amount >= 1) return amount.toFixed(2);
  return amount.toFixed(3);
}

function formatDateTime(value: string | null): string {
  if (!value) return "-";
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return "-";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(ms));
}

function formatLastRun(routine: RoutineMonitorItem): string {
  const run = routine.last_run;
  if (!run) return "No runs";
  const when = run.completed_at || run.started_at || run.created_at;
  return `${run.status.replace(/_/g, " ")} - ${formatDateTime(when)}`;
}

function statusClass(health: RoutineMonitorItem["health"]): string {
  switch (health) {
    case "active":
      return "bg-green-500";
    case "running":
      return "bg-blue-500";
    case "needs_approval":
      return "bg-amber-500";
    case "error":
      return "bg-red-500";
    default:
      return "bg-gray-300";
  }
}

function statusText(routine: RoutineMonitorItem): string {
  if (routine.health === "needs_approval") return "Needs approval";
  if (routine.health === "running") return "Running";
  if (routine.health === "error") return "Error";
  return routine.status.charAt(0).toUpperCase() + routine.status.slice(1);
}

export default function RoutineMonitorPanel({
  monitor,
  loading,
  error,
  onRefresh,
  onPause,
  onResume,
  onRunNow,
}: RoutineMonitorPanelProps) {
  const summary = monitor?.summary;
  const routines = monitor?.routines ?? [];

  if (!loading && !error && routines.length === 0) {
    return null;
  }

  return (
    <section className="pb-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-small font-semibold text-ul-text">
            Persistent Routines
          </h2>
          <p className="text-caption text-ul-text-muted">
            Ongoing delegated work, spend, approvals, and run health.
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="h-8 w-8 inline-flex items-center justify-center rounded-md border border-gray-200 text-gray-500 hover:text-gray-900 hover:bg-gray-50 disabled:opacity-45"
          title="Refresh routines"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
          />
        </button>
      </div>

      {error && (
        <div className="mb-3 flex items-center gap-2 rounded-md border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {summary && (
        <div className="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-5">
          <div className="rounded-md border border-gray-200 bg-white px-3 py-2">
            <div className="text-[11px] text-gray-500">Active</div>
            <div className="text-base font-semibold text-gray-900">
              {summary.active}/{summary.total}
            </div>
          </div>
          <div className="rounded-md border border-gray-200 bg-white px-3 py-2">
            <div className="text-[11px] text-gray-500">Approvals</div>
            <div className="text-base font-semibold text-gray-900">
              {summary.pending_approvals}
            </div>
          </div>
          <div className="rounded-md border border-gray-200 bg-white px-3 py-2">
            <div className="text-[11px] text-gray-500">Failures 24h</div>
            <div className="text-base font-semibold text-gray-900">
              {summary.failures_24h}
            </div>
          </div>
          <div className="rounded-md border border-gray-200 bg-white px-3 py-2">
            <div className="text-[11px] text-gray-500">Spend 30d</div>
            <div className="text-base font-semibold text-gray-900">
              {formatLight(summary.spend_light_30d)}
            </div>
          </div>
          <div className="rounded-md border border-gray-200 bg-white px-3 py-2">
            <div className="text-[11px] text-gray-500">Next Run</div>
            <div className="truncate text-sm font-medium text-gray-900">
              {formatDateTime(summary.next_run_at)}
            </div>
          </div>
        </div>
      )}

      {loading && routines.length === 0
        ? (
          <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
            {[0, 1].map((index) => (
              <div
                key={index}
                className="h-32 animate-pulse rounded-lg bg-gray-100"
              />
            ))}
          </div>
        )
        : (
          <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
            {routines.slice(0, 6).map((routine) => (
              <article
                key={routine.id}
                className="rounded-lg border border-gray-200 bg-white px-4 py-3"
              >
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className={`h-2 w-2 rounded-full ${
                          statusClass(routine.health)
                        }`}
                      />
                      <h3 className="truncate text-sm font-semibold text-gray-900">
                        {routine.name}
                      </h3>
                    </div>
                    <p className="mt-0.5 truncate text-[11px] text-gray-500">
                      {routine.composer_app_slug || routine.template_id}
                    </p>
                  </div>
                  <span className="shrink-0 rounded bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600">
                    {statusText(routine)}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[11px] text-gray-600">
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                    <span className="truncate">
                      Next {formatDateTime(routine.next_run_at)}
                    </span>
                  </span>
                  <span className="inline-flex min-w-0 items-center justify-end gap-1.5 text-right">
                    <Wallet className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                    <span className="truncate">
                      {formatLight(routine.spend_light_30d)} Light
                    </span>
                  </span>
                  <span className="col-span-2 truncate">
                    Last {formatLastRun(routine)}
                  </span>
                  <span className="truncate">
                    {routine.pending_capability_count} pending approvals
                  </span>
                  <span className="text-right">
                    {routine.failures_24h} failures 24h
                  </span>
                </div>

                <div className="mt-3 flex justify-end gap-1.5">
                  {routine.status === "active" || routine.status === "error"
                    ? (
                      <button
                        type="button"
                        onClick={() => onPause(routine.id)}
                        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-gray-200 px-2 text-xs text-gray-700 hover:bg-gray-50"
                        title="Pause routine"
                      >
                        <Pause className="h-3.5 w-3.5" />
                        Pause
                      </button>
                    )
                    : null}
                  {routine.status === "paused" || routine.status === "error"
                    ? (
                      <button
                        type="button"
                        onClick={() => onResume(routine.id)}
                        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-gray-200 px-2 text-xs text-gray-700 hover:bg-gray-50"
                        title="Resume routine"
                      >
                        <Play className="h-3.5 w-3.5" />
                        Resume
                      </button>
                    )
                    : null}
                  <button
                    type="button"
                    onClick={() => onRunNow(routine.id)}
                    disabled={routine.status === "disabled" ||
                      routine.status === "deleted"}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-gray-200 px-2 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                    title="Queue a run now"
                  >
                    <RotateCw className="h-3.5 w-3.5" />
                    Run
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
    </section>
  );
}
