// MCP (Model Context Protocol) Handler
// Implements JSON-RPC 2.0 protocol for tool discovery and execution
// Spec: https://modelcontextprotocol.io/specification/draft/server/tools

import { json, error } from './app.ts';
import { authenticate } from './auth.ts';
import { isApiToken } from '../services/tokens.ts';
import { createAppsService } from '../services/apps.ts';
import { createAppDataService, createWorkerAppDataService } from '../services/appdata.ts';
import { createMeteredAppDataService } from '../services/appdata-metered.ts';
import { checkRateLimit } from '../services/ratelimit.ts';
import { checkAndIncrementWeeklyCalls } from '../services/weekly-calls.ts';
import { checkProvisionalDailyLimit, updateLastActive } from '../services/provisional.ts';
import { getPermissionsForUser } from './user.ts';
import { type Tier, type AppPricingConfig, getCallPriceLight, getFreeCalls, getFreeCallsScope, formatLight, LIGHT_PER_DOLLAR_DESKTOP } from '../../shared/types/index.ts';
import { type UserContext } from '../runtime/sandbox.ts';
import { createR2Service } from '../services/storage.ts';
import { createUserService } from '../services/user.ts';
import { createAIService } from '../services/ai.ts';
import { decryptEnvVars, decryptEnvVar } from '../services/envvars.ts';
import { getCodeCache } from '../services/codecache.ts';
import { getPermissionCache } from '../services/permission-cache.ts';
import { createMemoryService, type MemoryService as MemoryServiceImpl } from '../services/memory.ts';
import { executeGpuFunction } from '../services/gpu/executor.ts';
import { acquireGpuSlot } from '../services/gpu/concurrency.ts';
import { settleGpuExecution } from '../services/gpu/billing.ts';
import { createD1DataService } from '../services/d1-data.ts';
import { getD1DatabaseId } from '../services/d1-provisioning.ts';
import { resolveAppEnvSchema } from '../services/app-settings.ts';
import type {
  MCPTool,
  MCPJsonSchema,
  MCPToolsListResponse,
  MCPToolCallRequest,
  MCPToolCallResponse,
  MCPContent,
  MCPServerInfo,
  MCPResourceDescriptor,
  MCPResourceContent,
  SkillFunction,
  BYOKProvider,
  AppManifest,
  App,
  AIRequest,
  AIContentPart,
} from '../../shared/types/index.ts';
import { manifestToMCPTools, normalizeManifestParameters } from '../../shared/types/index.ts';
import { getEnv } from '../lib/env.ts';

// ============================================
// MEMORY SERVICE (lazy singleton)
// ============================================

let _memoryService: MemoryServiceImpl | null = null;
function getMemoryService(): MemoryServiceImpl | null {
  if (!_memoryService) {
    try {
      _memoryService = createMemoryService();
    } catch (err) {
      console.error('Failed to create MemoryService:', err);
    }
  }
  return _memoryService;
}

// ============================================
// KV INDEX HELPERS (fire-and-forget content table upserts for search)
// ============================================

/**
 * Upsert a content row for an app KV entry with NULL embedding.
 * The background embedding processor fills the embedding later.
 */
async function indexAppKV(
  appId: string,
  appOwnerId: string,
  key: string,
  value: unknown
): Promise<void> {
  const SUPABASE_URL = getEnv('SUPABASE_URL');
  const SUPABASE_SERVICE_ROLE_KEY = getEnv('SUPABASE_SERVICE_ROLE_KEY');
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return;

  const embeddingText = typeof value === 'string' ? value : JSON.stringify(value);
  // Skip very large values to prevent content table bloat
  if (embeddingText.length > 50_000) return;

  const slug = `${appId}/${key}`;
  const row = {
    owner_id: appOwnerId,
    type: 'app_kv',
    slug: slug,
    title: key,
    description: `App data: ${key}`,
    visibility: 'private',
    size: new TextEncoder().encode(embeddingText).length,
    embedding_text: embeddingText.split(/\s+/).slice(0, 6000).join(' '),
    embedding: null,
    updated_at: new Date().toISOString(),
  };

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/content?on_conflict=owner_id,type,slug`,
    {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates',
      },
      body: JSON.stringify(row),
    }
  );
  if (!res.ok) {
    console.error('[KV-INDEX] Content upsert failed:', await res.text());
  }
}

/**
 * Upsert a content row for a user KV entry with NULL embedding.
 */
async function indexUserKV(
  userId: string,
  scope: string,
  key: string,
  value: unknown
): Promise<void> {
  const SUPABASE_URL = getEnv('SUPABASE_URL');
  const SUPABASE_SERVICE_ROLE_KEY = getEnv('SUPABASE_SERVICE_ROLE_KEY');
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return;

  const embeddingText = typeof value === 'string' ? value : JSON.stringify(value);
  if (embeddingText.length > 50_000) return;

  const slug = `${scope}/${key}`;
  const row = {
    owner_id: userId,
    type: 'user_kv',
    slug: slug,
    title: key,
    description: `User data: ${scope}/${key}`,
    visibility: 'private',
    size: new TextEncoder().encode(embeddingText).length,
    embedding_text: embeddingText.split(/\s+/).slice(0, 6000).join(' '),
    embedding: null,
    updated_at: new Date().toISOString(),
  };

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/content?on_conflict=owner_id,type,slug`,
    {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates',
      },
      body: JSON.stringify(row),
    }
  );
  if (!res.ok) {
    console.error('[KV-INDEX] User KV content upsert failed:', await res.text());
  }
}

/**
 * Delete a content index row for a removed KV entry.
 */
async function removeKVIndex(
  ownerId: string,
  type: string,
  slug: string
): Promise<void> {
  const SUPABASE_URL = getEnv('SUPABASE_URL');
  const SUPABASE_SERVICE_ROLE_KEY = getEnv('SUPABASE_SERVICE_ROLE_KEY');
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return;

  await fetch(
    `${SUPABASE_URL}/rest/v1/content?owner_id=eq.${ownerId}&type=eq.${type}&slug=eq.${encodeURIComponent(slug)}`,
    {
      method: 'DELETE',
      headers: {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Prefer': 'return=minimal',
      },
    }
  );
}

// ============================================
// TYPES
// ============================================

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number;  // Optional for JSON-RPC notifications (e.g. notifications/initialized)
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

type JsonRpcId = string | number | null | undefined;
type AuthResult = Awaited<ReturnType<typeof authenticate>>;

function normalizeJsonRpcId(id: JsonRpcId): string | number | null {
  return id ?? null;
}

function toTier(value: string): Tier {
  return value === 'free'
    || value === 'fun'
    || value === 'pro'
    || value === 'scale'
    || value === 'enterprise'
    ? value
    : 'free';
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  return await response.json() as T;
}

function isAiContentPartArray(value: unknown): value is AIContentPart[] {
  return Array.isArray(value) && value.every((part) => {
    if (!part || typeof part !== 'object') {
      return false;
    }
    const candidate = part as Record<string, unknown>;
    if (candidate.type === 'text') {
      return typeof candidate.text === 'string';
    }
    if (candidate.type === 'file') {
      return typeof candidate.data === 'string';
    }
    return false;
  });
}

function toAiMessages(value: unknown): AIRequest['messages'] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const messages: AIRequest['messages'] = [];
  for (const message of value) {
    if (!message || typeof message !== 'object') {
      return null;
    }

    const candidate = message as Record<string, unknown>;
    if (candidate.role !== 'system' && candidate.role !== 'user' && candidate.role !== 'assistant') {
      return null;
    }

    const content = candidate.content;
    if (typeof content !== 'string' && !isAiContentPartArray(content)) {
      return null;
    }

    messages.push({
      role: candidate.role,
      content,
      ...(candidate.cache_control && typeof candidate.cache_control === 'object'
        && (candidate.cache_control as Record<string, unknown>).type === 'ephemeral'
        ? { cache_control: { type: 'ephemeral' as const } }
        : {}),
    });
  }

  return messages;
}

function parseIncrementCallerUsageCount(payload: unknown): number | null {
  if (typeof payload === 'number') {
    return payload;
  }
  if (!Array.isArray(payload) || payload.length === 0) {
    return null;
  }

  const first = payload[0];
  if (typeof first === 'number') {
    return first;
  }
  if (first && typeof first === 'object' && 'call_count' in first && typeof first.call_count === 'number') {
    return first.call_count;
  }

  return null;
}

// JSON-RPC error codes
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;
const AUTH_REQUIRED = -32001;
const NOT_FOUND = -32002;
const RATE_LIMITED = -32000;

// Session sequence counters — tracks call order within a session.
// Key: sessionId → next sequence number. Auto-expires after 1 hour.
const sessionSequences = new Map<string, { seq: number; lastUsed: number }>();

function nextSequenceNumber(sessionId: string | undefined): number | undefined {
  if (!sessionId) return undefined;
  const now = Date.now();
  const entry = sessionSequences.get(sessionId);
  const seq = entry ? entry.seq + 1 : 1;
  sessionSequences.set(sessionId, { seq, lastUsed: now });
  // Lazy cleanup: purge stale sessions every 100 calls
  if (sessionSequences.size > 100 && Math.random() < 0.1) {
    const cutoff = now - 3_600_000; // 1 hour
    for (const [k, v] of sessionSequences) {
      if (v.lastUsed < cutoff) sessionSequences.delete(k);
    }
  }
  return seq;
}

// ============================================
// SDK TOOLS DEFINITIONS
// Always included in every app's tool list
// ============================================

const SDK_TOOLS: MCPTool[] = [
  // ---- Skills (Documentation) ----
  {
    name: 'ultralight.getSkills',
    title: 'Get Skills',
    description:
      'Get the Skills.md documentation for this app. Call this FIRST before using other tools — ' +
      'it explains every function, its parameters, return types, and usage patterns.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    outputSchema: {
      type: 'object',
      properties: {
        skills_md: { type: 'string', description: 'The full Skills.md markdown content.' },
        app_name: { type: 'string' },
        app_id: { type: 'string' },
      },
    },
  },

  // ---- Data Storage ----
  {
    name: 'ultralight.store',
    title: 'Store Data',
    description: 'Store a value in app-scoped persistent storage. Data is partitioned per user.',
    inputSchema: {
      type: 'object',
      properties: {
        key: {
          type: 'string',
          description: 'Storage key. Supports "/" for hierarchy (e.g., "users/123/profile").',
        },
        value: {
          description: 'JSON-serializable value to store.',
        },
      },
      required: ['key', 'value'],
    },
  },
  {
    name: 'ultralight.load',
    title: 'Load Data',
    description: 'Load a value from app-scoped storage by key.',
    inputSchema: {
      type: 'object',
      properties: {
        key: {
          type: 'string',
          description: 'Storage key to retrieve.',
        },
      },
      required: ['key'],
    },
    outputSchema: {
      description: 'The stored value, or null if not found.',
    },
  },
  {
    name: 'ultralight.list',
    title: 'List Keys',
    description: 'List all keys in storage, optionally filtered by prefix.',
    inputSchema: {
      type: 'object',
      properties: {
        prefix: {
          type: 'string',
          description: 'Optional prefix filter (e.g., "users/" to list all user keys).',
        },
      },
    },
    outputSchema: {
      type: 'array',
      items: { type: 'string' },
      description: 'Array of matching keys.',
    },
  },
  {
    name: 'ultralight.query',
    title: 'Query Data',
    description: 'Query storage with filtering, sorting, and pagination.',
    inputSchema: {
      type: 'object',
      properties: {
        prefix: {
          type: 'string',
          description: 'Key prefix to query.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return.',
        },
        offset: {
          type: 'number',
          description: 'Number of results to skip.',
        },
      },
      required: ['prefix'],
    },
    outputSchema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          value: {},
          updatedAt: { type: 'string' },
        },
      },
    },
  },
  {
    name: 'ultralight.remove',
    title: 'Remove Data',
    description: 'Remove a key from storage.',
    inputSchema: {
      type: 'object',
      properties: {
        key: {
          type: 'string',
          description: 'Storage key to remove.',
        },
      },
      required: ['key'],
    },
  },

  // ---- User Memory (Cross-App) ----
  {
    name: 'ultralight.remember',
    title: 'Remember (Cross-App)',
    description: "Store a value in user's cross-app memory. Defaults to app-scoped (app:{appId}). Use scope='user' for memory shared across all apps.",
    inputSchema: {
      type: 'object',
      properties: {
        key: {
          type: 'string',
          description: 'Memory key.',
        },
        value: {
          description: 'JSON-serializable value to remember.',
        },
        scope: {
          type: 'string',
          description: "Memory scope. Defaults to 'app:{appId}'. Use 'user' for cross-app memory.",
        },
      },
      required: ['key', 'value'],
    },
  },
  {
    name: 'ultralight.recall',
    title: 'Recall (Cross-App)',
    description: "Retrieve a value from user's cross-app memory. Defaults to app-scoped. Use scope='user' for cross-app memory.",
    inputSchema: {
      type: 'object',
      properties: {
        key: {
          type: 'string',
          description: 'Memory key to recall.',
        },
        scope: {
          type: 'string',
          description: "Memory scope. Defaults to 'app:{appId}'. Use 'user' for cross-app memory.",
        },
      },
      required: ['key'],
    },
    outputSchema: {
      description: 'The remembered value, or null if not found.',
    },
  },

  // ---- AI ----
  {
    name: 'ultralight.ai',
    title: 'Call AI Model',
    description: 'Call an AI model. Requires BYOK (Bring Your Own Key) to be enabled.',
    inputSchema: {
      type: 'object',
      properties: {
        messages: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              role: {
                type: 'string',
                enum: ['system', 'user', 'assistant'],
              },
              content: { type: 'string' },
            },
            required: ['role', 'content'],
          },
          description: 'Conversation messages.',
        },
        model: {
          type: 'string',
          description: 'Model ID (default: gpt-4).',
        },
        temperature: {
          type: 'number',
          description: 'Sampling temperature (0-2).',
        },
        max_tokens: {
          type: 'number',
          description: 'Maximum tokens to generate.',
        },
      },
      required: ['messages'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string' },
        model: { type: 'string' },
        usage: {
          type: 'object',
          properties: {
            input_tokens: { type: 'number' },
            output_tokens: { type: 'number' },
            cost_light: { type: 'number' },
          },
        },
      },
    },
  },

  // ---- Inter-App Calls ----
  {
    name: 'ultralight.call',
    title: 'Call Another App',
    description:
      'Call a function on another Ultralight app. Uses the current user\'s auth context — ' +
      'the called app sees the same user. Accepts app ID or slug as the target.',
    inputSchema: {
      type: 'object',
      properties: {
        app_id: {
          type: 'string',
          description: 'App ID or slug of the target app.',
        },
        function_name: {
          type: 'string',
          description: 'Function name to call on the target app (unprefixed, e.g. "doThing" not "app-slug_doThing").',
        },
        args: {
          type: 'object',
          description: 'Arguments to pass to the function.',
          additionalProperties: true,
        },
      },
      required: ['app_id', 'function_name'],
    },
    outputSchema: {
      description: 'The return value from the called function.',
    },
  },

];

// ============================================
// MAIN MCP HANDLER
// ============================================

/**
 * Handle MCP JSON-RPC requests
 * POST /mcp/:appId
 */
export async function handleMcp(request: Request, appId: string): Promise<Response> {
  const method = request.method;

  // Streamable HTTP transport: GET opens SSE stream (not supported yet), DELETE terminates session
  if (method === 'DELETE') {
    // Session termination — we're stateless, so just acknowledge
    return new Response(null, { status: 200 });
  }

  if (method === 'GET') {
    // SSE stream for server-initiated notifications — not supported yet
    return new Response(JSON.stringify({ error: 'SSE stream not supported. Use POST for MCP requests.' }), {
      status: 405,
      headers: { 'Allow': 'POST, DELETE', 'Content-Type': 'application/json' },
    });
  }

  if (method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed.' }), {
      status: 405,
      headers: { 'Allow': 'POST, GET, DELETE', 'Content-Type': 'application/json' },
    });
  }

  // Streamable HTTP: read client protocol version (don't enforce — backward compatible)
  const _clientProtocolVersion = request.headers.get('MCP-Protocol-Version');

  // Parse JSON-RPC request
  let rpcRequest: JsonRpcRequest;
  try {
    rpcRequest = await request.json();
  } catch {
    return jsonRpcErrorResponse(null, PARSE_ERROR, 'Parse error: Invalid JSON');
  }

  // Validate JSON-RPC format
  if (rpcRequest.jsonrpc !== '2.0' || !rpcRequest.method) {
    return jsonRpcErrorResponse(
      rpcRequest.id ?? null,
      INVALID_REQUEST,
      'Invalid Request: Missing jsonrpc version or method'
    );
  }

  // Phase 2A+2B: Authenticate user AND load app in parallel (independent calls)
  const appsService = createAppsService();
  let userId: string;
  let user: UserContext | null = null;
  let tokenAppIds: string[] | null = null;
  let tokenFunctionNames: string[] | null = null;

  // Support token-in-URL: if no Authorization header, check ?token= query param
  // This lets users share a single MCP endpoint URL that works without separate auth config
  let authRequest = request;
  if (!request.headers.get('Authorization')) {
    const url = new URL(request.url);
    const urlToken = url.searchParams.get('token');
    if (urlToken) {
      const headers = new Headers(request.headers);
      headers.set('Authorization', `Bearer ${urlToken}`);
      authRequest = new Request(request.url, { method: request.method, headers, body: request.body });
    }
  }

  // Run auth and app lookup concurrently — they have no dependency on each other
  let authUser: AuthResult;
  let app: App | null;

  try {
    [authUser, app] = await Promise.all([
      authenticate(authRequest),
      appsService.findById(appId),
    ]);
  } catch (authErr) {
    // If findById fails it throws, but authenticate errors are the common case
    const message = authErr instanceof Error ? authErr.message : 'Authentication required';

    // Classify the auth error for client-side handling
    let errorType = 'AUTH_REQUIRED';
    if (message.includes('expired')) {
      errorType = 'AUTH_TOKEN_EXPIRED';
    } else if (message.includes('Missing') || message.includes('invalid authorization')) {
      errorType = 'AUTH_MISSING_TOKEN';
    } else if (message.includes('Invalid JWT') || message.includes('decode')) {
      errorType = 'AUTH_INVALID_TOKEN';
    } else if (message.includes('Invalid or expired API token')) {
      errorType = 'AUTH_API_TOKEN_INVALID';
    }

    console.error(`MCP auth failed [${errorType}]:`, message, {
      appId,
      method: rpcRequest.method,
      hasAuthHeader: !!request.headers.get('Authorization'),
    });

    const reqUrl = new URL(request.url);
    const host = request.headers.get('host') || reqUrl.host;
    const proto = request.headers.get('x-forwarded-proto') || (host.includes('localhost') ? 'http' : 'https');
    const baseUrl = `${proto}://${host}`;
    const authErrorResponse = jsonRpcErrorResponse(
      rpcRequest.id,
      -32001,
      message,
      { type: errorType }
    );
    // MCP spec: 401 must include WWW-Authenticate pointing to resource metadata
    const authHeaders = new Headers(authErrorResponse.headers);
    authHeaders.set('WWW-Authenticate', `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"`);
    return new Response(authErrorResponse.body, {
      status: 401,
      headers: authHeaders,
    });
  }

  // Process auth result
  userId = authUser.id;
  tokenAppIds = authUser.tokenAppIds || null;
  tokenFunctionNames = authUser.tokenFunctionNames || null;

  // Extract display name and avatar from JWT user_metadata (not available on authenticate() return type)
  let displayName: string | null = authUser.email.split('@')[0];
  let avatarUrl: string | null = null;
  const token = request.headers.get('Authorization')?.slice(7) || '';
  if (token && !isApiToken(token)) {
    try {
      const parts = token.split('.');
      if (parts.length === 3) {
        const base64Payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        const padded = base64Payload + '='.repeat((4 - base64Payload.length % 4) % 4);
        const payload = JSON.parse(atob(padded));
        const meta = payload.user_metadata || {};
        displayName = meta.full_name || meta.name || displayName;
        avatarUrl = meta.avatar_url || meta.picture || null;
      }
    } catch { /* JWT metadata extraction is best-effort */ }
  }

  user = {
    id: authUser.id,
    email: authUser.email,
    displayName,
    avatarUrl,
    tier: toTier(authUser.tier),
    provisional: authUser.provisional || false,
  };

  // Update last_active_at for provisional users (fire-and-forget)
  if (authUser.provisional) {
    updateLastActive(userId);
  }

  // Validate app result
  if (!app) {
    return jsonRpcErrorResponse(rpcRequest.id, -32002, 'App not found');
  }

  // Hosting suspension flag: suspended apps still serve calls, but revenue
  // goes to the owner's (negative) balance to recover hosting debt.
  // When enough per-call revenue pushes balance positive, auto-unsuspend.
  const isSuspended = app.hosting_suspended === true;

  // Token scoping: if the API token is scoped to specific apps, enforce it
  if (tokenAppIds && tokenAppIds.length > 0 && !tokenAppIds.includes('*')) {
    if (!tokenAppIds.includes(appId) && !tokenAppIds.includes(app.slug)) {
      return jsonRpcErrorResponse(
        rpcRequest.id,
        -32003,
        `Token not authorized for this app. Scoped to: ${tokenAppIds.join(', ')}`
      );
    }
  }

  // Scope enforcement: require apps:call scope for tools/call
  if (rpcRequest.method === 'tools/call') {
    const scopes = authUser.scopes || ['*'];
    if (!scopes.includes('*') && !scopes.includes('apps:call')) {
      return jsonRpcErrorResponse(
        rpcRequest.id,
        -32003,
        'Token missing required scope: apps:call'
      );
    }
  }

  // Phase 2B: Run gate checks in parallel — rate limit, weekly calls, per-app RL, permissions
  // All depend on userId (from auth) and app (from findById), both now resolved
  {
    const isToolsCall = rpcRequest.method === 'tools/call';
    const isNonOwner = app.owner_id !== userId;
    const rlConfig = app.rate_limit_config as { calls_per_minute?: number; calls_per_day?: number } | null;
    const endpointRateLimitOptions = isToolsCall
      ? { mode: 'fail_closed' as const, resource: 'MCP tools/call rate limit' }
      : undefined;

    // Build array of gate checks to run in parallel
    const gateChecks = await Promise.all([
      // [0] Per-endpoint rate limit (always)
      checkRateLimit(userId, `mcp:${rpcRequest.method}`, undefined, undefined, endpointRateLimitOptions),
      // [1] Weekly call limit (tools/call only)
      isToolsCall
        ? checkAndIncrementWeeklyCalls(userId, toTier(user.tier), {
          mode: 'fail_closed',
          resource: 'MCP weekly call limit',
        })
        : null,
      // [2] Per-app minute rate limit (tools/call, non-owner, if configured)
      isToolsCall && isNonOwner && rlConfig?.calls_per_minute
        ? checkRateLimit(userId, `app:${appId}:minute`, rlConfig.calls_per_minute, 1, {
          mode: 'fail_closed',
          resource: 'MCP app minute rate limit',
        }) : null,
      // [3] Per-app daily rate limit (tools/call, non-owner, if configured)
      isToolsCall && isNonOwner && rlConfig?.calls_per_day
        ? checkRateLimit(userId, `app:${appId}:day`, rlConfig.calls_per_day, 1440, {
          mode: 'fail_closed',
          resource: 'MCP app daily rate limit',
        }) : null,
      // [4] Visibility/permissions (private apps, non-owner)
      app.visibility === 'private' && isNonOwner
        ? getPermissionsForUser(userId, app.id, app.owner_id, app.visibility) : undefined,
      // [5] Provisional daily call limit (tools/call, provisional users only)
      isToolsCall && user?.provisional
        ? checkProvisionalDailyLimit(userId) : null,
    ]);

    // Check results — return first error found
    const [endpointRL, weeklyRL, appMinuteRL, appDayRL, perms, provisionalRL] = gateChecks;

    if (!endpointRL.allowed) {
      if (endpointRL.reason === 'service_unavailable') {
        return jsonRpcErrorResponse(
          rpcRequest.id,
          INTERNAL_ERROR,
          'Usage controls are temporarily unavailable. Please try again shortly.',
        );
      }
      return jsonRpcErrorResponse(
        rpcRequest.id, RATE_LIMITED,
        `Rate limit exceeded. Try again after ${endpointRL.resetAt.toISOString()}`
      );
    }
    if (weeklyRL && !weeklyRL.allowed) {
      if (weeklyRL.reason === 'service_unavailable') {
        return jsonRpcErrorResponse(
          rpcRequest.id,
          INTERNAL_ERROR,
          'Usage controls are temporarily unavailable. Please try again shortly.',
        );
      }
      return jsonRpcErrorResponse(
        rpcRequest.id, RATE_LIMITED,
        `Too many requests. Please try again later or upgrade to Pro.`
      );
    }
    if (appMinuteRL && !appMinuteRL.allowed) {
      if (appMinuteRL.reason === 'service_unavailable') {
        return jsonRpcErrorResponse(
          rpcRequest.id,
          INTERNAL_ERROR,
          'App usage controls are temporarily unavailable. Please try again shortly.',
        );
      }
      return jsonRpcErrorResponse(
        rpcRequest.id, RATE_LIMITED,
        `App rate limit exceeded (${rlConfig!.calls_per_minute}/min). Try again after ${appMinuteRL.resetAt.toISOString()}`
      );
    }
    if (appDayRL && !appDayRL.allowed) {
      if (appDayRL.reason === 'service_unavailable') {
        return jsonRpcErrorResponse(
          rpcRequest.id,
          INTERNAL_ERROR,
          'App usage controls are temporarily unavailable. Please try again shortly.',
        );
      }
      return jsonRpcErrorResponse(
        rpcRequest.id, RATE_LIMITED,
        `App daily limit exceeded (${rlConfig!.calls_per_day}/day). Try again tomorrow.`
      );
    }
    if (perms !== undefined && perms !== null && perms.allowed.size === 0) {
      return jsonRpcErrorResponse(rpcRequest.id, -32002, 'App not found');
    }
    if (provisionalRL && !provisionalRL.allowed) {
      if (provisionalRL.reason === 'service_unavailable') {
        return jsonRpcErrorResponse(
          rpcRequest.id,
          INTERNAL_ERROR,
          'Provisional usage controls are temporarily unavailable. Please try again shortly.',
        );
      }
      return jsonRpcErrorResponse(
        rpcRequest.id, RATE_LIMITED,
        `Provisional account daily limit reached (50 calls/day). Sign in at ultralight-api.rgn4jz429m.workers.dev to unlock full access.`
      );
    }
  }

  // Route to method handler
  const { method: rpcMethod, params, id } = rpcRequest;

  try {
    switch (rpcMethod) {
      case 'initialize': {
        const response = handleInitialize(id, appId, app);
        // Streamable HTTP: assign a session ID on initialize
        const sessionId = crypto.randomUUID();
        const headers = new Headers(response.headers);
        headers.set('Mcp-Session-Id', sessionId);
        return new Response(response.body, { status: response.status, headers });
      }

      case 'notifications/initialized':
        // Client acknowledgment after initialize — no response body needed
        return new Response(null, { status: 202 });

      case 'tools/list':
        return await handleToolsList(id, app, params, userId);

      case 'tools/call':
        return await handleToolsCall(id, app, params, userId, user, request, tokenFunctionNames);

      case 'resources/list':
        return handleResourcesList(id, appId, app);

      case 'resources/read':
        return await handleResourcesRead(id, appId, app, params, userId);

      default:
        return jsonRpcErrorResponse(id, METHOD_NOT_FOUND, `Method not found: ${rpcMethod}`);
    }
  } catch (err) {
    console.error(`MCP ${rpcMethod} error:`, err);
    return jsonRpcErrorResponse(
      id,
      INTERNAL_ERROR,
      `Internal error: ${err instanceof Error ? err.message : 'Unknown error'}`
    );
  }
}

// ============================================
// METHOD HANDLERS
// ============================================

/**
 * Handle initialize request - return server capabilities
 */
function handleInitialize(
  id: JsonRpcId,
  appId: string,
  app: App,
): Response {
  // Level 2: Inline the app's Skills.md directly into the instructions field.
  // This guarantees agents receive function signatures, parameter types, and usage
  // examples even if they never call resources/read. The skills_md is auto-generated
  // per app and is typically 1-3KB (~300-800 tokens) — compact enough to inline.
  //
  // If skills_md isn't generated yet (new app, still building), fall back to the
  // description + a directive to check resources/read.
  let instructions: string;

  if (app.skills_md) {
    // Inline the full auto-generated Skills.md — it's already concise
    instructions = app.skills_md;
  } else {
    // Skills.md not yet generated — use description + resource directive
    instructions = (app.description || `${app.name || app.slug} — an Ultralight MCP server.`) +
      `\n\nCall resources/read with uri "ultralight://app/${appId}/skills.md" ` +
      'to load full documentation once available.';
  }

  const result: MCPServerInfo = {
    protocolVersion: '2025-03-26',
    capabilities: {
      tools: { listChanged: false },
      resources: { subscribe: false, listChanged: false },
    },
    serverInfo: {
      name: app.name || app.slug,
      version: '1.0.0',
    },
    instructions: instructions,
  };

  return jsonRpcResponse(id, result);
}

/**
 * Handle resources/list request - return available resources for this app
 */
function handleResourcesList(
  id: JsonRpcId,
  appId: string,
  app: App,
): Response {
  const resources: MCPResourceDescriptor[] = [];

  // Skills.md — auto-generated function documentation
  if (app.skills_md) {
    resources.push({
      uri: `ultralight://app/${appId}/skills.md`,
      name: `${app.name || app.slug} — Skills & Usage Guide`,
      description: 'Auto-generated documentation: function signatures, parameters, return types, and usage examples. Read this before calling tools.',
      mimeType: 'text/markdown',
    });
  }

  // Phase 1B: Manifest — structured function schemas + app metadata
  resources.push({
    uri: `ultralight://app/${appId}/manifest.json`,
    name: `${app.name || app.slug} — App Manifest`,
    description: 'Function definitions, parameter schemas, and app configuration. Machine-readable complement to skills.md.',
    mimeType: 'application/json',
  });

  // Phase 2A: Storage — browsable app data
  resources.push({
    uri: `ultralight://app/${appId}/data`,
    name: `${app.name || app.slug} — Stored Data`,
    description: 'List of all storage keys for this app. Read individual keys at ultralight://app/{appId}/data/{key}.',
    mimeType: 'application/json',
  });

  return jsonRpcResponse(id, { resources });
}

/**
 * Handle resources/read request - return resource content
 */
async function handleResourcesRead(
  id: JsonRpcId,
  appId: string,
  app: App,
  params: unknown,
  userId?: string
): Promise<Response> {
  const readParams = params as { uri?: string } | undefined;
  const uri = readParams?.uri;

  if (!uri) {
    return jsonRpcErrorResponse(id, INVALID_PARAMS, 'Missing required parameter: uri');
  }

  // Skills.md — auto-generated function documentation
  const expectedSkillsUri = `ultralight://app/${appId}/skills.md`;
  if (uri === expectedSkillsUri) {
    if (!app.skills_md) {
      return jsonRpcErrorResponse(id, -32002, 'Skills.md not yet generated for this app');
    }

    const contents: MCPResourceContent[] = [{
      uri: uri,
      mimeType: 'text/markdown',
      text: app.skills_md,
    }];

    return jsonRpcResponse(id, { contents });
  }

  // Phase 1B: Manifest — structured function schemas + runtime metadata
  if (uri === `ultralight://app/${appId}/manifest.json`) {
    let manifest: Record<string, unknown> = {};
    if (app.manifest) {
      try {
        manifest = JSON.parse(app.manifest);
      } catch { /* invalid manifest JSON, return empty */ }
    }
    // Enrich with runtime metadata
    manifest._meta = {
      app_id: appId,
      name: app.name,
      slug: app.slug,
      version: app.current_version || null,
      visibility: app.visibility || null,
      exports: app.exports || [],
      total_runs: app.total_runs || 0,
    };

    const contents: MCPResourceContent[] = [{
      uri: uri,
      mimeType: 'application/json',
      text: JSON.stringify(manifest, null, 2),
    }];
    return jsonRpcResponse(id, { contents });
  }

  // Phase 2A: Storage key listing
  if (uri === `ultralight://app/${appId}/data`) {
    if (!userId) {
      return jsonRpcErrorResponse(id, AUTH_REQUIRED, 'Authentication required to access app storage');
    }
    try {
      const appData = createAppDataService(appId, userId);
      const keys = await appData.list();
      const contents: MCPResourceContent[] = [{
        uri: uri,
        mimeType: 'application/json',
        text: JSON.stringify({ keys, count: keys.length }),
      }];
      return jsonRpcResponse(id, { contents });
    } catch (err) {
      return jsonRpcErrorResponse(id, INTERNAL_ERROR, `Failed to list storage keys: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }

  // Phase 2A: Individual storage key read
  const dataPrefix = `ultralight://app/${appId}/data/`;
  if (uri.startsWith(dataPrefix)) {
    if (!userId) {
      return jsonRpcErrorResponse(id, AUTH_REQUIRED, 'Authentication required to access app storage');
    }
    const key = decodeURIComponent(uri.slice(dataPrefix.length));
    if (!key) {
      return jsonRpcErrorResponse(id, INVALID_PARAMS, 'Missing key in URI');
    }
    try {
      const appData = createAppDataService(appId, userId);
      const value = await appData.load(key);
      if (value === null || value === undefined) {
        return jsonRpcErrorResponse(id, NOT_FOUND, `Storage key not found: ${key}`);
      }
      const contents: MCPResourceContent[] = [{
        uri: uri,
        mimeType: 'application/json',
        text: JSON.stringify(value),
      }];
      return jsonRpcResponse(id, { contents });
    } catch (err) {
      return jsonRpcErrorResponse(id, INTERNAL_ERROR, `Failed to read storage key: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }

  return jsonRpcErrorResponse(id, -32002, `Resource not found: ${uri}`);
}

/**
 * Handle tools/list request - return available tools
 */
async function handleToolsList(
  id: JsonRpcId,
  app: App,
  params?: { cursor?: string },
  callerUserId?: string
): Promise<Response> {
  const tools: MCPTool[] = [];

  // First, try to get tools from manifest (v2 architecture)
  if (app.manifest) {
    try {
      const manifest = JSON.parse(app.manifest) as AppManifest;
      if (manifest.functions && manifest.type === 'mcp') {
        const manifestTools = manifestToMCPTools(manifest, app.id, app.slug);
        tools.push(...manifestTools);
      }
    } catch (err) {
      console.error('Failed to parse manifest for tools list:', err);
    }
  }

  // Fall back to skills_parsed if no manifest tools found (legacy behavior)
  if (tools.length === 0 && app.skills_parsed?.functions) {
    for (const fn of app.skills_parsed.functions) {
      tools.push(skillFunctionToMCPTool(fn));
    }
  }

  // GPU apps: generate tools from exports (Python function names)
  if (tools.length === 0 && app.runtime === 'gpu' && app.exports.length > 0) {
    for (const exportName of app.exports) {
      tools.push({
        name: exportName,
        description: `GPU function: ${exportName}`,
        inputSchema: {
          type: 'object' as const,
          properties: {},
          additionalProperties: true,
        },
      });
    }
  }

  // Permission filtering for private apps: only show allowed functions to non-owners
  if (callerUserId && app.visibility === 'private') {
    const permsResult = await getPermissionsForUser(callerUserId, app.id, app.owner_id, app.visibility);
    if (permsResult !== null) {
      // Filter tools to only include allowed functions
      // SDK tools (ultralight.*) are always shown
      const filteredTools = tools.filter(tool =>
        tool.name.startsWith('ultralight.') || permsResult.allowed.has(tool.name)
      );
      tools.length = 0;
      tools.push(...filteredTools);
    }
  }

  // Add SDK tools (always included)
  tools.push(...SDK_TOOLS);

  // ── GPU tool enrichment ──
  // If this is a GPU app, annotate tools with cost + latency hints
  if (app.runtime === 'gpu') {
    const gpuType = app.gpu_type || 'GPU';
    const benchmark = app.gpu_benchmark as Record<string, unknown> | null;

    for (const tool of tools) {
      // Skip SDK tools
      if (tool.name.startsWith('ultralight.')) continue;

      // Add GPU context to description
      const avgMs = benchmark?.mean_ms as number | undefined;
      const avgDisplay = avgMs ? `~${(avgMs / 1000).toFixed(1)}s` : 'variable';
      const gpuSuffix = `\n\n⚡ GPU function (${gpuType}, ${avgDisplay})`;
      tool.description = (tool.description || '') + gpuSuffix;

      // Set annotations: GPU tools are never read-only, not idempotent, open-world
      tool.annotations = {
        ...tool.annotations,
        readOnlyHint: false,
        idempotentHint: false,
        openWorldHint: true,
      };
    }
  }

  const result: MCPToolsListResponse = {
    tools,
    // No pagination for now
  };

  return jsonRpcResponse(id, result);
}

/**
 * Handle tools/call request - execute a tool
 */
async function handleToolsCall(
  id: JsonRpcId,
  app: App,
  params: unknown,
  userId: string,
  user: UserContext | null,
  request: Request,
  tokenFunctionNames?: string[] | null
): Promise<Response> {
  // Validate params
  const callParams = params as MCPToolCallRequest | undefined;
  if (!callParams?.name) {
    return jsonRpcErrorResponse(id, INVALID_PARAMS, 'Missing tool name');
  }

  const { name, arguments: args } = callParams;

  // Check if it's an SDK tool (always allowed) — supports both ultralight.* and ul.* prefixes
  if (name.startsWith('ultralight.') || name.startsWith('ul.')) {
    return await executeSDKTool(id, name, args || {}, app.id, app.owner_id, userId, user, request);
  }

  // Token function scoping: if the API token restricts callable functions, enforce it
  if (tokenFunctionNames && tokenFunctionNames.length > 0 && !tokenFunctionNames.includes('*')) {
    // Extract the raw function name from prefixed tool name (slug_functionName)
    const prefix = `${app.slug}_`;
    const rawName = name.startsWith(prefix) ? name.slice(prefix.length) : name;
    if (!tokenFunctionNames.includes(name) && !tokenFunctionNames.includes(rawName)) {
      return jsonRpcErrorResponse(
        id,
        -32003,
        `Token not authorized for function '${rawName}'. Scoped to: ${tokenFunctionNames.join(', ')}`
      );
    }
  }

  // Permission check: for private apps, verify non-owner has access to this function
  // Also enforce granular constraints (IP, time window, budget, expiry, arg whitelist) — Pro feature
  if (app.visibility === 'private') {
    const permsResult = await getPermissionsForUser(userId, app.id, app.owner_id, app.visibility);
    if (permsResult !== null) {
      if (!permsResult.allowed.has(name)) {
        return jsonRpcErrorResponse(
          id,
          -32003,
          `Permission denied: you do not have access to '${name}'. Ask the app owner to grant you access.`
        );
      }

      // Enforce granular constraints on the matching permission row
      const { checkConstraints } = await import('../services/constraints.ts');
      const matchingRow = permsResult.rows.find(r => r.function_name === name && r.allowed);
      if (matchingRow) {
        const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
          || request.headers.get('x-real-ip')
          || null;
        // Pass call arguments for argument-value whitelist enforcement
        const callArgs = (args && typeof args === 'object') ? args as Record<string, unknown> : undefined;
        const constraintResult = checkConstraints(matchingRow, clientIp, undefined, callArgs);
        if (!constraintResult.allowed) {
          return jsonRpcErrorResponse(
            id,
            -32003,
            `Permission denied: ${constraintResult.reason}`
          );
        }

        // Increment budget_used atomically if budget_limit is set
        if (matchingRow.budget_limit !== null && matchingRow.budget_limit > 0) {
          const sbUrl = getEnv('SUPABASE_URL');
          const sbKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');
          try {
            // Use Supabase RPC for atomic increment to avoid race conditions
            const rpcRes = await fetch(`${sbUrl}/rest/v1/rpc/increment_budget_used`, {
              method: 'POST',
              headers: {
                'apikey': sbKey,
                'Authorization': `Bearer ${sbKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                p_user_id: userId,
                p_app_id: app.id,
                p_function_name: name,
              }),
            });
            if (!rpcRes.ok) {
              // Fallback: use PostgREST PATCH with atomic SQL expression
              // PostgREST doesn't support SET col = col + 1 directly,
              // so we await the non-atomic version but log a warning
              console.warn('Budget RPC not available, falling back to non-atomic increment');
              await fetch(`${sbUrl}/rest/v1/user_app_permissions?granted_to_user_id=eq.${userId}&app_id=eq.${app.id}&function_name=eq.${encodeURIComponent(name)}`, {
                method: 'PATCH',
                headers: {
                  'apikey': sbKey,
                  'Authorization': `Bearer ${sbKey}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  budget_used: (matchingRow.budget_used || 0) + 1,
                  updated_at: new Date().toISOString(),
                }),
              });
            }
          } catch (err) {
            console.error('Budget increment failed:', err);
          }

          // Keep permission cache in sync with local budget increment
          getPermissionCache().incrementBudget(userId, app.id, name);
        }
      }
    }
  }

  // Determine the actual function name to execute
  let functionName = name;
  let isManifestFunction = false;

  // Check if it's a manifest-based tool (format: appSlug_functionName or just functionName)
  if (app.manifest) {
    try {
      const manifest = JSON.parse(app.manifest) as AppManifest;
      const prefix = `${app.slug}_`;
      if (name.startsWith(prefix) && manifest.functions) {
        // Prefixed name: strip slug prefix
        const fnName = name.slice(prefix.length);
        if (fnName in manifest.functions) {
          functionName = fnName;
          isManifestFunction = true;
        }
      } else if (manifest.functions && name in manifest.functions) {
        // Unprefixed name: use directly (supports in-chat widget bridge calls)
        functionName = name;
        isManifestFunction = true;
      }
    } catch (err) {
      console.error('Failed to parse manifest for tool call:', err);
    }
  }

  // Fall back to skills_parsed check (legacy behavior)
  if (!isManifestFunction) {
    const appFunction = app.skills_parsed?.functions.find(f => f.name === name);
    // GPU apps: allow any exported function name
    const isGpuExport = app.runtime === 'gpu' && app.exports.includes(name);
    if (!appFunction && !isGpuExport) {
      return jsonRpcErrorResponse(id, INVALID_PARAMS, `Unknown tool: ${name}`);
    }
  }

  // Extract agent meta (e.g. _user_query, _session_id) before passing to sandbox
  const { extractCallMeta } = await import('../services/call-logger.ts');
  const { cleanArgs, userQuery, sessionId } = extractCallMeta(args || {});

  // Extract auth token from request for inter-app calls (ultralight.call)
  const authToken = request.headers.get('Authorization')?.slice(7) || undefined;

  // Execute app function via sandbox
  return await executeAppFunction(id, functionName, cleanArgs, app, userId, user, { userQuery, sessionId, authToken });
}

// ============================================
// TOOL EXECUTION
// ============================================

/**
 * Execute an SDK tool (ultralight.*)
 */
async function executeSDKTool(
  id: JsonRpcId,
  toolName: string,
  args: Record<string, unknown>,
  appId: string,
  appOwnerId: string,
  userId: string,
  user: UserContext | null,
  request?: Request
): Promise<Response> {
  try {
    // Create app data service — use Worker-backed service if configured (native R2, ~10x faster)
    // Wrap with metered service when userId is present to track user data storage.
    const _workerUrl = getEnv('WORKER_DATA_URL');
    const _workerSecret = getEnv('WORKER_SECRET');
    const _rawAppDataService = (_workerUrl && _workerSecret)
      ? createWorkerAppDataService(appId, userId, _workerUrl, _workerSecret)
      : createAppDataService(appId, userId);
    const appDataService = userId
      ? createMeteredAppDataService(_rawAppDataService, userId)
      : _rawAppDataService;

    let result: unknown;

    switch (toolName) {
      // Skills (documentation)
      case 'ultralight.getSkills': {
        const appsService = createAppsService();
        const app = await appsService.findById(appId);
        result = {
          skills_md: app?.skills_md || 'Skills.md not yet generated for this app.',
          app_name: app?.name || app?.slug || appId,
          app_id: appId,
        };
        break;
      }

      // Storage
      case 'ultralight.store': {
        const storeKey = args.key as string;
        await appDataService.store(storeKey, args.value);
        // Index KV data for semantic search (fire-and-forget)
        indexAppKV(appId, appOwnerId, storeKey, args.value).catch(err =>
          console.error('[KV-INDEX] App KV index failed:', err)
        );
        result = { success: true };
        break;
      }

      case 'ultralight.load':
        result = await appDataService.load(args.key as string);
        break;

      case 'ultralight.list':
        result = await appDataService.list(args.prefix as string | undefined);
        break;

      case 'ultralight.query':
        result = await appDataService.query(args.prefix as string, {
          limit: args.limit as number | undefined,
          offset: args.offset as number | undefined,
        });
        break;

      case 'ultralight.remove': {
        const removeKey = args.key as string;
        await appDataService.remove(removeKey);
        // Clean up content index (fire-and-forget)
        removeKVIndex(appOwnerId, 'app_kv', `${appId}/${removeKey}`).catch(err =>
          console.error('[KV-INDEX] App KV remove failed:', err)
        );
        result = { success: true };
        break;
      }

      // Memory (cross-app)
      case 'ultralight.remember': {
        const memService = getMemoryService();
        if (!memService) {
          result = { success: false, error: 'Memory service not available' };
          break;
        }
        const scope = args.scope as string || `app:${appId}`;
        const rememberKey = args.key as string;
        await memService.remember(userId, scope, rememberKey, args.value);
        // Index user KV data for semantic search (fire-and-forget)
        indexUserKV(userId, scope, rememberKey, args.value).catch(err =>
          console.error('[KV-INDEX] User KV index failed:', err)
        );
        result = { success: true, key: rememberKey, scope };
        break;
      }

      case 'ultralight.recall': {
        const memService = getMemoryService();
        if (!memService) {
          result = null;
          break;
        }
        const scope = args.scope as string || `app:${appId}`;
        result = await memService.recall(userId, scope, args.key as string);
        break;
      }

      // AI
      case 'ultralight.ai': {
        // Get user's BYOK configuration
        const userService = createUserService();
        const userProfile = await userService.getUser(userId);

        if (!userProfile?.byok_enabled || !userProfile.byok_provider) {
          result = {
            content: '',
            model: 'none',
            usage: { input_tokens: 0, output_tokens: 0, cost_light: 0 },
            error: 'BYOK not configured. Please add your API key in Settings.',
          };
          break;
        }

        // Get the decrypted API key for the user's primary provider
        const apiKey = await userService.getDecryptedApiKey(userId, userProfile.byok_provider);
        if (!apiKey) {
          result = {
            content: '',
            model: 'none',
            usage: { input_tokens: 0, output_tokens: 0, cost_light: 0 },
            error: 'API key not found. Please re-add your API key in Settings.',
          };
          break;
        }

        // Create AI service with user's provider and key
        const aiService = createAIService(userProfile.byok_provider, apiKey);
        const aiMessages = toAiMessages(args.messages);
        if (!aiMessages) {
          result = {
            content: '',
            model: 'none',
            usage: { input_tokens: 0, output_tokens: 0, cost_light: 0 },
            error: 'Invalid messages payload. Expected an array of AI messages.',
          };
          break;
        }

        // Make the AI call
        try {
          result = await aiService.call({
            messages: aiMessages,
            model: args.model as string | undefined,
            temperature: args.temperature as number | undefined,
            max_tokens: args.max_tokens as number | undefined,
            tools: args.tools as Array<{ name: string; description: string; parameters: Record<string, unknown> }> | undefined,
          });
        } catch (aiError) {
          result = {
            content: '',
            model: args.model || 'unknown',
            usage: { input_tokens: 0, output_tokens: 0, cost_light: 0 },
            error: aiError instanceof Error ? aiError.message : 'AI call failed',
          };
        }
        break;
      }

      // Inter-app calls
      case 'ultralight.call': {
        const targetAppId = args.app_id as string;
        const targetFn = args.function_name as string;
        const callArgs = (args.args as Record<string, unknown>) || {};

        if (!targetAppId || !targetFn) {
          result = { error: 'app_id and function_name are required' };
          break;
        }

        const baseUrl = getEnv('BASE_URL');
        const authToken = request?.headers.get('Authorization')?.slice(7);

        if (!baseUrl || !authToken) {
          result = { error: 'Inter-app calls not available (missing baseUrl or authToken)' };
          break;
        }

        // Make JSON-RPC call to target app's MCP endpoint
        const rpcRequest = {
          jsonrpc: '2.0',
          id: crypto.randomUUID(),
          method: 'tools/call',
          params: {
            name: targetFn,
            arguments: callArgs,
          },
        };

        const callResponse = await fetch(`${baseUrl}/mcp/${targetAppId}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`,
          },
          body: JSON.stringify(rpcRequest),
        });

        if (!callResponse.ok) {
          const errText = await callResponse.text().catch(() => callResponse.statusText);
          result = { error: `Call failed (${callResponse.status}): ${errText}` };
          break;
        }

        const rpcResponse = await readJsonResponse<JsonRpcResponse>(callResponse);
        if (rpcResponse.error) {
          result = { error: `RPC error: ${rpcResponse.error.message || JSON.stringify(rpcResponse.error)}` };
          break;
        }

        // Unwrap MCP tool result
        const callResult = rpcResponse.result as MCPToolCallResponse | undefined;
        if (callResult?.content && Array.isArray(callResult.content)) {
          const textBlock = callResult.content.find((c) => c.type === 'text');
          if (textBlock?.text) {
            try {
              result = JSON.parse(textBlock.text);
            } catch {
              result = textBlock.text;
            }
          } else {
            result = callResult;
          }
        } else {
          result = callResult;
        }
        break;
      }

      // Async job polling — mirrors ul.job from platform-mcp
      case 'ultralight.job':
      case 'ul.job': {
        const jobId = args.job_id as string;
        if (!jobId) {
          result = { error: 'Missing required: job_id' };
          break;
        }
        const { getJob } = await import('../services/async-jobs.ts');
        const job = await getJob(jobId, userId);
        if (!job) {
          result = { error: `Job ${jobId} not found` };
          break;
        }
        if (job.status === 'running') {
          const elapsed = Date.now() - new Date(job.created_at).getTime();
          result = { job_id: jobId, status: 'running', elapsed_seconds: Math.round(elapsed / 1000), message: 'Still running. Poll again in a few seconds.' };
        } else if (job.status === 'completed') {
          result = { job_id: jobId, status: 'completed', duration_ms: job.duration_ms, result: job.result, logs: job.logs, ai_cost_light: job.ai_cost_light };
        } else {
          result = { job_id: jobId, status: 'failed', duration_ms: job.duration_ms, error: job.error };
        }
        break;
      }

      default:
        return jsonRpcErrorResponse(id, INVALID_PARAMS, `Unknown SDK tool: ${toolName}`);
    }

    return jsonRpcResponse(id, formatToolResult(result));

  } catch (err) {
    console.error(`SDK tool ${toolName} error:`, err);
    return jsonRpcResponse(id, formatToolError(err));
  }
}

/**
 * Execute an app-specific function
 */
/**
 * Handle GPU function execution — dispatches to RunPod instead of Deno sandbox.
 * Called early in executeAppFunction before code fetching (GPU apps have no JS code).
 */
async function handleGpuExecution(
  id: JsonRpcId,
  app: App,
  functionName: string,
  args: Record<string, unknown>,
  userId: string,
  user: UserContext | null,
  meta?: { userQuery?: string; sessionId?: string; authToken?: string },
): Promise<Response> {
  if (app.gpu_status !== 'live') {
    return jsonRpcErrorResponse(
      id,
      -32603,
      `GPU function is not ready (status: ${app.gpu_status ?? 'null'}). Try again later.`,
    );
  }

  // Acquire concurrency slot (429 if full after 5s wait)
  let gpuSlot;
  try {
    gpuSlot = await acquireGpuSlot(
      app.gpu_endpoint_id as string,
      (app.gpu_concurrency_limit as number) || 5,
    );
  } catch (_concurrencyErr) {
    return jsonRpcErrorResponse(
      id,
      -32000,
      'GPU function is at capacity. Please try again in a few seconds.',
      { type: 'GPU_CONCURRENCY_LIMIT' },
    );
  }

  try {
    // Execute on GPU
    const gpuExecStart = Date.now();
    const gpuResult = await executeGpuFunction({
      app,
      functionName,
      args,
      executionId: crypto.randomUUID(),
    });
    const gpuExecDuration = Date.now() - gpuExecStart;

    // Settle billing (if caller !== owner and result is chargeable)
    let gpuCallChargeLight = 0;
    let gpuSettlement;
    if (userId !== app.owner_id) {
      gpuSettlement = await settleGpuExecution(
        userId,
        app as unknown as Parameters<typeof settleGpuExecution>[1],
        functionName,
        args,
        gpuResult,
      );

      if (gpuSettlement.insufficientBalance) {
        return jsonRpcResponse(id, {
          isError: true,
          content: [{
            type: 'text',
            text: gpuSettlement.insufficientBalanceMessage!,
          }],
        });
      }
      gpuCallChargeLight = gpuSettlement.chargedLight;
    }

    // Log the call (fire-and-forget, with GPU telemetry)
    const gpuResultJson = JSON.stringify(
      gpuResult.success ? gpuResult.result : gpuResult.error,
    );
    const gpuResponseSizeBytes = new TextEncoder().encode(gpuResultJson).byteLength;
    const gpuCallSource = user?.provisional ? 'onboarding_template' : undefined;

    const { logMcpCall: logGpuMcpCall } = await import('../services/call-logger.ts');
    logGpuMcpCall({
      userId,
      appId: app.id as string,
      appName: (app.name || app.slug) as string,
      functionName,
      method: 'tools/call',
      success: gpuResult.success,
      durationMs: gpuExecDuration,
      errorMessage: gpuResult.success ? undefined : gpuResult.error?.message,
      source: gpuCallSource,
      inputArgs: args,
      outputResult: gpuResult.success ? gpuResult.result : gpuResult.error,
      userTier: user?.tier,
      appVersion: (app.current_version as string) || undefined,
      responseSizeBytes: gpuResponseSizeBytes,
      callChargeLight: gpuCallChargeLight,
      sessionId: meta?.sessionId,
      sequenceNumber: nextSequenceNumber(meta?.sessionId),
      userQuery: meta?.userQuery,
      // GPU-specific telemetry
      gpuType: gpuResult.gpuType,
      gpuExitCode: gpuResult.exitCode,
      gpuDurationMs: gpuResult.durationMs,
      gpuCostLight: gpuResult.gpuCostLight,
      gpuPeakVramGb: gpuResult.peakVramGb,
      gpuDeveloperFeeLight: gpuSettlement?.breakdown.developerFeeLight || 0,
      gpuFailurePolicy: gpuSettlement?.failurePolicy,
    });

    // Return result (same format as Deno sandbox)
    if (gpuResult.success) {
      return jsonRpcResponse(id, formatToolResult(gpuResult.result, gpuResult.logs));
    } else {
      return jsonRpcResponse(id, formatToolError(gpuResult.error));
    }
  } finally {
    gpuSlot.release();
  }
}

async function executeAppFunction(
  id: JsonRpcId,
  functionName: string,
  args: Record<string, unknown>,
  app: App,
  userId: string,
  user: UserContext | null,
  meta?: { userQuery?: string; sessionId?: string; authToken?: string }
): Promise<Response> {
  try {
    // ── GPU Runtime Branch (early return) ──
    // Must check BEFORE code fetching since GPU apps don't have JS code in R2.
    if (app.runtime === 'gpu') {
      return await handleGpuExecution(id, app, functionName, args, userId, user, meta);
    }

    const r2Service = createR2Service();
    // Use Worker-backed data service if configured (native R2 bindings, ~10x faster)
    // Wrap with metered service when userId is present to track user data storage.
    const _wUrl = getEnv('WORKER_DATA_URL');
    const _wSecret = getEnv('WORKER_SECRET');
    const _rawAppDataService2 = (_wUrl && _wSecret)
      ? createWorkerAppDataService(app.id, userId, _wUrl, _wSecret)
      : createAppDataService(app.id, userId);
    const appDataService = userId
      ? createMeteredAppDataService(_rawAppDataService2, userId)
      : _rawAppDataService2;
    const userService = createUserService();

    // Phase 2C: Run independent setup tasks in parallel
    // - Code fetch (R2, ~50-200ms on cache miss — the bottleneck)
    // - User profile for BYOK (~30ms)
    // - Env var decryption (CPU-only, ~0ms)
    // - Per-user secrets fetch (~30ms, conditional)
    // - Supabase config fetch (~30ms, conditional)

    // --- Code fetch (check in-memory cache first, fall back to R2) ---
    const codeCache = getCodeCache();
    const cachedCode = codeCache.get(app.id, app.storage_key);

    const codeFetchPromise = cachedCode
      ? Promise.resolve(cachedCode)
      : (async () => {
          console.log(`[MCP] Code cache MISS for app ${app.id}, fetching from R2 (storage_key=${app.storage_key})...`);
          const entryFiles = ['index.tsx', 'index.ts', 'index.jsx', 'index.js'];
          for (const entryFile of entryFiles) {
            try {
              const path = `${app.storage_key}${entryFile}`;
              const fetched = await r2Service.fetchTextFile(path);
              if (fetched) {
                // Log code fingerprint for debugging
                const hasGemma = fetched.includes('gemma');
                const hasSub = fetched.includes('FROM subjects sub WHERE');
                const hasOldS = fetched.includes('FROM subjects WHERE');
                console.log(`[MCP] Fetched ${path} (${fetched.length} bytes) gemma=${hasGemma} subAlias=${hasSub} oldSQL=${hasOldS}`);
                codeCache.set(app.id, app.storage_key, fetched);
                return fetched;
              }
            } catch { /* Try next */ }
          }
          return null;
        })();

    if (cachedCode) {
      console.log(`[MCP] Code cache HIT for app ${app.id} (${codeCache.stats.hitRate} hit rate)`);
    }

    // --- Env var decryption (CPU-only) ---
    const encryptedEnvVars = app.env_vars || {};
    const envVarsPromise = decryptEnvVars(encryptedEnvVars).catch(err => {
      console.error('Failed to decrypt env vars:', err);
      return {} as Record<string, string>;
    });

    // --- Per-user secrets fetch (conditional) ---
    const envSchema = resolveAppEnvSchema(app);
    const perUserKeys = Object.entries(envSchema)
      .filter(([, v]) => v.scope === 'per_user')
      .map(([k]) => k);
    const _SUPABASE_URL = getEnv('SUPABASE_URL');
    const _SUPABASE_SERVICE_ROLE_KEY = getEnv('SUPABASE_SERVICE_ROLE_KEY');

    const secretsPromise = perUserKeys.length > 0
      ? fetch(
          `${_SUPABASE_URL}/rest/v1/user_app_secrets?user_id=eq.${userId}&app_id=eq.${app.id}&select=key,value_encrypted`,
          { headers: { 'apikey': _SUPABASE_SERVICE_ROLE_KEY, 'Authorization': `Bearer ${_SUPABASE_SERVICE_ROLE_KEY}` } }
        ).then(res => res.ok ? res.json() as Promise<Array<{ key: string; value_encrypted: string }>> : [])
         .catch(() => [] as Array<{ key: string; value_encrypted: string }>)
      : Promise.resolve([] as Array<{ key: string; value_encrypted: string }>);

    // --- Supabase config fetch (conditional) ---
    const supabaseConfigPromise = (async (): Promise<{ url: string; anonKey: string; serviceKey?: string } | undefined> => {
      // Prefer config_id (new model)
      if (app.supabase_config_id) {
        try {
          const { getDecryptedSupabaseConfig } = await import('./user.ts');
          const config = await getDecryptedSupabaseConfig(app.supabase_config_id as string);
          if (config) return config;
        } catch (err) {
          console.error('Failed to get Supabase config by ID:', err);
        }
      }
      // Legacy fallback: app-level creds
      if (app.supabase_enabled && app.supabase_url && app.supabase_anon_key_encrypted) {
        try {
          const anonKey = await decryptEnvVar(app.supabase_anon_key_encrypted as string);
          const config: { url: string; anonKey: string; serviceKey?: string } = { url: app.supabase_url as string, anonKey };
          if (app.supabase_service_key_encrypted) {
            config.serviceKey = await decryptEnvVar(app.supabase_service_key_encrypted as string);
          }
          return config;
        } catch (err) {
          console.error('Failed to decrypt legacy Supabase config:', err);
        }
      }
      // Legacy fallback: user platform-level config
      if (app.supabase_enabled) {
        try {
          const { getDecryptedPlatformSupabase } = await import('./user.ts');
          const platformConfig = await getDecryptedPlatformSupabase(app.owner_id);
          if (platformConfig) return platformConfig;
        } catch (err) {
          console.error('Failed to get platform Supabase config:', err);
        }
      }
      return undefined;
    })();

    // Await all parallel tasks
    const [code, envVars, userSecrets, userProfile, supabaseConfig] = await Promise.all([
      codeFetchPromise,
      envVarsPromise,
      secretsPromise,
      userService.getUser(userId),   // Phase 2D: fetch user profile here (BYOK keys included)
      supabaseConfigPromise,
    ]);

    if (!code) {
      return jsonRpcErrorResponse(id, INTERNAL_ERROR, 'App code not found');
    }

    // Phase 2D: Build AI service from user profile — no redundant re-fetch
    // getUser() already fetched byok_keys; use getDecryptedApiKey() which will cache-hit
    // or, even better, we have the profile so we avoid the re-query on the hot path
    let userApiKey: string | null = null;
    let aiServiceInstance: { call: (request: unknown) => Promise<unknown> };

    if (userProfile?.byok_enabled && userProfile.byok_provider) {
      userApiKey = await userService.getDecryptedApiKey(userId, userProfile.byok_provider);
      if (userApiKey) {
        const actualAiService = createAIService(userProfile.byok_provider, userApiKey);
        aiServiceInstance = {
          call: async (request: unknown) => actualAiService.call(request as Parameters<typeof actualAiService.call>[0]),
        };
      } else {
        aiServiceInstance = {
          call: async () => ({
            content: '',
            model: 'none',
            usage: { input_tokens: 0, output_tokens: 0, cost_light: 0 },
            error: 'API key not found. Please re-add your API key in Settings.',
          }),
        };
      }
    } else {
      aiServiceInstance = {
        call: async () => ({
          content: '',
          model: 'none',
          usage: { input_tokens: 0, output_tokens: 0, cost_light: 0 },
          error: 'BYOK not configured. Please add your API key in Settings.',
        }),
      };
    }

    // Convert args object to array (positional arguments)
    // For now, pass as single object argument
    // Always pass args object so functions can destructure (even if empty)
    const argsArray = [args];

    // Merge per-user secrets into envVars (per-user overrides universal)
    for (const secret of userSecrets) {
      try {
        envVars[secret.key] = await decryptEnvVar(secret.value_encrypted);
      } catch (err) {
        console.error(`Failed to decrypt per-user secret ${secret.key}:`, err);
      }
    }

    // Check for missing required per-user secrets
    const requiredPerUser = Object.entries(envSchema)
      .filter(([, v]) => v.scope === 'per_user' && v.required)
      .map(([k]) => k);
    const missingSecrets = requiredPerUser.filter(k => !envVars[k]);

    if (missingSecrets.length > 0) {
      return jsonRpcErrorResponse(
        id,
        -32006,
        `Missing required secrets: ${missingSecrets.join(', ')}. Use ul.connect to provide them.`,
        {
          type: 'MISSING_SECRETS',
          missing_secrets: missingSecrets,
          app_id: app.id,
          hint: `Call ul.connect with app_id="${app.id}" and provide: ${missingSecrets.join(', ')}`,
        }
      );
    }

    // ── Deno Sandbox Path (existing, unchanged) ──
    // Execute in sandbox (local — Worker handles data layer only)
    const baseUrl = getEnv('BASE_URL') || undefined;
    // workerBaseUrl not needed — SELF service binding handles internal routing
    const isSuspended = app.hosting_suspended === true;

    const memService = getMemoryService();
    const memoryAdapter = memService ? {
      remember: async (key: string, value: unknown) => {
        await memService.remember(userId, `app:${app.id}`, key, value);
      },
      recall: async (key: string) => {
        return await memService.recall(userId, `app:${app.id}`, key);
      },
    } : null;

    // ── D1 Data Service (lazy-provisioned) ──
    const d1DatabaseId = app.d1_database_id ? app.d1_database_id : await getD1DatabaseId(app.id);
    const d1DataService = createD1DataService(app.id, d1DatabaseId);

    // AI-capable apps get a longer timeout (120s) since AI calls are inherently slow
    const permissions = ['memory:read', 'memory:write', 'ai:call', 'net:fetch', 'app:call'];
    // Include manifest-declared permissions (e.g., net:connect for IMAP/SMTP)
    let manifestPerms: string[] = [];
    try {
      const rawManifest = (app as any).manifest;
      const parsed = typeof rawManifest === 'string' ? JSON.parse(rawManifest) : rawManifest;
      manifestPerms = parsed?.permissions || [];
    } catch {}
    if (!Array.isArray(manifestPerms)) manifestPerms = [];
    for (const p of manifestPerms) {
      if (p === 'net:connect' && !permissions.includes(p)) {
        permissions.push(p);
      }
    }
    const timeoutMs = permissions.includes('ai:call') ? 120_000 : 30_000;

    // ── Async promotion threshold: if execution exceeds this, return a job envelope ──
    // Set high to avoid promotion — CF Workers Dynamic Worker sub-isolates don't survive
    // after the parent response is sent, even with ctx.waitUntil(). Keep sync for reliability.
    const ASYNC_PROMOTION_MS = 120_000;
    const isAiCapable = permissions.includes('ai:call');
    const executionId = crypto.randomUUID();

    const execStart = Date.now();
    const sandboxConfig = {
      appId: app.id,
      userId,
      ownerId: app.owner_id,
      executionId,
      code,
      permissions,
      userApiKey,
      user,
      appDataService,
      d1DataService,
      memoryService: memoryAdapter,
      aiService: aiServiceInstance as { call: (request: import('../../shared/types/index.ts').AIRequest, apiKey: string) => Promise<import('../../shared/types/index.ts').AIResponse> },
      envVars,
      supabase: supabaseConfig,
      baseUrl,
      authToken: meta?.authToken,
      workerSecret: getEnv('WORKER_SECRET') || undefined,
      timeoutMs,
    };

    // Helper: run billing + logging after execution completes (used by both sync and async paths)
    const runPostExecution = async (result: { success: boolean; result: unknown; error?: unknown; logs: Array<{ time: string; level: string; message: string }>; durationMs: number; aiCostLight: number }) => {
      const execDuration = result.durationMs;

      // ── Per-call pricing: charge caller → app owner ──
      let callChargeLight = 0;
      if (result.success && userId !== app.owner_id) {
        const pricingConfig = app.pricing_config as AppPricingConfig | null;
        callChargeLight = getCallPriceLight(pricingConfig, functionName);

        if (callChargeLight > 0) {
          const freeCalls = getFreeCalls(pricingConfig, functionName);
          if (freeCalls > 0) {
            const scope = getFreeCallsScope(pricingConfig);
            const counterKey = scope === 'app' ? '__app__' : functionName;
            try {
              const _SB_URL = getEnv('SUPABASE_URL');
              const _SB_KEY = getEnv('SUPABASE_SERVICE_ROLE_KEY');
              const usageRes = await fetch(
                `${_SB_URL}/rest/v1/rpc/increment_caller_usage`,
                {
                  method: 'POST',
                  headers: {
                    'apikey': _SB_KEY,
                    'Authorization': `Bearer ${_SB_KEY}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    p_app_id: app.id,
                    p_user_id: userId,
                    p_counter_key: counterKey,
                  }),
                }
              );
              if (usageRes.ok) {
                const callCount = parseIncrementCallerUsageCount(await readJsonResponse<unknown>(usageRes));
                if (callCount !== null && callCount <= freeCalls) {
                  callChargeLight = 0;
                }
              }
            } catch (usageErr) {
              console.error('[PRICING] Free calls usage check error:', usageErr);
            }
          }
        }

        if (callChargeLight > 0) {
          try {
            const SUPABASE_URL = getEnv('SUPABASE_URL');
            const SUPABASE_SERVICE_ROLE_KEY = getEnv('SUPABASE_SERVICE_ROLE_KEY');

            const transferRes = await fetch(
              `${SUPABASE_URL}/rest/v1/rpc/transfer_balance`,
              {
                method: 'POST',
                headers: {
                  'apikey': SUPABASE_SERVICE_ROLE_KEY,
                  'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  p_from_user: userId,
                  p_to_user: app.owner_id,
                  p_amount_light: callChargeLight,
                }),
              }
            );

            if (transferRes.ok) {
              const rows = await transferRes.json() as Array<{ from_new_balance: number; to_new_balance: number }>;
              if (!rows || rows.length === 0) {
                callChargeLight = 0; // Insufficient balance — async can't return error to caller, skip
              } else {
                const transferReason = isSuspended ? 'tool_call_suspended' : 'tool_call';
                fetch(`${SUPABASE_URL}/rest/v1/transfers`, {
                  method: 'POST',
                  headers: {
                    'apikey': SUPABASE_SERVICE_ROLE_KEY,
                    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                    'Content-Type': 'application/json',
                    'Prefer': 'return=minimal',
                  },
                  body: JSON.stringify({
                    from_user_id: userId,
                    to_user_id: app.owner_id,
                    amount_light: callChargeLight,
                    reason: transferReason,
                    app_id: app.id,
                    function_name: functionName,
                  }),
                }).catch(() => {});

                if (isSuspended && rows[0] && rows[0].to_new_balance > 0) {
                  fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${app.owner_id}`, {
                    method: 'PATCH',
                    headers: {
                      'apikey': SUPABASE_SERVICE_ROLE_KEY,
                      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                      'Content-Type': 'application/json',
                      'Prefer': 'return=minimal',
                    },
                    body: JSON.stringify({ hosting_suspended: false }),
                  }).catch(() => {});
                  console.log(`[SUSPEND] Auto-unsuspended app ${app.id} — owner balance recovered to ${rows[0].to_new_balance}¢`);
                }
              }
            } else {
              console.error(`[PRICING] Transfer failed for ${userId} → ${app.owner_id}:`, await transferRes.text());
              callChargeLight = 0;
            }
          } catch (chargeErr) {
            console.error(`[PRICING] Charge error:`, chargeErr);
            callChargeLight = 0;
          }
        }
      }

      // Measure response size for cost telemetry
      const resultJson = JSON.stringify(result.success ? result.result : result.error);
      const responseSizeBytes = new TextEncoder().encode(resultJson || '').byteLength;
      const requestCost = 0.0000003;
      const cpuCost = execDuration * 0.00000002;
      const executionCostEstimateLight = (requestCost + cpuCost) * LIGHT_PER_DOLLAR_DESKTOP;

      const callSource = user?.provisional ? 'onboarding_template' : undefined;
      const { logMcpCall } = await import('../services/call-logger.ts');
      logMcpCall({
        userId,
        appId: app.id,
        appName: app.name || app.slug,
        functionName,
        method: 'tools/call',
        success: result.success,
        durationMs: execDuration,
        errorMessage: result.success ? undefined : String(result.error),
        source: callSource,
        inputArgs: args,
        outputResult: result.success ? result.result : result.error,
        userTier: user?.tier,
        appVersion: app.current_version || undefined,
        aiCostLight: result.aiCostLight || 0,
        sessionId: meta?.sessionId,
        sequenceNumber: nextSequenceNumber(meta?.sessionId),
        userQuery: meta?.userQuery,
        responseSizeBytes,
        executionCostEstimateLight,
        callChargeLight,
      });

      return callChargeLight;
    };

    // Start execution (Dynamic Worker sandbox — avoids `new Function()` restriction on CF Workers)
    const { executeInDynamicSandbox } = await import('../runtime/dynamic-sandbox.ts');
    const executionPromise = executeInDynamicSandbox(sandboxConfig, functionName, argsArray);

    // ── Async promotion: race execution against timer ──
    // Only promote AI-capable apps (others complete fast enough)
    const { canAcceptAsyncJob, createJob, completeJob, failJob } = await import('../services/async-jobs.ts');

    if (isAiCapable && canAcceptAsyncJob()) {
      const promotionTimer = new Promise<'promote'>((resolve) => {
        setTimeout(() => resolve('promote'), ASYNC_PROMOTION_MS);
      });

      const raceResult = await Promise.race([
        executionPromise.then(r => ({ type: 'sync' as const, result: r })),
        promotionTimer.then(() => ({ type: 'promote' as const, result: undefined as unknown })),
      ]);

      if (raceResult.type === 'sync') {
        // Fast path: completed within threshold — business as usual
        const result = raceResult.result as { success: boolean; result: unknown; error?: unknown; logs: Array<{ time: string; level: string; message: string }>; durationMs: number; aiCostLight: number };
        const callChargeLight = await runPostExecution(result);

        // Fire-and-forget: rebuild entity index after successful execution
        if (result.success) {
          import('../services/entity-index.ts')
            .then(({ rebuildEntityIndex }) => rebuildEntityIndex(userId))
            .catch(err => console.error('[MCP] Entity index rebuild failed:', err));
        }

        // Handle insufficient balance for sync path (callChargeLight would be 0 if failed)
        if (result.success) {
          // Auto-stamp widget responses with app version for client cache busting
          if (result.result && typeof result.result === 'object' && (result.result as any).app_html) {
            (result.result as any).version = app.current_version || '1';
          }
          return jsonRpcResponse(id, formatToolResult(result.result, result.logs));
        } else {
          return jsonRpcResponse(id, formatToolError(result.error));
        }
      } else {
        // Slow path: promote to async job
        const jobId = await createJob({
          appId: app.id,
          userId,
          ownerId: app.owner_id,
          functionName,
          executionId,
          meta: { sessionId: meta?.sessionId, userQuery: meta?.userQuery },
        });

        // Attach completion handler — execution continues in background
        // Must use ctx.waitUntil() to keep CF Worker alive after response is sent
        const completionPromise = executionPromise.then(async (result) => {
          await runPostExecution(result);
          await completeJob(jobId, {
            success: result.success,
            result: result.success ? result.result : result.error,
            logs: result.logs,
            durationMs: result.durationMs,
            aiCostLight: result.aiCostLight,
          });
        }).catch(async (err) => {
          await failJob(jobId, {
            type: 'ExecutionError',
            message: err instanceof Error ? err.message : String(err),
          }, Date.now() - execStart);
        });

        // Keep CF Worker alive until async execution completes
        const ctx = (globalThis as any).__ctx as { waitUntil?: (p: Promise<unknown>) => void } | undefined;
        if (ctx?.waitUntil) ctx.waitUntil(completionPromise);

        // Return job envelope immediately
        return jsonRpcResponse(id, {
          content: [{
            type: 'text',
            text: JSON.stringify({
              _async: true,
              job_id: jobId,
              status: 'running',
              message: `Execution promoted to async job. Poll with ul.job({ job_id: "${jobId}" }) to get the result.`,
            }),
          }],
          structuredContent: {
            _async: true,
            job_id: jobId,
            status: 'running',
          },
          isError: false,
        });
      }
    } else {
      // Non-AI apps or async limit reached: synchronous execution (original behavior)
      const result = await executionPromise;
      await runPostExecution(result);

      // Fire-and-forget: rebuild entity index after successful execution
      if (result.success) {
        import('../services/entity-index.ts')
          .then(({ rebuildEntityIndex }) => rebuildEntityIndex(userId))
          .catch(err => console.error('[MCP] Entity index rebuild failed:', err));
      }

      if (result.success) {
        // Auto-stamp widget responses with app version for client cache busting
        if (result.result && typeof result.result === 'object' && (result.result as any).app_html) {
          (result.result as any).version = app.current_version || '1';
        }
        return jsonRpcResponse(id, formatToolResult(result.result, result.logs));
      } else {
        return jsonRpcResponse(id, formatToolError(result.error));
      }
    }

  } catch (err) {
    console.error(`App function ${functionName} error:`, err);
    return jsonRpcResponse(id, formatToolError(err));
  }
}

// ============================================
// HELPERS
// ============================================

/**
 * Convert SkillFunction to MCPTool format
 */
function skillFunctionToMCPTool(fn: SkillFunction): MCPTool {
  // Convert parameters object to JSON Schema
  const inputSchema: MCPJsonSchema = {
    type: 'object',
    properties: {},
    required: [],
  };

  if (fn.parameters && typeof fn.parameters === 'object') {
    // Normalize array→object for legacy skills_parsed records
    const params = normalizeManifestParameters(fn.parameters) || fn.parameters;
    for (const [name, schema] of Object.entries(params)) {
      inputSchema.properties![name] = schema as MCPJsonSchema;
      // Assume all parameters are required unless marked optional
      if (!(schema as MCPJsonSchema).nullable) {
        inputSchema.required!.push(name);
      }
    }
  }

  return {
    name: fn.name,
    description: fn.description,
    inputSchema,
    outputSchema: fn.returns as MCPJsonSchema | undefined,
  };
}

/**
 * Format successful tool result for MCP response
 */
function formatToolResult(result: unknown, logs?: Array<{ message: string }> | string[]): MCPToolCallResponse {
  const content: MCPContent[] = [];

  // Add result as text
  if (result !== undefined && result !== null) {
    content.push({
      type: 'text',
      text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
    });
  }

  // Add logs if present
  const logMessages = logs?.map((log) => typeof log === 'string' ? log : log.message) || [];
  if (logMessages.length > 0) {
    content.push({
      type: 'text',
      text: `\n--- Logs ---\n${logMessages.join('\n')}`,
    });
  }

  return {
    content,
    structuredContent: result,
    isError: false,
  };
}

/**
 * Format tool error for MCP response
 */
function formatToolError(err: unknown): MCPToolCallResponse {
  const message = err instanceof Error
    ? err.message
    : (err as { message?: string })?.message || String(err);

  return {
    content: [{
      type: 'text',
      text: `Error: ${message}`,
    }],
    isError: true,
  };
}

/**
 * Create JSON-RPC success response
 */
function jsonRpcResponse(id: JsonRpcId, result: unknown): Response {
  const response: JsonRpcResponse = {
    jsonrpc: '2.0',
    id: normalizeJsonRpcId(id),
    result,
  };

  return new Response(JSON.stringify(response), {
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Create JSON-RPC error response
 */
function jsonRpcErrorResponse(
  id: JsonRpcId,
  code: number,
  message: string,
  data?: unknown
): Response {
  const response: JsonRpcResponse = {
    jsonrpc: '2.0',
    id: normalizeJsonRpcId(id),
    error: { code, message, data },
  };

  return new Response(JSON.stringify(response), {
    status: code === RATE_LIMITED ? 429 : code < 0 ? 400 : 500,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ============================================
// WELL-KNOWN MCP DISCOVERY
// ============================================

/**
 * Handle MCP discovery endpoint
 * GET /a/:appId/.well-known/mcp.json
 */
export async function handleMcpDiscovery(request: Request, appId: string): Promise<Response> {
  try {
    const appsService = createAppsService();
    const app = await appsService.findById(appId);

    if (!app) {
      return error('App not found', 404);
    }

    // Check visibility for private apps
    if (app.visibility === 'private') {
      try {
        const user = await authenticate(request);
        if (user.id !== app.owner_id) {
          return error('App not found', 404);
        }
      } catch {
        return error('App not found', 404);
      }
    }

    // Count tools
    const appToolsCount = app.skills_parsed?.functions?.length || 0;
    const totalTools = appToolsCount + SDK_TOOLS.length;

    const response = {
      name: app.name || app.slug,
      description: app.description || undefined,
      transport: {
        type: 'http-post',
        url: `/mcp/${appId}`,
      },
      capabilities: {
        tools: { listChanged: false },
        resources: { subscribe: false, listChanged: false },
      },
      tools_count: totalTools,
      app_tools: appToolsCount,
      sdk_tools: SDK_TOOLS.length,
      resources_count: app.skills_md ? 1 : 0,
    };

    return json(response);

  } catch (err) {
    console.error('MCP discovery error:', err);
    return error('Failed to get MCP info', 500);
  }
}
