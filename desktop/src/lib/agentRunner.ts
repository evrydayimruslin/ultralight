// AgentRunner — singleton service for parallel background agent execution.
// Lives in module scope (not a React hook) so it survives component re-renders.
// Each agent gets its own independent streaming loop via runAgentLoop.

import { invoke } from '@tauri-apps/api/core';
import { runAgentLoop, type LoopMessage, type AgentLoopCallbacks } from './agentLoop';
import type { ChatTool } from './api';
import { updateSystemAgentState, maybeEmbedConversation } from './agentStateSummary';
import { createDesktopLogger } from './logging';

// ── Types ──

export type AgentStatus = 'pending' | 'running' | 'completed' | 'error' | 'stopped' | 'waiting_for_approval';

export interface AgentRunConfig {
  agentId: string;
  conversationId: string;
  systemPrompt: string;
  initialTask: string;
  model: string;
  tools: ChatTool[];
  /** Tool executor — routes tool calls to local/MCP handlers */
  onToolCall: (name: string, args: Record<string, unknown>) => Promise<string>;
}

export type AgentEvent =
  | { type: 'status_change'; agentId: string; status: AgentStatus; error?: string }
  | { type: 'message_added'; agentId: string; message: LoopMessage }
  | { type: 'stream_delta'; agentId: string; assistantId: string; content: string }
  | { type: 'warning'; agentId: string; message: string }
  | { type: 'completed'; agentId: string; toolRounds: number; hitLimit: boolean }
  | { type: 'message_queued'; agentId: string; content: string; queueLength: number }
  | { type: 'queue_changed'; agentId: string; queueLength: number };

interface ActiveRun {
  agentId: string;
  conversationId: string;
  abortController: AbortController;
  status: AgentStatus;
  messages: LoopMessage[];
  error?: string;
  /** Queued follow-up messages — drained after current run completes */
  pendingMessages: string[];
  /** Stashed config so we can resume without re-supplying everything */
  config?: AgentRunConfig;
}

type EventListener = (event: AgentEvent) => void;

const agentRunnerLogger = createDesktopLogger('AgentRunner');

// ── AgentRunner Class ──

class AgentRunner {
  private runs = new Map<string, ActiveRun>();
  private listeners = new Set<EventListener>();

  /**
   * Start a new agent run. The agent streams and executes tools
   * in the background, completely independent of React state.
   */
  async start(config: AgentRunConfig): Promise<void> {
    const { agentId, conversationId, systemPrompt, initialTask, model, tools, onToolCall } = config;

    // Don't start if already running
    if (this.runs.has(agentId) && this.runs.get(agentId)!.status === 'running') {
      agentRunnerLogger.warn('Agent is already running', { agentId });
      return;
    }

    const abortController = new AbortController();

    const run: ActiveRun = {
      agentId,
      conversationId,
      abortController,
      status: 'running',
      messages: [],
      pendingMessages: [],
      config,
    };

    this.runs.set(agentId, run);
    this.emit({ type: 'status_change', agentId, status: 'running' });

    // Update agent status in DB
    await this.updateDbStatus(agentId, 'running');

    // Create the initial user message (the task)
    const taskMessage: LoopMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: initialTask,
      created_at: Date.now(),
    };

    run.messages.push(taskMessage);
    this.emit({ type: 'message_added', agentId, message: taskMessage });

    // Persist the task message
    await this.persistMessage(conversationId, taskMessage, 0);

    // Set up callbacks
    const callbacks: AgentLoopCallbacks = {
      onMessage: (msg: LoopMessage) => {
        run.messages.push(msg);
        this.emit({ type: 'message_added', agentId, message: msg });
        // Persist each message immediately
        this.persistMessage(conversationId, msg, run.messages.length - 1).catch(err => {
          agentRunnerLogger.error('Failed to persist agent message', { agentId, error: err });
        });
      },
      onStreamDelta: (assistantId: string, content: string) => {
        this.emit({ type: 'stream_delta', agentId, assistantId, content });
      },
      onToolCall,
      onWarning: (message: string) => {
        agentRunnerLogger.warn('Agent loop warning', { agentId, message });
        this.emit({ type: 'warning', agentId, message });
      },
    };

    // Run the loop asynchronously
    try {
      const result = await runAgentLoop(
        [taskMessage],
        callbacks,
        {
          systemPrompt,
          tools,
          model,
          signal: abortController.signal,
          trace: {
            conversationId,
            source: 'agent_runner',
          },
        },
      );

      // Update status based on result
      if (abortController.signal.aborted) {
        // Check if this was a deliberate pause (submit_plan) or handoff (already completed)
        // The tool handler may have already set the DB status before aborting.
        let finalStatus: AgentStatus = 'stopped';
        try {
          const dbAgent = await invoke<{ status: string } | null>('db_get_agent', { id: agentId });
          if (dbAgent?.status === 'waiting_for_approval') {
            finalStatus = 'waiting_for_approval';
          } else if (dbAgent?.status === 'completed') {
            finalStatus = 'completed';
          }
        } catch {
          // Fall through to default 'stopped'
        }

        if (finalStatus === 'stopped') {
          await this.updateDbStatus(agentId, 'stopped');
        }
        run.status = finalStatus;
        this.emit({ type: 'status_change', agentId, status: finalStatus });
      } else {
        run.status = 'completed';
        await this.updateDbStatus(agentId, 'completed');
        this.emit({ type: 'status_change', agentId, status: 'completed' });
        this.emit({
          type: 'completed',
          agentId,
          toolRounds: result.toolRounds,
          hitLimit: result.hitLimit,
        });

        // System agent state summary — fire and forget
        this.maybeUpdateSystemAgentState(agentId, run.messages);

        // Embed conversation for cross-session semantic search — fire and forget
        maybeEmbedConversation(
          run.conversationId,
          run.config?.agentId || 'Untitled',
          run.messages.slice(-10).map(m => ({ role: m.role, content: m.content })),
        ).catch(() => {});
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      run.status = 'error';
      run.error = errorMsg;
      await this.updateDbStatus(agentId, 'error');
      this.emit({ type: 'status_change', agentId, status: 'error', error: errorMsg });
    }

    // Drain the queue — if messages were queued during this run, auto-resume
    this.drainQueue(agentId);
  }

  /**
   * Resume a completed/stopped/error agent with a new user message.
   * Reuses the original config (system prompt, tools, model).
   * Loads existing messages from DB and appends the new one.
   */
  async resume(agentId: string, userMessage: string): Promise<void> {
    const run = this.runs.get(agentId);
    if (!run) {
      agentRunnerLogger.warn('Cannot resume agent without run', { agentId });
      return;
    }
    if (run.status === 'running') {
      // Agent is busy — queue the message instead
      this.queueMessage(agentId, userMessage);
      return;
    }
    if (!run.config) {
      agentRunnerLogger.warn('Cannot resume agent without stashed config', { agentId });
      return;
    }

    const abortController = new AbortController();
    run.abortController = abortController;
    run.status = 'running';
    run.error = undefined;

    this.emit({ type: 'status_change', agentId, status: 'running' });
    await this.updateDbStatus(agentId, 'running');

    // Load full conversation history from DB
    let existingMessages: LoopMessage[] = [];
    try {
      interface DbMsg {
        id: string;
        role: string;
        content: string;
        tool_calls: string | null;
        tool_call_id: string | null;
        usage: string | null;
        cost_light: number | null;
        created_at: number;
      }
      const dbMsgs = await invoke<DbMsg[]>('db_load_messages', {
        conversationId: run.conversationId,
      });
      existingMessages = dbMsgs.map(db => ({
        id: db.id,
        role: db.role as LoopMessage['role'],
        content: db.content,
        tool_calls: db.tool_calls ? JSON.parse(db.tool_calls) : undefined,
        tool_call_id: db.tool_call_id ?? undefined,
        usage: db.usage ? JSON.parse(db.usage) : undefined,
        cost_light: db.cost_light ?? undefined,
        created_at: db.created_at,
      }));
    } catch {
      // Fallback to in-memory messages
      existingMessages = [...run.messages];
    }

    // Create and persist the new user message
    const newMsg: LoopMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: userMessage,
      created_at: Date.now(),
    };
    existingMessages.push(newMsg);
    run.messages.push(newMsg);
    this.emit({ type: 'message_added', agentId, message: newMsg });
    await this.persistMessage(run.conversationId, newMsg, existingMessages.length - 1);

    // Set up callbacks (same as start)
    const callbacks: AgentLoopCallbacks = {
      onMessage: (msg: LoopMessage) => {
        run.messages.push(msg);
        this.emit({ type: 'message_added', agentId, message: msg });
        this.persistMessage(run.conversationId, msg, run.messages.length - 1).catch(err => {
          agentRunnerLogger.error('Failed to persist resumed agent message', { agentId, error: err });
        });
      },
      onStreamDelta: (assistantId: string, content: string) => {
        this.emit({ type: 'stream_delta', agentId, assistantId, content });
      },
      onToolCall: run.config.onToolCall,
      onWarning: (message: string) => {
        agentRunnerLogger.warn('Agent loop warning', { agentId, message });
        this.emit({ type: 'warning', agentId, message });
      },
    };

    // Run the loop
    try {
      const result = await runAgentLoop(
        existingMessages,
        callbacks,
        {
          systemPrompt: run.config.systemPrompt,
          tools: run.config.tools,
          model: run.config.model,
          signal: abortController.signal,
          trace: {
            conversationId: run.conversationId,
            source: 'agent_runner_resume',
          },
        },
      );

      if (abortController.signal.aborted) {
        let finalStatus: AgentStatus = 'stopped';
        try {
          const dbAgent = await invoke<{ status: string } | null>('db_get_agent', { id: agentId });
          if (dbAgent?.status === 'waiting_for_approval') finalStatus = 'waiting_for_approval';
          else if (dbAgent?.status === 'completed') finalStatus = 'completed';
        } catch { /* fallthrough */ }
        if (finalStatus === 'stopped') await this.updateDbStatus(agentId, 'stopped');
        run.status = finalStatus;
        this.emit({ type: 'status_change', agentId, status: finalStatus });
      } else {
        run.status = 'completed';
        await this.updateDbStatus(agentId, 'completed');
        this.emit({ type: 'status_change', agentId, status: 'completed' });
        this.emit({ type: 'completed', agentId, toolRounds: result.toolRounds, hitLimit: result.hitLimit });

        // System agent state summary — fire and forget
        this.maybeUpdateSystemAgentState(agentId, run.messages);

        // Embed conversation for cross-session semantic search — fire and forget
        maybeEmbedConversation(
          run.conversationId,
          run.config?.agentId || 'Untitled',
          run.messages.slice(-10).map(m => ({ role: m.role, content: m.content })),
        ).catch(() => {});
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      run.status = 'error';
      run.error = errorMsg;
      await this.updateDbStatus(agentId, 'error');
      this.emit({ type: 'status_change', agentId, status: 'error', error: errorMsg });
    }

    // Drain the queue — if messages were queued during this run, auto-resume
    this.drainQueue(agentId);
  }

  /**
   * Queue a follow-up message for a running agent.
   * Will be delivered when the current run completes.
   */
  queueMessage(agentId: string, content: string): void {
    const run = this.runs.get(agentId);
    if (!run) return;
    run.pendingMessages.push(content);
    this.emit({ type: 'message_queued', agentId, content, queueLength: run.pendingMessages.length });
  }

  /**
   * Remove a queued message by index.
   */
  dequeueMessage(agentId: string, index: number): void {
    const run = this.runs.get(agentId);
    if (!run || index < 0 || index >= run.pendingMessages.length) return;
    run.pendingMessages.splice(index, 1);
    this.emit({ type: 'queue_changed', agentId, queueLength: run.pendingMessages.length });
  }

  /**
   * Get the pending message queue for an agent.
   */
  getQueue(agentId: string): string[] {
    return this.runs.get(agentId)?.pendingMessages ?? [];
  }

  /**
   * Stop a running agent.
   */
  stop(agentId: string): void {
    const run = this.runs.get(agentId);
    if (run && run.status === 'running') {
      run.abortController.abort();
      // Status update happens in the try/catch of start()
    }
  }

  /**
   * Get the current status of an agent run.
   */
  getStatus(agentId: string): { status: AgentStatus; messages: LoopMessage[]; error?: string } | null {
    const run = this.runs.get(agentId);
    if (!run) return null;
    return {
      status: run.status,
      messages: [...run.messages],
      error: run.error,
    };
  }

  /**
   * Get messages for a running agent (for live viewing).
   */
  getMessages(agentId: string): LoopMessage[] {
    return this.runs.get(agentId)?.messages ?? [];
  }

  /**
   * Check if an agent is currently running.
   */
  isRunning(agentId: string): boolean {
    return this.runs.get(agentId)?.status === 'running';
  }

  /**
   * Check if an agent has a run entry (any status — running, completed, stopped, error).
   * Used to determine if follow-ups should route through agentRunner vs useChat.
   */
  hasRun(agentId: string): boolean {
    return this.runs.has(agentId);
  }

  /**
   * Get all active (running) agent IDs.
   */
  getActiveAgentIds(): string[] {
    const ids: string[] = [];
    for (const [id, run] of this.runs) {
      if (run.status === 'running') ids.push(id);
    }
    return ids;
  }

  /**
   * Subscribe to agent events. Returns unsubscribe function.
   */
  on(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Clean up a completed/errored run from memory.
   */
  cleanup(agentId: string): void {
    const run = this.runs.get(agentId);
    if (run && run.status !== 'running') {
      this.runs.delete(agentId);
    }
  }

  // ── Private ──

  private emit(event: AgentEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        agentRunnerLogger.error('Agent listener error', { error: err });
      }
    }
  }

  /**
   * After a run completes, if there are queued messages, auto-resume with the next one.
   */
  private drainQueue(agentId: string): void {
    const run = this.runs.get(agentId);
    if (!run || run.status === 'running') return;
    if (run.pendingMessages.length === 0) return;

    const nextMessage = run.pendingMessages.shift()!;
    this.emit({ type: 'queue_changed', agentId, queueLength: run.pendingMessages.length });
    // Fire-and-forget — resume handles its own error states
    this.resume(agentId, nextMessage).catch(err => {
      agentRunnerLogger.error('Failed to drain agent queue', { agentId, error: err });
    });
  }

  private async updateDbStatus(agentId: string, status: string): Promise<void> {
    try {
      await invoke('db_update_agent', { id: agentId, status });
    } catch (err) {
      agentRunnerLogger.error('Failed to update agent status in DB', { agentId, status, error: err });
    }
  }

  /**
   * If this is a system agent, generate and persist a state summary.
   * Runs async (fire-and-forget) to not block the main flow.
   */
  private maybeUpdateSystemAgentState(agentId: string, messages: LoopMessage[]): void {
    // Check if this is a system agent — async, non-blocking
    invoke<{ is_system: number } | null>('db_get_agent', { id: agentId })
      .then(agent => {
        if (agent?.is_system === 1 && messages.length > 0) {
          const recentMsgs = messages.slice(-5).map(m => ({
            role: m.role,
            content: m.content,
          }));
          updateSystemAgentState(agentId, recentMsgs).catch(err =>
            agentRunnerLogger.warn('State summary update failed', { agentId, error: err })
          );
        }
      })
      .catch(() => { /* ignore lookup errors */ });
  }

  private async persistMessage(
    conversationId: string,
    msg: LoopMessage,
    sortOrder: number,
  ): Promise<void> {
    try {
      await invoke('db_save_message', {
        message: {
          id: msg.id,
          conversation_id: conversationId,
          role: msg.role,
          content: msg.content,
          tool_calls: msg.tool_calls ? JSON.stringify(msg.tool_calls) : null,
          tool_call_id: msg.tool_call_id ?? null,
          usage: msg.usage ? JSON.stringify(msg.usage) : null,
          cost_light: msg.cost_light ?? null,
          created_at: msg.created_at,
          sort_order: sortOrder,
        },
      });
    } catch (err) {
      agentRunnerLogger.error('Failed to persist message', { conversationId, messageId: msg.id, error: err });
    }
  }
}

// ── Singleton Export ──

export const agentRunner = new AgentRunner();
