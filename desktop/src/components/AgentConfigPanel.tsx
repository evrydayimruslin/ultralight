// Shared agent configuration panel — used in AgentHeader (chat view) and HomeView (agents tab).
// Supports editable Directive, Admin Notes, granular function selection per connected app,
// per-function conventions, team member search/select, and model display.

import { useState, useCallback, useEffect, useRef } from 'react';
import type { Agent } from '../hooks/useAgentFleet';
import ModelSelector from './ModelSelector';

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
  expanded: boolean;
}

/** Persisted shape in agent.connected_apps JSON */
interface ConnectedAppsConfig {
  [appId: string]: {
    name: string;
    selected_functions: string[];
    conventions: Record<string, string>;
  };
}

/** Persisted shape includes apps config + team member IDs */
interface PersistedConfig {
  apps: ConnectedAppsConfig;
  team?: string[];
}

export interface AgentConfigPanelProps {
  agent: Agent;
  allAgents: Agent[];
  onUpdateAgent: (updates: Partial<Agent>) => Promise<void>;
  onNavigateToAgent?: (agentId: string) => void;
  executeMcpTool?: (name: string, args: Record<string, unknown>) => Promise<string>;
  /** Show model selector (only in chat header, not in agents tab) */
  showModelSelector?: boolean;
  /** Show the Open Chat button (only in agents tab, not in chat header) */
  showOpenChat?: boolean;
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

function buildPersistedConfig(apps: ConnectedApp[], teamMemberIds: string[]): PersistedConfig {
  const appsConfig: ConnectedAppsConfig = {};
  for (const app of apps) {
    const selectedFns = app.functions.filter(f => f.selected).map(f => f.name);
    const conventions: Record<string, string> = {};
    for (const fn of app.functions) {
      if (fn.convention.trim()) {
        conventions[fn.name] = fn.convention.trim();
      }
    }
    appsConfig[app.id] = {
      name: app.name,
      selected_functions: selectedFns,
      conventions,
    };
  }
  return {
    apps: appsConfig,
    team: teamMemberIds.length > 0 ? teamMemberIds : undefined,
  };
}

function parsePersistedConfig(json: string): PersistedConfig {
  const raw = JSON.parse(json);
  if (raw.apps && typeof raw.apps === 'object' && !raw.apps.name) {
    return { apps: raw.apps, team: raw.team };
  }
  return { apps: raw as ConnectedAppsConfig, team: undefined };
}

/** Inspect an app and build the function list */
async function inspectApp(
  executeMcpTool: (name: string, args: Record<string, unknown>) => Promise<string>,
  appId: string,
  cfg?: { selected_functions: string[]; conventions: Record<string, string> },
): Promise<{ name: string; description: string | null; functions: AppFunction[] }> {
  const result = await executeMcpTool('ul_discover', { scope: 'inspect', app_id: appId });
  const parsed = JSON.parse(result);
  const manifest = parsed.manifest
    ? (typeof parsed.manifest === 'string' ? JSON.parse(parsed.manifest) : parsed.manifest)
    : parsed.app?.manifest;
  const appName = parsed.app?.name || parsed.metadata?.name || parsed.name || appId;
  const appDesc = parsed.app?.description || parsed.metadata?.description || parsed.description || null;

  const fnList: AppFunction[] = [];
  if (manifest?.functions) {
    for (const [fnName, fn] of Object.entries(manifest.functions)) {
      fnList.push({
        name: fnName,
        description: (fn as { description?: string }).description || '',
        selected: cfg ? cfg.selected_functions.includes(fnName) : true,
        convention: cfg ? (cfg.conventions[fnName] || '') : '',
      });
    }
  } else {
    const fns = parsed.functions || parsed.tools || [];
    for (const fn of fns) {
      fnList.push({
        name: fn.name,
        description: fn.description || '',
        selected: cfg ? cfg.selected_functions.includes(fn.name) : true,
        convention: cfg ? (cfg.conventions[fn.name] || '') : '',
      });
    }
  }

  return { name: appName, description: appDesc, functions: fnList };
}

// ── Component ──

export default function AgentConfigPanel({
  agent,
  allAgents,
  onUpdateAgent,
  onNavigateToAgent,
  executeMcpTool,
  showModelSelector = false,
  showOpenChat = false,
}: AgentConfigPanelProps) {
  const [adminNotes, setAdminNotes] = useState(agent.admin_notes ?? '');
  const [directive, setDirective] = useState(agent.initial_task || agent.name || '');
  const [editingDirective, setEditingDirective] = useState(false);

  // Connected apps state
  const [connectedApps, setConnectedApps] = useState<ConnectedApp[]>([]);
  const [appSearchQuery, setAppSearchQuery] = useState('');
  const [appSearchResults, setAppSearchResults] = useState<Array<{ id: string; name: string; description: string | null }>>([]);
  const [searchingApps, setSearchingApps] = useState(false);
  const appSearchRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Team members state
  const [teamMembers, setTeamMembers] = useState<string[]>([]);
  const [teamSearchQuery, setTeamSearchQuery] = useState('');

  // Track agent ID to re-init state when agent changes
  const prevAgentIdRef = useRef<string | null>(null);

  // Init / re-init when agent changes
  if (agent.id !== prevAgentIdRef.current) {
    prevAgentIdRef.current = agent.id;
    // These will be set synchronously on first render or when agent changes
  }

  useEffect(() => {
    setAdminNotes(agent.admin_notes ?? '');
    setDirective(agent.initial_task || agent.name || '');
    setEditingDirective(false);

    // Load connected apps + team from agent record
    if (agent.connected_apps) {
      try {
        const persisted = parsePersistedConfig(agent.connected_apps);
        setTeamMembers(persisted.team || []);
        const config = persisted.apps;
        const apps: ConnectedApp[] = Object.entries(config).map(([appId, cfg]) => ({
          id: appId,
          name: cfg.name,
          description: null,
          functions: [],
          expanded: false,
        }));
        setConnectedApps(apps);

        // Inspect each app to get full function lists
        if (executeMcpTool) {
          Object.entries(config).forEach(async ([appId, cfg]) => {
            try {
              const info = await inspectApp(executeMcpTool, appId, cfg);
              setConnectedApps(prev => prev.map(a =>
                a.id === appId ? { ...a, name: info.name, description: info.description, functions: info.functions } : a
              ));
            } catch { /* keep placeholder */ }
          });
        }
      } catch {
        setConnectedApps([]);
        setTeamMembers([]);
      }
    } else if (agent.connected_app_ids) {
      // Legacy: just app IDs without granular config
      try {
        const ids: string[] = JSON.parse(agent.connected_app_ids);
        setConnectedApps(ids.map(id => ({ id, name: id, description: null, functions: [], expanded: false })));
        if (executeMcpTool) {
          ids.forEach(async (appId) => {
            try {
              const info = await inspectApp(executeMcpTool, appId);
              setConnectedApps(prev => prev.map(a =>
                a.id === appId ? { ...a, name: info.name, description: info.description, functions: info.functions } : a
              ));
            } catch { /* keep placeholder */ }
          });
        }
      } catch {
        setConnectedApps([]);
        setTeamMembers([]);
      }
    } else {
      setConnectedApps([]);
      setTeamMembers([]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.id]);

  // ── Persist helpers ──

  const teamMembersRef = useRef(teamMembers);
  teamMembersRef.current = teamMembers;

  const persistConfig = useCallback(async (apps: ConnectedApp[]) => {
    const config = buildPersistedConfig(apps, teamMembersRef.current);
    const ids = apps.map(a => a.id);
    await onUpdateAgent({
      connected_apps: JSON.stringify(config),
      connected_app_ids: ids.length > 0 ? JSON.stringify(ids) : null,
    } as Partial<Agent>);
  }, [onUpdateAgent]);

  const persistTeam = useCallback(async (team: string[]) => {
    const config = buildPersistedConfig(connectedApps, team);
    const ids = connectedApps.map(a => a.id);
    await onUpdateAgent({
      connected_apps: JSON.stringify(config),
      connected_app_ids: ids.length > 0 ? JSON.stringify(ids) : null,
    } as Partial<Agent>);
  }, [connectedApps, onUpdateAgent]);

  const handleNotesBlur = useCallback(async () => {
    if (adminNotes !== (agent.admin_notes ?? '')) {
      await onUpdateAgent({ admin_notes: adminNotes || null } as Partial<Agent>);
    }
  }, [agent, adminNotes, onUpdateAgent]);

  const handleDirectiveBlur = useCallback(async () => {
    setEditingDirective(false);
    const currentDirective = agent.initial_task || agent.name || '';
    if (directive !== currentDirective && directive.trim()) {
      await onUpdateAgent({ initial_task: directive.trim(), name: directive.trim() } as Partial<Agent>);
    }
  }, [agent, directive, onUpdateAgent]);

  // ── Function toggle / convention ──

  const toggleFunction = useCallback(async (appId: string, fnName: string) => {
    const nextApps = connectedApps.map(a => {
      if (a.id !== appId) return a;
      return { ...a, functions: a.functions.map(f => f.name === fnName ? { ...f, selected: !f.selected } : f) };
    });
    setConnectedApps(nextApps);
    await persistConfig(nextApps);
  }, [connectedApps, persistConfig]);

  const toggleAllFunctions = useCallback(async (appId: string, selectAll: boolean) => {
    const nextApps = connectedApps.map(a => {
      if (a.id !== appId) return a;
      return { ...a, functions: a.functions.map(f => ({ ...f, selected: selectAll })) };
    });
    setConnectedApps(nextApps);
    await persistConfig(nextApps);
  }, [connectedApps, persistConfig]);

  const updateConvention = useCallback((appId: string, fnName: string, value: string) => {
    setConnectedApps(prev => prev.map(a => {
      if (a.id !== appId) return a;
      return { ...a, functions: a.functions.map(f => f.name === fnName ? { ...f, convention: value } : f) };
    }));
  }, []);

  const saveConvention = useCallback(async () => {
    await persistConfig(connectedApps);
  }, [connectedApps, persistConfig]);

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

    if (executeMcpTool) {
      try {
        const info = await inspectApp(executeMcpTool, searchResult.id);
        const updatedApp = { ...newApp, name: info.name, functions: info.functions };
        const updatedApps = nextApps.map(a => a.id === searchResult.id ? updatedApp : a);
        setConnectedApps(updatedApps);
        await persistConfig(updatedApps);
      } catch {
        await persistConfig(nextApps);
      }
    } else {
      await persistConfig(nextApps);
    }
  }, [connectedApps, executeMcpTool, persistConfig]);

  const removeConnectedApp = useCallback(async (id: string) => {
    const next = connectedApps.filter(a => a.id !== id);
    setConnectedApps(next);
    await persistConfig(next);
  }, [connectedApps, persistConfig]);

  // ── Team member management ──

  const resolvedTeamMembers = teamMembers
    .map(id => allAgents.find(a => a.id === id))
    .filter((a): a is Agent => a != null);

  const teamSearchResults = teamSearchQuery.trim().length >= 2
    ? allAgents.filter(a =>
        a.id !== agent.id &&
        !teamMembers.includes(a.id) &&
        (a.name.toLowerCase().includes(teamSearchQuery.toLowerCase()) ||
         a.role.toLowerCase().includes(teamSearchQuery.toLowerCase()) ||
         (a.initial_task || '').toLowerCase().includes(teamSearchQuery.toLowerCase()))
      ).slice(0, 8)
    : [];

  const addTeamMember = useCallback(async (memberId: string) => {
    const next = [...teamMembers, memberId];
    setTeamMembers(next);
    setTeamSearchQuery('');
    await persistTeam(next);
  }, [teamMembers, persistTeam]);

  const removeTeamMember = useCallback(async (memberId: string) => {
    const next = teamMembers.filter(id => id !== memberId);
    setTeamMembers(next);
    await persistTeam(next);
  }, [teamMembers, persistTeam]);

  // ── Render ──

  return (
    <div className="space-y-3">
      {/* Top row: Role, Model, Directory, Permissions */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-caption text-ul-text-muted block mb-1">Role</label>
          <span className="text-small text-ul-text capitalize">{agent.role}</span>
        </div>
        <div>
          <label className="text-caption text-ul-text-muted block mb-1">Model</label>
          {showModelSelector ? <ModelSelector /> : (
            <span className="text-small text-ul-text-secondary">{agent.model || 'default'}</span>
          )}
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

      {/* Directive — editable title */}
      <div>
        <label className="text-caption text-ul-text-muted block mb-1">Directive</label>
        {editingDirective ? (
          <input
            type="text"
            value={directive}
            onChange={e => setDirective(e.target.value)}
            onBlur={handleDirectiveBlur}
            onKeyDown={e => { if (e.key === 'Enter') handleDirectiveBlur(); if (e.key === 'Escape') { setDirective(agent.initial_task || agent.name || ''); setEditingDirective(false); } }}
            autoFocus
            className="w-full px-2 py-1.5 text-small rounded border border-blue-300 bg-white focus:outline-none focus:border-blue-500"
            placeholder="e.g. Front Desk Concierge"
          />
        ) : (
          <button
            onClick={() => setEditingDirective(true)}
            className="w-full text-left px-2 py-1.5 text-small text-ul-text-secondary rounded border border-transparent hover:border-ul-border hover:bg-white transition-colors"
          >
            {directive || <span className="text-ul-text-muted italic">Click to name this agent...</span>}
          </button>
        )}
      </div>

      {/* Admin notes */}
      <div>
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
        <div>
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
                      <div className="flex items-center gap-2 mb-1.5 pb-1.5 border-b border-gray-100">
                        <button onClick={() => toggleAllFunctions(app.id, true)} className="text-[10px] text-blue-600 hover:underline">
                          Select All
                        </button>
                        <span className="text-[10px] text-ul-text-muted">·</span>
                        <button onClick={() => toggleAllFunctions(app.id, false)} className="text-[10px] text-blue-600 hover:underline">
                          Deselect All
                        </button>
                      </div>

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
                            {fn.selected && (
                              <input
                                type="text"
                                value={fn.convention}
                                onChange={e => updateConvention(app.id, fn.name, e.target.value)}
                                onBlur={() => saveConvention()}
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

      {/* Team — search and connect sibling agents */}
      <div>
        <label className="text-caption text-ul-text-muted block mb-1.5">
          Team
          {resolvedTeamMembers.length > 0 && (
            <span className="ml-1.5 text-[10px] text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">
              {resolvedTeamMembers.length} member{resolvedTeamMembers.length !== 1 ? 's' : ''}
            </span>
          )}
        </label>

        {resolvedTeamMembers.length > 0 && (
          <div className="space-y-1 rounded border border-blue-200 p-2 bg-blue-50/30 mb-2">
            {resolvedTeamMembers.map(member => (
              <div key={member.id} className="flex items-center gap-2">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusDotClass(member.status)}`} />
                <span className="text-caption text-ul-text truncate flex-1">{member.name}</span>
                <span className="text-[10px] text-ul-text-muted capitalize">{member.role}</span>
                {member.initial_task && (
                  <span className="text-[10px] text-ul-text-muted truncate max-w-[120px]" title={member.initial_task}>
                    {member.initial_task.slice(0, 30)}{member.initial_task.length > 30 ? '...' : ''}
                  </span>
                )}
                {onNavigateToAgent && (
                  <button
                    onClick={() => onNavigateToAgent(member.id)}
                    className="text-[10px] text-blue-500 hover:text-blue-700 shrink-0"
                  >
                    Open
                  </button>
                )}
                <button
                  onClick={() => removeTeamMember(member.id)}
                  className="text-[10px] text-red-400 hover:text-red-600 px-0.5 shrink-0"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="relative">
          <input
            type="text"
            value={teamSearchQuery}
            onChange={e => setTeamSearchQuery(e.target.value)}
            placeholder="Search agents to add to team..."
            className="w-full text-small rounded border border-ul-border px-2 py-1.5 bg-white focus:outline-none focus:border-ul-border-focus"
          />
        </div>

        {teamSearchResults.length > 0 && (
          <div className="mt-1 rounded border border-ul-border bg-white shadow-sm max-h-40 overflow-y-auto">
            {teamSearchResults.map(a => (
              <button
                key={a.id}
                type="button"
                onClick={() => addTeamMember(a.id)}
                className="w-full text-left px-3 py-1.5 hover:bg-gray-50 flex items-center gap-2 border-b border-ul-border last:border-b-0"
              >
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusDotClass(a.status)}`} />
                <span className="text-caption text-ul-text truncate flex-1">{a.name}</span>
                <span className="text-[10px] text-ul-text-muted capitalize">{a.role}</span>
                <span className="text-[10px] text-blue-600 shrink-0">+ add</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Open Chat button (agents tab only) */}
      {showOpenChat && onNavigateToAgent && (
        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={() => onNavigateToAgent(agent.id)}
            className="text-caption px-3 py-1 rounded bg-ul-bg-dark text-white hover:bg-gray-700 transition-colors"
          >
            Open Chat →
          </button>
        </div>
      )}
    </div>
  );
}
