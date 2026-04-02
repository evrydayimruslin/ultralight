// Shared agent configuration panel — used in AgentHeader (chat view) and HomeView (agents tab).
// Supports editable Directive, Admin Notes, granular function selection per connected app,
// per-function conventions, and model display.

import { useState, useCallback, useEffect, useRef } from 'react';
import type { Agent } from '../hooks/useAgentFleet';
import { fetchModels, type ModelInfo } from '../lib/api';
import ConfigDropdown, { type DropdownOption } from './ConfigDropdown';

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
  // If appId looks like a UUID, inspect directly; otherwise search by slug first
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(appId);
  let resolvedId = appId;
  if (!isUuid) {
    // Look up UUID by slug via search
    const searchResult = await executeMcpTool('ul_discover', { scope: 'search', query: appId });
    const searchParsed = JSON.parse(searchResult);
    const results = searchParsed.results || searchParsed.apps || [];
    const match = results.find((r: { slug?: string; name?: string; id: string }) =>
      r.slug === appId || r.name === appId
    );
    if (match?.id) {
      resolvedId = match.id;
    } else {
      throw new Error(`Could not find UUID for app "${appId}"`);
    }
  }
  const result = await executeMcpTool('ul_discover', { scope: 'inspect', app_id: resolvedId });
  if (result.startsWith('Error')) throw new Error(result);
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

// Module-level caches — survive component remounts (e.g. toggling config panel)
interface CachedApp { id: string; slug: string; name: string; description: string | null; functions?: AppFunction[] }
let _cachedUserApps: CachedApp[] | null = null;
let _cachedModels: ModelInfo[] | null = null;

export default function AgentConfigPanel({
  agent,
  allAgents,
  onUpdateAgent,
  onNavigateToAgent,
  executeMcpTool,
  showOpenChat = false,
}: AgentConfigPanelProps) {
  const [adminNotes, setAdminNotes] = useState(agent.admin_notes ?? '');
  const [editingNotes, setEditingNotes] = useState(false);
  const [directive, setDirective] = useState(agent.initial_task || agent.name || '');
  const [editingDirective, setEditingDirective] = useState(false);
  const [flashModelValue, setFlashModelValue] = useState('');
  const [heavyModelValue, setHeavyModelValue] = useState('');
  const [models, setModels] = useState<ModelInfo[]>(_cachedModels || []);

  // Scope state
  const [scopedApps, setScopedApps] = useState<ScopedApp[]>([]);
  const [allUserApps, setAllUserApps] = useState<CachedApp[]>([]);
  const [loadingApps, setLoadingApps] = useState(false);
  // Legacy — kept for backwards compat init
  const [connectedApps, setConnectedApps] = useState<ConnectedApp[]>([]);
  const [appSearchQuery, setAppSearchQuery] = useState('');
  const [appSearchResults, setAppSearchResults] = useState<Array<{ id: string; name: string; description: string | null }>>([]);
  const [searchingApps, setSearchingApps] = useState(false);
  const appSearchRef = useRef<ReturnType<typeof setTimeout> | null>(null);


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

    // Fetch models for dropdown (use module cache if available)
    if (_cachedModels) {
      setModels(_cachedModels);
    } else {
      fetchModels().then(m => { _cachedModels = m; setModels(m); }).catch(() => {});
    }

    // Fetch all user apps for the scope dropdown (use module cache if available)
    if (_cachedUserApps) {
      setAllUserApps(_cachedUserApps);
      setLoadingApps(false);
    } else if (executeMcpTool) {
      setLoadingApps(true);
      executeMcpTool('ul_discover', { scope: 'library' })
        .then(result => {
          console.log('[AgentConfigPanel] library result:', result?.slice(0, 500));
          const parsed = JSON.parse(result);
          let apps: CachedApp[] = [];

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
              // Parse functions from markdown lines like "- fn_name(args): description"
              const fns: AppFunction[] = [];
              for (const line of lines.slice(1)) {
                const fnMatch = line.match(/^- (\w+)\(.*?\)(?::\s*(.*))?$/);
                if (fnMatch) {
                  fns.push({ name: fnMatch[1], description: fnMatch[2]?.trim() === 'No description' ? '' : (fnMatch[2]?.trim() || ''), selected: true, convention: '' });
                }
              }
              apps.push({ id: name, slug: name, name, description: lines[1]?.trim() || null, functions: fns.length > 0 ? fns : undefined });
            }
          } else if (parsed.results) {
            apps = parsed.results.map((r: { id: string; slug?: string; name: string; description?: string }) => ({
              id: r.id, slug: r.slug || r.id, name: r.name, description: r.description || null,
            }));
          }

          _cachedUserApps = apps;
          setAllUserApps(apps);
        })
        .catch(() => setAllUserApps([]))
        .finally(() => setLoadingApps(false));
    }

    // Load scoped apps from agent record
    if (agent.connected_apps) {
      try {
        const persisted = parsePersistedConfig(agent.connected_apps);

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

      }
    } else {
      setScopedApps([]);
      setConnectedApps([]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.id]);

  // ── Persist helpers ──

  const persistScopeConfig = useCallback(async (apps: ScopedApp[]) => {
    const config = buildScopePersistedConfig(apps, []);
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

  const handleSelectFlashModel = useCallback(async (value: string) => {
    setFlashModelValue(value);
    const combined = value && heavyModelValue ? `${value} → ${heavyModelValue}` : value || heavyModelValue;
    await onUpdateAgent({ model: combined } as Partial<Agent>);
  }, [heavyModelValue, onUpdateAgent]);

  const handleSelectHeavyModel = useCallback(async (value: string) => {
    setHeavyModelValue(value);
    const combined = flashModelValue && value ? `${flashModelValue} → ${value}` : flashModelValue || value;
    await onUpdateAgent({ model: combined } as Partial<Agent>);
  }, [flashModelValue, onUpdateAgent]);

  const handleToolApprovalChange = useCallback(async (value: string) => {
    await onUpdateAgent({ permission_level: value } as Partial<Agent>);
  }, [onUpdateAgent]);

  // ── Function toggle / convention ──

  // ── Scope handlers ──

  const addScopedApp = useCallback(async (app: CachedApp) => {
    // Use pre-parsed functions from library cache if available
    const cachedFns = app.functions || [];
    const newApp: ScopedApp = {
      id: app.id,
      slug: app.slug,
      name: app.name,
      description: app.description,
      access: 'all',
      functions: cachedFns,
      expanded: false,
    };
    const next = [...scopedApps, newApp];
    setScopedApps(next);

    // If no cached functions, try inspecting via API
    if (cachedFns.length === 0 && executeMcpTool) {
      try {
        const info = await inspectApp(executeMcpTool, app.id);
        const updated = next.map(a => a.id === app.id ? { ...a, name: info.name, description: info.description, functions: info.functions } : a);
        setScopedApps(updated);
        await persistScopeConfig(updated);
      } catch (err) {
        console.warn('[AgentConfigPanel] inspectApp failed:', err);
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

  const updateScopeConvention = useCallback((appId: string, fnName: string, value: string) => {
    setScopedApps(prev => prev.map(a => {
      if (a.id !== appId) return a;
      return { ...a, functions: a.functions.map(f => f.name === fnName ? { ...f, convention: value } : f) };
    }));
  }, []);

  const saveScopeConvention = useCallback(async () => {
    await persistScopeConfig(scopedApps);
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

  // ── Render ──

  const cardClass = 'bg-gray-50 p-3';
  const labelClass = 'text-[12.5px] font-medium text-ul-text';
  const valueClass = 'text-[12px] font-mono text-gray-500';
  const valueBtnClass = `${valueClass} py-0.5 hover:bg-white transition-colors`;

  // Model dropdown options
  const modelOptions: DropdownOption[] = models.map(m => ({
    value: m.id,
    label: displayModelName(m.id),
    description: m.provider,
  }));

  // Approval dropdown options
  const approvalOptions: DropdownOption[] = [
    { value: 'auto_edit', label: 'Auto-approve', description: 'Tools run without asking', icon: <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" /> },
    { value: 'ask_always', label: 'Ask always', description: 'Confirm before each tool', icon: <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" /> },
    { value: 'auto_read', label: 'Read only', description: 'Block all write operations', icon: <span className="w-1.5 h-1.5 rounded-full bg-gray-300 shrink-0" /> },
  ];

  // Scope dropdown options
  const availableApps = allUserApps.filter(a => !scopedApps.some(s => s.id === a.id));
  const scopeOptions: DropdownOption[] = availableApps.map(a => ({
    value: a.id,
    label: a.name,
    description: a.description || undefined,
  }));

  return (
    <div className="space-y-1">

      {/* ── Model ── */}
      <div className={cardClass}>
        <span className={`${labelClass} block mb-1.5`}>Model</span>
        <div className="space-y-1">
          {/* Flash */}
          <ConfigDropdown
            options={modelOptions}
            selected={flashModelValue}
            onSelect={handleSelectFlashModel}
            searchable
            searchPlaceholder="Search models..."
            allowCustom
            customLabel="Use"
            width="w-80"
            trigger={
              <div className="flex items-center w-[calc(100%+1.5rem)] -mx-3 pl-4 pr-3 py-0.5 hover:bg-white transition-colors">
                <span className="text-[12px] font-mono text-gray-400 mr-3 shrink-0">Flash</span>
                <span className="flex-1 min-w-0 text-left text-[12px] font-mono text-gray-500 truncate">
                  {flashModelValue ? displayModelName(flashModelValue) : <span className="text-gray-500">not set</span>}
                </span>
              </div>
            }
          />
          {/* Heavy */}
          <ConfigDropdown
            options={modelOptions}
            selected={heavyModelValue}
            onSelect={handleSelectHeavyModel}
            searchable
            searchPlaceholder="Search models..."
            allowCustom
            customLabel="Use"
            width="w-80"
            trigger={
              <div className="flex items-center w-[calc(100%+1.5rem)] -mx-3 pl-4 pr-3 py-0.5 hover:bg-white transition-colors">
                <span className="text-[12px] font-mono text-gray-400 mr-3 shrink-0">Heavy</span>
                <span className="flex-1 min-w-0 text-left text-[12px] font-mono text-gray-500 truncate">
                  {heavyModelValue ? displayModelName(heavyModelValue) : <span className="text-gray-500">not set</span>}
                </span>
              </div>
            }
          />
        </div>
      </div>

      {/* ── Approval ── */}
      <div className={cardClass}>
        <span className={`${labelClass} block mb-1.5`}>Approval</span>
        <ConfigDropdown
          options={approvalOptions}
          selected={agent.permission_level || 'auto_edit'}
          onSelect={handleToolApprovalChange}
          width="w-64"
          trigger={
            <div className="flex items-center gap-2 w-[calc(100%+1.5rem)] -mx-3 px-3 py-0.5 hover:bg-white transition-colors">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                (agent.permission_level || 'auto_edit') === 'auto_edit' ? 'bg-emerald-400' :
                agent.permission_level === 'ask_always' ? 'bg-amber-400' : 'bg-gray-300'
              }`} />
              <span className={valueClass}>
                {(agent.permission_level || 'auto_edit') === 'auto_edit' ? 'Auto-approve' :
                 agent.permission_level === 'ask_always' ? 'Ask always' : 'Read only'}
              </span>
            </div>
          }
        />
      </div>

      {/* ── Scope ── */}
      {executeMcpTool && (
        <div className={cardClass}>
          <span className={`${labelClass} block mb-2`}>
            Scope: {scopedApps.length > 0 ? `${scopedApps.length} App${scopedApps.length !== 1 ? 's' : ''}` : 'All'}
          </span>

          {/* Scoped apps */}
          {scopedApps.length > 0 && (
            <div className="space-y-1.5 mb-2">
              {scopedApps.map(app => (
                <div key={app.id} className="rounded border border-gray-100 overflow-hidden">
                  <div className="flex items-center gap-2 px-2.5 py-1.5 bg-gray-50/50">
                    {app.access !== 'data' && (
                      <button onClick={() => toggleScopeExpanded(app.id)} className="shrink-0">
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
                          className={`transition-transform text-gray-400 ${app.expanded ? 'rotate-90' : ''}`}>
                          <path d="M3 1.5L7 5L3 8.5" />
                        </svg>
                      </button>
                    )}
                    <button onClick={() => app.access !== 'data' && toggleScopeExpanded(app.id)} className="text-small text-ul-text font-medium truncate flex-1 min-w-0 text-left">
                      {app.name}
                    </button>
                    <button
                      onClick={() => {
                        const levels: ScopeAccess[] = ['all', 'functions', 'data'];
                        const next = levels[(levels.indexOf(app.access) + 1) % levels.length];
                        changeScopeAccess(app.id, next);
                      }}
                      className="text-[10px] text-gray-400 px-1.5 py-0.5 rounded hover:bg-white hover:text-gray-600 transition-colors shrink-0"
                    >
                      {app.access === 'all' ? 'All' : app.access === 'functions' ? 'Functions' : 'Data'}
                    </button>
                    {app.access !== 'data' && app.functions.length > 0 && (
                      <span className="text-[10px] text-gray-400 shrink-0 font-mono">
                        {app.functions.filter(f => f.selected).length}/{app.functions.length}
                      </span>
                    )}
                    {app.access !== 'data' && app.functions.length === 0 && (
                      <span className="text-[10px] text-gray-300 shrink-0">...</span>
                    )}
                    <button onClick={() => removeScopedApp(app.id)} className="text-gray-300 hover:text-red-400 transition-colors shrink-0">
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                        <path d="M3 3l6 6M9 3l-6 6" />
                      </svg>
                    </button>
                  </div>

                  {app.expanded && app.access !== 'data' && (
                    <div className="border-t border-gray-100 bg-white px-2.5 py-1.5">
                      {app.functions.length === 0 ? (
                        <p className="text-[11px] text-gray-300 py-1">Loading functions...</p>
                      ) : (
                        <>
                      <div className="flex items-center gap-2 mb-1.5 pb-1.5 border-b border-gray-50">
                        <button onClick={() => toggleScopeAllFunctions(app.id, true)} className="text-[10px] text-gray-400 hover:text-gray-600">All</button>
                        <span className="text-[10px] text-gray-200">|</span>
                        <button onClick={() => toggleScopeAllFunctions(app.id, false)} className="text-[10px] text-gray-400 hover:text-gray-600">None</button>
                      </div>
                      <div className="space-y-1 max-h-[500px] overflow-y-auto">
                        {app.functions.map(fn => (
                          <div key={fn.name} className="py-0.5">
                            <label className="flex items-center gap-1.5 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={fn.selected}
                                onChange={() => toggleScopeFunction(app.id, fn.name)}
                                className="rounded border-gray-300 text-gray-700 focus:ring-0 focus:ring-offset-0 w-3 h-3"
                              />
                              <span className={`text-[11px] font-mono ${fn.selected ? 'text-gray-600' : 'text-gray-300 line-through'}`}>
                                {fn.name}
                              </span>
                            </label>
                            {fn.selected && (
                              <input
                                type="text"
                                value={fn.convention}
                                onChange={e => updateScopeConvention(app.id, fn.name, e.target.value)}
                                onBlur={saveScopeConvention}
                                placeholder="Custom instructions for this function..."
                                className="mt-0.5 ml-[18px] w-[calc(100%-18px)] px-1.5 py-0.5 text-[11px] font-mono text-gray-400 rounded border border-gray-100 bg-gray-50/50 focus:outline-none focus:border-gray-300 focus:bg-white placeholder:text-gray-300"
                              />
                            )}
                          </div>
                        ))}
                      </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Add app */}
          {loadingApps ? (
            <span className="text-[10px] text-gray-300">Loading...</span>
          ) : availableApps.length > 0 ? (
            <ConfigDropdown
              options={scopeOptions}
              onSelect={value => {
                const app = allUserApps.find(a => a.id === value);
                if (app) addScopedApp(app);
              }}
              searchable
              searchPlaceholder="Search apps..."
              width="w-72"
              trigger={
                <div className={`${valueBtnClass} -mx-3 px-3 w-[calc(100%+1.5rem)]`}>
                  + Add app...
                </div>
              }
            />
          ) : scopedApps.length === 0 ? null : null}
        </div>
      )}

      {/* ── Instructions ── */}
      <div className={cardClass}>
        <span className={`${labelClass} block mb-1`}>Instructions</span>
        {editingNotes ? (
          <textarea
            value={adminNotes}
            onChange={e => setAdminNotes(e.target.value)}
            onBlur={() => { handleNotesBlur(); setEditingNotes(false); }}
            placeholder="Behavioral rules, conventions, guidance..."
            autoFocus
            className={`w-full px-0 py-1 ${valueClass} border-0 bg-transparent focus:outline-none resize-none placeholder:text-gray-300`}
            rows={2}
          />
        ) : (
          <button
            onClick={() => setEditingNotes(true)}
            className={`w-full text-left ${valueBtnClass} whitespace-pre-wrap -mx-3 px-3 py-1 mt-0.5 w-[calc(100%+1.5rem)]`}
          >
            {adminNotes || <span className="text-gray-500">+ Add custom instructions...</span>}
          </button>
        )}
      </div>

      {/* Open Chat button (agents tab only) */}
      {showOpenChat && onNavigateToAgent && (
        <div className="pt-1">
          <button
            onClick={() => onNavigateToAgent(agent.id)}
            className="text-caption px-3 py-1 rounded bg-gray-800 text-white hover:bg-gray-700 transition-colors"
          >
            Open Chat
          </button>
        </div>
      )}
    </div>
  );
}
