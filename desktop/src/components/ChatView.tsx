// Main chat interface — assembles message list + input + sidebar.

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
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
import { clearToken, getToken, getApiBase, getModel } from '../lib/storage';
import { getContextWindow } from '../lib/tokens';
import { buildSystemPrompt } from '../lib/systemPrompt';
import { agentRunner } from '../lib/agentRunner';

interface ChatViewProps {
  agentId?: string | null;
  onNavigateHome?: () => void;
  onNavigateToAgent?: (agentId: string) => void;
}

export default function ChatView({
  agentId,
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

  // Build system prompt — full coding agent prompt when project dir is set
  const systemPrompt = useMemo(() => buildSystemPrompt(projectDir), [projectDir]);

  // Merge tool sets — only include local tools when project dir is set
  const allTools = useMemo(() => {
    if (projectDir) {
      return [...mcpTools, ...localTools];
    }
    return mcpTools;
  }, [mcpTools, localTools, projectDir]);

  // Ref for stable tool call reference (avoids stale closures in spawned agents)
  const handleToolCallRef = useRef<(name: string, args: Record<string, unknown>) => Promise<string>>(null!);

  // Unified tool executor — routes to local or MCP, with permission gate
  const handleToolCall = useCallback(async (
    name: string,
    args: Record<string, unknown>,
  ): Promise<string> => {
    // Only gate local tools (MCP platform tools go through server-side auth)
    if (isLocalTool(name)) {
      if (!projectDir) {
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

      return executeLocalTool(name, args, projectDir, agentCtx);
    }
    // Fall through to MCP tools
    return executeMcpTool(name, args);
  }, [isLocalTool, projectDir, checkPermission, executeLocalTool, executeMcpTool, createAgent, startAgent, activeAgent, allTools]);

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

  // Reset message count tracking when conversation changes
  useEffect(() => {
    prevMessageCountRef.current = messages.length;
  }, [activeId]);

  // Load agent conversation when agentId prop changes
  useEffect(() => {
    if (!agentId) return;
    const agent = agents.find(a => a.id === agentId);
    if (agent) {
      setActiveAgent(agent);
      loadConversation(agent.conversation_id).then(msgs => {
        loadMessages(msgs);
        switchConversation(agent.conversation_id);
        prevMessageCountRef.current = msgs.length;
      });
      // Sync queued messages from agentRunner
      setQueuedMessages(agentRunner.getQueue(agentId));
    }
  }, [agentId, agents, setActiveAgent, loadConversation, loadMessages, switchConversation]);

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

  // Send message — routes through agentRunner for background agents, useChat for interactive
  const sendMessage = useCallback(async (content: string) => {
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

    // Interactive path — useChat (first message or non-runner agent)
    let convId = activeId;
    if (!convId) {
      // Create a general agent on first message
      const agent = await createAgent({
        name: content.slice(0, 40).replace(/\n/g, ' '),
        role: 'general',
        initialTask: content,
        systemPrompt: systemPrompt,
        projectDir: projectDir,
        model: getModel(),
        parentAgentId: null,
      });
      setActiveAgent(agent);
      switchConversation(agent.conversation_id);
      convId = agent.conversation_id;
      if (onNavigateToAgent) onNavigateToAgent(agent.id);
    }
    await chatSendMessage(content);
  }, [activeAgent, isRunnerManaged, activeId, createAgent, systemPrompt, projectDir, chatSendMessage, switchConversation, setActiveAgent, onNavigateToAgent]);

  // New agent (from sidebar [+])
  const handleNewAgent = useCallback(() => {
    chatClearMessages();
    switchConversation(null);
    setActiveAgent(null);
    prevMessageCountRef.current = 0;
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
    });
    await refreshAgents();
  }, [activeAgent, refreshAgents]);

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
        onUpdateAgent={handleUpdateAgent}
        onStop={() => activeAgent && stopAgent(activeAgent.id)}
        onNewSession={handleNewSession}
        onSignOut={handleSignOut}
        onOpenSubagentChat={onNavigateToAgent}
        onStopSubagent={stopAgent}
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
      <MessageList messages={messages} isLoading={isActive} />

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
