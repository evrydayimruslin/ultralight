// Agent header — collapsed shows name + status, expanded shows full config panel.
// Uses shared AgentConfigPanel for the config UI.

import { useState } from 'react';
import type { Agent } from '../hooks/useAgentFleet';
import BalanceIndicator from './BalanceIndicator';
import ContextIndicator from './ContextIndicator';
import AgentConfigPanel from './AgentConfigPanel';
import { openSubagentWindow } from '../lib/multiWindow';

// ── Types ──

interface AgentHeaderProps {
  agent: Agent | null;
  isRunning: boolean;
  tokenCount: number;
  contextWindow: number;
  childAgents: Agent[];
  allAgents: Agent[];
  onUpdateAgent: (updates: Partial<Agent>) => Promise<void>;
  onStop: () => void;
  onNewSession: () => void;
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
  allAgents,
  onUpdateAgent,
  onStop,
  onNewSession,
  onOpenSubagentChat,
  onStopSubagent,
  executeMcpTool,
}: AgentHeaderProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border-b border-ul-border bg-white flex-shrink-0">
      {/* Collapsed header — always visible */}
      <header className="flex items-center justify-between px-4 h-nav">
        <div className="flex items-center gap-3">
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
        </div>
      </header>

      {/* Expanded config panel — uses shared AgentConfigPanel */}
      {expanded && agent && (
        <div className="px-4 pb-4 border-t border-ul-border bg-gray-50 max-h-[70vh] overflow-y-auto">
          <div className="mt-3">
            <AgentConfigPanel
              agent={agent}
              allAgents={allAgents}
              onUpdateAgent={onUpdateAgent}
              onNavigateToAgent={onOpenSubagentChat}
              executeMcpTool={executeMcpTool}
              showModelSelector
            />
          </div>

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
