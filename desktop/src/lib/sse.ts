// SSE parser for OpenAI-format chat completion streams
// Parses Server-Sent Events from the /chat/stream endpoint
// and yields typed delta events as an async iterator.

// ── Types ──

export interface ChatDelta {
  /** Incremental text content */
  content?: string;
  /** Tool call chunks (accumulated across deltas) */
  tool_calls?: ToolCallDelta[];
}

export interface ToolCallDelta {
  index: number;
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

export interface ChatStreamEvent {
  type: 'delta' | 'tool_call' | 'usage' | 'done' | 'error';
  /** Text delta (type=delta) */
  content?: string;
  /** Tool call deltas (type=delta, accumulated) */
  tool_calls?: ToolCallDelta[];
  /** Usage stats from final chunk (type=usage) */
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    total_cost?: number;
  };
  /** Error message (type=error) */
  error?: string;
  /** Finish reason from the API */
  finish_reason?: string | null;
}

// ── SSE Line Parser ──

/**
 * Parse raw SSE text into data payloads.
 * Handles the `data: {...}` and `data: [DONE]` format.
 */
function* parseSSELines(text: string): Generator<string> {
  const lines = text.split('\n');
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      const data = line.slice(6).trim();
      if (data && data !== '[DONE]') {
        yield data;
      } else if (data === '[DONE]') {
        yield '[DONE]';
      }
    }
  }
}

// ── Stream Consumer ──

/**
 * Consume an SSE response body and yield ChatStreamEvents.
 * This is the core streaming parser used by useChat.
 *
 * @param body - ReadableStream<Uint8Array> from fetch response
 * @yields ChatStreamEvent for each parsed SSE chunk
 */
export async function* parseSSEStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<ChatStreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete lines from buffer
      const lines = buffer.split('\n');
      // Keep the last potentially incomplete line in the buffer
      buffer = lines.pop() || '';

      const fullText = lines.join('\n');

      for (const data of parseSSELines(fullText)) {
        if (data === '[DONE]') {
          yield { type: 'done' };
          return;
        }

        try {
          const parsed = JSON.parse(data) as {
            choices?: Array<{
              delta?: {
                content?: string;
                tool_calls?: ToolCallDelta[];
              };
              finish_reason?: string | null;
            }>;
            usage?: {
              prompt_tokens?: number;
              completion_tokens?: number;
              total_tokens?: number;
              total_cost?: number;
            };
            error?: { message?: string };
          };

          // Handle error responses
          if (parsed.error) {
            yield {
              type: 'error',
              error: parsed.error.message || 'Unknown error',
            };
            continue;
          }

          // Handle usage (appears in final chunk with stream_options.include_usage)
          if (parsed.usage) {
            yield {
              type: 'usage',
              usage: {
                prompt_tokens: parsed.usage.prompt_tokens || 0,
                completion_tokens: parsed.usage.completion_tokens || 0,
                total_tokens: parsed.usage.total_tokens || 0,
                total_cost: parsed.usage.total_cost,
              },
            };
          }

          // Handle choices
          const choice = parsed.choices?.[0];
          if (choice) {
            const delta = choice.delta;

            if (delta?.content || delta?.tool_calls) {
              yield {
                type: 'delta',
                content: delta.content || undefined,
                tool_calls: delta.tool_calls || undefined,
                finish_reason: choice.finish_reason,
              };
            } else if (choice.finish_reason) {
              yield {
                type: 'delta',
                finish_reason: choice.finish_reason,
              };
            }
          }
        } catch {
          // Partial JSON or non-JSON line — skip
        }
      }
    }

    // Process any remaining buffer
    if (buffer.trim()) {
      for (const data of parseSSELines(buffer)) {
        if (data === '[DONE]') {
          yield { type: 'done' };
          return;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ── Tool Call Accumulator ──

export interface AccumulatedToolCall {
  id: string;
  type: string;
  function: {
    name: string;
    arguments: string;
  };
}

/**
 * Accumulate tool call deltas into complete tool calls.
 * OpenAI streams tool calls in pieces — this merges them.
 */
export function accumulateToolCalls(
  existing: AccumulatedToolCall[],
  deltas: ToolCallDelta[],
): AccumulatedToolCall[] {
  const result = [...existing];

  for (const delta of deltas) {
    const idx = delta.index;

    // Extend array if needed
    while (result.length <= idx) {
      result.push({ id: '', type: 'function', function: { name: '', arguments: '' } });
    }

    if (delta.id) result[idx].id = delta.id;
    if (delta.type) result[idx].type = delta.type;
    if (delta.function?.name) result[idx].function.name += delta.function.name;
    if (delta.function?.arguments) result[idx].function.arguments += delta.function.arguments;
  }

  return result;
}
