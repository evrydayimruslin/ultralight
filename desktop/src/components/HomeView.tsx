// Command — tabbed view with Project (kanban), Agents (fleet), and Activity (event feed).

import { useState, useCallback, useEffect, useMemo, useRef, Fragment } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useKanban, type KanbanCard as KanbanCardType } from '../hooks/useKanban';
import type { Agent, CreateAgentParams } from '../hooks/useAgentFleet';
import { useAgentFleet } from '../hooks/useAgentFleet';
import { useMcp } from '../hooks/useMcp';
import { usePermissions } from '../hooks/usePermissions';
import { buildAgentSystemPrompt, inspectAndBuildMcpSchemas, generateConnectedAppsSchema } from '../lib/systemPrompt';
import { loadBaseContext, readAbsoluteFile, fileNameWithoutExt } from '../lib/templates';
import { agentRunner, type AgentEvent } from '../lib/agentRunner';

import KanbanBoard from './KanbanBoard';
import CardDetailModal from './CardDetailModal';
import CreateAgentModal from './CreateAgentModal';
import SpendingApprovalModal from './SpendingApprovalModal';
import AgentConfigPanel from './AgentConfigPanel';
import WidgetHomescreen from './WidgetHomescreen';
import WidgetAppView from './WidgetAppView';
import { useWidgetInbox, type WidgetAppSource } from '../hooks/useWidgetInbox';

// ── Types ──

type DashboardTab = 'agents' | 'admin';

interface HomeViewProps {
  onNavigateToAgent: (agentId: string, initialMessage?: string) => void;
}

interface ActivityEntry {
  id: string;
  agentId: string;
  agentName: string;
  type: string;
  detail: string;
  timestamp: number;
}

// ── Helpers ──

function statusDot(status: string): string {
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
  switch (status) {
    case 'running': return 'Running';
    case 'pending': return 'Pending';
    case 'completed': return 'Completed';
    case 'error': return 'Error';
    case 'stopped': return 'Stopped';
    case 'waiting_for_approval': return 'Awaiting Approval';
    default: return status;
  }
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

// ── Tab Button ──

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-small font-medium border-b-2 transition-colors
        ${active
          ? 'border-ul-text text-ul-text'
          : 'border-transparent text-ul-text-muted hover:text-ul-text-secondary hover:border-gray-200'
        }`}
    >
      {label}
    </button>
  );
}

// ── Component ──

export default function HomeView({
  onNavigateToAgent,
}: HomeViewProps) {
  // Project dir removed from Command — now per-conversation in ChatInput.
  // Pass null to downstream consumers that still expect it.
  const selectedProjectDir: string | null = null;
  const [activeTab, setActiveTab] = useState<DashboardTab>('admin');
  const [quickInstructAgent, setQuickInstructAgent] = useState<string | null>(null);
  const [quickInstructText, setQuickInstructText] = useState('');
  const [quickInstructNewSession, setQuickInstructNewSession] = useState(false);
  const [activityLog, setActivityLog] = useState<ActivityEntry[]>([]);
  const [expandedAgentId, setExpandedAgentId] = useState<string | null>(null);
  const instructInputRef = useRef<HTMLInputElement>(null);
  const { sources: widgetSources, metas: widgetMetas, totalBadge: widgetBadge, loading: widgetLoading, getAppHtml, executeBridgeCall, refresh: refreshWidgets } = useWidgetInbox();
  const [openWidget, setOpenWidget] = useState<WidgetAppSource | null>(null);
  const [widgetAppHtml, setWidgetAppHtml] = useState<string | null>(null);

  const handleOpenWidget = useCallback(async (source: WidgetAppSource) => {
    const html = await getAppHtml(source);
    if (html) {
      setWidgetAppHtml(html);
      setOpenWidget(source);
    }
  }, [getAppHtml]);

  const handleCloseWidget = useCallback(() => {
    setOpenWidget(null);
    setWidgetAppHtml(null);
    // Don't trigger full refresh — the 30s poll will update badges naturally
  }, []);

  const {
    columns,
    cards,
    loading: kanbanLoading,
    createCard,
    updateCard,
    moveCard,
    deleteCard,
    assignAgent,
  } = useKanban(selectedProjectDir);

  const {
    agents,
    createAgent,
    startAgent,
    refreshAgents,
  } = useAgentFleet();

  const { executeToolCall: executeMcpTool } = useMcp();
  const { pendingSpending, checkSpending, approveSpending, denySpending } = usePermissions();

  const [selectedCard, setSelectedCard] = useState<KanbanCardType | null>(null);
  const [createAgentCard, setCreateAgentCard] = useState<KanbanCardType | null>(null);

  // Agent name lookup for activity log
  const agentNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of agents) map.set(a.id, a.name);
    return map;
  }, [agents]);

  // Subscribe to agentRunner events for the activity feed
  useEffect(() => {
    const unsubscribe = agentRunner.on((event: AgentEvent) => {
      let entry: ActivityEntry | null = null;
      const ts = Date.now();

      switch (event.type) {
        case 'status_change':
          entry = {
            id: crypto.randomUUID(),
            agentId: event.agentId,
            agentName: agentNameMap.get(event.agentId) || event.agentId.slice(0, 8),
            type: 'status',
            detail: `Status changed to ${event.status}${event.error ? `: ${event.error}` : ''}`,
            timestamp: ts,
          };
          break;
        case 'completed':
          entry = {
            id: crypto.randomUUID(),
            agentId: event.agentId,
            agentName: agentNameMap.get(event.agentId) || event.agentId.slice(0, 8),
            type: 'completed',
            detail: `Completed after ${event.toolRounds} tool round${event.toolRounds !== 1 ? 's' : ''}${event.hitLimit ? ' (hit limit)' : ''}`,
            timestamp: ts,
          };
          break;
        case 'warning':
          entry = {
            id: crypto.randomUUID(),
            agentId: event.agentId,
            agentName: agentNameMap.get(event.agentId) || event.agentId.slice(0, 8),
            type: 'warning',
            detail: event.message,
            timestamp: ts,
          };
          break;
      }

      if (entry) {
        setActivityLog(prev => [entry!, ...prev].slice(0, 100));
      }
    });

    return unsubscribe;
  }, [agentNameMap]);

  // Filter agents for current project
  const projectAgents = useMemo(() => {
    if (!selectedProjectDir) return agents;
    return agents.filter(a => a.project_dir === selectedProjectDir || !a.project_dir);
  }, [agents, selectedProjectDir]);

  const activeAgents = useMemo(
    () => projectAgents.filter(a => a.status === 'running' || a.status === 'pending'),
    [projectAgents]
  );

  const recentAgents = useMemo(
    () => projectAgents
      .filter(a => a.status !== 'running' && a.status !== 'pending')
      .slice(0, 8),
    [projectAgents]
  );

  // Quick-instruct: send follow-up to an agent via agentRunner
  const handleQuickInstruct = useCallback(async () => {
    if (!quickInstructAgent || !quickInstructText.trim()) return;
    const text = quickInstructText.trim();
    setQuickInstructText('');

    if (quickInstructNewSession) {
      // Navigate to agent chat — the text will be sent as first message in new session
      setQuickInstructAgent(null);
      onNavigateToAgent(quickInstructAgent, text);
    } else if (agentRunner.isRunning(quickInstructAgent)) {
      agentRunner.queueMessage(quickInstructAgent, text);
    } else if (agentRunner.hasRun(quickInstructAgent)) {
      await agentRunner.resume(quickInstructAgent, text);
    } else {
      // Not managed by agentRunner — navigate to it instead
      onNavigateToAgent(quickInstructAgent);
    }
  }, [quickInstructAgent, quickInstructText, quickInstructNewSession, onNavigateToAgent]);

  // Expand/collapse agent row in fleet table
  const handleExpandAgent = useCallback((agentId: string) => {
    setExpandedAgentId(prev => prev === agentId ? null : agentId);
  }, []);

  // Update agent from inline config panel
  const handleInlineUpdateAgent = useCallback(async (agentId: string, updates: Partial<Agent>) => {
    try {
      await invoke('db_update_agent', {
        id: agentId,
        status: updates.status ?? null,
        name: updates.name ?? null,
        adminNotes: updates.admin_notes ?? null,
        endGoal: updates.end_goal ?? null,
        context: updates.context ?? null,
        permissionLevel: updates.permission_level ?? null,
        model: updates.model ?? null,
        projectDir: updates.project_dir ?? null,
        connectedAppIds: updates.connected_app_ids ?? null,
        connectedApps: updates.connected_apps ?? null,
        initialTask: updates.initial_task ?? null,
      });
      await refreshAgents();
    } catch (err) {
      console.warn('Failed to update agent:', err);
    }
  }, [refreshAgents]);

  // ── Kanban callbacks (unchanged) ──

  const handleCreateCard = useCallback(async (columnId: string, title: string) => {
    await createCard(columnId, title);
  }, [createCard]);

  const handleMoveCard = useCallback(async (cardId: string, targetColumnId: string, position: number) => {
    await moveCard(cardId, targetColumnId, position);
  }, [moveCard]);

  const handleCardClick = useCallback((card: KanbanCardType) => {
    setSelectedCard(card);
  }, []);

  const handleCardUpdate = useCallback(async (
    id: string,
    updates: Partial<Pick<KanbanCardType, 'title' | 'description' | 'acceptance_criteria' | 'status' | 'assigned_agent_id'>>,
  ) => {
    await updateCard(id, updates);
    setSelectedCard(prev => prev?.id === id ? { ...prev, ...updates, updated_at: Date.now() } : prev);
  }, [updateCard]);

  const handleCardDelete = useCallback(async (id: string) => {
    await deleteCard(id);
    setSelectedCard(null);
  }, [deleteCard]);

  const handleCreateAgentFromCard = useCallback((card: KanbanCardType) => {
    setSelectedCard(null);
    setCreateAgentCard(card);
  }, []);

  const handleCreateAndStartAgent = useCallback(async (params: {
    name: string;
    role: string;
    task: string;
    model: string;
    permissionLevel: string;
    cardId?: string;
    launchMode: string;
    templateBody?: string;
    templateMcps?: string[];
    selectedContextPaths?: string[];
    selectedSkillIds?: Array<{ id: string; name: string; priceLight: number }>;
    connectedAppIds?: string[];
  }) => {
    const baseCtx = await loadBaseContext(selectedProjectDir);
    const knowledgeCtx: Array<{ name: string; content: string }> = [];
    if (params.selectedContextPaths) {
      for (const path of params.selectedContextPaths) {
        if (baseCtx.some(b => b.path === path)) continue;
        const content = await readAbsoluteFile(path);
        if (content) {
          knowledgeCtx.push({ name: fileNameWithoutExt(path), content });
        }
      }
    }

    const skillCtx: Array<{ name: string; content: string }> = [];
    if (params.selectedSkillIds?.length) {
      for (const skill of params.selectedSkillIds) {
        const approved = await checkSpending(skill.name, skill.priceLight);
        if (!approved) continue;
        try {
          const result = await executeMcpTool('ul_call', {
            app_id: skill.id,
            function_name: 'get_content',
          });
          skillCtx.push({ name: skill.name, content: result });
        } catch (err) {
          console.warn(`Failed to fetch skill ${skill.name}:`, err);
        }
      }
    }

    let mcpSchemas: string | undefined;
    if (params.templateMcps?.length) {
      mcpSchemas = await inspectAndBuildMcpSchemas(params.templateMcps, executeMcpTool);
    }

    // Inspect connected apps and build schema blocks for the system prompt
    if (params.connectedAppIds?.length) {
      const connectedSchemas = [];
      for (const appId of params.connectedAppIds) {
        try {
          const result = await executeMcpTool('ul_discover', { scope: 'inspect', app_id: appId });
          const parsed = JSON.parse(result);
          const manifest = parsed.manifest ? JSON.parse(parsed.manifest) : null;
          const appName = parsed.metadata?.name || parsed.name || appId;
          const appDesc = parsed.metadata?.description || parsed.description || null;

          if (manifest?.functions) {
            connectedSchemas.push({
              app_id: appId,
              name: appName,
              description: appDesc,
              permissions: manifest.permissions,
              functions: manifest.functions,
            });
          } else {
            // Fallback: build from inspect tools/functions
            const fns = parsed.functions || parsed.tools || [];
            const fnMap: Record<string, { description: string; parameters?: Record<string, { type: string; description?: string; required?: boolean }> }> = {};
            for (const fn of fns) {
              const params: Record<string, { type: string; description?: string; required?: boolean }> = {};
              const props = fn.parameters?.properties || fn.inputSchema?.properties || {};
              for (const [pName, pSchema] of Object.entries(props)) {
                const s = pSchema as { type?: string; description?: string };
                params[pName] = { type: s.type || 'any', description: s.description };
              }
              fnMap[fn.name] = { description: fn.description || '', parameters: Object.keys(params).length > 0 ? params : undefined };
            }
            if (Object.keys(fnMap).length > 0) {
              connectedSchemas.push({ app_id: appId, name: appName, description: appDesc, functions: fnMap });
            }
          }
        } catch (err) {
          console.warn(`Failed to inspect connected app ${appId}:`, err);
        }
      }

      if (connectedSchemas.length > 0) {
        const connectedBlock = generateConnectedAppsSchema(connectedSchemas);
        mcpSchemas = mcpSchemas ? `${mcpSchemas}\n\n${connectedBlock}` : connectedBlock;
      }
    }

    const allContext = [
      ...baseCtx.map(f => ({ name: f.name, content: f.content })),
      ...knowledgeCtx,
    ];
    const systemPrompt = buildAgentSystemPrompt(
      params.role, params.name, selectedProjectDir,
      params.templateBody,
      undefined,
      params.launchMode,
      allContext.length > 0 ? allContext : undefined,
      skillCtx.length > 0 ? skillCtx : undefined,
      mcpSchemas,
    );

    const agent = await createAgent({
      name: params.name,
      role: params.role,
      initialTask: params.cardId ? `[Card: ${params.cardId}]\n\n${params.task}` : params.task,
      systemPrompt,
      projectDir: selectedProjectDir,
      model: params.model,
      parentAgentId: null,
      permissionLevel: params.permissionLevel,
      launchMode: params.launchMode,
      connectedAppIds: params.connectedAppIds?.length ? JSON.stringify(params.connectedAppIds) : undefined,
    });

    if (params.cardId) {
      await assignAgent(params.cardId, agent.id);
    }

    onNavigateToAgent(agent.id);
  }, [selectedProjectDir, createAgent, assignAgent, onNavigateToAgent, executeMcpTool, checkSpending]);

  const handleApproveAgent = useCallback(async (discussAgentId: string, plan: string, card: KanbanCardType) => {
    await invoke('db_update_agent', { id: discussAgentId, status: 'completed' });
    const taskText = card.description
      ? `${card.title}\n\nDescription: ${card.description}`
      : card.title;
    const baseCtx = await loadBaseContext(selectedProjectDir);
    const systemPrompt = buildAgentSystemPrompt(
      'builder', card.title.slice(0, 40), selectedProjectDir, undefined, undefined, 'build_now',
      baseCtx.length > 0 ? baseCtx.map(f => ({ name: f.name, content: f.content })) : undefined,
    );
    const builder = await createAgent({
      name: `${card.title.slice(0, 30)} Builder`,
      role: 'builder',
      initialTask: card.id ? `[Card: ${card.id}]\n\n${taskText}` : taskText,
      systemPrompt,
      projectDir: selectedProjectDir,
      model: 'anthropic/claude-sonnet-4',
      parentAgentId: discussAgentId,
      launchMode: 'build_now',
      context: `Approved plan:\n${plan}`,
    });

    await assignAgent(card.id, builder.id);
    onNavigateToAgent(builder.id);
  }, [selectedProjectDir, createAgent, assignAgent, onNavigateToAgent]);

  const handleRejectAgent = useCallback(async (agentId: string) => {
    await invoke('db_update_agent', { id: agentId, status: 'stopped' });
    await invoke('db_create_card_report', {
      id: crypto.randomUUID(),
      cardId: selectedCard?.id ?? '',
      agentId,
      reportType: 'progress',
      content: 'Plan rejected by user.',
    });
  }, [selectedCard]);

  return (
    <div className="flex-1 flex flex-col h-full bg-white">
      {/* Header */}
      <div className="flex items-center justify-between px-4 h-nav border-b border-ul-border flex-shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-h3 text-ul-text tracking-tight">Command</h1>
        </div>
        <div className="flex items-center gap-3">
          {/* Refresh button */}
          <button
            onClick={() => {
              if (activeTab === 'admin') refreshWidgets();
              if (activeTab === 'agents') refreshAgents();
            }}
            title="Refresh"
            className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
      </div>

      {/* Admin header — no tabs needed */}

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto relative">
        {false && activeTab === 'project_disabled' && (
          <div className="px-6 py-4 space-y-6">
            {selectedProjectDir ? (
              <section>
                {kanbanLoading ? (
                  <div className="flex items-center justify-center h-32 text-small text-ul-text-muted">
                    Loading board...
                  </div>
                ) : (
                  <KanbanBoard
                    columns={columns}
                    cards={cards}
                    agents={agents}
                    onCreateCard={handleCreateCard}
                    onMoveCard={handleMoveCard}
                    onCardClick={handleCardClick}
                  />
                )}
              </section>
            ) : (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-gray-300 mb-4">
                  <path d="M6 14V38C6 39.6569 7.34315 41 9 41H39C40.6569 41 42 39.6569 42 38V20C42 18.3431 40.6569 17 39 17H24L20 11H9C7.34315 11 6 12.3431 6 14Z" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <h2 className="text-body font-medium text-ul-text mb-1">No project selected</h2>
                <p className="text-small text-ul-text-muted">
                  Select a project folder to see your kanban board and agents.
                </p>
              </div>
            )}

            {activeAgents.length > 0 && (
              <section>
                <h2 className="text-small font-medium text-ul-text-secondary uppercase tracking-wider mb-3">
                  Active Agents
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {activeAgents.map(agent => (
                    <button
                      key={agent.id}
                      onClick={() => onNavigateToAgent(agent.id)}
                      className="flex items-start gap-3 p-3 rounded-lg border border-ul-border bg-white hover:bg-gray-50 hover:shadow-sm transition-all text-left"
                    >
                      <span className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${statusDot(agent.status)}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-small font-medium text-ul-text truncate">{agent.name}</span>
                          <span className="text-caption px-1.5 py-0.5 rounded bg-gray-100 text-ul-text-secondary flex-shrink-0">{agent.role}</span>
                        </div>
                        {agent.initial_task && (
                          <p className="text-caption text-ul-text-muted mt-0.5 truncate">{agent.initial_task}</p>
                        )}
                        <p className="text-caption text-ul-text-muted mt-1">{formatRelativeTime(agent.updated_at)}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {recentAgents.length > 0 && (
              <section>
                <h2 className="text-small font-medium text-ul-text-secondary uppercase tracking-wider mb-3">
                  Recent Agents
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {recentAgents.map(agent => (
                    <button
                      key={agent.id}
                      onClick={() => onNavigateToAgent(agent.id)}
                      className="flex items-start gap-3 p-3 rounded-lg border border-ul-border bg-white hover:bg-gray-50 hover:shadow-sm transition-all text-left"
                    >
                      <span className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${statusDot(agent.status)}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-small font-medium text-ul-text truncate">{agent.name}</span>
                          <span className="text-caption px-1.5 py-0.5 rounded bg-gray-100 text-ul-text-secondary flex-shrink-0">{agent.role}</span>
                        </div>
                        {agent.last_message_preview && (
                          <p className="text-caption text-ul-text-muted mt-0.5 truncate">{agent.last_message_preview}</p>
                        )}
                        <p className="text-caption text-ul-text-muted mt-1">{formatRelativeTime(agent.updated_at)}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {selectedProjectDir && activeAgents.length === 0 && recentAgents.length === 0 && (
              <div className="text-center py-8">
                <p className="text-small text-ul-text-muted">
                  No agents yet. Create one from the sidebar or assign an agent to a kanban card.
                </p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'agents' && (
          <div className="px-6 py-4">
            {/* Quick Instruct bar */}
            <div className="mb-4">
              <div className="flex items-center gap-2">
                <select
                  value={quickInstructAgent || ''}
                  onChange={e => setQuickInstructAgent(e.target.value || null)}
                  className="input text-small h-9 w-48"
                >
                  <option value="">Select agent...</option>
                  {projectAgents.map(a => (
                    <option key={a.id} value={a.id}>
                      {a.status === 'running' ? '\u25CF ' : ''}{a.name}
                    </option>
                  ))}
                </select>
                <input
                  ref={instructInputRef}
                  type="text"
                  value={quickInstructText}
                  onChange={e => setQuickInstructText(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleQuickInstruct(); }}
                  placeholder={quickInstructAgent ? 'Send instruction...' : 'Pick an agent first'}
                  disabled={!quickInstructAgent}
                  className="input text-small h-9 flex-1"
                />
                <button
                  onClick={handleQuickInstruct}
                  disabled={!quickInstructAgent || !quickInstructText.trim()}
                  className="btn-primary btn-sm disabled:opacity-30"
                >
                  Send
                </button>
              </div>
              {quickInstructAgent && (
                <label className="flex items-center gap-1.5 mt-1.5 ml-[200px] cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={quickInstructNewSession}
                    onChange={e => setQuickInstructNewSession(e.target.checked)}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-[11px] text-ul-text-muted">Start new session</span>
                </label>
              )}
            </div>

            {/* Agent fleet table */}
            <div className="border border-ul-border rounded-lg overflow-hidden">
              <table className="w-full text-small">
                <thead>
                  <tr className="bg-gray-50 border-b border-ul-border">
                    <th className="text-left px-3 py-2 text-caption font-medium text-ul-text-secondary">Status</th>
                    <th className="text-left px-3 py-2 text-caption font-medium text-ul-text-secondary">Agent</th>
                    <th className="text-left px-3 py-2 text-caption font-medium text-ul-text-secondary">Role</th>
                    <th className="text-left px-3 py-2 text-caption font-medium text-ul-text-secondary">Messages</th>
                    <th className="text-left px-3 py-2 text-caption font-medium text-ul-text-secondary">Updated</th>
                    <th className="text-right px-3 py-2 text-caption font-medium text-ul-text-secondary">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {projectAgents.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-8 text-center text-ul-text-muted">
                        No agents yet
                      </td>
                    </tr>
                  ) : (
                    projectAgents.map(agent => {
                      const isExpanded = expandedAgentId === agent.id;
                      return (
                        <Fragment key={agent.id}>
                          <tr
                            className={`border-b border-gray-100 hover:bg-gray-50 transition-colors cursor-pointer ${isExpanded ? 'bg-gray-50' : ''}`}
                            onClick={() => handleExpandAgent(agent.id)}
                          >
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-2">
                                <span className={`w-2 h-2 rounded-full ${statusDot(agent.status)}`} />
                                <span className="text-caption">{statusLabel(agent.status)}</span>
                              </div>
                            </td>
                            <td className="px-3 py-2 font-medium text-ul-text">{agent.name}</td>
                            <td className="px-3 py-2">
                              <span className="text-caption px-1.5 py-0.5 rounded bg-gray-100 text-ul-text-secondary">
                                {agent.role}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-ul-text-muted">
                              {agent.message_count ?? '—'}
                            </td>
                            <td className="px-3 py-2 text-ul-text-muted">
                              {formatRelativeTime(agent.updated_at)}
                            </td>
                            <td className="px-3 py-2 text-right">
                              <div className="flex items-center justify-end gap-1" onClick={e => e.stopPropagation()}>
                                {agent.status === 'running' && (
                                  <button
                                    onClick={() => agentRunner.stop(agent.id)}
                                    className="text-caption px-2 py-0.5 rounded bg-red-50 text-red-600 hover:bg-red-100 transition-colors"
                                  >
                                    Stop
                                  </button>
                                )}
                                <button
                                  onClick={() => {
                                    setQuickInstructAgent(agent.id);
                                    setTimeout(() => instructInputRef.current?.focus(), 50);
                                  }}
                                  className="text-caption px-2 py-0.5 rounded bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors"
                                >
                                  Instruct
                                </button>
                              </div>
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr className="border-b border-gray-200 bg-gray-50">
                              <td colSpan={6} className="px-4 py-3">
                                <AgentConfigPanel
                                  agent={agent}
                                  allAgents={projectAgents}
                                  onUpdateAgent={async (updates) => handleInlineUpdateAgent(agent.id, updates)}
                                  onNavigateToAgent={onNavigateToAgent}
                                  executeMcpTool={executeMcpTool}
                                  showOpenChat
                                />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Full-screen widget app overlay — positioned against the tab content container */}
        {openWidget && widgetAppHtml && (
          <div className="absolute inset-0 z-10 bg-white">
            <WidgetAppView
              source={openWidget}
              appHtml={widgetAppHtml}
              onBack={handleCloseWidget}
              onBridgeCall={executeBridgeCall}
            />
          </div>
        )}

        {activeTab === 'admin' && (
          <div className="px-6 py-4">
                {/* Widget Homescreen — grid of widget tiles */}
                <WidgetHomescreen
                  sources={widgetSources}
                  metas={widgetMetas}
                  loading={widgetLoading}
                  onOpenWidget={handleOpenWidget}
                />

                {/* Agent Activity Log */}
                {activityLog.length > 0 && (
                  <div className="mt-6 border-t border-gray-200 pt-4">
                    <h3 className="text-caption font-medium text-ul-text-muted mb-2">Recent Activity</h3>
                    <div className="space-y-1">
                      {activityLog.map(entry => (
                        <div
                          key={entry.id}
                          className="flex items-start gap-3 px-3 py-2 rounded-md hover:bg-gray-50 transition-colors cursor-pointer"
                          onClick={() => onNavigateToAgent(entry.agentId)}
                        >
                          <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${
                            entry.type === 'warning' ? 'bg-ul-warning'
                              : entry.type === 'completed' ? 'bg-blue-400'
                              : 'bg-gray-300'
                          }`} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-small font-medium text-ul-text">{entry.agentName}</span>
                              <span className="text-caption text-ul-text-muted">{formatRelativeTime(entry.timestamp)}</span>
                            </div>
                            <p className="text-caption text-ul-text-secondary truncate">{entry.detail}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Empty state */}
                {activityLog.length === 0 && widgetBadge === 0 && !widgetLoading && (
                  <div className="text-center py-16">
                    <svg width="40" height="40" viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-gray-300 mx-auto mb-3">
                      <circle cx="20" cy="20" r="16" />
                      <path d="M20 12v8l5 5" strokeLinecap="round" />
                    </svg>
                    <p className="text-small text-ul-text-muted">
                      No activity yet. Events will appear here as agents run.
                    </p>
                  </div>
                )}
          </div>
        )}
      </div>

      {/* Modals */}
      {selectedCard && (
        <CardDetailModal
          card={selectedCard}
          agents={agents}
          onUpdate={handleCardUpdate}
          onDelete={handleCardDelete}
          onCreateAgent={handleCreateAgentFromCard}
          onApproveAgent={handleApproveAgent}
          onRejectAgent={handleRejectAgent}
          onClose={() => setSelectedCard(null)}
        />
      )}

      {createAgentCard && (
        <CreateAgentModal
          card={createAgentCard}
          defaultModel="anthropic/claude-sonnet-4"
          projectDir={selectedProjectDir}
          executeMcpTool={executeMcpTool}
          onCreateAndStart={handleCreateAndStartAgent}
          onClose={() => setCreateAgentCard(null)}
        />
      )}

      {pendingSpending && (
        <SpendingApprovalModal
          request={pendingSpending}
          onApprove={approveSpending}
          onDeny={denySpending}
        />
      )}
    </div>
  );
}
