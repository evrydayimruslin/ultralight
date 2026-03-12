// Custom chat hook with SSE streaming and tool-use loop.
// Replaces Vercel AI SDK useChat — gives full control over
// raw OpenAI-format SSE from /chat/stream.

import { useState, useCallback, useRef } from 'react';
import { streamChat, type ChatMessage, type ChatTool } from '../lib/api';
import { accumulateToolCalls, type AccumulatedToolCall } from '../lib/sse';
import { getModel } from '../lib/storage';

// ── Types ──

export interface Message {
  id: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: AccumulatedToolCall[];
  tool_call_id?: string;
  /** Token usage for this message (assistant only) */
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    total_cost?: number;
  };
  /** Cost in cents for this message */
  cost_cents?: number;
  /** Timestamp */
  created_at: number;
}

export interface UseChatOptions {
  /** System prompt prepended to every request */
  systemPrompt?: string;
  /** MCP tools to make available to the model */
  tools?: ChatTool[];
  /** Called when a tool needs execution. Return the tool result as a string. */
  onToolCall?: (name: string, args: Record<string, unknown>) => Promise<string>;
  /** Called when streaming starts */
  onStreamStart?: () => void;
  /** Called when streaming completes */
  onStreamEnd?: () => void;
  /** Max tool-use loop iterations (prevents infinite loops) */
  maxToolRounds?: number;
}

export interface UseChatReturn {
  messages: Message[];
  isLoading: boolean;
  error: string | null;
  sendMessage: (content: string) => Promise<void>;
  clearMessages: () => void;
  clearError: () => void;
  stopGeneration: () => void;
}

// ── Hook ──

export function useChat(options: UseChatOptions = {}): UseChatReturn {
  const {
    systemPrompt,
    tools,
    onToolCall,
    onStreamStart,
    onStreamEnd,
    maxToolRounds = 5,
  } = options;

  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const isAborted = useRef(false);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const stopGeneration = useCallback(() => {
    isAborted.current = true;
    abortRef.current?.abort();
  }, []);

  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim() || isLoading) return;

    setError(null);
    setIsLoading(true);
    isAborted.current = false;
    onStreamStart?.();

    // Add user message
    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: content.trim(),
      created_at: Date.now(),
    };

    setMessages(prev => [...prev, userMsg]);

    // Build messages for the API
    const buildApiMessages = (msgs: Message[]): ChatMessage[] => {
      const apiMsgs: ChatMessage[] = [];

      if (systemPrompt) {
        apiMsgs.push({ role: 'system', content: systemPrompt });
      }

      for (const msg of msgs) {
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
    };

    // Tool-use loop
    let currentMessages = [...messages, userMsg];
    let toolRound = 0;

    try {
      while (toolRound <= maxToolRounds) {
        if (isAborted.current) break;

        const model = getModel();
        const apiMessages = buildApiMessages(currentMessages);

        // Create assistant message placeholder
        const assistantId = crypto.randomUUID();
        let assistantContent = '';
        let toolCalls: AccumulatedToolCall[] = [];
        let messageUsage: Message['usage'] = undefined;
        let finishReason: string | null = null;

        // Add empty assistant message to UI
        setMessages([...currentMessages, {
          id: assistantId,
          role: 'assistant',
          content: '',
          created_at: Date.now(),
        }]);

        // Stream the response
        for await (const event of streamChat({
          model,
          messages: apiMessages,
          tools: tools && tools.length > 0 ? tools : undefined,
        })) {
          if (isAborted.current) break;

          switch (event.type) {
            case 'delta':
              if (event.content) {
                assistantContent += event.content;
                // Update UI progressively
                setMessages(prev => prev.map(m =>
                  m.id === assistantId
                    ? { ...m, content: assistantContent }
                    : m
                ));
              }
              if (event.tool_calls) {
                toolCalls = accumulateToolCalls(toolCalls, event.tool_calls);
              }
              if (event.finish_reason) {
                finishReason = event.finish_reason;
              }
              break;

            case 'usage':
              messageUsage = event.usage;
              break;

            case 'error':
              // Remove the empty assistant placeholder on error
              setMessages(prev => prev.filter(m => m.id !== assistantId));
              setError(event.error || 'Stream error');
              setIsLoading(false);
              onStreamEnd?.();
              return;

            case 'done':
              break;
          }
        }

        if (isAborted.current) break;

        // Calculate approximate cost from usage
        let costCents: number | undefined;
        if (messageUsage?.total_cost !== undefined) {
          costCents = messageUsage.total_cost * 100 * 1.2; // Convert USD to cents + 20% markup
        }

        // Finalize assistant message
        const completedAssistant: Message = {
          id: assistantId,
          role: 'assistant',
          content: assistantContent,
          tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
          usage: messageUsage,
          cost_cents: costCents,
          created_at: Date.now(),
        };

        currentMessages = [...currentMessages, completedAssistant];
        setMessages([...currentMessages]);

        // Check if we need to execute tool calls
        if (finishReason === 'tool_calls' && toolCalls.length > 0 && onToolCall) {
          toolRound++;

          // Execute each tool call and add results
          for (const tc of toolCalls) {
            if (isAborted.current) break;

            try {
              const args = JSON.parse(tc.function.arguments);
              const result = await onToolCall(tc.function.name, args);

              const toolMsg: Message = {
                id: crypto.randomUUID(),
                role: 'tool',
                content: result,
                tool_call_id: tc.id,
                created_at: Date.now(),
              };

              currentMessages = [...currentMessages, toolMsg];
              setMessages([...currentMessages]);
            } catch (err) {
              const toolMsg: Message = {
                id: crypto.randomUUID(),
                role: 'tool',
                content: `Tool error: ${err instanceof Error ? err.message : String(err)}`,
                tool_call_id: tc.id,
                created_at: Date.now(),
              };

              currentMessages = [...currentMessages, toolMsg];
              setMessages([...currentMessages]);
            }
          }

          // Continue the loop — send tool results back to the model
          continue;
        }

        // No tool calls or finish_reason !== 'tool_calls' — we're done
        break;
      }
    } catch (err) {
      if (!isAborted.current) {
        setError(err instanceof Error ? err.message : 'An error occurred');
      }
    } finally {
      setIsLoading(false);
      onStreamEnd?.();
    }
  }, [messages, isLoading, systemPrompt, tools, onToolCall, onStreamStart, onStreamEnd, maxToolRounds]);

  return {
    messages,
    isLoading,
    error,
    sendMessage,
    clearMessages,
    clearError,
    stopGeneration,
  };
}
