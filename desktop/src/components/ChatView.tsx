// Main chat interface — assembles message list + input + sidebar.

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { useChat } from '../hooks/useChat';
import { useMcp } from '../hooks/useMcp';
import { useLocalTools, type AgentToolContext } from '../hooks/useLocalTools';
import { useProjectDir } from '../hooks/useProjectDir';
import { usePermissions } from '../hooks/usePermissions';
import { useConversations } from '../hooks/useConversations';
import { useAgentFleet } from '../hooks/useAgentFleet';
import MessageList from './MessageList';
import ChatInput from './ChatInput';
import PermissionModal from './PermissionModal';
import SpendingApprovalModal from './SpendingApprovalModal';
import AgentHeader from './AgentHeader';
import { clearToken, getToken, getApiBase, getModel, getInterpreterModel, getHeavyModel } from '../lib/storage';
import { getContextWindow } from '../lib/tokens';
import { buildSystemPrompt, buildCodeModeAppsPrompt } from '../lib/systemPrompt';
import { SYSTEM_AGENTS } from '../lib/systemAgents';
import { gatherProjectContext } from '../lib/projectContext';
import { parseFileOperations } from '../lib/parseFileOps';
import { updateSystemAgentState, maybeEmbedConversation } from '../lib/agentStateSummary';
import { fetchFunctionIndex, fetchTaskContext, streamOrchestrate, streamChat } from '../lib/api';
import { agentRunner } from '../lib/agentRunner';

/** Map flash broker's model suggestion to a real OpenRouter model ID */
function resolveModelFromBroker(suggestion?: string): string | undefined {
  if (!suggestion) return undefined;
  switch (suggestion.toLowerCase()) {
    case 'flash':
      return 'google/gemini-3.1-flash-lite-preview:nitro';
    case 'sonnet':
      return 'anthropic/claude-sonnet-4';
    case 'opus':
      return 'anthropic/claude-opus-4';
    default:
      // If the broker returns a full model ID, use it directly
      if (suggestion.includes('/')) return suggestion;
      return undefined;
  }
}

/** Parse "flash → heavy" model string from agent record, falling back to localStorage globals */
function parseAgentModels(agentModel: string | null): { interpreter: string; heavy: string } {
  if (agentModel) {
    const parts = agentModel.split('→').map(s => s.trim());
    if (parts[0] && parts[1]) return { interpreter: parts[0], heavy: parts[1] };
    if (parts[0]) return { interpreter: parts[0], heavy: getHeavyModel() };
  }
  return { interpreter: getInterpreterModel(), heavy: getHeavyModel() };
}

interface ChatViewProps {
  agentId?: string | null;
  /** Initial message to send automatically when navigating with a new session instruction */
  initialMessage?: string;
  onNavigateHome?: () => void;
  onNavigateToAgent?: (agentId: string) => void;
}

export default function ChatView({
  agentId,
  initialMessage,
  onNavigateHome,
  onNavigateToAgent,
}: ChatViewProps = {}) {
  const { tools: mcpTools, executeToolCall: executeMcpTool } = useMcp();
  const { tools: localTools, executeToolCall: executeLocalTool, isLocalTool } = useLocalTools();
  const { projectDir, pickDirectory } = useProjectDir();
  const {
    level: permissionLevel,
    setLevel: setPermissionLevel,
    pendingRequest,
    checkPermission,
    allow,
    alwaysAllow,
    deny,
    pendingSpending,
    approveSpending,
    denySpending,
  } = usePermissions();
  const {
    conversations: _conversations,
    activeId,
    createConversation,
    loadConversation,
    switchConversation,
    saveMessages,
    deleteConversation: _deleteConversation,
    refreshList: _refreshList,
    searchConversations: _searchConversations,
  } = useConversations();
  const {
    agents,
    activeAgent,
    createAgent,
    startAgent,
    stopAgent,
    deleteAgent,
    setActiveAgent,
    refreshAgents,
    isAgentRunning,
    newSession,
  } = useAgentFleet();

  const [diagnostics, setDiagnostics] = useState<string | null>(null);
  const [queuedMessages, setQueuedMessages] = useState<string[]>([]);

  // Per-conversation project directory (persisted to agent DB record)
  const [conversationProjectDir, setConversationProjectDir] = useState<string | null>(null);
  const conversationProjectDirRef = useRef<string | null>(null);
  useEffect(() => { conversationProjectDirRef.current = conversationProjectDir; }, [conversationProjectDir]);

  // Track whether the active conversation uses the orchestrate endpoint (no local agent loop)
  const isOrchestratedRef = useRef(false);

  // Signal for force-saving after orchestrate stream completes
  const orchestrateSaveNeeded = useRef(false);

  // Pre-chat connected apps (legacy — kept for backwards compat)
  const [preChatApps, setPreChatApps] = useState<Array<{ id: string; name: string; description: string | null; functionCount: number }>>([]);
  const [preChatAppQuery, setPreChatAppQuery] = useState('');
  const [preChatAppResults, setPreChatAppResults] = useState<Array<{ id: string; name: string; description: string | null; functionCount: number }>>([]);
  const [preChatSearching, setPreChatSearching] = useState(false);
  const preChatSearchRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Pre-chat scope (for new chats — restricts apps/functions/data before agent creation)
  interface PreChatScopeFn { name: string; description: string; selected: boolean }
  interface PreChatScopeApp {
    id: string;
    slug: string;
    name: string;
    access: 'all' | 'functions' | 'data';
    functions: PreChatScopeFn[];
    expanded: boolean;
  }
  interface PreChatAppEntry { id: string; slug: string; name: string; description: string | null; functions: PreChatScopeFn[] }
  const [preChatScope, setPreChatScope] = useState<PreChatScopeApp[]>([]);
  const [preChatAllApps, setPreChatAllApps] = useState<PreChatAppEntry[]>([]);
  const [preChatAppsLoading, setPreChatAppsLoading] = useState(false);

  // Refs for stable closure access in callbacks (activeAgent, preChatScope)
  const preChatScopeRef = useRef(preChatScope);
  preChatScopeRef.current = preChatScope;
  const activeAgentRef = useRef(activeAgent);
  activeAgentRef.current = activeAgent;

  // Fetch all user apps for pre-chat scope dropdown (once)
  const preChatAppsFetchedRef = useRef(false);
  useEffect(() => {
    if (!executeMcpTool || preChatAppsFetchedRef.current) return;
    preChatAppsFetchedRef.current = true;
    setPreChatAppsLoading(true);
    executeMcpTool('ul_discover', { scope: 'library' })
      .then(result => {
        const parsed = JSON.parse(result);
        let apps: PreChatAppEntry[] = [];

        // Shape 1: structured array in .library (no library.md fallback)
        if (Array.isArray(parsed.library)) {
          apps = parsed.library
            .filter((r: { type?: string }) => r.type === 'app')
            .map((r: { id: string; slug?: string; name: string; description?: string }) => ({
              id: r.id, slug: r.slug || r.id, name: r.name, description: r.description || null, functions: [],
            }));
        }
        // Shape 2: markdown string in .library — parse "## app-slug\nDescription\n\nFunctions:\n- fn(args): desc"
        else if (typeof parsed.library === 'string') {
          const md = parsed.library as string;
          const sections = md.split(/^## /gm).filter(Boolean);
          for (const section of sections) {
            const lines = section.split('\n');
            const name = lines[0]?.trim();
            if (!name) continue;
            if (name.startsWith('#') || name === 'Saved Apps' || name === 'Saved Pages' || name === 'Library') continue;
            const desc = lines[1]?.trim() || null;
            // Parse functions: lines starting with "- fn_name(args): description"
            const fns: PreChatScopeFn[] = [];
            for (const line of lines) {
              const fnMatch = line.match(/^- (\w+)\(.*?\)(?::\s*(.*))?$/);
              if (fnMatch) {
                fns.push({ name: fnMatch[1], description: fnMatch[2] || '', selected: true });
              }
            }
            apps.push({ id: name, slug: name, name, description: desc, functions: fns });
          }
        }
        // Shape 3: .results array (query search response)
        else if (parsed.results) {
          apps = parsed.results.map((r: { id: string; slug?: string; name: string; description?: string }) => ({
            id: r.id, slug: r.slug || r.id, name: r.name, description: r.description || null, functions: [],
          }));
        }

        // Deduplicate by slug
        const seen = new Set<string>();
        apps = apps.filter(a => { if (seen.has(a.slug)) return false; seen.add(a.slug); return true; });
        console.log('[SCOPE] Loaded', apps.length, 'apps for scope dropdown');
        setPreChatAllApps(apps);
      })
      .catch(err => {
        console.error('[SCOPE] Failed to load apps:', err);
        setPreChatAllApps([]);
      })
      .finally(() => setPreChatAppsLoading(false));
  }, [executeMcpTool]);

  // Detect if we're in a system agent context (routes through Flash pipeline instead of agent loop)
  const systemAgentConfig = useMemo(() => {
    if (!activeAgent?.is_system || !activeAgent.system_agent_type) return null;
    return SYSTEM_AGENTS.find(c => c.type === activeAgent.system_agent_type) || null;
  }, [activeAgent?.is_system, activeAgent?.system_agent_type]);

  const systemAgentContext = useMemo(() => {
    if (!systemAgentConfig) return null;
    return { type: systemAgentConfig.type, persona: systemAgentConfig.persona, skillsPath: systemAgentConfig.skillsPath };
  }, [systemAgentConfig]);

  // Build system prompt — regular agents only (system agents use Flash persona injection server-side)
  const baseSystemPrompt = useMemo(() => buildSystemPrompt(conversationProjectDir, getModel()), [conversationProjectDir]);
  const [systemPrompt, setSystemPrompt] = useState(baseSystemPrompt);

  // Keep in sync when conversationProjectDir changes
  useEffect(() => {
    setSystemPrompt(buildSystemPrompt(conversationProjectDir, getModel()));
  }, [conversationProjectDir]);

  // Merge tool sets — system agents don't need tools (Flash handles them server-side)
  const allTools = useMemo(() => {
    if (conversationProjectDir) {
      return [...mcpTools, ...localTools];
    }
    return mcpTools;
  }, [mcpTools, localTools, conversationProjectDir]);


  // Ref for stable tool call reference (avoids stale closures in spawned agents)
  const handleToolCallRef = useRef<(name: string, args: Record<string, unknown>) => Promise<string>>(null!);

  // Unified tool executor — routes to local or MCP, with permission gate
  const handleToolCall = useCallback(async (
    name: string,
    args: Record<string, unknown>,
  ): Promise<string> => {
    // Only gate local tools (MCP platform tools go through server-side auth)
    if (isLocalTool(name)) {
      if (!conversationProjectDirRef.current) {
        return 'Error: No project directory selected. Please open a folder first.';
      }

      // Permission check — may show modal and block until user responds
      const allowed = await checkPermission(name, args);
      if (!allowed) {
        return 'Permission denied by user.';
      }

      // Build agent context for JS-handled tools (spawn_agent, check_agent, update_card_status, card reports)
      const agentCtx: AgentToolContext = {
        createAgent,
        startAgent,
        parentAgentId: activeAgent?.id ?? null,
        currentAgentId: activeAgent?.id ?? null,
        currentCardId: null, // Card ID is passed through the agent's initial_task as [Card: <id>]
        tools: allTools,
        onToolCall: (n, a) => handleToolCallRef.current(n, a),
        abortCurrentRun: () => {
          if (activeAgent) {
            agentRunner.stop(activeAgent.id);
          }
        },
      };

      return executeLocalTool(name, args, conversationProjectDirRef.current!, agentCtx);
    }
    // Fall through to MCP tools
    return executeMcpTool(name, args);
  }, [isLocalTool, checkPermission, executeLocalTool, executeMcpTool, createAgent, startAgent, activeAgent, allTools]);

  // Keep ref in sync for spawned agents
  handleToolCallRef.current = handleToolCall;

  const {
    messages,
    isLoading,
    error,
    tokenCount,
    sendMessage: chatSendMessage,
    loadMessages,
    clearMessages: chatClearMessages,
    clearError,
    stopGeneration,
    appendMessage,
    updateStreamContent,
  } = useChat({
    systemPrompt,
    tools: allTools,
    onToolCall: handleToolCall,
  });

  const contextWindow = getContextWindow(getModel());

  // Ref for stable closure access to current messages
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  // Track previous messages length for auto-save
  const prevMessageCountRef = useRef(0);

  // Auto-save messages when they change
  useEffect(() => {
    if (!activeId || messages.length === 0) return;
    // Only save when message count increases (new messages added)
    if (messages.length > prevMessageCountRef.current) {
      saveMessages(activeId, messages);
    }
    prevMessageCountRef.current = messages.length;
  }, [messages, activeId, saveMessages]);

  // Re-save all messages when streaming completes to capture final content
  // (streaming updates content in-place without changing array length)
  const wasLoadingRef = useRef(false);
  useEffect(() => {
    if (wasLoadingRef.current && !isLoading && activeId && messages.length > 0) {
      saveMessages(activeId, messages, true);
    }
    wasLoadingRef.current = isLoading;
  }, [isLoading, activeId, messages, saveMessages]);

  // Force-save after orchestrate stream completes
  // The orchestrate path uses updateStreamContent (in-place updates) which
  // doesn't change message count, so the auto-save effects don't trigger.
  useEffect(() => {
    if (orchestrateSaveNeeded.current && activeId && messages.length > 0) {
      orchestrateSaveNeeded.current = false;
      saveMessages(activeId, messages, true);
    }
  }, [messages, activeId, saveMessages]);

  // Reset message count tracking when conversation changes
  useEffect(() => {
    prevMessageCountRef.current = messages.length;
  }, [activeId]);

  // Load agent conversation when agentId prop changes
  useEffect(() => {
    if (!agentId) return;
    const agent = agents.find(a => a.id === agentId);
    if (agent) {
      // Reset orchestrated flag when switching agents — ensures we load from DB
      isOrchestratedRef.current = false;
      setActiveAgent(agent);
      setConversationProjectDir(agent.project_dir);
      loadConversation(agent.conversation_id).then(msgs => {
        loadMessages(msgs);
        switchConversation(agent.conversation_id);
        prevMessageCountRef.current = msgs.length;
      });
      // Sync queued messages from agentRunner
      setQueuedMessages(agentRunner.getQueue(agentId));
    }
  }, [agentId, agents, setActiveAgent, loadConversation, loadMessages, switchConversation]);

  // Default to global CWD for new chats (no agent yet)
  useEffect(() => {
    if (!agentId && projectDir) setConversationProjectDir(projectDir);
  }, [agentId, projectDir]);

  // Auto-send initialMessage when navigating with new session instruction
  const initialMessageSentRef = useRef<string | null>(null);
  useEffect(() => {
    if (initialMessage && activeAgent && activeId && initialMessage !== initialMessageSentRef.current) {
      initialMessageSentRef.current = initialMessage;
      // Small delay to ensure conversation is loaded before sending
      const timer = setTimeout(() => {
        sendMessage(initialMessage);
      }, 100);
      return () => clearTimeout(timer);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMessage, activeAgent, activeId]);

  // Subscribe to agentRunner events for the active agent — live message updates
  useEffect(() => {
    if (!activeAgent) return;
    const agentId = activeAgent.id;

    const unsubscribe = agentRunner.on((event) => {
      if ('agentId' in event && event.agentId !== agentId) return;

      switch (event.type) {
        case 'message_added':
          appendMessage(event.message as import('../hooks/useChat').Message);
          break;
        case 'stream_delta':
          updateStreamContent(event.assistantId, event.content);
          break;
        case 'message_queued':
        case 'queue_changed':
          setQueuedMessages(agentRunner.getQueue(agentId));
          break;
      }
    });

    return unsubscribe;
  }, [activeAgent, appendMessage, updateStreamContent]);

  // Whether the active agent is managed by agentRunner (background agent with run entry)
  const isRunnerManaged = activeAgent ? agentRunner.hasRun(activeAgent.id) : false;
  // Composite loading state: useChat loading OR agentRunner running
  const isActive = isLoading || (activeAgent ? isAgentRunning(activeAgent.id) : false);

  // Pre-chat connected apps search (debounced)
  useEffect(() => {
    if (preChatSearchRef.current) clearTimeout(preChatSearchRef.current);
    const q = preChatAppQuery.trim();
    if (!q || q.length < 2) {
      setPreChatAppResults([]);
      return;
    }

    preChatSearchRef.current = setTimeout(async () => {
      setPreChatSearching(true);
      try {
        const result = await executeMcpTool('ul_discover', { scope: 'library', query: q });
        const parsed = JSON.parse(result);
        const results = (parsed.results || [])
          .filter((r: { id: string }) => !preChatApps.some(a => a.id === r.id))
          .map((r: { id: string; name: string; description?: string; function_count?: number }) => ({
            id: r.id,
            name: r.name,
            description: r.description || null,
            functionCount: r.function_count || 0,
          }));
        setPreChatAppResults(results);
      } catch {
        setPreChatAppResults([]);
      } finally {
        setPreChatSearching(false);
      }
    }, 400);

    return () => { if (preChatSearchRef.current) clearTimeout(preChatSearchRef.current); };
  }, [preChatAppQuery, executeMcpTool, preChatApps]);

  // Helper: run the orchestrate SSE stream and feed events into the chat UI
  const runOrchestrateStream = useCallback(async (
    content: string,
    history?: Array<{ role: string; content: string }>,
  ) => {
    const userMsg: import('../hooks/useChat').Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: content.trim(),
      created_at: Date.now(),
    };
    appendMessage(userMsg);

    const assistantId = crypto.randomUUID();
    let assistantContent = '';
    let statusHint = '';  // Subtle animated status during Flash phase

    const updateUI = () => {
      if (assistantContent) {
        // Once real content arrives, show only the content
        updateStreamContent(assistantId, assistantContent);
      } else if (statusHint) {
        // During Flash phase, show a subtle status hint
        updateStreamContent(assistantId, `\u200B${statusHint}`);
      }
    };

    // Build scope from agent's connected_apps config, or from pre-chat scope (first message)
    // Use refs to avoid stale closure issues
    const currentAgent = activeAgentRef.current;
    const currentPreChatScope = preChatScopeRef.current;
    let scope: Record<string, { access: 'all' | 'functions' | 'data'; functions?: string[]; conventions?: Record<string, string> }> | undefined;
    if (currentAgent?.connected_apps) {
      try {
        const parsed = JSON.parse(currentAgent.connected_apps);
        const apps = parsed.apps || parsed;
        const scopeEntries = Object.entries(apps as Record<string, { slug?: string; access?: string; selected_functions?: string[]; conventions?: Record<string, string> }>);
        if (scopeEntries.length > 0) {
          scope = {};
          for (const [, cfg] of scopeEntries) {
            const slug = cfg.slug;
            if (!slug) continue;
            const access = (cfg.access || 'all') as 'all' | 'functions' | 'data';
            const fns = cfg.selected_functions && cfg.selected_functions.length > 0 ? cfg.selected_functions : undefined;
            const conventions = cfg.conventions && Object.keys(cfg.conventions).length > 0 ? cfg.conventions : undefined;
            scope[slug] = { access, functions: fns, conventions };
          }
          if (Object.keys(scope).length === 0) scope = undefined;
        }
      } catch { /* no scope */ }
    } else if (currentPreChatScope.length > 0) {
      // First message — agent just created, activeAgent state not yet updated
      scope = {};
      for (const s of currentPreChatScope) {
        const selectedFns = s.functions.filter(f => f.selected).map(f => f.name);
        scope[s.slug] = {
          access: s.access,
          functions: selectedFns.length > 0 && selectedFns.length < s.functions.length ? selectedFns : undefined,
        };
      }
    }
    if (scope) console.log('[SCOPE] Sending scope:', Object.keys(scope).join(', '));

    // Gather system agent states for Flash's Context Index
    const systemAgentStates = agents
      .filter(a => a.is_system === 1 && a.system_agent_type)
      .map(a => {
        const config = SYSTEM_AGENTS.find(c => c.type === a.system_agent_type);
        return {
          type: a.system_agent_type!,
          name: a.name,
          tools: config?.toolScope || [],
          stateSummary: a.state_summary,
          status: a.status,
        };
      });

    // Gather local project context if a project dir is set
    let projectContext: string | undefined;
    if (conversationProjectDirRef.current) {
      try {
        projectContext = await gatherProjectContext(conversationProjectDirRef.current, content);
      } catch (err) {
        console.warn('[ChatView] Context gathering failed:', err);
      }
    }

    const agentModels = parseAgentModels(currentAgent?.model || null);

    for await (const event of streamOrchestrate({
      message: content,
      conversationHistory: history,
      interpreterModel: agentModels.interpreter,
      heavyModel: agentModels.heavy,
      scope,
      adminNotes: currentAgent?.admin_notes || undefined,
      systemAgentStates: systemAgentStates.length > 0 ? systemAgentStates : undefined,
      systemAgentContext: systemAgentContext || undefined,
      projectContext,
      conversationId: activeId || undefined,
    })) {
      switch (event.type) {
        // Flash phase — show subtle status hints
        case 'flash_status':
          statusHint = event.text || 'Thinking...';
          updateUI();
          break;
        case 'flash_search':
          statusHint = `Searching ${(event.apps || []).join(', ')}...`;
          updateUI();
          break;
        case 'flash_found':
          statusHint = `Found ${event.entity}`;
          updateUI();
          break;
        case 'flash_context':
          statusHint = 'Preparing response...';
          updateUI();
          break;
        case 'flash_prompt':
          statusHint = 'Writing...';
          updateUI();
          break;

        // Flash answered directly
        case 'flash_direct':
          statusHint = '';
          assistantContent += event.content || '';
          updateUI();
          break;

        // Heavy model streaming — real content
        case 'heavy_status':
          if (!assistantContent) {
            statusHint = event.text || 'Writing...';
            updateUI();
          }
          break;
        case 'heavy_text':
          statusHint = '';
          assistantContent += event.content || '';
          updateUI();
          break;
        case 'heavy_recipe':
          break; // Don't show recipe code

        // Execution
        case 'exec_start':
          if (assistantContent) {
            // Already have text from heavy model, just wait
          } else {
            statusHint = 'Running...';
            updateUI();
          }
          break;
        case 'exec_result': {
          // Recipe result is internal — don't show raw JSON to the user.
          // The heavy model's text response is the user-facing output.
          statusHint = '';
          updateUI();
          break;
        }

        // System agent delegation
        case 'system_agent_spawn': {
          const targetAgent = agents.find(
            a => a.is_system === 1 && a.system_agent_type === event.agentType
          );
          if (targetAgent && event.task) {
            const targetConfig = SYSTEM_AGENTS.find(c => c.type === targetAgent.system_agent_type);
            if (targetConfig) {
              // Fire delegated orchestrate via the system agent's Flash pipeline (async)
              // Pass originalPrompt so the system agent sees the user's exact words
              runDelegatedOrchestrate(targetAgent, targetConfig, event.task, event.originalPrompt, conversationProjectDirRef.current);
            }
            assistantContent += `\n\n> Delegating to **${targetAgent.name}**: ${event.task}`;
            updateUI();
          }
          break;
        }

        // Legacy compat
        case 'status':
          statusHint = event.text || '';
          updateUI();
          break;
        case 'text':
          statusHint = '';
          assistantContent += event.content || '';
          updateUI();
          break;
        case 'tool_start': break;
        case 'result': {
          const rs = typeof event.data === 'string' ? event.data : JSON.stringify(event.data, null, 2);
          if (rs && rs !== 'null') assistantContent += `\n\`\`\`json\n${rs}\n\`\`\``;
          updateUI();
          break;
        }

        case 'usage':
          console.log('[orchestrate] usage:', event.flash, event.heavy);
          break;
        case 'error':
          statusHint = '';
          assistantContent += `\n\n**Error:** ${event.message || 'Unknown error'}`;
          updateUI();
          break;
        case 'done':
          statusHint = '';
          updateUI();
          // Fire-and-forget: embed conversation for cross-session semantic search
          if (activeAgentRef.current && messages.length >= 5) {
            const agent = activeAgentRef.current;
            maybeEmbedConversation(
              agent.conversation_id,
              agent.name,
              messages.slice(-10).map(m => ({ role: m.role, content: m.content })),
            ).catch(() => {});
          }
          break;
      }
    }

    appendMessage({
      id: assistantId,
      role: 'assistant',
      content: assistantContent,
      created_at: Date.now(),
    });

    // Execute local file operations from the model's response
    if (conversationProjectDirRef.current && assistantContent) {
      const fileOps = parseFileOperations(assistantContent);
      if (fileOps.length > 0) {
        for (const op of fileOps) {
          try {
            const allowed = await checkPermission('file_write', { path: op.path, content: op.content });
            if (!allowed) continue;
            await invoke('file_write', {
              projectRoot: conversationProjectDirRef.current,
              path: op.path,
              content: op.content,
            });
            console.log(`[ChatView] Wrote file: ${op.path}`);
          } catch (err) {
            console.warn(`[ChatView] Failed to write ${op.path}:`, err);
          }
        }
      }
    }

    // Signal that a force-save is needed after the next render
    orchestrateSaveNeeded.current = true;
  }, [appendMessage, updateStreamContent]);

  // Send message — routes through agentRunner for background agents, useChat for interactive
  // Helper: run delegated orchestrate for a system agent (fire-and-forget)
  const runDelegatedOrchestrate = useCallback(async (
    agent: typeof agents[0],
    config: typeof SYSTEM_AGENTS[0],
    task: string,
    originalPrompt?: string,
    callingProjectDir?: string | null,
  ) => {
    try {
      // Inherit project directory from the calling conversation if target agent doesn't have one
      if (callingProjectDir && !agent.project_dir) {
        await invoke('db_update_agent', {
          id: agent.id,
          status: null, name: null, adminNotes: null, endGoal: null,
          context: null, permissionLevel: null, model: null,
          projectDir: callingProjectDir,
          connectedAppIds: null, connectedApps: null,
          initialTask: null, stateSummary: null, systemAgentType: null,
        });
        console.log(`[ChatView] Inherited projectDir ${callingProjectDir} → ${agent.name}`);
      }

      // Build the message for the system agent — includes both routing context and original prompt
      const delegationMessage = originalPrompt && originalPrompt !== task
        ? `## User's Original Request\n${originalPrompt}\n\n## Routing Context\n${task}`
        : task;

      // Save task as user message in system agent's conversation
      await invoke('db_save_message', {
        message: {
          id: crypto.randomUUID(),
          conversation_id: agent.conversation_id,
          role: 'user',
          content: delegationMessage,
          tool_calls: null,
          tool_call_id: null,
          usage: null,
          cost_light: null,
          created_at: Date.now(),
          sort_order: Date.now(),
        },
      });

      // Gather local project context for delegated agent
      let delegatedProjectContext: string | undefined;
      if (callingProjectDir) {
        try {
          delegatedProjectContext = await gatherProjectContext(callingProjectDir, delegationMessage);
        } catch (err) {
          console.warn('[ChatView] Delegated context gathering failed:', err);
        }
      }

      // Run orchestrate with the system agent's context and its configured models
      const sysModels = parseAgentModels(agent.model || null);
      let resultContent = '';
      for await (const ev of streamOrchestrate({
        message: delegationMessage,
        interpreterModel: sysModels.interpreter,
        heavyModel: sysModels.heavy,
        adminNotes: agent.admin_notes || undefined,
        systemAgentContext: { type: config.type, persona: config.persona, skillsPath: config.skillsPath },
        projectContext: delegatedProjectContext,
        conversationId: activeId || undefined,
      })) {
        if (ev.type === 'flash_direct' || ev.type === 'heavy_text') {
          resultContent += ev.content || '';
        }
      }

      // Save result as assistant message in system agent's conversation
      if (resultContent) {
        await invoke('db_save_message', {
          message: {
            id: crypto.randomUUID(),
            conversation_id: agent.conversation_id,
            role: 'assistant',
            content: resultContent,
            tool_calls: null,
            tool_call_id: null,
            usage: null,
            cost_light: null,
            created_at: Date.now(),
            sort_order: Date.now(),
          },
        });
      }

      // Update state summary
      await updateSystemAgentState(agent.id, [
        { role: 'user', content: task },
        { role: 'assistant', content: resultContent },
      ]);
    } catch (err) {
      console.warn('[ChatView] Delegated orchestrate failed:', err);
    }
  }, [agents]);

  const sendMessage = useCallback(async (content: string) => {
    // System agents always route through Flash orchestrate pipeline
    if (systemAgentContext && activeAgent) {
      const history = messages
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .slice(-10)
        .map(m => ({ role: m.role, content: m.content }));
      await runOrchestrateStream(content, history);
      return;
    }

    // If there's an active agent managed by agentRunner, route through it
    if (activeAgent && isRunnerManaged) {
      if (agentRunner.isRunning(activeAgent.id)) {
        // Agent is busy — queue the message
        agentRunner.queueMessage(activeAgent.id, content);
      } else {
        // Agent is idle — resume with follow-up
        await agentRunner.resume(activeAgent.id, content);
      }
      return;
    }

    // Follow-up in an orchestrated conversation — stream without recreating agent
    if (activeAgent && isOrchestratedRef.current) {
      const history = messages
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .map(m => ({ role: m.role, content: m.content }));
      await runOrchestrateStream(content, history);
      return;
    }

    // Interactive path — first message creates agent, then streams via orchestrate
    let convId = activeId;
    if (!convId) {

      // ── ALL chats use server-side orchestration ──
      // Flash broker handles context resolution, model selection, and prompt construction.
      // Heavy model writes ONE recipe. Dynamic Worker executes it. No client-side agent loop.
      {
        isOrchestratedRef.current = true;

        // Build connected_apps from pre-chat scope if any (use ref for fresh value)
        const scopeSnapshot = preChatScopeRef.current;
        let connectedApps: string | undefined;
        let connectedAppIds: string | undefined;
        if (scopeSnapshot.length > 0) {
          const appsConfig: Record<string, { name: string; slug: string; access: string; selected_functions: string[]; conventions: Record<string, string> }> = {};
          for (const s of scopeSnapshot) {
            const selectedFns = s.functions.filter(f => f.selected).map(f => f.name);
            appsConfig[s.id] = { name: s.name, slug: s.slug, access: s.access, selected_functions: selectedFns, conventions: {} };
          }
          connectedApps = JSON.stringify({ apps: appsConfig });
          connectedAppIds = JSON.stringify(scopeSnapshot.map(s => s.id));
        }

        const agent = await createAgent({
          name: content.slice(0, 40).replace(/\n/g, ' '),
          role: 'general',
          initialTask: content,
          systemPrompt: '',  // Server constructs the prompt via Flash broker
          projectDir: conversationProjectDirRef.current,
          model: `${getInterpreterModel()} → ${getHeavyModel()}`,
          parentAgentId: null,
          connectedAppIds: connectedAppIds || (preChatApps.length > 0 ? JSON.stringify(preChatApps.map(a => a.id)) : undefined),
          connectedApps,
        });
        setActiveAgent(agent);
        switchConversation(agent.conversation_id);
        convId = agent.conversation_id;
        setPreChatApps([]);
        setPreChatAppQuery('');
        setPreChatAppResults([]);
        setPreChatScope([]);

        // Stream FIRST, then navigate — keeps this ChatView mounted during streaming
        await runOrchestrateStream(content);

        // Generate a nice title asynchronously (don't block navigation)
        (async () => {
          try {
            let title = '';
            for await (const ev of streamChat({
              model: getInterpreterModel(),
              messages: [{ role: 'user', content: `Generate a short title (3-6 words, no quotes) for a chat that starts with this message:\n\n${content.slice(0, 200)}` }],
              temperature: 0.3,
              max_tokens: 30,
            })) {
              if (ev.type === 'delta') title += ev.content || '';
            }
            title = title.trim().replace(/^["']|["']$/g, '');
            if (title && title.length > 0 && title.length < 60) {
              await invoke('db_update_agent', {
                id: agent.id, name: title, status: null, adminNotes: null,
                endGoal: null, context: null, permissionLevel: null, model: null,
                projectDir: null, connectedAppIds: null, connectedApps: null,
                initialTask: null, stateSummary: null, systemAgentType: null,
              });
              refreshAgents();
            }
          } catch (err) {
            console.warn('[ChatView] Title generation failed:', err);
          }
        })();

        // Force-save messages to DB before navigating (navigation remounts ChatView)
        const currentMessages = messagesRef.current;
        if (currentMessages.length > 0) {
          await saveMessages(agent.conversation_id, currentMessages, true);
        }

        // Navigate to the agent view (causes remount — new instance loads saved messages from DB)
        if (onNavigateToAgent) onNavigateToAgent(agent.id);
        return;
      }

    }
    // This shouldn't be reached — orchestrate path returns above
    await chatSendMessage(content);
  }, [activeAgent, isRunnerManaged, activeId, createAgent, systemPrompt, chatSendMessage, switchConversation, setActiveAgent, onNavigateToAgent, preChatApps, messages, runOrchestrateStream]);

  // New agent (from sidebar [+])
  const handleNewAgent = useCallback(() => {
    chatClearMessages();
    switchConversation(null);
    setActiveAgent(null);
    prevMessageCountRef.current = 0;
    isOrchestratedRef.current = false;
    setPreChatApps([]);
    setPreChatAppQuery('');
    setPreChatAppResults([]);
    setPreChatScope([]);
  }, [chatClearMessages, switchConversation, setActiveAgent]);

  // Select agent from sidebar
  const handleSelectAgent = useCallback(async (selectedAgentId: string) => {
    const agent = agents.find(a => a.id === selectedAgentId);
    if (!agent) return;
    if (agent.conversation_id === activeId) return;

    setActiveAgent(agent);
    const msgs = await loadConversation(agent.conversation_id);
    loadMessages(msgs);
    switchConversation(agent.conversation_id);
    prevMessageCountRef.current = msgs.length;

    if (onNavigateToAgent) onNavigateToAgent(agent.id);
  }, [agents, activeId, setActiveAgent, loadConversation, loadMessages, switchConversation, onNavigateToAgent]);

  // Delete agent
  const handleDeleteAgent = useCallback(async (id: string) => {
    const agent = agents.find(a => a.id === id);
    await deleteAgent(id);
    if (agent && agent.conversation_id === activeId) {
      chatClearMessages();
      setActiveAgent(null);
      prevMessageCountRef.current = 0;
    }
  }, [agents, activeId, deleteAgent, chatClearMessages, setActiveAgent]);

  // Stop agent
  const handleStopAgent = useCallback((id: string) => {
    stopAgent(id);
  }, [stopAgent]);

  const handleSignOut = () => {
    clearToken();
    window.location.reload();
  };

  // Child agents of current active agent
  const childAgents = useMemo(() => {
    if (!activeAgent) return [];
    return agents.filter(a => a.parent_agent_id === activeAgent.id);
  }, [agents, activeAgent]);

  // All agents for team search in AgentHeader

  // Handle agent updates from header config panel
  const handleUpdateAgent = useCallback(async (updates: Partial<import('../hooks/useAgentFleet').Agent>) => {
    if (!activeAgent) return;
    await invoke('db_update_agent', {
      id: activeAgent.id,
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
  }, [activeAgent, refreshAgents]);

  // Handle project directory changes — update local state + persist to DB
  const handleProjectDirChange = useCallback(async (dir: string) => {
    setConversationProjectDir(dir);
    if (activeAgent) {
      await handleUpdateAgent({ project_dir: dir });
    }
  }, [activeAgent, handleUpdateAgent]);

  // Show "needs folder" banner for Tool Maker when no project dir is set
  const showNeedsFolderBanner = !conversationProjectDir && systemAgentContext?.type === 'tool_builder';

  const handleBannerSelectFolder = useCallback(async () => {
    try {
      const selected = await open({ directory: true, multiple: false, title: 'Select Project Directory' });
      if (selected && typeof selected === 'string') {
        handleProjectDirChange(selected);
      }
    } catch (err) {
      console.error('[ChatView] Folder picker error:', err);
    }
  }, [handleProjectDirChange]);

  // Reset agent session — clear messages, keep identity/config
  const handleNewSession = useCallback(async () => {
    if (!activeAgent) return;
    await newSession(activeAgent.id);
    chatClearMessages();
    prevMessageCountRef.current = 0;
  }, [activeAgent, newSession, chatClearMessages]);

  const runDiagnostics = async () => {
    setDiagnostics('Running preflight checks...');
    try {
      const token = getToken();
      const base = getApiBase();
      const res = await fetch(`${base}/debug/chat-preflight`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const data = await res.json();
      const items = data.checks || data.steps || [];
      const lines = items.map((s: { check?: string; step?: string; result: string; ok: boolean }) =>
        `${s.ok ? '✓' : '✗'} ${s.check || s.step}: ${s.result}`
      );
      setDiagnostics(lines.join('\n') || JSON.stringify(data, null, 2));
    } catch (err) {
      setDiagnostics(`Network error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div className="flex flex-col flex-1 min-w-0 h-full">
      {/* Agent Header */}
      <AgentHeader
        agent={activeAgent}
        isRunning={activeAgent ? isAgentRunning(activeAgent.id) : false}
        tokenCount={tokenCount}
        contextWindow={contextWindow}
        childAgents={childAgents}
        allAgents={agents}
        onUpdateAgent={handleUpdateAgent}
        onStop={() => activeAgent && stopAgent(activeAgent.id)}
        onNewSession={handleNewSession}

        onOpenSubagentChat={onNavigateToAgent}
        onStopSubagent={stopAgent}
        executeMcpTool={executeMcpTool}
      />


      {/* Error banner */}
      {error && (
        <div className="px-4 py-2 bg-ul-error-soft border-b border-ul-border">
          <div className="flex items-center justify-between">
            <p className="text-small text-ul-error">{error}</p>
            <div className="flex items-center gap-2">
              <button onClick={runDiagnostics} className="text-caption text-ul-text-secondary hover:underline">
                Diagnose
              </button>
              <button onClick={handleSignOut} className="text-caption text-ul-error hover:underline">
                Re-enter Token
              </button>
              <button onClick={() => { clearError(); setDiagnostics(null); }} className="text-caption text-ul-error hover:underline">
                Dismiss
              </button>
            </div>
          </div>
          {diagnostics && (
            <pre className="mt-2 p-2 bg-white rounded text-xs text-ul-text-secondary font-mono whitespace-pre-wrap border border-ul-border">
              {diagnostics}
            </pre>
          )}
        </div>
      )}

      {/* Messages */}
      <MessageList
        messages={messages}
        isLoading={isActive}
        systemAgent={systemAgentConfig || undefined}
        onStarterClick={sendMessage}
      />

      {/* Queued messages indicator */}
      {queuedMessages.length > 0 && (
        <div className="px-4 py-2 bg-amber-50 border-t border-amber-200">
          <div className="max-w-narrow mx-auto">
            <p className="text-caption font-medium text-amber-700 mb-1">
              Queued ({queuedMessages.length})
            </p>
            {queuedMessages.map((msg, i) => (
              <div key={i} className="flex items-center justify-between gap-2 py-1">
                <p className="text-caption text-amber-600 truncate flex-1">
                  {msg.length > 80 ? msg.slice(0, 80) + '...' : msg}
                </p>
                <button
                  onClick={() => {
                    if (activeAgent) {
                      agentRunner.dequeueMessage(activeAgent.id, i);
                    }
                  }}
                  className="text-amber-400 hover:text-amber-600 flex-shrink-0"
                  title="Remove from queue"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}


      {/* Needs-folder banner */}
      {showNeedsFolderBanner && (
        <div className="px-4 py-2 border-t border-amber-200 bg-amber-50">
          <div className="max-w-narrow mx-auto flex items-center gap-3">
            <svg className="w-4.5 h-4.5 text-amber-600 flex-shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
            </svg>
            <span className="flex-1 text-small text-amber-900">A project folder is needed to write and read files</span>
            <button
              onClick={handleBannerSelectFolder}
              className="px-3 py-1 text-caption font-medium rounded-md border border-amber-600 text-amber-700 bg-white hover:bg-amber-600 hover:text-white transition-colors flex-shrink-0"
            >
              Select Folder
            </button>
          </div>
        </div>
      )}

      {/* Input */}
      <ChatInput
        onSend={sendMessage}
        isLoading={isActive}
        onStop={() => {
          if (activeAgent && isAgentRunning(activeAgent.id)) {
            stopAgent(activeAgent.id);
          } else {
            stopGeneration();
          }
        }}
        queueMode={isRunnerManaged}
        projectDir={conversationProjectDir}
        onProjectDirChange={handleProjectDirChange}
      />

      {/* Permission modal overlay */}
      {pendingRequest && (
        <PermissionModal
          request={pendingRequest}
          onAllow={allow}
          onAlwaysAllow={alwaysAllow}
          onDeny={deny}
        />
      )}

      {/* Spending approval modal */}
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
