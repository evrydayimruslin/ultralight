// Subagent window — simplified chat viewer for subagent pop-out windows.
// Shows agent name/status header + message list + admin input.
// Loaded when main.tsx detects ?subagent= query param.

import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Agent } from '../hooks/useAgentFleet';
import { agentRunner, type AgentEvent } from '../lib/agentRunner';
import MessageList from './MessageList';
import type { Message } from '../hooks/useChat';

interface SubagentWindowProps {
  agentId: string;
}

// ── Helpers ──

function statusDotClass(status: string): string {
  switch (status) {
    case 'running': return 'bg-green-500';
    case 'pending': return 'bg-gray-300';
    case 'completed': return 'bg-blue-400';
    case 'error': return 'bg-red-500';
    case 'stopped': return 'bg-amber-400';
    case 'waiting_for_approval': return 'bg-amber-500';
    default: return 'bg-gray-300';
  }
}

function statusLabel(status: string): string {
  if (status === 'waiting_for_approval') return 'Awaiting Approval';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

// ── Component ──

export default function SubagentWindow({ agentId }: SubagentWindowProps) {
  const [agent, setAgent] = useState<Agent | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  // Load agent + messages
  useEffect(() => {
    mountedRef.current = true;

    async function load() {
      try {
        const ag = await invoke<Agent | null>('db_get_agent', { id: agentId });
        if (!ag) {
          setError('Agent not found');
          setLoading(false);
          return;
        }
        if (!mountedRef.current) return;
        setAgent(ag);

        // Load conversation messages
        const msgs = await invoke<Message[]>('db_load_messages', {
          conversationId: ag.conversation_id,
        });
        if (mountedRef.current) {
          setMessages(msgs);
          setLoading(false);
        }
      } catch (err) {
        if (mountedRef.current) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      }
    }

    load();

    return () => { mountedRef.current = false; };
  }, [agentId]);

  // Subscribe to agent status changes
  useEffect(() => {
    const unsubscribe = agentRunner.on((event: AgentEvent) => {
      if (!mountedRef.current || event.agentId !== agentId) return;

      if (event.type === 'status_change') {
        setAgent(prev => prev ? { ...prev, status: event.status, updated_at: Date.now() } : prev);
      }
    });

    return unsubscribe;
  }, [agentId]);

  // Poll messages for live updates (every 2s when running)
  useEffect(() => {
    if (!agent || agent.status !== 'running') return;

    const interval = setInterval(async () => {
      try {
        // Try getting messages from agentRunner first (in-memory, more recent)
        const runtimeMsgs = agentRunner.getMessages(agentId);
        if (runtimeMsgs && mountedRef.current) {
          setMessages(runtimeMsgs);
          return;
        }

        // Fall back to DB
        const msgs = await invoke<Message[]>('db_load_messages', {
          conversationId: agent.conversation_id,
        });
        if (mountedRef.current) {
          setMessages(msgs);
        }
      } catch {
        // ignore polling errors
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [agent, agentId]);

  const handleStop = useCallback(() => {
    agentRunner.stop(agentId);
  }, [agentId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-white">
        <p className="text-body text-ul-text-muted">Loading agent...</p>
      </div>
    );
  }

  if (error || !agent) {
    return (
      <div className="flex items-center justify-center h-full bg-white">
        <p className="text-body text-ul-error">{error || 'Agent not found'}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <header className="flex items-center justify-between px-4 h-nav border-b border-ul-border flex-shrink-0">
        <div className="flex items-center gap-3">
          <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${statusDotClass(agent.status)}`} />
          <div>
            <h1 className="text-h3 text-ul-text tracking-tight">{agent.name}</h1>
            <span className="text-caption text-ul-text-muted">
              {agent.role} · {statusLabel(agent.status)}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {agent.status === 'running' && (
            <button
              onClick={handleStop}
              className="px-3 py-1 text-small rounded border border-ul-border text-ul-error hover:bg-red-50 transition-colors"
            >
              Stop
            </button>
          )}
        </div>
      </header>

      {/* Task display */}
      {agent.initial_task && (
        <div className="px-4 py-2 bg-gray-50 border-b border-ul-border">
          <p className="text-caption text-ul-text-muted">
            <span className="font-medium">Directive:</span> {agent.initial_task}
          </p>
        </div>
      )}

      {/* Messages */}
      <MessageList messages={messages} isLoading={agent.status === 'running'} />
    </div>
  );
}
