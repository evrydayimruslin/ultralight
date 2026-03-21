// Agent header — collapsed shows name + status, expanded shows full config panel.
// Supports editable Task, Admin Notes, granular function selection per connected app,
// per-function conventions, and fleet awareness.

import { useState, useCallback, useEffect, useRef } from 'react';
import type { Agent } from '../hooks/useAgentFleet';
import ModelSelector from './ModelSelector';
import BalanceIndicator from './BalanceIndicator';
import ContextIndicator from './ContextIndicator';
import { openSubagentWindow } from '../lib/multiWindow';

// ── Types ──

interface AppFunction {
  name: string;
  description: string;
  selected: boolean;
  convention: string;
}

interface ConnectedApp {
  id: string;
  name: string;
  description: string | null;
  functions: AppFunction[];
  expanded: boolean; // UI toggle for showing function list
}

/** Persisted shape in agent.connected_apps JSON */
interface ConnectedAppsConfig {
  [appId: string]: {
    name: string;
    selected_functions: string[];
    conventions: Record<string, string>;
  };
}

interface AgentHeaderProps {
  agent: Agent | null;
  isRunning: boolean;
  tokenCount: number;
  contextWindow: number;
  childAgents: Agent[];
  siblingAgents: Agent[];
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

/** Build ConnectedAppsConfig from current UI state for persistence */
function buildAppsConfig(apps: ConnectedApp[]): ConnectedAppsConfig {
  const config: ConnectedAppsConfig = {};
  for (const app of apps) {
    const selectedFns = app.functions.filter(f => f.selected).map(f => f.name);
    const conventions: Record<string, string> = {};
    for (const fn of app.functions) {
      if (fn.convention.trim()) {
        conventions[fn.name] = fn.convention.trim();
      }
    }
    config[app.id] = {
      name: app.name,
      selected_functions: selectedFns,
      conventions,
    };
  }
  return config;
}

// ── Component ──

export default function AgentHeader({
  agent,
  isRunning,
  tokenCount,
  contextWindow,
  childAgents,
  siblingAgents,
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
  const [task, setTask] = useState(agent?.initial_task ?? '');
  const [editingTask, setEditingTask] = useState(false);

  // Connected apps state
  const [connectedApps, setConnectedApps] = useState<ConnectedApp[]>([]);
  const [appSearchQuery, setAppSearchQuery] = useState('');
  const [appSearchResults, setAppSearchResults] = useState<Array<{ id: string; name: string; description: string | null }>>([]);
  const [searchingApps, setSearchingApps] = useState(false);
  const appSearchRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync state when agent changes
  const agentKey = agent?.id ?? '';
  const [lastAgentId, setLastAgentId] = useState(agentKey);
  if (agentKey !== lastAgentId) {
    setLastAgentId(agentKey);
    setAdminNotes(agent?.admin_notes ?? '');
    setTask(agent?.initial_task ?? '');
    setEditingTask(false);

    // Load connected apps from agent record
    if (agent?.connected_apps) {
      try {
        const config: ConnectedAppsConfig = JSON.parse(agent.connected_apps);
        const apps: ConnectedApp[] = Object.entries(config).map(([appId, cfg]) => ({
          id: appId,
          name: cfg.name,
          description: null,
          functions: [], // Will be populated on inspect
          expanded: false,
        }));
        setConnectedApps(apps);

        // Inspect each app to get full function lists
        if (executeMcpTool) {
          Object.entries(config).forEach(async ([appId, cfg]) => {
            try {
              const result = await executeMcpTool('ul_discover', { scope: 'inspect', app_id: appId });
              const parsed = JSON.parse(result);
              const manifest = parsed.manifest
                ? (typeof parsed.manifest === 'string' ? JSON.parse(parsed.manifest) : parsed.manifest)
                : parsed.app?.manifest;
              const appName = parsed.app?.name || parsed.metadata?.name || parsed.name || cfg.name;
              const appDesc = parsed.app?.description || parsed.metadata?.description || parsed.description || null;

              // Build function list from manifest or fallback
              const fnList: AppFunction[] = [];
              if (manifest?.functions) {
                for (const [fnName, fn] of Object.entries(manifest.functions)) {
                  fnList.push({
                    name: fnName,
                    description: (fn as { description?: string }).description || '',
                    selected: cfg.selected_functions.includes(fnName),
                    convention: cfg.conventions[fnName] || '',
                  });
                }
              } else {
                const fns = parsed.functions || parsed.tools || [];
                for (const fn of fns) {
                  fnList.push({
                    name: fn.name,
                    description: fn.description || '',
                    selected: cfg.selected_functions.includes(fn.name),
                    convention: cfg.conventions[fn.name] || '',
                  });
                }
              }

              setConnectedApps(prev => prev.map(a =>
                a.id === appId ? { ...a, name: appName, description: appDesc, functions: fnList } : a
              ));
            } catch { /* keep placeholder */ }
          });
        }
      } catch {
        setConnectedApps([]);
      }
    } else if (agent?.connected_app_ids) {
      // Legacy: just app IDs without granular config
      try {
        const ids: string[] = JSON.parse(agent.connected_app_ids);
        setConnectedApps(ids.map(id => ({ id, name: id, description: null, functions: [], expanded: false })));
        if (executeMcpTool) {
          ids.forEach(async (appId) => {
            try {
              const result = await executeMcpTool('ul_discover', { scope: 'inspect', app_id: appId });
              const parsed = JSON.parse(result);
              const appName = parsed.app?.name || parsed.metadata?.name || parsed.name || appId;
              const appDesc = parsed.app?.description || parsed.metadata?.description || parsed.description || null;
              const manifest = parsed.manifest
                ? (typeof parsed.manifest === 'string' ? JSON.parse(parsed.manifest) : parsed.manifest)
                : parsed.app?.manifest;

              const fnList: AppFunction[] = [];
              const fnSource = manifest?.functions || {};
              for (const [fnName, fn] of Object.entries(fnSource)) {
                fnList.push({
                  name: fnName,
                  description: (fn as { description?: string }).description || '',
                  selected: true, // Legacy: all selected by default
                  convention: '',
                });
              }
              if (fnList.length === 0) {
                const fns = parsed.functions || parsed.tools || [];
                for (const fn of fns) {
                  fnList.push({ name: fn.name, description: fn.description || '', selected: true, convention: '' });
                }
              }

              setConnectedApps(prev => prev.map(a =>
                a.id === appId ? { ...a, name: appName, description: appDesc, functions: fnList } : a
              ));
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

  // ── Persist helpers ──

  const persistApps = useCallback(async (apps: ConnectedApp[]) => {
    if (!agent) return;
    const config = buildAppsConfig(apps);
    const ids = apps.map(a => a.id);
    await onUpdateAgent({
      connected_apps: JSON.stringify(config),
      connected_app_ids: ids.length > 0 ? JSON.stringify(ids) : null,
    } as Partial<Agent>);
  }, [agent, onUpdateAgent]);

  const handleNotesBlur = useCallback(async () => {
    if (!agent) return;
    if (adminNotes !== (agent.admin_notes ?? '')) {
      await onUpdateAgent({ admin_notes: adminNotes || null } as Partial<Agent>);
    }
  }, [agent, adminNotes, onUpdateAgent]);

  const handleTaskBlur = useCallback(async () => {
    if (!agent) return;
    setEditingTask(false);
    if (task !== (agent.initial_task ?? '')) {
      await onUpdateAgent({ initial_task: task || null } as Partial<Agent>);
    }
  }, [agent, task, onUpdateAgent]);

  // ── Function toggle / convention ──

  const toggleFunction = useCallback(async (appId: string, fnName: string) => {
    const nextApps = connectedApps.map(a => {
      if (a.id !== appId) return a;
      return {
        ...a,
        functions: a.functions.map(f =>
          f.name === fnName ? { ...f, selected: !f.selected } : f
        ),
      };
    });
    setConnectedApps(nextApps);
    await persistApps(nextApps);
  }, [connectedApps, persistApps]);

  const toggleAllFunctions = useCallback(async (appId: string, selectAll: boolean) => {
    const nextApps = connectedApps.map(a => {
      if (a.id !== appId) return a;
      return { ...a, functions: a.functions.map(f => ({ ...f, selected: selectAll })) };
    });
    setConnectedApps(nextApps);
    await persistApps(nextApps);
  }, [connectedApps, persistApps]);

  const updateConvention = useCallback((appId: string, fnName: string, value: string) => {
    setConnectedApps(prev => prev.map(a => {
      if (a.id !== appId) return a;
      return {
        ...a,
        functions: a.functions.map(f =>
          f.name === fnName ? { ...f, convention: value } : f
        ),
      };
    }));
  }, []);

  const saveConvention = useCallback(async (appId: string) => {
    await persistApps(connectedApps);
  }, [connectedApps, persistApps]);

  const toggleAppExpanded = useCallback((appId: string) => {
    setConnectedApps(prev => prev.map(a =>
      a.id === appId ? { ...a, expanded: !a.expanded } : a
    ));
  }, []);

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
        const result = await executeMcpTool('ul_discover', { scope: 'library', query: q });
        const parsed = JSON.parse(result);
        const results = (parsed.results || [])
          .filter((r: { id: string }) => !connectedApps.some(ca => ca.id === r.id))
          .map((r: { id: string; name: string; description?: string }) => ({
            id: r.id,
            name: r.name,
            description: r.description || null,
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

  const addConnectedApp = useCallback(async (searchResult: { id: string; name: string; description: string | null }) => {
    // Add with all functions selected by default — inspect to get function list
    const newApp: ConnectedApp = {
      id: searchResult.id,
      name: searchResult.name,
      description: searchResult.description,
      functions: [],
      expanded: false,
    };
    const nextApps = [...connectedApps, newApp];
    setConnectedApps(nextApps);
    setAppSearchResults(prev => prev.filter(r => r.id !== searchResult.id));
    setAppSearchQuery('');

    // Inspect to get functions
    if (executeMcpTool) {
      try {
        const result = await executeMcpTool('ul_discover', { scope: 'inspect', app_id: searchResult.id });
        const parsed = JSON.parse(result);
        const manifest = parsed.manifest
          ? (typeof parsed.manifest === 'string' ? JSON.parse(parsed.manifest) : parsed.manifest)
          : parsed.app?.manifest;
        const appName = parsed.app?.name || parsed.metadata?.name || parsed.name || searchResult.name;

        const fnList: AppFunction[] = [];
        if (manifest?.functions) {
          for (const [fnName, fn] of Object.entries(manifest.functions)) {
            fnList.push({
              name: fnName,
              description: (fn as { description?: string }).description || '',
              selected: true,
              convention: '',
            });
          }
        } else {
          const fns = parsed.functions || parsed.tools || [];
          for (const fn of fns) {
            fnList.push({ name: fn.name, description: fn.description || '', selected: true, convention: '' });
          }
        }

        const updatedApp = { ...newApp, name: appName, functions: fnList };
        const updatedApps = nextApps.map(a => a.id === searchResult.id ? updatedApp : a);
        setConnectedApps(updatedApps);
        await persistApps(updatedApps);
      } catch {
        // Still save even without functions
        await persistApps(nextApps);
      }
    } else {
      await persistApps(nextApps);
    }
  }, [connectedApps, executeMcpTool, persistApps]);

  const removeConnectedApp = useCallback(async (id: string) => {
    const next = connectedApps.filter(a => a.id !== id);
    setConnectedApps(next);
    await persistApps(next);
  }, [connectedApps, persistApps]);

  // ── Fleet awareness ──
  const activeTeammates = siblingAgents.filter(a =>
    a.id !== agent?.id && !['completed', 'error', 'stopped'].includes(a.status)
  );

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
          <button onClick={onSignOut} className="btn-ghost btn-sm text-caption text-ul-text-muted" title="Sign out">
            Sign Out
          </button>
        </div>
      </header>

      {/* Expanded config panel */}
      {expanded && agent && (
        <div className="px-4 pb-4 border-t border-ul-border bg-gray-50 max-h-[70vh] overflow-y-auto">
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

          {/* Task — editable */}
          <div className="mt-3">
            <label className="text-caption text-ul-text-muted block mb-1">
              Task
              <span className="text-[10px] text-ul-text-muted ml-1">(agent's mission)</span>
            </label>
            {editingTask ? (
              <input
                type="text"
                value={task}
                onChange={e => setTask(e.target.value)}
                onBlur={handleTaskBlur}
                onKeyDown={e => { if (e.key === 'Enter') handleTaskBlur(); if (e.key === 'Escape') { setTask(agent.initial_task ?? ''); setEditingTask(false); } }}
                autoFocus
                className="w-full px-2 py-1.5 text-small rounded border border-blue-300 bg-white focus:outline-none focus:border-blue-500"
                placeholder="e.g. Front desk concierge for guest services"
              />
            ) : (
              <button
                onClick={() => setEditingTask(true)}
                className="w-full text-left px-2 py-1.5 text-small text-ul-text-secondary rounded border border-transparent hover:border-ul-border hover:bg-white transition-colors"
              >
                {task || <span className="text-ul-text-muted italic">Click to set agent's mission...</span>}
              </button>
            )}
          </div>

          {/* Admin notes */}
          <div className="mt-3">
            <label className="text-caption text-ul-text-muted block mb-1">
              Admin Notes
              <span className="text-[10px] text-ul-text-muted ml-1">(behavioral instructions)</span>
            </label>
            <textarea
              value={adminNotes}
              onChange={e => setAdminNotes(e.target.value)}
              onBlur={handleNotesBlur}
              placeholder="Add conventions, rules, and guidance for this agent..."
              className="w-full px-2 py-1.5 text-small rounded border border-ul-border bg-white focus:outline-none focus:border-ul-border-focus resize-none"
              rows={3}
            />
          </div>

          {/* Connected Apps — granular function selection */}
          {executeMcpTool && (
            <div className="mt-3">
              <label className="text-caption text-ul-text-muted block mb-1.5">
                Connected Apps
                {connectedApps.length > 0 && (
                  <span className="ml-1.5 text-[10px] text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">
                    {connectedApps.length} app{connectedApps.length !== 1 ? 's' : ''}
                    {' · '}
                    {connectedApps.reduce((sum, a) => sum + a.functions.filter(f => f.selected).length, 0)} fn
                  </span>
                )}
              </label>

              {/* Connected apps list */}
              {connectedApps.length > 0 && (
                <div className="space-y-2 mb-2">
                  {connectedApps.map(app => (
                    <div key={app.id} className="rounded border border-emerald-200 bg-emerald-50/30 overflow-hidden">
                      {/* App header */}
                      <div className="flex items-center gap-2 px-2.5 py-1.5">
                        <button
                          onClick={() => toggleAppExpanded(app.id)}
                          className="flex items-center gap-1.5 flex-1 min-w-0"
                        >
                          <svg
                            width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
                            className={`transition-transform flex-shrink-0 ${app.expanded ? 'rotate-90' : ''}`}
                          >
                            <path d="M3 1.5L7 5L3 8.5" />
                          </svg>
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                          <span className="text-caption text-ul-text font-medium truncate">{app.name}</span>
                        </button>
                        <span className="text-[10px] text-ul-text-muted shrink-0">
                          {app.functions.filter(f => f.selected).length}/{app.functions.length} fn
                        </span>
                        <button
                          type="button"
                          onClick={() => removeConnectedApp(app.id)}
                          className="text-[10px] text-red-400 hover:text-red-600 px-0.5 shrink-0"
                        >
                          ✕
                        </button>
                      </div>

                      {/* Expanded function list */}
                      {app.expanded && app.functions.length > 0 && (
                        <div className="border-t border-emerald-200 bg-white px-2.5 py-1.5">
                          {/* Select all / deselect all */}
                          <div className="flex items-center gap-2 mb-1.5 pb-1.5 border-b border-gray-100">
                            <button
                              onClick={() => toggleAllFunctions(app.id, true)}
                              className="text-[10px] text-blue-600 hover:underline"
                            >
                              Select All
                            </button>
                            <span className="text-[10px] text-ul-text-muted">·</span>
                            <button
                              onClick={() => toggleAllFunctions(app.id, false)}
                              className="text-[10px] text-blue-600 hover:underline"
                            >
                              Deselect All
                            </button>
                          </div>

                          {/* Function checkboxes */}
                          <div className="space-y-1 max-h-60 overflow-y-auto">
                            {app.functions.map(fn => (
                              <div key={fn.name}>
                                <label className="flex items-start gap-1.5 cursor-pointer group">
                                  <input
                                    type="checkbox"
                                    checked={fn.selected}
                                    onChange={() => toggleFunction(app.id, fn.name)}
                                    className="mt-0.5 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                                  />
                                  <div className="flex-1 min-w-0">
                                    <span className={`text-[11px] font-mono ${fn.selected ? 'text-ul-text' : 'text-ul-text-muted line-through'}`}>
                                      {fn.name}
                                    </span>
                                    {fn.description && (
                                      <span className="text-[10px] text-ul-text-muted ml-1.5">
                                        — {fn.description.slice(0, 60)}{fn.description.length > 60 ? '...' : ''}
                                      </span>
                                    )}
                                  </div>
                                </label>
                                {/* Convention input — only shown for selected functions */}
                                {fn.selected && (
                                  <input
                                    type="text"
                                    value={fn.convention}
                                    onChange={e => updateConvention(app.id, fn.name, e.target.value)}
                                    onBlur={() => saveConvention(app.id)}
                                    placeholder="Convention: e.g. always confirm before executing..."
                                    className="ml-5 mt-0.5 mb-1 w-[calc(100%-1.25rem)] text-[10px] px-1.5 py-0.5 rounded border border-gray-200 bg-gray-50 focus:outline-none focus:border-blue-300 focus:bg-white text-ul-text-secondary placeholder:text-gray-300"
                                  />
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
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

          {/* Fleet Awareness — sibling agents */}
          {activeTeammates.length > 0 && (
            <div className="mt-3 pt-3 border-t border-ul-border">
              <label className="text-caption text-ul-text-muted block mb-1.5">
                Team
                <span className="ml-1.5 text-[10px] text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">
                  {activeTeammates.length} active
                </span>
              </label>
              <div className="space-y-1">
                {activeTeammates.map(teammate => (
                  <div key={teammate.id} className="flex items-center gap-2 px-2 py-1 bg-white rounded border border-ul-border">
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusDotClass(teammate.status)}`} />
                    <span className="text-caption text-ul-text flex-1 truncate">{teammate.name}</span>
                    <span className="text-[10px] text-ul-text-muted capitalize">{teammate.role}</span>
                    <button
                      onClick={() => onOpenSubagentChat?.(teammate.id)}
                      className="text-[10px] text-blue-500 hover:text-blue-700"
                    >
                      Open
                    </button>
                  </div>
                ))}
              </div>
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
