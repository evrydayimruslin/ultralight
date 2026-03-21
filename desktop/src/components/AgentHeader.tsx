// Agent header — collapsed shows name + status, expanded shows full config panel.
// Replaces the old static header bar in ChatView.

import { useState, useCallback, useEffect, useRef } from 'react';
import type { Agent } from '../hooks/useAgentFleet';
import ModelSelector from './ModelSelector';
import BalanceIndicator from './BalanceIndicator';
import ContextIndicator from './ContextIndicator';
import { openSubagentWindow } from '../lib/multiWindow';

interface ConnectedApp {
  id: string;
  name: string;
  description: string | null;
  functionCount: number;
}

interface AgentHeaderProps {
  agent: Agent | null;
  isRunning: boolean;
  tokenCount: number;
  contextWindow: number;
  childAgents: Agent[];
  onUpdateAgent: (updates: Partial<Agent>) => Promise<void>;
  onStop: () => void;
  onNewSession: () => void;
  onSignOut: () => void;
  onOpenSubagentChat?: (agentId: string) => void;
  onStopSubagent?: (agentId: string) => void;
  executeMcpTool?: (name: string, args: Record<string, unknown>) => Promise<string>;
}

// ── Helpers ──

function statusDotClass(status: string): string {
  switch (status) {
    case 'running': return 'bg-ul-success';
    case 'pending': return 'bg-gray-300';
    case 'completed': return 'bg-blue-400';
    case 'error': return 'bg-ul-error';
    case 'stopped': return 'bg-ul-warning';
    case 'waiting_for_approval': return 'bg-amber-500';
    default: return 'bg-gray-300';
  }
}

function formatElapsed(createdAt: number): string {
  const diff = Date.now() - createdAt;
  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  if (minutes < 1) return '<1m';
  if (minutes < 60) return `${minutes}m`;
  return `${hours}h ${minutes % 60}m`;
}

// ── Component ──

export default function AgentHeader({
  agent,
  isRunning,
  tokenCount,
  contextWindow,
  childAgents,
  onUpdateAgent,
  onStop,
  onNewSession,
  onSignOut,
  onOpenSubagentChat,
  onStopSubagent,
  executeMcpTool,
}: AgentHeaderProps) {
  const [expanded, setExpanded] = useState(false);
  const [adminNotes, setAdminNotes] = useState(agent?.admin_notes ?? '');

  // Connected apps state
  const [connectedApps, setConnectedApps] = useState<ConnectedApp[]>([]);
  const [appSearchQuery, setAppSearchQuery] = useState('');
  const [appSearchResults, setAppSearchResults] = useState<ConnectedApp[]>([]);
  const [searchingApps, setSearchingApps] = useState(false);
  const appSearchRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync admin notes when agent changes
  const agentNotesKey = agent?.id ?? '';
  const [lastAgentId, setLastAgentId] = useState(agentNotesKey);
  if (agentNotesKey !== lastAgentId) {
    setLastAgentId(agentNotesKey);
    setAdminNotes(agent?.admin_notes ?? '');
    // Load existing connected apps from agent record
    if (agent?.connected_app_ids) {
      try {
        const ids: string[] = JSON.parse(agent.connected_app_ids);
        // Populate with just IDs for now — names will resolve on inspect
        setConnectedApps(ids.map(id => ({ id, name: id, description: null, functionCount: 0 })));
        // Inspect each to get proper names
        if (executeMcpTool && ids.length > 0) {
          ids.forEach(async (appId) => {
            try {
              const result = await executeMcpTool('ul_discover', { scope: 'library', action: 'inspect', app_id: appId });
              const parsed = JSON.parse(result);
              if (parsed.app) {
                setConnectedApps(prev => prev.map(a =>
                  a.id === appId ? {
                    ...a,
                    name: parsed.app.name || appId,
                    description: parsed.app.description || null,
                    functionCount: parsed.app.manifest?.functions ? Object.keys(parsed.app.manifest.functions).length : 0,
                  } : a
                ));
              }
            } catch { /* keep placeholder */ }
          });
        }
      } catch {
        setConnectedApps([]);
      }
    } else {
      setConnectedApps([]);
    }
  }

  const handleNotesBlur = useCallback(async () => {
    if (!agent) return;
    if (adminNotes !== (agent.admin_notes ?? '')) {
      await onUpdateAgent({ admin_notes: adminNotes || null } as Partial<Agent>);
    }
  }, [agent, adminNotes, onUpdateAgent]);

  // ── Connected Apps search (debounced) ──

  useEffect(() => {
    if (appSearchRef.current) clearTimeout(appSearchRef.current);
    const q = appSearchQuery.trim();
    if (!q || q.length < 2 || !executeMcpTool) {
      setAppSearchResults([]);
      return;
    }

    appSearchRef.current = setTimeout(async () => {
      setSearchingApps(true);
      try {
        const result = await executeMcpTool('ul_discover', {
          scope: 'library',
          query: q,
        });
        const parsed = JSON.parse(result);
        const results: ConnectedApp[] = (parsed.results || [])
          .filter((r: { id: string }) => !connectedApps.some(ca => ca.id === r.id))
          .map((r: { id: string; name: string; description?: string; function_count?: number }) => ({
            id: r.id,
            name: r.name,
            description: r.description || null,
            functionCount: r.function_count || 0,
          }));
        setAppSearchResults(results);
      } catch {
        setAppSearchResults([]);
      } finally {
        setSearchingApps(false);
      }
    }, 400);

    return () => { if (appSearchRef.current) clearTimeout(appSearchRef.current); };
  }, [appSearchQuery, executeMcpTool, connectedApps]);

  const addConnectedApp = useCallback(async (app: ConnectedApp) => {
    const next = [...connectedApps, app];
    setConnectedApps(next);
    setAppSearchResults(prev => prev.filter(r => r.id !== app.id));
    setAppSearchQuery('');
    // Persist to agent record
    if (agent) {
      await onUpdateAgent({ connected_app_ids: JSON.stringify(next.map(a => a.id)) } as Partial<Agent>);
    }
  }, [connectedApps, agent, onUpdateAgent]);

  const removeConnectedApp = useCallback(async (id: string) => {
    const next = connectedApps.filter(a => a.id !== id);
    setConnectedApps(next);
    // Persist to agent record
    if (agent) {
      await onUpdateAgent({ connected_app_ids: next.length > 0 ? JSON.stringify(next.map(a => a.id)) : null } as Partial<Agent>);
    }
  }, [connectedApps, agent, onUpdateAgent]);

  return (
    <div className="border-b border-ul-border bg-white flex-shrink-0">
      {/* Collapsed header — always visible */}
      <header className="flex items-center justify-between px-4 h-nav">
        <div className="flex items-center gap-3">
          {/* Agent name + status */}
          {agent ? (
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-2 hover:bg-gray-50 rounded px-2 py-1 -mx-2 transition-colors"
            >
              <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${statusDotClass(agent.status)}`} />
              <span className="text-h3 text-ul-text tracking-tight">{agent.name}</span>
              <svg
                width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
                className={`transition-transform ${expanded ? 'rotate-180' : ''}`}
              >
                <path d="M3.5 5.5L7 9L10.5 5.5" />
              </svg>
            </button>
          ) : (
            <h1 className="text-h3 text-ul-text tracking-tight">Ultralight</h1>
          )}
        </div>

        <div className="flex items-center gap-2">
          <ContextIndicator tokenCount={tokenCount} contextWindow={contextWindow} />
          <BalanceIndicator />
          <button onClick={onSignOut} className="btn-ghost btn-sm text-caption text-ul-text-muted" title="Sign out">
            Sign Out
          </button>
        </div>
      </header>

      {/* Expanded config panel */}
      {expanded && agent && (
        <div className="px-4 pb-4 border-t border-ul-border bg-gray-50">
          {/* Config grid */}
          <div className="grid grid-cols-2 gap-3 mt-3">
            <div>
              <label className="text-caption text-ul-text-muted block mb-1">Role</label>
              <span className="text-small text-ul-text capitalize">{agent.role}</span>
            </div>
            <div>
              <label className="text-caption text-ul-text-muted block mb-1">Model</label>
              <ModelSelector />
            </div>
            <div>
              <label className="text-caption text-ul-text-muted block mb-1">Directory</label>
              <span className="text-small text-ul-text-secondary truncate block">
                {agent.project_dir ? agent.project_dir.split('/').slice(-2).join('/') : '—'}
              </span>
            </div>
            <div>
              <label className="text-caption text-ul-text-muted block mb-1">Permissions</label>
              <span className="text-small text-ul-text capitalize">{agent.permission_level}</span>
            </div>
          </div>

          {/* Task */}
          {agent.initial_task && (
            <div className="mt-3">
              <label className="text-caption text-ul-text-muted block mb-1">Task</label>
              <p className="text-small text-ul-text-secondary line-clamp-2">{agent.initial_task}</p>
            </div>
          )}

          {/* Admin notes */}
          <div className="mt-3">
            <label className="text-caption text-ul-text-muted block mb-1">Admin Notes</label>
            <textarea
              value={adminNotes}
              onChange={e => setAdminNotes(e.target.value)}
              onBlur={handleNotesBlur}
              placeholder="Add guidance for this agent..."
              className="w-full px-2 py-1.5 text-small rounded border border-ul-border bg-white focus:outline-none focus:border-ul-border-focus resize-none"
              rows={2}
            />
          </div>

          {/* Connected Apps */}
          {executeMcpTool && (
            <div className="mt-3">
              <label className="text-caption text-ul-text-muted block mb-1.5">
                Connected Apps
                {connectedApps.length > 0 && (
                  <span className="ml-1.5 text-[10px] text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">
                    {connectedApps.length} connected
                  </span>
                )}
              </label>

              {/* Selected apps */}
              {connectedApps.length > 0 && (
                <div className="space-y-1 rounded border border-emerald-200 p-2 bg-emerald-50/30 mb-2">
                  {connectedApps.map(app => (
                    <div key={app.id} className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                      <span className="text-caption text-ul-text truncate flex-1">{app.name}</span>
                      {app.functionCount > 0 && (
                        <span className="text-[10px] text-ul-text-muted">{app.functionCount} fn</span>
                      )}
                      <button
                        type="button"
                        onClick={() => removeConnectedApp(app.id)}
                        className="text-[10px] text-red-500 hover:text-red-700 px-1"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Search input */}
              <div className="relative">
                <input
                  type="text"
                  value={appSearchQuery}
                  onChange={e => setAppSearchQuery(e.target.value)}
                  placeholder="Search your apps to connect..."
                  className="w-full text-small rounded border border-ul-border px-2 py-1.5 bg-white focus:outline-none focus:border-ul-border-focus"
                />
                {searchingApps && (
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-ul-text-muted">
                    searching...
                  </span>
                )}
              </div>

              {/* Search results dropdown */}
              {appSearchResults.length > 0 && (
                <div className="mt-1 rounded border border-ul-border bg-white shadow-sm max-h-40 overflow-y-auto">
                  {appSearchResults.map(app => (
                    <button
                      key={app.id}
                      type="button"
                      onClick={() => addConnectedApp(app)}
                      className="w-full text-left px-3 py-1.5 hover:bg-gray-50 flex items-center gap-2 border-b border-ul-border last:border-b-0"
                    >
                      <span className="text-caption text-ul-text truncate flex-1">{app.name}</span>
                      {app.description && (
                        <span className="text-[10px] text-ul-text-muted truncate max-w-[150px]">{app.description}</span>
                      )}
                      <span className="text-[10px] text-emerald-600 shrink-0">+ connect</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Status + Actions */}
          <div className="flex items-center justify-between mt-3">
            <span className="text-caption text-ul-text-muted">
              {agent.status === 'waiting_for_approval' ? 'Awaiting Approval' : agent.status} · {formatElapsed(agent.created_at)}
            </span>
            <div className="flex items-center gap-2">
              {isRunning && (
                <button onClick={onStop} className="btn-ghost btn-sm text-caption text-ul-error">
                  Stop
                </button>
              )}
              <button onClick={onNewSession} className="btn-ghost btn-sm text-caption">
                New Session
              </button>
            </div>
          </div>

          {/* Subagents */}
          {childAgents.length > 0 && (
            <div className="mt-3 pt-3 border-t border-ul-border">
              <label className="text-caption text-ul-text-muted block mb-2">
                Subagents ({childAgents.length})
              </label>
              <div className="space-y-2">
                {childAgents.map(child => (
                  <div key={child.id} className="flex items-center gap-2 px-2 py-1.5 bg-white rounded border border-ul-border">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${statusDotClass(child.status)}`} />
                    <span className="text-small text-ul-text flex-1 truncate">{child.name}</span>
                    <span className="text-caption text-ul-text-muted">{child.role}</span>
                    <button
                      onClick={() => openSubagentWindow(child.id, child.name)}
                      className="text-caption text-blue-500 hover:text-blue-700 whitespace-nowrap"
                    >
                      Open Chat ↗
                    </button>
                    {child.status === 'running' && onStopSubagent && (
                      <button
                        onClick={() => onStopSubagent(child.id)}
                        className="text-caption text-ul-error hover:text-red-700"
                      >
                        Stop
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
