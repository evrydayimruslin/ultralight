// Agent header — collapsed shows name + status, expanded shows full config panel.
// Replaces the old static header bar in ChatView.

import { useState, useCallback } from 'react';
import type { Agent } from '../hooks/useAgentFleet';
import ModelSelector from './ModelSelector';
import BalanceIndicator from './BalanceIndicator';
import ContextIndicator from './ContextIndicator';
import { openSubagentWindow } from '../lib/multiWindow';

interface AgentHeaderProps {
  agent: Agent | null;
  isRunning: boolean;
  tokenCount: number;
  contextWindow: number;
  sidebarOpen: boolean;
  childAgents: Agent[];
  onToggleSidebar: () => void;
  onUpdateAgent: (updates: Partial<Agent>) => Promise<void>;
  onStop: () => void;
  onNewSession: () => void;
  onSignOut: () => void;
  onOpenSubagentChat?: (agentId: string) => void;
  onStopSubagent?: (agentId: string) => void;
}

// ── Helpers ──

function statusDotClass(status: string): string {
  switch (status) {
    case 'running': return 'bg-ul-success';
    case 'pending': return 'bg-gray-300';
    case 'completed': return 'bg-blue-400';
    case 'error': return 'bg-ul-error';
    case 'stopped': return 'bg-ul-warning';
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
  sidebarOpen,
  childAgents,
  onToggleSidebar,
  onUpdateAgent,
  onStop,
  onNewSession,
  onSignOut,
  onOpenSubagentChat,
  onStopSubagent,
}: AgentHeaderProps) {
  const [expanded, setExpanded] = useState(false);
  const [adminNotes, setAdminNotes] = useState(agent?.admin_notes ?? '');

  // Sync admin notes when agent changes
  const agentNotesKey = agent?.id ?? '';
  const [lastAgentId, setLastAgentId] = useState(agentNotesKey);
  if (agentNotesKey !== lastAgentId) {
    setLastAgentId(agentNotesKey);
    setAdminNotes(agent?.admin_notes ?? '');
  }

  const handleNotesBlur = useCallback(async () => {
    if (!agent) return;
    if (adminNotes !== (agent.admin_notes ?? '')) {
      await onUpdateAgent({ admin_notes: adminNotes || null } as Partial<Agent>);
    }
  }, [agent, adminNotes, onUpdateAgent]);

  return (
    <div className="border-b border-ul-border bg-white flex-shrink-0">
      {/* Collapsed header — always visible */}
      <header className="flex items-center justify-between px-4 h-nav">
        <div className="flex items-center gap-3">
          {/* Sidebar toggle */}
          <button
            onClick={onToggleSidebar}
            className="p-1 rounded hover:bg-gray-100 text-ul-text-secondary"
            title={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <line x1="3" y1="5" x2="15" y2="5" />
              <line x1="3" y1="9" x2="15" y2="9" />
              <line x1="3" y1="13" x2="15" y2="13" />
            </svg>
          </button>

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

          {/* Status + Actions */}
          <div className="flex items-center justify-between mt-3">
            <span className="text-caption text-ul-text-muted">
              {agent.status} · {formatElapsed(agent.created_at)}
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
