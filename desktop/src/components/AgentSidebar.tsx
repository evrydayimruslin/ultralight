// Agent sidebar — "text inbox" style flat list of agents.
// Replaces ConversationSidebar. Each entry is an agent (persistent identity).

import { useState, useRef, useEffect, useCallback } from 'react';
import type { Agent } from '../hooks/useAgentFleet';

interface AgentSidebarProps {
  agents: Agent[];
  activeAgentId: string | null;
  isOpen: boolean;
  onSelect: (agentId: string) => void;
  onNewAgent: () => void;
  onGoHome: () => void;
  onDelete: (agentId: string) => void;
  onStop: (agentId: string) => void;
  onClose: () => void;
  isAgentRunning: (agentId: string) => boolean;
}

// ── Helpers ──

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);

  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  if (hours < 24) return `${hours}h`;
  if (days < 7) return `${days}d`;
  return new Date(timestamp).toLocaleDateString();
}

function statusDot(status: string): string {
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

// ── Component ──

export default function AgentSidebar({
  agents,
  activeAgentId,
  isOpen,
  onSelect,
  onNewAgent,
  onGoHome,
  onDelete,
  onStop,
  onClose,
  isAgentRunning,
}: AgentSidebarProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [contextMenu, setContextMenu] = useState<{ agentId: string; x: number; y: number } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>();
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // Focus search on open
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => searchRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Close context menu on click outside
  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [contextMenu]);

  const handleSearch = useCallback((value: string) => {
    setSearchQuery(value);
    clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      // Search filtering is done client-side for agents
    }, 300);
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent, agentId: string) => {
    e.preventDefault();
    setContextMenu({ agentId, x: e.clientX, y: e.clientY });
  }, []);

  const handleDeleteFromMenu = useCallback(() => {
    if (!contextMenu) return;
    if (confirmDelete === contextMenu.agentId) {
      onDelete(contextMenu.agentId);
      setConfirmDelete(null);
      setContextMenu(null);
    } else {
      setConfirmDelete(contextMenu.agentId);
      setTimeout(() => setConfirmDelete(null), 3000);
    }
  }, [contextMenu, confirmDelete, onDelete]);

  const handleStopFromMenu = useCallback(() => {
    if (!contextMenu) return;
    onStop(contextMenu.agentId);
    setContextMenu(null);
  }, [contextMenu, onStop]);

  if (!isOpen) return null;

  // Filter agents by search
  const filtered = searchQuery
    ? agents.filter(a =>
        a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (a.initial_task && a.initial_task.toLowerCase().includes(searchQuery.toLowerCase()))
      )
    : agents;

  // Sort: running agents first, then by updated_at DESC
  const sorted = [...filtered].sort((a, b) => {
    const aRunning = a.status === 'running' ? 0 : 1;
    const bRunning = b.status === 'running' ? 0 : 1;
    if (aRunning !== bRunning) return aRunning - bRunning;
    return b.updated_at - a.updated_at;
  });

  return (
    <div className="flex flex-col w-64 h-full border-r border-ul-border bg-gray-50 flex-shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-ul-border">
        <span className="text-small font-medium text-ul-text">Agents</span>
        <div className="flex items-center gap-1">
          {/* Home button */}
          <button
            onClick={onGoHome}
            className="p-1 rounded hover:bg-gray-200 text-ul-text-secondary"
            title="Home"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6.5L8 2.5L13 6.5V13H10V9.5H6V13H3V6.5Z" />
            </svg>
          </button>
          {/* New agent */}
          <button
            onClick={onNewAgent}
            className="p-1 rounded hover:bg-gray-200 text-ul-text-secondary"
            title="New agent"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <line x1="8" y1="3" x2="8" y2="13" />
              <line x1="3" y1="8" x2="13" y2="8" />
            </svg>
          </button>
          {/* Close */}
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-gray-200 text-ul-text-secondary"
            title="Close sidebar"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <line x1="4" y1="4" x2="12" y2="12" />
              <line x1="12" y1="4" x2="4" y2="12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b border-ul-border">
        <input
          ref={searchRef}
          type="text"
          value={searchQuery}
          onChange={e => handleSearch(e.target.value)}
          placeholder="Search agents..."
          className="w-full px-2 py-1 text-small rounded border border-ul-border bg-white focus:outline-none focus:border-ul-border-focus"
        />
      </div>

      {/* Agent list */}
      <div className="flex-1 overflow-y-auto">
        {sorted.length === 0 ? (
          <div className="px-3 py-8 text-center text-caption text-ul-text-muted">
            {searchQuery ? 'No agents found' : 'No agents yet'}
          </div>
        ) : (
          sorted.map(agent => (
            <button
              key={agent.id}
              onClick={() => onSelect(agent.id)}
              onContextMenu={e => handleContextMenu(e, agent.id)}
              className={`
                w-full text-left px-3 py-2.5 border-b border-gray-100
                hover:bg-gray-100 transition-colors
                ${activeAgentId === agent.id ? 'bg-blue-50 border-l-2 border-l-blue-500' : ''}
              `}
            >
              <div className="flex items-center gap-2">
                {/* Status dot */}
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${statusDot(agent.status)}`} />
                {/* Name */}
                <span className="text-small font-medium text-ul-text truncate flex-1">
                  {agent.name}
                </span>
                {/* Time */}
                <span className="text-caption text-ul-text-muted flex-shrink-0">
                  {formatRelativeTime(agent.updated_at)}
                </span>
              </div>
              {/* Preview */}
              {agent.last_message_preview && (
                <p className="text-caption text-ul-text-muted mt-0.5 truncate pl-4">
                  {agent.last_message_preview}
                </p>
              )}
            </button>
          ))
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="fixed z-50 bg-white border border-ul-border rounded-md shadow-md py-1 min-w-[140px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {isAgentRunning(contextMenu.agentId) && (
            <button
              onClick={handleStopFromMenu}
              className="w-full text-left px-3 py-1.5 text-small text-ul-text hover:bg-gray-100"
            >
              Stop
            </button>
          )}
          <button
            onClick={handleDeleteFromMenu}
            className={`w-full text-left px-3 py-1.5 text-small hover:bg-gray-100
              ${confirmDelete === contextMenu.agentId ? 'text-ul-error font-medium' : 'text-ul-text'}
            `}
          >
            {confirmDelete === contextMenu.agentId ? 'Confirm Delete' : 'Delete'}
          </button>
        </div>
      )}
    </div>
  );
}
