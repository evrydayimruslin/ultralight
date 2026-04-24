// API client for Ultralight chat endpoints
// All requests route through the Ultralight server proxy (auth + billing).

import { fetchFromApi, getToken } from './storage';
import { parseSSEStream, type ChatStreamEvent } from './sse';
import type { ToolUsed } from '../types/executionPlan';
import type { AmbientSuggestion } from '../types/ambientSuggestion';
import { createDesktopLogger } from './logging';

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

const apiLogger = createDesktopLogger('api');

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
  let res: Response;
  try {
    res = await fetchFromApi('/chat/stream', {
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
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  const token = getToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  try {
    const res = await fetchFromApi('/chat/models', { headers });
    if (!res.ok) {
      throw new Error(`Failed to fetch models: ${res.status}`);
    }

    const data = await res.json() as { models: ModelInfo[] };
    return data.models;
  } catch {
    return FALLBACK_MODELS;
  }
}

// ── Function Index (per-user typed function catalog for codemode) ──

export interface FunctionIndex {
  functions: Record<string, {
    appId: string;
    appSlug: string;
    fnName: string;
    description: string;
    params: Record<string, { type: string; required?: boolean; description?: string }>;
  }>;
  widgets: Array<{ name: string; appId: string; label: string }>;
  types: string;
  updatedAt: string | null;
}

const FN_INDEX_CACHE_KEY = 'ul_fn_index';

/**
 * Fetch the user's function index from the server, with localStorage caching.
 * Returns cached version if available and less than 5 minutes old.
 */
export async function fetchFunctionIndex(forceRefresh = false): Promise<FunctionIndex | null> {
  // Check cache first
  if (!forceRefresh) {
    try {
      const cached = localStorage.getItem(FN_INDEX_CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached) as FunctionIndex & { _cachedAt?: number };
        const age = Date.now() - (parsed._cachedAt || 0);
        if (age < 5 * 60 * 1000) { // 5 minutes
          return parsed;
        }
      }
    } catch { /* cache corrupt */ }
  }

  // Fetch from server
  const token = getToken();
  if (!token) return null;

  try {
    const res = await fetchFromApi('/chat/function-index', {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const index = await res.json() as FunctionIndex;

    // Cache with timestamp
    try {
      localStorage.setItem(FN_INDEX_CACHE_KEY, JSON.stringify({ ...index, _cachedAt: Date.now() }));
    } catch { /* storage full */ }

    return index;
  } catch {
    return null;
  }
}

// ── Task Context (per-request entity + function resolution) ──

export interface TaskContext {
  entities: Array<{
    name: string;
    match: string;
    type: string;
    id: string;
    appId: string;
    appName: string;
    context: string;
  }>;
  functions: Array<{
    name: string;
    appId: string;
    description: string;
    returns: string;
    conventions: string[];
    dependsOn: string[];
  }>;
  conventions: Array<{ appName: string; key: string; value: string }>;
  promptBlock: string;
  modelSuggestion?: string;  // flash broker's recommendation: "flash" or "sonnet"
}

/**
 * Resolve task context for a user prompt.
 * POSTs the prompt to /chat/context and returns matched entities,
 * functions, conventions, and a formatted promptBlock for system prompt injection.
 */
export async function fetchTaskContext(prompt: string): Promise<TaskContext | null> {
  const token = getToken();
  if (!token) return null;

  try {
    const res = await fetchFromApi('/chat/context', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt }),
    });
    if (!res.ok) return null;
    return await res.json() as TaskContext;
  } catch {
    return null;
  }
}

// ── MCP Tool Execution ──

export interface McpToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

export class ExecutionPlanRequestError extends Error {
  status: number;
  detail?: string;

  constructor(message: string, status: number, detail?: string) {
    super(message);
    this.name = 'ExecutionPlanRequestError';
    this.status = status;
    this.detail = detail;
  }
}

async function buildExecutionPlanRequestError(res: Response): Promise<ExecutionPlanRequestError> {
  const fallback = `Execution plan request failed (${res.status})`;
  const text = await res.text().catch(() => '');

  if (!text) {
    return new ExecutionPlanRequestError(fallback, res.status);
  }

  try {
    const parsed = JSON.parse(text) as { error?: string; detail?: string };
    return new ExecutionPlanRequestError(
      parsed.error || fallback,
      res.status,
      parsed.detail || text,
    );
  } catch {
    return new ExecutionPlanRequestError(text, res.status, text);
  }
}

/**
 * Execute an MCP tool call via the platform endpoint.
 */
export async function executeMcpTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<McpToolResult> {
  const res = await fetchFromApi('/mcp/platform', {
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

/**
 * Call a specific app's MCP endpoint directly (bypasses ul.call prefix issues).
 * toolName must be the slug-prefixed name (e.g., "app-7vftmp_widget_email_inbox_ui").
 */
export async function executeAppMcpTool(
  appUuid: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<McpToolResult> {
  const res = await fetchFromApi(`/mcp/${appUuid}`, {
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
    const result = await executeMcpTool('ul.wallet', { action: 'status' });
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

// ── Orchestrate Stream ──

export interface OrchestrateEvent {
  type:
    // Flash phase
    | 'flash_status' | 'ambient_suggestions' | 'flash_search' | 'flash_found' | 'flash_context' | 'flash_prompt' | 'flash_direct'
    // Heavy phase
    | 'heavy_status' | 'heavy_text' | 'heavy_recipe'
    // Execution phase
    | 'plan_ready' | 'plan_cancelled' | 'exec_start' | 'exec_result'
    // System agent delegation
    | 'system_agent_spawn'
    // Meta
    | 'usage' | 'done' | 'error'
    // Legacy compat
    | 'status' | 'text' | 'tool_start' | 'result';
  text?: string;
  content?: string;
  name?: string;
  code?: string;
  data?: unknown;
  flash?: unknown;
  heavy?: unknown;
  message?: string;
  query?: string;
  apps?: string[];
  suggestions?: AmbientSuggestion[];
  entity?: string;
  detail?: string;
  functions?: string[];
  conventions?: number;
  prompt?: string;
  model?: string;
  /** System agent delegation fields */
  agentType?: string;
  task?: string;
  originalPrompt?: string;
  plan?: {
    id: string;
    recipe: string;
    tools_used: ToolUsed[];
    total_cost_light: number;
    created_at: number;
  };
  planId?: string;
  reason?: string;
}

/**
 * Stream events from the /chat/orchestrate SSE endpoint.
 * The server handles routing, tool execution, and model selection —
 * the client just consumes the event stream.
 */
export async function* streamOrchestrate(opts: {
  message: string;
  conversationHistory?: Array<{ role: string; content: string }>;
  interpreterModel?: string;
  heavyModel?: string;
  scope?: Record<string, { access: 'all' | 'functions' | 'data'; functions?: string[]; conventions?: Record<string, string> }>;
  /** Behavioral instructions from the agent's admin notes */
  adminNotes?: string;
  systemAgentStates?: Array<{ type: string; name: string; tools: string[]; stateSummary: string | null; status: string }>;
  systemAgentContext?: { type: string; persona: string; skillsPath: string };
  /** Local project file context gathered client-side for Tool Maker */
  projectContext?: string;
  /** Conversation ID for rolling summary persistence */
  conversationId?: string;
  /** Attached files (base64 data URLs) */
  files?: Array<{ name: string; size: number; mimeType: string; content: string }>;
}): AsyncGenerator<OrchestrateEvent> {
  let res: Response;
  try {
    res = await fetchFromApi('/chat/orchestrate', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(opts),
    });
  } catch (err) {
    yield { type: 'error', message: `Network error: ${err instanceof Error ? err.message : 'Connection failed'}` };
    return;
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    yield { type: 'error', message: `Server error (${res.status}): ${errText}` };
    return;
  }

  if (!res.body) {
    yield { type: 'error', message: 'No response body' };
    return;
  }

  // Parse SSE stream
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || ''; // Keep incomplete line

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6).trim();
        if (data === '[DONE]') {
          yield { type: 'done' };
          return;
        }
        try {
          yield JSON.parse(data) as OrchestrateEvent;
        } catch {
          // Skip unparseable lines
        }
      }
    }
  }
}

export async function confirmExecutionPlan(planId: string): Promise<void> {
  const res = await fetchFromApi(`/chat/plan/${planId}/confirm`, {
    method: 'POST',
    headers: authHeaders(),
  });

  if (!res.ok) {
    throw await buildExecutionPlanRequestError(res);
  }
}

export async function cancelExecutionPlan(planId: string): Promise<void> {
  const res = await fetchFromApi(`/chat/plan/${planId}/cancel`, {
    method: 'POST',
    headers: authHeaders(),
  });

  if (!res.ok) {
    throw await buildExecutionPlanRequestError(res);
  }
}

// ── Conversation Embedding ──

/** Embed a conversation summary for cross-session semantic search */
export async function embedConversation(opts: {
  conversationId: string;
  conversationName: string;
  summary: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await fetchFromApi('/api/user/conversation-embedding', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(opts),
    });
  } catch (err) {
    apiLogger.warn('Failed to embed conversation', { error: err });
  }
}

// ── System Agent State Sync ──

/** Sync system agent states to server KV for Flash's Context Index */
export async function syncSystemAgentStates(
  states: Array<{ type: string; name: string; tools: string[]; stateSummary: string | null; status: string }>,
): Promise<void> {
  try {
    await fetchFromApi('/api/user/system-agent-states', {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ states }),
    });
  } catch (err) {
    apiLogger.warn('Failed to sync system agent states', { error: err });
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
