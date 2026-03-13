// AgentRunner — singleton service for parallel background agent execution.
// Lives in module scope (not a React hook) so it survives component re-renders.
// Each agent gets its own independent streaming loop via runAgentLoop.

import { invoke } from '@tauri-apps/api/core';
import { runAgentLoop, type LoopMessage, type AgentLoopCallbacks } from './agentLoop';
import type { ChatTool } from './api';

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
  | { type: 'completed'; agentId: string; toolRounds: number; hitLimit: boolean };

interface ActiveRun {
  agentId: string;
  conversationId: string;
  abortController: AbortController;
  status: AgentStatus;
  messages: LoopMessage[];
  error?: string;
}

type EventListener = (event: AgentEvent) => void;

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
      console.warn(`[AgentRunner] Agent ${agentId} is already running`);
      return;
    }

    const abortController = new AbortController();

    const run: ActiveRun = {
      agentId,
      conversationId,
      abortController,
      status: 'running',
      messages: [],
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
          console.error(`[AgentRunner] Failed to persist message for agent ${agentId}:`, err);
        });
      },
      onStreamDelta: (assistantId: string, content: string) => {
        this.emit({ type: 'stream_delta', agentId, assistantId, content });
      },
      onToolCall,
      onWarning: (message: string) => {
        console.warn(`[AgentRunner] Agent ${agentId}: ${message}`);
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
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      run.status = 'error';
      run.error = errorMsg;
      await this.updateDbStatus(agentId, 'error');
      this.emit({ type: 'status_change', agentId, status: 'error', error: errorMsg });
    }
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
        console.error('[AgentRunner] Listener error:', err);
      }
    }
  }

  private async updateDbStatus(agentId: string, status: string): Promise<void> {
    try {
      await invoke('db_update_agent', { id: agentId, status });
    } catch (err) {
      console.error(`[AgentRunner] Failed to update agent status in DB:`, err);
    }
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
          cost_cents: msg.cost_cents ?? null,
          created_at: msg.created_at,
          sort_order: sortOrder,
        },
      });
    } catch (err) {
      console.error(`[AgentRunner] Failed to persist message:`, err);
    }
  }
}

// ── Singleton Export ──

export const agentRunner = new AgentRunner();
