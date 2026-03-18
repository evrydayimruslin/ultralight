// Imperative agent tool loop — the core execution engine.
// Extracted from useChat so that both the foreground hook (useChat)
// and background AgentRunner can share identical behavior.

import { streamChat, type ChatMessage, type ChatTool } from './api';
import { accumulateToolCalls, type AccumulatedToolCall } from './sse';
import { countAllTokens, shouldSummarize } from './tokens';
import { summarizeMessages } from './summarizer';

// ── Types ──

export interface LoopMessage {
  id: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: AccumulatedToolCall[];
  tool_call_id?: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    total_cost?: number;
  };
  cost_light?: number;
  created_at: number;
}

export interface AgentLoopCallbacks {
  /** Called when a new message is produced (assistant or tool result) */
  onMessage: (msg: LoopMessage) => void;
  /** Called when the assistant message is being streamed (content deltas) */
  onStreamDelta?: (assistantId: string, contentSoFar: string) => void;
  /** Called when token count is updated */
  onTokenCount?: (count: number) => void;
  /** Execute a tool call. Return the result as a string. */
  onToolCall: (name: string, args: Record<string, unknown>) => Promise<string>;
  /** Called when a non-fatal error occurs (retries, summarization failures) */
  onWarning?: (msg: string) => void;
}

export interface AgentLoopOptions {
  /** System prompt */
  systemPrompt?: string;
  /** Available tools */
  tools?: ChatTool[];
  /** Model ID */
  model: string;
  /** Max tool-use loop rounds */
  maxToolRounds?: number;
  /** AbortSignal for cancellation */
  signal?: AbortSignal;
}

export interface AgentLoopResult {
  /** Final messages produced during this loop (not including input messages) */
  newMessages: LoopMessage[];
  /** Number of tool rounds executed */
  toolRounds: number;
  /** Whether the loop hit the max tool rounds limit */
  hitLimit: boolean;
  /** Final token count */
  tokenCount: number;
}

// ── Constants ──

const MAX_STREAM_RETRIES = 2;
const RETRY_DELAY_MS = 1000;
const DEFAULT_MAX_ROUNDS = 25;

// ── Core Loop ──

/**
 * Run the agent tool loop imperatively.
 * Streams a chat completion, executes any tool calls, and repeats
 * until the model stops calling tools or we hit the round limit.
 *
 * @param existingMessages - Messages already in the conversation (before this turn)
 * @param callbacks - Event callbacks for message production, streaming, etc.
 * @param options - Model, tools, system prompt, limits
 * @returns Summary of what happened during the loop
 */
export async function runAgentLoop(
  existingMessages: LoopMessage[],
  callbacks: AgentLoopCallbacks,
  options: AgentLoopOptions,
): Promise<AgentLoopResult> {
  const {
    systemPrompt,
    tools,
    model,
    maxToolRounds = DEFAULT_MAX_ROUNDS,
    signal,
  } = options;

  const newMessages: LoopMessage[] = [];
  let toolRound = 0;
  let currentMessages = [...existingMessages];
  let tokenCount = 0;

  const isAborted = () => signal?.aborted ?? false;

  while (toolRound <= maxToolRounds) {
    if (isAborted()) break;

    // Build API messages
    const apiMessages = buildApiMessages(currentMessages, systemPrompt);

    // Token counting + auto-summarization
    tokenCount = countAllTokens(apiMessages);
    callbacks.onTokenCount?.(tokenCount);

    let apiMsgs = apiMessages;
    if (shouldSummarize(tokenCount, model)) {
      callbacks.onWarning?.(`Context at ${tokenCount} tokens — summarizing...`);
      try {
        apiMsgs = await summarizeMessages(apiMsgs, model);
        tokenCount = countAllTokens(apiMsgs);
        callbacks.onTokenCount?.(tokenCount);
      } catch (sumErr) {
        callbacks.onWarning?.('Summarization failed, continuing with full context');
      }
    }

    // Stream the response
    const streamResult = await streamWithRetry(apiMsgs, tools, model, callbacks, signal);

    if (!streamResult || isAborted()) break;

    // Calculate cost in Light (USD × 800 × 1.2 markup)
    let costLight: number | undefined;
    if (streamResult.usage?.total_cost !== undefined) {
      costLight = streamResult.usage.total_cost * 800 * 1.2;
    }

    // Finalize assistant message
    const assistantMsg: LoopMessage = {
      id: streamResult.assistantId,
      role: 'assistant',
      content: streamResult.content,
      tool_calls: streamResult.toolCalls.length > 0 ? streamResult.toolCalls : undefined,
      usage: streamResult.usage,
      cost_light: costLight,
      created_at: Date.now(),
    };

    newMessages.push(assistantMsg);
    currentMessages = [...currentMessages, assistantMsg];
    callbacks.onMessage(assistantMsg);

    // Execute tool calls if needed
    if (streamResult.finishReason === 'tool_calls' && streamResult.toolCalls.length > 0) {
      toolRound++;

      for (const tc of streamResult.toolCalls) {
        if (isAborted()) break;

        let toolResult: string;
        try {
          const args = JSON.parse(tc.function.arguments);
          toolResult = await callbacks.onToolCall(tc.function.name, args);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          const errName = err instanceof Error ? err.constructor.name : 'Error';
          toolResult = `Tool error (${errName}): ${errMsg}\n\nYou can try a different approach or fix the arguments and retry.`;
          callbacks.onWarning?.(`Tool ${tc.function.name} failed: ${errMsg}`);
        }

        const toolMsg: LoopMessage = {
          id: crypto.randomUUID(),
          role: 'tool',
          content: toolResult,
          tool_call_id: tc.id,
          created_at: Date.now(),
        };

        newMessages.push(toolMsg);
        currentMessages = [...currentMessages, toolMsg];
        callbacks.onMessage(toolMsg);
      }

      continue; // Next round — send tool results back to model
    }

    // No tool calls — we're done
    break;
  }

  const hitLimit = toolRound > maxToolRounds;

  return {
    newMessages,
    toolRounds: toolRound,
    hitLimit,
    tokenCount,
  };
}

// ── Helpers ──

function buildApiMessages(messages: LoopMessage[], systemPrompt?: string): ChatMessage[] {
  const apiMsgs: ChatMessage[] = [];

  if (systemPrompt) {
    apiMsgs.push({ role: 'system', content: systemPrompt });
  }

  for (const msg of messages) {
    const apiMsg: ChatMessage = {
      role: msg.role,
      content: msg.content,
    };
    if (msg.tool_calls && msg.tool_calls.length > 0) {
      apiMsg.tool_calls = msg.tool_calls;
    }
    if (msg.tool_call_id) {
      apiMsg.tool_call_id = msg.tool_call_id;
    }
    apiMsgs.push(apiMsg);
  }

  return apiMsgs;
}

interface StreamResult {
  assistantId: string;
  content: string;
  toolCalls: AccumulatedToolCall[];
  usage?: LoopMessage['usage'];
  finishReason: string | null;
}

async function streamWithRetry(
  apiMessages: ChatMessage[],
  tools: ChatTool[] | undefined,
  model: string,
  callbacks: AgentLoopCallbacks,
  signal?: AbortSignal,
): Promise<StreamResult | null> {
  const assistantId = crypto.randomUUID();
  let content = '';
  let toolCalls: AccumulatedToolCall[] = [];
  let usage: LoopMessage['usage'] = undefined;
  let finishReason: string | null = null;

  for (let attempt = 0; attempt <= MAX_STREAM_RETRIES; attempt++) {
    if (signal?.aborted) return null;

    // Reset on retry
    if (attempt > 0) {
      callbacks.onWarning?.(`Stream retry ${attempt}/${MAX_STREAM_RETRIES}...`);
      content = '';
      toolCalls = [];
      usage = undefined;
      finishReason = null;
      await new Promise(r => setTimeout(r, RETRY_DELAY_MS * attempt));
    }

    try {
      let streamError = false;

      for await (const event of streamChat({
        model,
        messages: apiMessages,
        tools: tools && tools.length > 0 ? tools : undefined,
      })) {
        if (signal?.aborted) return null;

        switch (event.type) {
          case 'delta':
            if (event.content) {
              content += event.content;
              callbacks.onStreamDelta?.(assistantId, content);
            }
            if (event.tool_calls) {
              toolCalls = accumulateToolCalls(toolCalls, event.tool_calls);
            }
            if (event.finish_reason) {
              finishReason = event.finish_reason;
            }
            break;

          case 'usage':
            usage = event.usage;
            break;

          case 'error': {
            const errMsg = event.error || 'Stream error';
            const isRetryable = /5\d{2}|rate.limit|timeout|overloaded/i.test(errMsg);
            if (isRetryable && attempt < MAX_STREAM_RETRIES) {
              callbacks.onWarning?.(`Retryable stream error: ${errMsg}`);
              streamError = true;
              break;
            }
            // Non-retryable or final attempt
            throw new Error(errMsg);
          }

          case 'done':
            break;
        }

        if (streamError) break;
      }

      if (streamError) continue;

      // Success
      return { assistantId, content, toolCalls, usage, finishReason };
    } catch (err) {
      if (attempt < MAX_STREAM_RETRIES) {
        callbacks.onWarning?.(`Stream attempt ${attempt + 1} failed: ${err}`);
        continue;
      }
      throw err; // Final attempt — propagate
    }
  }

  return null; // Should not reach here
}
