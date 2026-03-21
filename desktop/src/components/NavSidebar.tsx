// NavSidebar — Claude Code-inspired navigation sidebar.
// Sections: Command, Tools, New Chat, Agents (time-grouped list),
// and bottom profile menu (Profile/Wallet/Settings).

import { useState, useRef, useEffect, useCallback } from 'react';
import { CirclePlus, Compass, Package, Wallet, Settings, User } from 'lucide-react';
import type { Agent } from '../hooks/useAgentFleet';
import type { AppView } from '../hooks/useAppState';
import { getToken, getApiBase } from '../lib/storage';

// ── Props ──

interface NavSidebarProps {
  agents: Agent[];
  activeView: AppView;
  isOpen: boolean;
  onNavigateHome: () => void;
  onNavigateToCapabilities: () => void;
  onNavigateToProfile: () => void;
  onNavigateToWallet: () => void;
  onNavigateToSettings: () => void;
  onSelectAgent: (agentId: string) => void;
  onNewAgent: () => void;
  onDeleteAgent: (agentId: string) => void;
  onStopAgent: (agentId: string) => void;
  isAgentRunning: (agentId: string) => boolean;
}

// ── Helpers (ported from AgentSidebar) ──

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

interface TimeGroup {
  label: string;
  agents: Agent[];
}

function groupAgentsByTime(agents: Agent[]): TimeGroup[] {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 86_400_000;
  const weekStart = todayStart - 7 * 86_400_000;

  const groups: Record<string, Agent[]> = {
    'Today': [],
    'Yesterday': [],
    'Previous 7 Days': [],
    'Older': [],
  };

  for (const agent of agents) {
    const t = agent.updated_at;
    if (t >= todayStart) groups['Today'].push(agent);
    else if (t >= yesterdayStart) groups['Yesterday'].push(agent);
    else if (t >= weekStart) groups['Previous 7 Days'].push(agent);
    else groups['Older'].push(agent);
  }

  return Object.entries(groups)
    .filter(([, list]) => list.length > 0)
    .map(([label, list]) => ({ label, agents: list }));
}

// ── localStorage helpers for collapse state ──

function getCollapsed(key: string, defaultVal: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v !== null ? v === 'true' : defaultVal;
  } catch { return defaultVal; }
}

function setCollapsed(key: string, val: boolean) {
  try { localStorage.setItem(key, String(val)); } catch { /* ignore */ }
}

// ── Sub-components ──

function NavItem({ icon, label, active, onClick }: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3 py-1.5 rounded-md text-small transition-colors
        ${active
          ? 'bg-ul-bg-active text-ul-text font-medium'
          : 'text-ul-text-secondary hover:bg-ul-bg-hover hover:text-ul-text'
        }`}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );
}

function CollapsibleSection({ title, expanded, onToggle, trailing, children }: {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  trailing?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-1">
      <div className="flex items-center px-3 py-1.5">
        <button
          onClick={onToggle}
          className="flex items-center gap-1 text-caption font-medium text-ul-text-muted uppercase tracking-wider hover:text-ul-text-secondary transition-colors"
        >
          {title}
          <svg
            width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
            className={`transition-transform ${expanded ? '' : '-rotate-90'}`}
          >
            <path d="M3 4.5L6 7.5L9 4.5" />
          </svg>
        </button>
        {trailing && <div className="ml-auto">{trailing}</div>}
      </div>
      {expanded && <div className="px-1">{children}</div>}
    </div>
  );
}

// ── Icons (Lucide) ── //

const iconProps = { size: 16, strokeWidth: 1.5 } as const;
const NewSessionIcon = <CirclePlus {...iconProps} />;
const CommandIcon = <Compass {...iconProps} />;
const ToolsIcon = <Package {...iconProps} />;


// ── Component ──

export default function NavSidebar({
  agents,
  activeView,
  isOpen,
  onNavigateHome,
  onNavigateToCapabilities,
  onNavigateToProfile,
  onNavigateToWallet,
  onNavigateToSettings,
  onSelectAgent,
  onNewAgent,
  onDeleteAgent,
  onStopAgent,
  isAgentRunning,
}: NavSidebarProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [agentsExpanded, setAgentsExpanded] = useState(() => !getCollapsed('ul_nav_agents_collapsed', false));
  const [contextMenu, setContextMenu] = useState<{ agentId: string; x: number; y: number } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [userInfo, setUserInfo] = useState<{ email: string; display_name: string | null } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const profileMenuRef = useRef<HTMLDivElement>(null);

  // Fetch user info for profile menu
  useEffect(() => {
    const token = getToken();
    if (!token) return;
    fetch(`${getApiBase()}/api/user`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data) setUserInfo({ email: data.email, display_name: data.display_name });
      })
      .catch(() => {});
  }, []);

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

  // Close profile menu on click outside
  useEffect(() => {
    if (!profileMenuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(e.target as Node)) {
        setProfileMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [profileMenuOpen]);

  const toggleAgents = useCallback(() => {
    setAgentsExpanded(v => {
      const next = !v;
      setCollapsed('ul_nav_agents_collapsed', !next);
      return next;
    });
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent, agentId: string) => {
    e.preventDefault();
    setContextMenu({ agentId, x: e.clientX, y: e.clientY });
  }, []);

  const handleDeleteFromMenu = useCallback(() => {
    if (!contextMenu) return;
    if (confirmDelete === contextMenu.agentId) {
      onDeleteAgent(contextMenu.agentId);
      setConfirmDelete(null);
      setContextMenu(null);
    } else {
      setConfirmDelete(contextMenu.agentId);
      setTimeout(() => setConfirmDelete(null), 3000);
    }
  }, [contextMenu, confirmDelete, onDeleteAgent]);

  const handleStopFromMenu = useCallback(() => {
    if (!contextMenu) return;
    onStopAgent(contextMenu.agentId);
    setContextMenu(null);
  }, [contextMenu, onStopAgent]);

  if (!isOpen) return null;

  // Sort agents
  const sorted = [...agents].sort((a, b) => {
    const aRunning = a.status === 'running' ? 0 : 1;
    const bRunning = b.status === 'running' ? 0 : 1;
    if (aRunning !== bRunning) return aRunning - bRunning;
    return b.updated_at - a.updated_at;
  });

  const timeGroups = groupAgentsByTime(sorted);
  const activeAgentId = activeView.kind === 'agent' ? activeView.agentId : null;
  const displayName = userInfo?.display_name || userInfo?.email?.split('@')[0] || 'User';
  const initial = displayName.charAt(0).toUpperCase();

  return (
    <div className="flex flex-col w-64 h-full border-r border-ul-border bg-gray-50 flex-shrink-0">
      {/* Primary nav */}
      <nav className="px-2 pt-2">
        <NavItem
          icon={CommandIcon}
          label="Command"
          active={activeView.kind === 'home'}
          onClick={onNavigateHome}
        />
        <NavItem
          icon={ToolsIcon}
          label="Tools"
          active={activeView.kind === 'capabilities'}
          onClick={onNavigateToCapabilities}
        />
        <NavItem
          icon={NewSessionIcon}
          label="New Chat"
          active={activeView.kind === 'new-chat'}
          onClick={onNewAgent}
        />
      </nav>

      {/* Agents */}
      <CollapsibleSection
        title="Agents"
        expanded={agentsExpanded}
        onToggle={toggleAgents}
        trailing={
          agents.length > 0 ? (
            <button
              onClick={e => { e.stopPropagation(); setSearchOpen(true); }}
              className="p-0.5 rounded hover:bg-ul-bg-hover text-ul-text-muted hover:text-ul-text-secondary transition-colors"
              title="Search agents"
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="7" cy="7" r="4.5" />
                <line x1="10.5" y1="10.5" x2="14" y2="14" />
              </svg>
            </button>
          ) : null
        }
      >
        {/* Time-grouped agent list */}
        <div className="flex-1 overflow-y-auto min-h-0" style={{ maxHeight: 'calc(100vh - 340px)' }}>
          {timeGroups.length === 0 ? (
            <div className="px-3 py-4 text-center text-caption text-ul-text-muted">
              No agents yet
            </div>
          ) : (
            timeGroups.map(group => (
              <div key={group.label}>
                <div className="px-3 py-1">
                  <span className="text-caption text-ul-text-muted">{group.label}</span>
                </div>
                {group.agents.map(agent => (
                  <button
                    key={agent.id}
                    onClick={() => onSelectAgent(agent.id)}
                    onContextMenu={e => handleContextMenu(e, agent.id)}
                    className={`w-full text-left px-3 py-1.5 rounded-md transition-colors mx-1
                      ${activeAgentId === agent.id
                        ? 'bg-ul-bg-active'
                        : 'hover:bg-ul-bg-hover'
                      }`}
                    style={{ width: 'calc(100% - 8px)' }}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${statusDot(agent.status)}`} />
                      <span className="text-small text-ul-text truncate flex-1">{agent.name}</span>
                      <span className="text-caption text-ul-text-muted flex-shrink-0">
                        {formatRelativeTime(agent.updated_at)}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      </CollapsibleSection>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Profile menu trigger */}
      <div className="relative border-t border-ul-border px-2 py-2" ref={profileMenuRef}>
        {profileMenuOpen && (
          <div className="absolute bottom-full left-2 right-2 mb-1 bg-white border border-ul-border rounded-md shadow-md py-1 z-50">
            <button
              onClick={() => { setProfileMenuOpen(false); onNavigateToProfile(); }}
              className="w-full text-left px-3 py-1.5 text-small text-ul-text hover:bg-gray-100 flex items-center gap-2.5"
            >
              <User {...iconProps} />
              Profile
            </button>
            <button
              onClick={() => { setProfileMenuOpen(false); onNavigateToWallet(); }}
              className="w-full text-left px-3 py-1.5 text-small text-ul-text hover:bg-gray-100 flex items-center gap-2.5"
            >
              <Wallet {...iconProps} />
              Wallet
            </button>
            <button
              onClick={() => { setProfileMenuOpen(false); onNavigateToSettings(); }}
              className="w-full text-left px-3 py-1.5 text-small text-ul-text hover:bg-gray-100 flex items-center gap-2.5"
            >
              <Settings {...iconProps} />
              Settings
            </button>
          </div>
        )}
        <button
          onClick={() => setProfileMenuOpen(v => !v)}
          className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md text-small text-ul-text-secondary hover:bg-ul-bg-hover transition-colors"
        >
          <span className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-caption font-semibold text-ul-text flex-shrink-0">
            {initial}
          </span>
          <span className="truncate flex-1 text-left">{displayName}</span>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
            className={`transition-transform flex-shrink-0 ${profileMenuOpen ? 'rotate-180' : ''}`}
          >
            <path d="M3 4.5L6 7.5L9 4.5" />
          </svg>
        </button>
      </div>

      {/* Search modal */}
      {searchOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center pt-[15%] bg-black/20"
          onClick={() => { setSearchOpen(false); setSearchQuery(''); }}
        >
          <div
            className="w-[420px] max-h-[60vh] bg-white rounded-lg shadow-xl border border-ul-border flex flex-col overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 px-4 py-3 border-b border-ul-border">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-ul-text-muted flex-shrink-0">
                <circle cx="7" cy="7" r="4.5" />
                <line x1="10.5" y1="10.5" x2="14" y2="14" />
              </svg>
              <input
                ref={searchRef}
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search agents..."
                className="flex-1 text-sm outline-none bg-transparent text-ul-text placeholder:text-ul-text-muted"
                autoFocus
                onKeyDown={e => { if (e.key === 'Escape') { setSearchOpen(false); setSearchQuery(''); } }}
              />
              <button
                onClick={() => { setSearchOpen(false); setSearchQuery(''); }}
                className="text-ul-text-muted hover:text-ul-text"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <line x1="3" y1="3" x2="11" y2="11" />
                  <line x1="11" y1="3" x2="3" y2="11" />
                </svg>
              </button>
            </div>
            <div className="overflow-y-auto flex-1">
              {sorted.filter(a =>
                !searchQuery ||
                a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                (a.initial_task && a.initial_task.toLowerCase().includes(searchQuery.toLowerCase()))
              ).length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-ul-text-muted">
                  No agents found
                </div>
              ) : (
                sorted
                  .filter(a =>
                    !searchQuery ||
                    a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    (a.initial_task && a.initial_task.toLowerCase().includes(searchQuery.toLowerCase()))
                  )
                  .map(agent => (
                    <button
                      key={agent.id}
                      onClick={() => { onSelectAgent(agent.id); setSearchOpen(false); setSearchQuery(''); }}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-gray-50 transition-colors
                        ${activeAgentId === agent.id ? 'bg-gray-50' : ''}`}
                    >
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${statusDot(agent.status)}`} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-ul-text truncate">{agent.name}</div>
                        {agent.initial_task && (
                          <div className="text-xs text-ul-text-muted truncate">{agent.initial_task}</div>
                        )}
                      </div>
                      <span className="text-xs text-ul-text-muted flex-shrink-0">
                        {formatRelativeTime(agent.updated_at)}
                      </span>
                    </button>
                  ))
              )}
            </div>
          </div>
        </div>
      )}

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
