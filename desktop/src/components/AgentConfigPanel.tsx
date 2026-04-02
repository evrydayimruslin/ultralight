// Shared agent configuration panel — used in AgentHeader (chat view) and HomeView (agents tab).
// Supports editable Directive, Admin Notes, granular function selection per connected app,
// per-function conventions, team member search/select, and model display.

import { useState, useCallback, useEffect, useRef } from 'react';
import type { Agent } from '../hooks/useAgentFleet';

// ── Types ──

interface AppFunction {
  name: string;
  description: string;
  selected: boolean;
  convention: string;
}

type ScopeAccess = 'all' | 'functions' | 'data';

interface ScopedApp {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  access: ScopeAccess;
  functions: AppFunction[];
  expanded: boolean;
}

/** Legacy type — kept for backwards compat parsing */
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
    slug?: string;
    access?: ScopeAccess;
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

function buildScopePersistedConfig(apps: ScopedApp[], teamMemberIds: string[]): PersistedConfig {
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
      slug: app.slug,
      access: app.access,
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
): Promise<{ name: string; description: string | null; functions: AppFunction[]; widgets?: Array<{ id: string; label: string; data_tool: string; poll_interval_s?: number }> }> {
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

  // Extract widget declarations from manifest
  const widgets = manifest?.widgets && Array.isArray(manifest.widgets) ? manifest.widgets : undefined;

  return { name: appName, description: appDesc, functions: fnList, widgets };
}

// ── Component ──

export default function AgentConfigPanel({
  agent,
  allAgents,
  onUpdateAgent,
  onNavigateToAgent,
  executeMcpTool,
  showOpenChat = false,
}: AgentConfigPanelProps) {
  const [adminNotes, setAdminNotes] = useState(agent.admin_notes ?? '');
  const [directive, setDirective] = useState(agent.initial_task || agent.name || '');
  const [editingDirective, setEditingDirective] = useState(false);
  const [editingFlashModel, setEditingFlashModel] = useState(false);
  const [editingHeavyModel, setEditingHeavyModel] = useState(false);
  const [flashModelValue, setFlashModelValue] = useState('');
  const [heavyModelValue, setHeavyModelValue] = useState('');
  const flashModelRef = useRef<HTMLInputElement>(null);
  const heavyModelRef = useRef<HTMLInputElement>(null);

  // Scope state
  const [scopedApps, setScopedApps] = useState<ScopedApp[]>([]);
  const [allUserApps, setAllUserApps] = useState<Array<{ id: string; slug: string; name: string; description: string | null }>>([]);
  const [loadingApps, setLoadingApps] = useState(false);
  // Legacy — kept for backwards compat init
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
    const modelParts = (agent.model || '').split(' → ').map(s => s.trim());
    setFlashModelValue(modelParts[0] || '');
    setHeavyModelValue(modelParts[1] || modelParts[0] || '');
    setEditingFlashModel(false);
    setEditingHeavyModel(false);

    // Fetch all user apps for the scope dropdown
    if (executeMcpTool) {
      setLoadingApps(true);
      executeMcpTool('ul_discover', { scope: 'library' })
        .then(result => {
          const parsed = JSON.parse(result);
          let apps: Array<{ id: string; slug: string; name: string; description: string | null }> = [];

          if (Array.isArray(parsed.library)) {
            apps = parsed.library
              .filter((r: { type?: string }) => r.type === 'app')
              .map((r: { id: string; slug?: string; name: string; description?: string }) => ({
                id: r.id, slug: r.slug || r.id, name: r.name, description: r.description || null,
              }));
          } else if (typeof parsed.library === 'string') {
            const sections = (parsed.library as string).split(/^## /gm).filter(Boolean);
            for (const section of sections) {
              const lines = section.split('\n');
              const name = lines[0]?.trim();
              if (!name || name.startsWith('#') || name === 'Saved Apps' || name === 'Saved Pages' || name === 'Library') continue;
              apps.push({ id: name, slug: name, name, description: lines[1]?.trim() || null });
            }
          } else if (parsed.results) {
            apps = parsed.results.map((r: { id: string; slug?: string; name: string; description?: string }) => ({
              id: r.id, slug: r.slug || r.id, name: r.name, description: r.description || null,
            }));
          }

          setAllUserApps(apps);
        })
        .catch(() => setAllUserApps([]))
        .finally(() => setLoadingApps(false));
    }

    // Load scoped apps from agent record
    if (agent.connected_apps) {
      try {
        const persisted = parsePersistedConfig(agent.connected_apps);
        setTeamMembers(persisted.team || []);
        const config = persisted.apps;
        const apps: ScopedApp[] = Object.entries(config).map(([appId, cfg]) => ({
          id: appId,
          slug: cfg.slug || appId,
          name: cfg.name,
          description: null,
          access: cfg.access || 'all',
          functions: [],
          expanded: false,
        }));
        setScopedApps(apps);

        // Inspect each app to get full function lists
        if (executeMcpTool) {
          Object.entries(config).forEach(async ([appId, cfg]) => {
            try {
              const info = await inspectApp(executeMcpTool, appId, cfg);
              setScopedApps(prev => prev.map(a =>
                a.id === appId ? { ...a, name: info.name, description: info.description, functions: info.functions } : a
              ));
            } catch { /* keep placeholder */ }
          });
        }
      } catch {
        setScopedApps([]);
        setTeamMembers([]);
      }
    } else {
      setScopedApps([]);
      setTeamMembers([]);
      setConnectedApps([]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.id]);

  // ── Persist helpers ──

  const teamMembersRef = useRef(teamMembers);
  teamMembersRef.current = teamMembers;

  const persistScopeConfig = useCallback(async (apps: ScopedApp[]) => {
    const config = buildScopePersistedConfig(apps, teamMembersRef.current);
    const ids = apps.map(a => a.id);
    await onUpdateAgent({
      connected_apps: JSON.stringify(config),
      connected_app_ids: ids.length > 0 ? JSON.stringify(ids) : null,
    } as Partial<Agent>);
  }, [onUpdateAgent]);

  const persistConfig = useCallback(async (apps: ConnectedApp[]) => {
    // Legacy compat — unused in new scope UI
    const appsConfig: ConnectedAppsConfig = {};
    for (const app of apps) {
      appsConfig[app.id] = {
        name: app.name,
        selected_functions: app.functions.filter(f => f.selected).map(f => f.name),
        conventions: {},
      };
    }
    await onUpdateAgent({
      connected_apps: JSON.stringify({ apps: appsConfig }),
      connected_app_ids: apps.length > 0 ? JSON.stringify(apps.map(a => a.id)) : null,
    } as Partial<Agent>);
  }, [onUpdateAgent]);

  const persistTeam = useCallback(async (team: string[]) => {
    const config = buildScopePersistedConfig(scopedApps, team);
    const ids = scopedApps.map(a => a.id);
    await onUpdateAgent({
      connected_apps: JSON.stringify(config),
      connected_app_ids: ids.length > 0 ? JSON.stringify(ids) : null,
    } as Partial<Agent>);
  }, [scopedApps, onUpdateAgent]);

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

  const displayModelName = (id: string) => {
    const parts = id.split('/');
    const name = parts.length > 1 ? parts[1] : id;
    return name.replace(/:nitro$/, '');
  };

  const handleFlashModelBlur = useCallback(async () => {
    setEditingFlashModel(false);
    const flash = flashModelValue.trim();
    const heavy = heavyModelValue.trim();
    const combined = flash && heavy ? `${flash} → ${heavy}` : flash || heavy;
    if (combined !== (agent.model || '')) {
      await onUpdateAgent({ model: combined } as Partial<Agent>);
    }
  }, [agent, flashModelValue, heavyModelValue, onUpdateAgent]);

  const handleHeavyModelBlur = useCallback(async () => {
    setEditingHeavyModel(false);
    const flash = flashModelValue.trim();
    const heavy = heavyModelValue.trim();
    const combined = flash && heavy ? `${flash} → ${heavy}` : flash || heavy;
    if (combined !== (agent.model || '')) {
      await onUpdateAgent({ model: combined } as Partial<Agent>);
    }
  }, [agent, flashModelValue, heavyModelValue, onUpdateAgent]);

  const handleToolApprovalChange = useCallback(async (value: string) => {
    await onUpdateAgent({ permission_level: value } as Partial<Agent>);
  }, [onUpdateAgent]);

  // ── Function toggle / convention ──

  // ── Scope handlers ──

  const addScopedApp = useCallback(async (app: { id: string; slug: string; name: string; description: string | null }) => {
    const newApp: ScopedApp = {
      id: app.id,
      slug: app.slug,
      name: app.name,
      description: app.description,
      access: 'all',
      functions: [],
      expanded: false,
    };
    const next = [...scopedApps, newApp];
    setScopedApps(next);

    // Inspect to get functions
    if (executeMcpTool) {
      try {
        const info = await inspectApp(executeMcpTool, app.id);
        const updated = next.map(a => a.id === app.id ? { ...a, name: info.name, description: info.description, functions: info.functions } : a);
        setScopedApps(updated);
        await persistScopeConfig(updated);
      } catch {
        await persistScopeConfig(next);
      }
    } else {
      await persistScopeConfig(next);
    }
  }, [scopedApps, executeMcpTool, persistScopeConfig]);

  const removeScopedApp = useCallback(async (id: string) => {
    const next = scopedApps.filter(a => a.id !== id);
    setScopedApps(next);
    await persistScopeConfig(next);
  }, [scopedApps, persistScopeConfig]);

  const changeScopeAccess = useCallback(async (appId: string, access: ScopeAccess) => {
    const next = scopedApps.map(a => a.id === appId ? { ...a, access } : a);
    setScopedApps(next);
    await persistScopeConfig(next);
  }, [scopedApps, persistScopeConfig]);

  const toggleScopeExpanded = useCallback((appId: string) => {
    setScopedApps(prev => prev.map(a =>
      a.id === appId ? { ...a, expanded: !a.expanded } : a
    ));
  }, []);

  const toggleScopeFunction = useCallback(async (appId: string, fnName: string) => {
    const next = scopedApps.map(a => {
      if (a.id !== appId) return a;
      return { ...a, functions: a.functions.map(f => f.name === fnName ? { ...f, selected: !f.selected } : f) };
    });
    setScopedApps(next);
    await persistScopeConfig(next);
  }, [scopedApps, persistScopeConfig]);

  const toggleScopeAllFunctions = useCallback(async (appId: string, selectAll: boolean) => {
    const next = scopedApps.map(a => {
      if (a.id !== appId) return a;
      return { ...a, functions: a.functions.map(f => ({ ...f, selected: selectAll })) };
    });
    setScopedApps(next);
    await persistScopeConfig(next);
  }, [scopedApps, persistScopeConfig]);

  // Legacy handlers (still referenced by dead code below)
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

      {/* Model (Flash + Heavy) + Tool Approval row */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-caption text-ul-text-muted block mb-1">Model</label>
          <div className="flex flex-col gap-1">
            {/* Flash model */}
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400 flex-shrink-0" />
              {editingFlashModel ? (
                <input
                  ref={flashModelRef}
                  type="text"
                  value={flashModelValue}
                  onChange={e => setFlashModelValue(e.target.value)}
                  onBlur={handleFlashModelBlur}
                  onKeyDown={e => { if (e.key === 'Enter') handleFlashModelBlur(); if (e.key === 'Escape') { const p = (agent.model || '').split(' → '); setFlashModelValue(p[0]?.trim() || ''); setEditingFlashModel(false); } }}
                  autoFocus
                  className="flex-1 min-w-0 px-1.5 py-0.5 text-small rounded border border-blue-300 bg-white focus:outline-none focus:border-blue-500 font-mono"
                  placeholder="flash model"
                />
              ) : (
                <button
                  onClick={() => { setEditingFlashModel(true); setTimeout(() => flashModelRef.current?.focus(), 50); }}
                  className="flex-1 min-w-0 text-left px-1.5 py-0.5 text-small text-ul-text-secondary rounded border border-transparent hover:border-ul-border hover:bg-white transition-colors font-mono truncate"
                  title={flashModelValue}
                >
                  {flashModelValue ? displayModelName(flashModelValue) : <span className="text-ul-text-muted italic font-sans text-caption">flash</span>}
                </button>
              )}
            </div>
            {/* Heavy model */}
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-ul-success flex-shrink-0" />
              {editingHeavyModel ? (
                <input
                  ref={heavyModelRef}
                  type="text"
                  value={heavyModelValue}
                  onChange={e => setHeavyModelValue(e.target.value)}
                  onBlur={handleHeavyModelBlur}
                  onKeyDown={e => { if (e.key === 'Enter') handleHeavyModelBlur(); if (e.key === 'Escape') { const p = (agent.model || '').split(' → '); setHeavyModelValue(p[1]?.trim() || p[0]?.trim() || ''); setEditingHeavyModel(false); } }}
                  autoFocus
                  className="flex-1 min-w-0 px-1.5 py-0.5 text-small rounded border border-blue-300 bg-white focus:outline-none focus:border-blue-500 font-mono"
                  placeholder="heavy model"
                />
              ) : (
                <button
                  onClick={() => { setEditingHeavyModel(true); setTimeout(() => heavyModelRef.current?.focus(), 50); }}
                  className="flex-1 min-w-0 text-left px-1.5 py-0.5 text-small text-ul-text-secondary rounded border border-transparent hover:border-ul-border hover:bg-white transition-colors font-mono truncate"
                  title={heavyModelValue}
                >
                  {heavyModelValue ? displayModelName(heavyModelValue) : <span className="text-ul-text-muted italic font-sans text-caption">heavy</span>}
                </button>
              )}
            </div>
          </div>
        </div>
        <div>
          <label className="text-caption text-ul-text-muted block mb-1">Tool Approval</label>
          <select
            value={agent.permission_level || 'auto_edit'}
            onChange={e => handleToolApprovalChange(e.target.value)}
            className="w-full px-2 py-1.5 text-small rounded border border-ul-border bg-white focus:outline-none focus:border-ul-border-focus"
          >
            <option value="auto_edit">Auto-approve</option>
            <option value="ask_always">Ask always</option>
            <option value="auto_read">Auto-read only</option>
          </select>
        </div>
      </div>

      {/* Scope — restrict which apps/functions/data are available */}
      {executeMcpTool && (
        <div>
          <label className="text-caption text-ul-text-muted block mb-1.5">
            Scope
            {scopedApps.length > 0 && (
              <span className="ml-1.5 text-[10px] text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">
                {scopedApps.length} app{scopedApps.length !== 1 ? 's' : ''}
              </span>
            )}
          </label>

          {scopedApps.length === 0 && (
            <p className="text-[10px] text-ul-text-muted mb-2">No scope — all apps available</p>
          )}

          {/* Scoped apps list */}
          {scopedApps.length > 0 && (
            <div className="space-y-2 mb-2">
              {scopedApps.map(app => (
                <div key={app.id} className="rounded border border-blue-200 bg-blue-50/30 overflow-hidden">
                  {/* App row: name + access dropdown + remove */}
                  <div className="flex items-center gap-2 px-2.5 py-1.5">
                    {app.access !== 'data' && app.functions.length > 0 && (
                      <button
                        onClick={() => toggleScopeExpanded(app.id)}
                        className="flex items-center shrink-0"
                      >
                        <svg
                          width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
                          className={`transition-transform ${app.expanded ? 'rotate-90' : ''}`}
                        >
                          <path d="M3 1.5L7 5L3 8.5" />
                        </svg>
                      </button>
                    )}
                    <span className="text-caption text-ul-text font-medium truncate flex-1 min-w-0">{app.name}</span>
                    <select
                      value={app.access}
                      onChange={e => changeScopeAccess(app.id, e.target.value as ScopeAccess)}
                      className="text-[11px] px-1.5 py-0.5 rounded border border-blue-200 bg-white focus:outline-none focus:border-blue-400 shrink-0"
                    >
                      <option value="all">All</option>
                      <option value="functions">Functions only</option>
                      <option value="data">Data only</option>
                    </select>
                    {app.access !== 'data' && app.functions.length > 0 && (
                      <span className="text-[10px] text-ul-text-muted shrink-0">
                        {app.functions.filter(f => f.selected).length}/{app.functions.length} fn
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => removeScopedApp(app.id)}
                      className="text-[10px] text-red-400 hover:text-red-600 px-0.5 shrink-0"
                    >
                      ✕
                    </button>
                  </div>

                  {/* Expanded function list — only for All / Functions only */}
                  {app.expanded && app.access !== 'data' && app.functions.length > 0 && (
                    <div className="border-t border-blue-200 bg-white px-2.5 py-1.5">
                      <div className="flex items-center gap-2 mb-1.5 pb-1.5 border-b border-gray-100">
                        <button onClick={() => toggleScopeAllFunctions(app.id, true)} className="text-[10px] text-blue-600 hover:underline">
                          Select All
                        </button>
                        <span className="text-[10px] text-ul-text-muted">·</span>
                        <button onClick={() => toggleScopeAllFunctions(app.id, false)} className="text-[10px] text-blue-600 hover:underline">
                          Deselect All
                        </button>
                      </div>

                      <div className="space-y-1 max-h-60 overflow-y-auto">
                        {app.functions.map(fn => (
                          <label key={fn.name} className="flex items-start gap-1.5 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={fn.selected}
                              onChange={() => toggleScopeFunction(app.id, fn.name)}
                              className="mt-0.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
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
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Add app dropdown */}
          {(() => {
            const available = allUserApps.filter(a => !scopedApps.some(s => s.id === a.id));
            if (available.length === 0 && scopedApps.length > 0) return null;
            return (
              <div className="relative">
                {loadingApps ? (
                  <span className="text-[10px] text-ul-text-muted">Loading apps...</span>
                ) : available.length > 0 ? (
                  <select
                    value=""
                    onChange={e => {
                      const app = available.find(a => a.id === e.target.value);
                      if (app) addScopedApp(app);
                    }}
                    className="w-full text-small rounded border border-ul-border px-2 py-1.5 bg-white focus:outline-none focus:border-ul-border-focus text-ul-text-muted"
                  >
                    <option value="">+ Add app to scope...</option>
                    {available.map(app => (
                      <option key={app.id} value={app.id}>{app.name}</option>
                    ))}
                  </select>
                ) : null}
              </div>
            );
          })()}
        </div>
      )}

      {/* Team — deprecated for now */}
      {false && <div>
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
      </div>}

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
