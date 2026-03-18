// API client for Ultralight chat endpoints
// All requests route through the Ultralight server proxy (auth + billing).

import { getToken, getApiBase } from './storage';
import { parseSSEStream, type ChatStreamEvent } from './sse';

// ── Types ──

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: string;
    function: { name: string; arguments: string };
  }>;
}

export interface ChatTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
}

export interface ApiError {
  error: string;
  detail?: string;
  balance_light?: number;
  minimum_light?: number;
  topup_url?: string;
  allowed_models?: string[];
  resetAt?: string;
}

/** Fallback model list when server is unreachable */
const FALLBACK_MODELS: ModelInfo[] = [
  { id: 'anthropic/claude-sonnet-4-20250514', name: 'claude-sonnet-4-20250514', provider: 'anthropic' },
  { id: 'anthropic/claude-3.5-sonnet', name: 'claude-3.5-sonnet', provider: 'anthropic' },
  { id: 'anthropic/claude-3-opus', name: 'claude-3-opus', provider: 'anthropic' },
  { id: 'openai/gpt-4o', name: 'gpt-4o', provider: 'openai' },
  { id: 'openai/gpt-4o-mini', name: 'gpt-4o-mini', provider: 'openai' },
  { id: 'google/gemini-pro-1.5', name: 'gemini-pro-1.5', provider: 'google' },
  { id: 'deepseek/deepseek-chat', name: 'deepseek-chat', provider: 'deepseek' },
];

// ── Headers ──

function authHeaders(): Record<string, string> {
  const token = getToken();
  if (!token) throw new Error('Not authenticated');
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

// ── Chat Stream ──

/**
 * Stream a chat completion from the Ultralight proxy.
 * Returns an async iterator of ChatStreamEvents.
 */
export async function* streamChat(opts: {
  model: string;
  messages: ChatMessage[];
  tools?: ChatTool[];
  temperature?: number;
  max_tokens?: number;
}): AsyncGenerator<ChatStreamEvent> {
  const base = getApiBase();

  let res: Response;
  try {
    res = await fetch(`${base}/chat/stream`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        model: opts.model,
        messages: opts.messages,
        tools: opts.tools,
        temperature: opts.temperature ?? 0.7,
        max_tokens: opts.max_tokens ?? 4096,
      }),
    });
  } catch (err) {
    yield {
      type: 'error',
      error: `Network error: ${err instanceof Error ? err.message : 'Connection failed'}. Check your internet connection.`,
    };
    return;
  }

  // Handle non-streaming error responses
  if (!res.ok) {
    let apiError: ApiError;
    try {
      apiError = await res.json() as ApiError;
    } catch {
      apiError = { error: `HTTP ${res.status}: ${res.statusText}` };
    }

    yield {
      type: 'error',
      error: formatApiError(apiError, res.status),
    };
    return;
  }

  if (!res.body) {
    yield { type: 'error', error: 'No response body' };
    return;
  }

  // Parse the SSE stream
  yield* parseSSEStream(res.body);
}

// ── Models List ──

/**
 * Fetch available models from the server.
 */
export async function fetchModels(): Promise<ModelInfo[]> {
  const base = getApiBase();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  const token = getToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  try {
    const res = await fetch(`${base}/chat/models`, { headers });
    if (!res.ok) {
      throw new Error(`Failed to fetch models: ${res.status}`);
    }

    const data = await res.json() as { models: ModelInfo[] };
    return data.models;
  } catch {
    return FALLBACK_MODELS;
  }
}

// ── MCP Tool Execution ──

export interface McpToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

/**
 * Execute an MCP tool call via the platform endpoint.
 */
export async function executeMcpTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<McpToolResult> {
  const base = getApiBase();

  const res = await fetch(`${base}/mcp/platform`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: crypto.randomUUID(),
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: args,
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    return {
      content: [{ type: 'text', text: `Tool error (${res.status}): ${errText}` }],
      isError: true,
    };
  }

  const data = await res.json() as {
    result?: McpToolResult;
    error?: { message: string };
  };

  if (data.error) {
    return {
      content: [{ type: 'text', text: `Tool error: ${data.error.message}` }],
      isError: true,
    };
  }

  return data.result || { content: [{ type: 'text', text: 'No result' }], isError: true };
}

// ── Balance Check ──

/**
 * Get current balance via MCP wallet tool.
 */
export async function fetchBalance(): Promise<number | null> {
  try {
    const result = await executeMcpTool('ul.wallet', {});
    const text = result.content?.[0]?.text || '';
    const match = text.match(/(\d+\.?\d*)\s*light/i) || text.match(/balance[:\s]*✦?(\d+\.?\d*)/i);
    if (match) {
      return parseFloat(match[1]);
    }
    return null;
  } catch {
    return null;
  }
}

// ── Helpers ──

function formatLight(amount: number): string {
  const abs = Math.abs(amount);
  if (abs >= 1e6) return '✦' + (abs / 1e6).toFixed(2) + 'M';
  if (abs >= 5000) return '✦' + (abs / 1000).toFixed(1) + 'K';
  return '✦' + (abs % 1 === 0 ? String(abs) : abs.toFixed(2));
}

function formatApiError(err: ApiError, status: number): string {
  // Include server detail if available
  const detail = err.detail ? ` (${err.detail})` : '';

  switch (status) {
    case 401:
      return `Authentication failed${detail}`;
    case 402:
      return `Insufficient balance (${formatLight(err.balance_light || 0)} remaining). Top up at Settings > Billing.`;
    case 403:
      return err.error || 'Access denied. A full account is required for chat.';
    case 429:
      return `Rate limit exceeded.${err.resetAt ? ` Try again at ${new Date(err.resetAt).toLocaleTimeString()}.` : ''}`;
    case 503:
      return 'Chat service is temporarily unavailable. Please try again shortly.';
    default:
      return err.error || `Request failed (${status})`;
  }
}
