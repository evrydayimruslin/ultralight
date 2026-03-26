// Custom chat hook with SSE streaming and tool-use loop.
// Delegates to agentLoop for the core execution, manages React state on top.

import { useState, useCallback, useRef } from 'react';
import type { ChatTool } from '../lib/api';
import type { AccumulatedToolCall } from '../lib/sse';
import { getModel } from '../lib/storage';
import { countAllTokens } from '../lib/tokens';
import { runAgentLoop, type LoopMessage } from '../lib/agentLoop';

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
  /** Cost in Light for this message */
  cost_light?: number;
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
  /** Approximate token count of the current conversation */
  tokenCount: number;
  sendMessage: (content: string) => Promise<void>;
  /** Load messages from a saved conversation */
  loadMessages: (msgs: Message[]) => void;
  clearMessages: () => void;
  clearError: () => void;
  stopGeneration: () => void;
  /** Append a message from an external source (e.g. agentRunner events) */
  appendMessage: (msg: Message) => void;
  /** Update a streaming message's content by ID */
  updateStreamContent: (id: string, content: string) => void;
}

// ── Hook ──

export function useChat(options: UseChatOptions = {}): UseChatReturn {
  const {
    systemPrompt,
    tools,
    onToolCall,
    onStreamStart,
    onStreamEnd,
    maxToolRounds = 25,
  } = options;

  // Use a ref so sendMessage always reads the latest system prompt
  const systemPromptRef = useRef(systemPrompt);
  systemPromptRef.current = systemPrompt;

  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tokenCount, setTokenCount] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
    setTokenCount(0);
  }, []);

  const loadMessages = useCallback((msgs: Message[]) => {
    setMessages(msgs);
    setError(null);
    if (msgs.length > 0) {
      const apiMsgs = msgs.map(m => ({
        role: m.role,
        content: m.content,
        tool_calls: m.tool_calls,
        tool_call_id: m.tool_call_id,
      }));
      setTokenCount(countAllTokens(apiMsgs));
    } else {
      setTokenCount(0);
    }
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const stopGeneration = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const appendMessage = useCallback((msg: Message) => {
    setMessages(prev => {
      const exists = prev.find(m => m.id === msg.id);
      if (exists) {
        return prev.map(m => m.id === msg.id ? msg : m);
      }
      return [...prev, msg];
    });
  }, []);

  const updateStreamContent = useCallback((id: string, content: string) => {
    setMessages(prev => {
      const exists = prev.find(m => m.id === id);
      if (exists) {
        return prev.map(m => m.id === id ? { ...m, content } : m);
      }
      return [...prev, {
        id,
        role: 'assistant' as const,
        content,
        created_at: Date.now(),
      }];
    });
  }, []);

  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim() || isLoading) return;

    setError(null);
    setIsLoading(true);
    onStreamStart?.();

    const abortController = new AbortController();
    abortRef.current = abortController;

    // Add user message
    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: content.trim(),
      created_at: Date.now(),
    };

    const existingMessages: LoopMessage[] = [...messages, userMsg];
    setMessages(existingMessages as Message[]);

    try {
      const model = getModel();

      const result = await runAgentLoop(
        existingMessages,
        {
          onMessage: (msg: LoopMessage) => {
            // Append each new message to state as it's produced
            setMessages(prev => {
              // If this is an assistant message and we already have a placeholder, replace it
              const existing = prev.find(m => m.id === msg.id);
              if (existing) {
                return prev.map(m => m.id === msg.id ? (msg as Message) : m);
              }
              return [...prev, msg as Message];
            });
          },
          onStreamDelta: (assistantId: string, contentSoFar: string) => {
            // Update the streaming assistant message in UI
            setMessages(prev => {
              const exists = prev.find(m => m.id === assistantId);
              if (exists) {
                return prev.map(m =>
                  m.id === assistantId ? { ...m, content: contentSoFar } : m
                );
              }
              // Create placeholder if not yet in state
              return [...prev, {
                id: assistantId,
                role: 'assistant' as const,
                content: contentSoFar,
                created_at: Date.now(),
              }];
            });
          },
          onTokenCount: (count: number) => {
            setTokenCount(count);
          },
          onToolCall: onToolCall || (async () => 'No tool handler configured'),
          onWarning: (msg: string) => {
            console.warn(`[useChat] ${msg}`);
          },
        },
        {
          systemPrompt: systemPromptRef.current,
          tools,
          model,
          maxToolRounds,
          signal: abortController.signal,
        },
      );

      if (result.hitLimit) {
        setError(`Agent stopped after ${maxToolRounds} tool rounds. You can continue the conversation to keep going.`);
      }
    } catch (err) {
      if (!abortController.signal.aborted) {
        setError(err instanceof Error ? err.message : 'An error occurred');
      }
    } finally {
      setIsLoading(false);
      abortRef.current = null;
      onStreamEnd?.();
    }
  }, [messages, isLoading, tools, onToolCall, onStreamStart, onStreamEnd, maxToolRounds]);

  return {
    messages,
    isLoading,
    error,
    tokenCount,
    sendMessage,
    loadMessages,
    clearMessages,
    clearError,
    stopGeneration,
    appendMessage,
    updateStreamContent,
  };
}
