// NavSidebar — Claude Code-inspired navigation sidebar.
// Sections: New Session, Dashboard, Capabilities (Library/Marketplace),
// Agents (time-grouped list), and bottom nav (Wallet/Settings).

import { useState, useRef, useEffect, useCallback } from 'react';
import type { Agent } from '../hooks/useAgentFleet';
import type { AppView } from '../hooks/useAppState';

// ── Props ──

interface NavSidebarProps {
  agents: Agent[];
  activeView: AppView;
  isOpen: boolean;
  onNavigateHome: () => void;
  onNavigateToLibrary: () => void;
  onNavigateToMarketplace: () => void;
  onNavigateToWallet: () => void;
  onNavigateToSettings: () => void;
  onSelectAgent: (agentId: string) => void;
  onNewAgent: () => void;
  onDeleteAgent: (agentId: string) => void;
  onStopAgent: (agentId: string) => void;
  onClose: () => void;
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

function CollapsibleSection({ title, expanded, onToggle, children }: {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-1">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-3 py-1.5 text-caption font-medium text-ul-text-muted uppercase tracking-wider hover:text-ul-text-secondary transition-colors"
      >
        {title}
        <svg
          width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
          className={`transition-transform ${expanded ? '' : '-rotate-90'}`}
        >
          <path d="M3 4.5L6 7.5L9 4.5" />
        </svg>
      </button>
      {expanded && <div className="px-1">{children}</div>}
    </div>
  );
}

// ── Icons (inline SVGs) ──

const DashboardIcon = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="2" width="5" height="5" rx="1" />
    <rect x="9" y="2" width="5" height="5" rx="1" />
    <rect x="2" y="9" width="5" height="5" rx="1" />
    <rect x="9" y="9" width="5" height="5" rx="1" />
  </svg>
);

const LibraryIcon = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 3h12v10H2z" />
    <path d="M5 3v10" />
  </svg>
);

const MarketplaceIcon = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 6l1.5-3h9L14 6" />
    <path d="M2 6v7h12V6" />
    <path d="M6 9h4" />
  </svg>
);

const WalletIcon = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="4" width="12" height="9" rx="1.5" />
    <path d="M2 4V3.5A1.5 1.5 0 013.5 2h7" />
    <circle cx="11.5" cy="8.5" r="1" />
  </svg>
);

const SettingsIcon = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="8" cy="8" r="2" />
    <path d="M8 2v2M8 12v2M2 8h2M12 8h2M3.76 3.76l1.41 1.41M10.83 10.83l1.41 1.41M3.76 12.24l1.41-1.41M10.83 5.17l1.41-1.41" />
  </svg>
);

// ── Component ──

export default function NavSidebar({
  agents,
  activeView,
  isOpen,
  onNavigateHome,
  onNavigateToLibrary,
  onNavigateToMarketplace,
  onNavigateToWallet,
  onNavigateToSettings,
  onSelectAgent,
  onNewAgent,
  onDeleteAgent,
  onStopAgent,
  onClose,
  isAgentRunning,
}: NavSidebarProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [capabilitiesExpanded, setCapabilitiesExpanded] = useState(() => !getCollapsed('ul_nav_capabilities_collapsed', false));
  const [agentsExpanded, setAgentsExpanded] = useState(() => !getCollapsed('ul_nav_agents_collapsed', false));
  const [contextMenu, setContextMenu] = useState<{ agentId: string; x: number; y: number } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

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

  const toggleCapabilities = useCallback(() => {
    setCapabilitiesExpanded(v => {
      const next = !v;
      setCollapsed('ul_nav_capabilities_collapsed', !next);
      return next;
    });
  }, []);

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

  // Filter + sort agents
  const filtered = searchQuery
    ? agents.filter(a =>
        a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (a.initial_task && a.initial_task.toLowerCase().includes(searchQuery.toLowerCase()))
      )
    : agents;

  const sorted = [...filtered].sort((a, b) => {
    const aRunning = a.status === 'running' ? 0 : 1;
    const bRunning = b.status === 'running' ? 0 : 1;
    if (aRunning !== bRunning) return aRunning - bRunning;
    return b.updated_at - a.updated_at;
  });

  const timeGroups = groupAgentsByTime(sorted);
  const activeAgentId = activeView.kind === 'agent' ? activeView.agentId : null;

  return (
    <div className="flex flex-col w-64 h-full border-r border-ul-border bg-gray-50 flex-shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-3 border-b border-ul-border">
        <span className="text-small font-semibold text-ul-text tracking-tight">Ultralight</span>
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

      {/* New Session button */}
      <div className="px-3 py-2">
        <button
          onClick={onNewAgent}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 text-small font-medium text-ul-text rounded-md border border-ul-border bg-white hover:bg-gray-50 transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
            <line x1="7" y1="2" x2="7" y2="12" />
            <line x1="2" y1="7" x2="12" y2="7" />
          </svg>
          New Session
        </button>
      </div>

      {/* Primary nav */}
      <nav className="px-2">
        <NavItem
          icon={DashboardIcon}
          label="Dashboard"
          active={activeView.kind === 'home'}
          onClick={onNavigateHome}
        />
      </nav>

      {/* Capabilities */}
      <CollapsibleSection title="Capabilities" expanded={capabilitiesExpanded} onToggle={toggleCapabilities}>
        <NavItem
          icon={LibraryIcon}
          label="Library"
          active={activeView.kind === 'library'}
          onClick={onNavigateToLibrary}
        />
        <NavItem
          icon={MarketplaceIcon}
          label="Marketplace"
          active={activeView.kind === 'marketplace'}
          onClick={onNavigateToMarketplace}
        />
      </CollapsibleSection>

      {/* Agents */}
      <CollapsibleSection title="Agents" expanded={agentsExpanded} onToggle={toggleAgents}>
        {/* Search */}
        <div className="px-2 pb-1.5">
          <input
            ref={searchRef}
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search agents..."
            className="w-full px-2 py-1 text-small rounded border border-ul-border bg-white focus:outline-none focus:border-ul-border-focus"
          />
        </div>

        {/* Time-grouped agent list */}
        <div className="flex-1 overflow-y-auto min-h-0" style={{ maxHeight: 'calc(100vh - 380px)' }}>
          {timeGroups.length === 0 ? (
            <div className="px-3 py-4 text-center text-caption text-ul-text-muted">
              {searchQuery ? 'No agents found' : 'No agents yet'}
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

      {/* Bottom nav */}
      <div className="border-t border-ul-border px-2 py-2">
        <NavItem
          icon={WalletIcon}
          label="Wallet"
          active={activeView.kind === 'wallet'}
          onClick={onNavigateToWallet}
        />
        <NavItem
          icon={SettingsIcon}
          label="Settings"
          active={activeView.kind === 'settings'}
          onClick={onNavigateToSettings}
        />
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
