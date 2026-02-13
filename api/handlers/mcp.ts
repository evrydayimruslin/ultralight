// MCP (Model Context Protocol) Handler
// Implements JSON-RPC 2.0 protocol for tool discovery and execution
// Spec: https://modelcontextprotocol.io/specification/draft/server/tools

import { json, error } from './app.ts';
import { authenticate } from './auth.ts';
import { isApiToken } from '../services/tokens.ts';
import { createAppsService } from '../services/apps.ts';
import { createAppDataService } from '../services/appdata.ts';
import { checkRateLimit } from '../services/ratelimit.ts';
import { checkAndIncrementWeeklyCalls } from '../services/weekly-calls.ts';
import { getPermissionsForUser } from './user.ts';
import { type Tier } from '../../shared/types/index.ts';
import { executeInSandbox, type UserContext } from '../runtime/sandbox.ts';
import { createR2Service } from '../services/storage.ts';
import { createUserService } from '../services/user.ts';
import { createAIService } from '../services/ai.ts';
import { decryptEnvVars, decryptEnvVar } from '../services/envvars.ts';
import { getCodeCache } from '../services/codecache.ts';
import { createMemoryService, type MemoryService as MemoryServiceImpl } from '../services/memory.ts';
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
  ParsedSkills,
  SkillFunction,
  BYOKProvider,
  AppManifest,
  App,
} from '../../shared/types/index.ts';
import { manifestToMCPTools } from '../../shared/types/index.ts';

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
// TYPES
// ============================================

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
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

// JSON-RPC error codes
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;
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
            cost_cents: { type: 'number' },
          },
        },
      },
    },
  },

  // ---- Cron Jobs ----
  {
    name: 'ultralight.cron.list',
    title: 'List Cron Jobs',
    description: 'List all cron jobs for this app.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
    },
    outputSchema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          schedule: { type: 'string' },
          handler: { type: 'string' },
          enabled: { type: 'boolean' },
          lastRunAt: { type: 'string', nullable: true },
        },
      },
    },
  },
  {
    name: 'ultralight.cron.register',
    title: 'Register Cron Job',
    description: 'Register a new cron job to run on a schedule.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Unique name for the job.',
        },
        schedule: {
          type: 'string',
          description: 'Cron expression (e.g., "0 9 * * *" for daily at 9am).',
        },
        handler: {
          type: 'string',
          description: 'Name of exported function to call.',
        },
      },
      required: ['name', 'schedule', 'handler'],
    },
  },
  {
    name: 'ultralight.cron.update',
    title: 'Update Cron Job',
    description: 'Update an existing cron job.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name of the job to update.',
        },
        schedule: {
          type: 'string',
          description: 'New cron expression.',
        },
        handler: {
          type: 'string',
          description: 'New handler function name.',
        },
        enabled: {
          type: 'boolean',
          description: 'Enable or disable the job.',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'ultralight.cron.delete',
    title: 'Delete Cron Job',
    description: 'Delete a cron job.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name of the job to delete.',
        },
      },
      required: ['name'],
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
  // Only accept POST
  if (request.method !== 'POST') {
    return error('Method not allowed. Use POST for MCP requests.', 405);
  }

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

  // Authenticate user
  let userId: string;
  let user: UserContext | null = null;
  let tokenAppIds: string[] | null = null;
  let tokenFunctionNames: string[] | null = null;
  try {
    const authUser = await authenticate(request);
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
      tier: authUser.tier as Tier,
    };
  } catch (authErr) {
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

    return jsonRpcErrorResponse(
      rpcRequest.id,
      -32001,
      message,
      { type: errorType }
    );
  }

  // Check per-minute rate limit
  const rateLimitEndpoint = `mcp:${rpcRequest.method}`;
  const rateResult = await checkRateLimit(userId, rateLimitEndpoint);
  if (!rateResult.allowed) {
    return jsonRpcErrorResponse(
      rpcRequest.id,
      RATE_LIMITED,
      `Rate limit exceeded. Try again after ${rateResult.resetAt.toISOString()}`
    );
  }

  // Check weekly call limit for tool calls
  if (rpcRequest.method === 'tools/call') {
    const weeklyResult = await checkAndIncrementWeeklyCalls(userId, user.tier);
    if (!weeklyResult.allowed) {
      return jsonRpcErrorResponse(
        rpcRequest.id,
        RATE_LIMITED,
        `Too many requests. Please try again later or upgrade to Pro.`
      );
    }
  }

  // Load app
  const appsService = createAppsService();
  const app = await appsService.findById(appId);

  if (!app) {
    return jsonRpcErrorResponse(rpcRequest.id, -32002, 'App not found');
  }

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

  // Per-app rate limit (owner-configurable, Pro feature)
  // Stored as app.rate_limit_config JSONB: { calls_per_minute, calls_per_day }
  if (rpcRequest.method === 'tools/call' && app.owner_id !== userId) {
    const rlConfig = app.rate_limit_config as { calls_per_minute?: number; calls_per_day?: number } | null;
    if (rlConfig?.calls_per_minute) {
      const appRateResult = await checkRateLimit(userId, `app:${appId}:minute`, rlConfig.calls_per_minute, 1);
      if (!appRateResult.allowed) {
        return jsonRpcErrorResponse(
          rpcRequest.id,
          RATE_LIMITED,
          `App rate limit exceeded (${rlConfig.calls_per_minute}/min). Try again after ${appRateResult.resetAt.toISOString()}`
        );
      }
    }
    if (rlConfig?.calls_per_day) {
      const appDayResult = await checkRateLimit(userId, `app:${appId}:day`, rlConfig.calls_per_day, 1440);
      if (!appDayResult.allowed) {
        return jsonRpcErrorResponse(
          rpcRequest.id,
          RATE_LIMITED,
          `App daily limit exceeded (${rlConfig.calls_per_day}/day). Try again tomorrow.`
        );
      }
    }
  }

  // Check visibility — private apps: accessible by owner or users with granted permissions
  // (Actual function-level permission check happens in handleToolsList/handleToolsCall)
  if (app.visibility === 'private' && app.owner_id !== userId) {
    // Check if user has ANY permissions on this private app
    const perms = await getPermissionsForUser(userId, app.id, app.owner_id, app.visibility);
    if (perms !== null && perms.allowed.size === 0) {
      return jsonRpcErrorResponse(rpcRequest.id, -32002, 'App not found');
    }
  }

  // Route to method handler
  const { method, params, id } = rpcRequest;

  try {
    switch (method) {
      case 'initialize':
        return handleInitialize(id, appId, app);

      case 'tools/list':
        return await handleToolsList(id, app, params, userId);

      case 'tools/call':
        return await handleToolsCall(id, app, params, userId, user, request, tokenFunctionNames);

      case 'resources/list':
        return handleResourcesList(id, appId, app);

      case 'resources/read':
        return handleResourcesRead(id, appId, app, params);

      default:
        return jsonRpcErrorResponse(id, METHOD_NOT_FOUND, `Method not found: ${method}`);
    }
  } catch (err) {
    console.error(`MCP ${method} error:`, err);
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
  id: string | number,
  appId: string,
  app: { name: string; slug: string; description: string | null }
): Response {
  const result: MCPServerInfo = {
    name: app.name || app.slug,
    version: '1.0.0',
    description: app.description || undefined,
    capabilities: {
      tools: { listChanged: false },
      resources: { subscribe: false, listChanged: false },
    },
    endpoints: {
      mcp: `/mcp/${appId}`,
    },
  };

  return jsonRpcResponse(id, result);
}

/**
 * Handle resources/list request - return available resources for this app
 */
function handleResourcesList(
  id: string | number,
  appId: string,
  app: { name: string; slug: string; skills_md?: string | null }
): Response {
  const resources: MCPResourceDescriptor[] = [];

  // Always advertise skills.md — even if not yet generated, so clients know it exists
  if (app.skills_md) {
    resources.push({
      uri: `ultralight://app/${appId}/skills.md`,
      name: `${app.name || app.slug} — Skills & Usage Guide`,
      description: 'Auto-generated documentation: function signatures, parameters, return types, and usage examples. Read this before calling tools.',
      mimeType: 'text/markdown',
    });
  }

  return jsonRpcResponse(id, { resources });
}

/**
 * Handle resources/read request - return resource content
 */
function handleResourcesRead(
  id: string | number,
  appId: string,
  app: { name: string; slug: string; skills_md?: string | null },
  params: unknown
): Response {
  const readParams = params as { uri?: string } | undefined;
  const uri = readParams?.uri;

  if (!uri) {
    return jsonRpcErrorResponse(id, INVALID_PARAMS, 'Missing required parameter: uri');
  }

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

  return jsonRpcErrorResponse(id, -32002, `Resource not found: ${uri}`);
}

/**
 * Handle tools/list request - return available tools
 */
async function handleToolsList(
  id: string | number,
  app: { id: string; slug: string; owner_id: string; visibility: string; skills_parsed: ParsedSkills | null; manifest?: string | null },
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
  id: string | number,
  app: { id: string; slug: string; owner_id: string; visibility: string; storage_key: string; skills_parsed: ParsedSkills | null; manifest?: string | null },
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

  // Check if it's an SDK tool (always allowed)
  if (name.startsWith('ultralight.')) {
    return await executeSDKTool(id, name, args || {}, app.id, userId, user);
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
  // Also enforce granular constraints (IP, time window, budget, expiry) — Pro feature
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
        const constraintResult = checkConstraints(matchingRow, clientIp);
        if (!constraintResult.allowed) {
          return jsonRpcErrorResponse(
            id,
            -32003,
            `Permission denied: ${constraintResult.reason}`
          );
        }

        // Increment budget_used if budget_limit is set (fire and forget)
        if (matchingRow.budget_limit !== null && matchingRow.budget_limit > 0) {
          // @ts-ignore
          const _Deno = globalThis.Deno;
          const sbUrl = _Deno.env.get('SUPABASE_URL') || '';
          const sbKey = _Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
          fetch(`${sbUrl}/rest/v1/user_app_permissions?granted_to_user_id=eq.${userId}&app_id=eq.${app.id}&function_name=eq.${encodeURIComponent(name)}`, {
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
          }).catch(err => console.error('Budget increment failed:', err));
        }
      }
    }
  }

  // Determine the actual function name to execute
  let functionName = name;
  let isManifestFunction = false;

  // Check if it's a manifest-based tool (format: appSlug_functionName)
  if (app.manifest) {
    try {
      const manifest = JSON.parse(app.manifest) as AppManifest;
      const prefix = `${app.slug}_`;
      if (name.startsWith(prefix) && manifest.functions) {
        const fnName = name.slice(prefix.length);
        if (fnName in manifest.functions) {
          functionName = fnName;
          isManifestFunction = true;
        }
      }
    } catch (err) {
      console.error('Failed to parse manifest for tool call:', err);
    }
  }

  // Fall back to skills_parsed check (legacy behavior)
  if (!isManifestFunction) {
    const appFunction = app.skills_parsed?.functions.find(f => f.name === name);
    if (!appFunction) {
      return jsonRpcErrorResponse(id, INVALID_PARAMS, `Unknown tool: ${name}`);
    }
  }

  // Extract agent meta (e.g. _user_query, _session_id) before passing to sandbox
  const { extractCallMeta } = await import('../services/call-logger.ts');
  const { cleanArgs, userQuery, sessionId } = extractCallMeta(args || {});

  // Execute app function via sandbox
  return await executeAppFunction(id, functionName, cleanArgs, app, userId, user, { userQuery, sessionId });
}

// ============================================
// TOOL EXECUTION
// ============================================

/**
 * Execute an SDK tool (ultralight.*)
 */
async function executeSDKTool(
  id: string | number,
  toolName: string,
  args: Record<string, unknown>,
  appId: string,
  userId: string,
  user: UserContext | null
): Promise<Response> {
  try {
    // Create app data service for user-partitioned storage
    const appDataService = createAppDataService(appId, userId);

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
      case 'ultralight.store':
        await appDataService.store(args.key as string, args.value);
        result = { success: true };
        break;

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

      case 'ultralight.remove':
        await appDataService.remove(args.key as string);
        result = { success: true };
        break;

      // Memory (cross-app)
      case 'ultralight.remember': {
        const memService = getMemoryService();
        if (!memService) {
          result = { success: false, error: 'Memory service not available' };
          break;
        }
        const scope = args.scope as string || `app:${appId}`;
        await memService.remember(userId, scope, args.key as string, args.value);
        result = { success: true, key: args.key, scope };
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
            usage: { input_tokens: 0, output_tokens: 0, cost_cents: 0 },
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
            usage: { input_tokens: 0, output_tokens: 0, cost_cents: 0 },
            error: 'API key not found. Please re-add your API key in Settings.',
          };
          break;
        }

        // Create AI service with user's provider and key
        const aiService = createAIService(userProfile.byok_provider, apiKey);

        // Make the AI call
        try {
          result = await aiService.call({
            messages: args.messages as Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
            model: args.model as string | undefined,
            temperature: args.temperature as number | undefined,
            max_tokens: args.max_tokens as number | undefined,
            tools: args.tools as Array<{ name: string; description: string; parameters: Record<string, unknown> }> | undefined,
          });
        } catch (aiError) {
          result = {
            content: '',
            model: args.model || 'unknown',
            usage: { input_tokens: 0, output_tokens: 0, cost_cents: 0 },
            error: aiError instanceof Error ? aiError.message : 'AI call failed',
          };
        }
        break;
      }

      // Cron
      case 'ultralight.cron.list':
        // TODO: Implement cron list
        result = [];
        break;

      case 'ultralight.cron.register':
        // TODO: Implement cron register
        result = { success: true, message: 'Cron registration via MCP not yet implemented' };
        break;

      case 'ultralight.cron.update':
        // TODO: Implement cron update
        result = { success: true, message: 'Cron update via MCP not yet implemented' };
        break;

      case 'ultralight.cron.delete':
        // TODO: Implement cron delete
        result = { success: true, message: 'Cron delete via MCP not yet implemented' };
        break;

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
async function executeAppFunction(
  id: string | number,
  functionName: string,
  args: Record<string, unknown>,
  app: { id: string; storage_key: string },
  userId: string,
  user: UserContext | null,
  meta?: { userQuery?: string; sessionId?: string }
): Promise<Response> {
  try {
    const r2Service = createR2Service();
    const appDataService = createAppDataService(app.id, userId);
    const userService = createUserService();

    // Fetch app code — check in-memory cache first, fall back to R2
    const codeCache = getCodeCache();
    let code: string | null = codeCache.get(app.id, app.storage_key);

    if (code) {
      console.log(`[MCP] Code cache HIT for app ${app.id} (${codeCache.stats.hitRate} hit rate)`);
    } else {
      console.log(`[MCP] Code cache MISS for app ${app.id}, fetching from R2...`);
      const entryFiles = ['index.tsx', 'index.ts', 'index.jsx', 'index.js'];

      for (const entryFile of entryFiles) {
        try {
          code = await r2Service.fetchTextFile(`${app.storage_key}${entryFile}`);
          break;
        } catch {
          // Try next
        }
      }

      // Cache the code for future calls
      if (code) {
        codeCache.set(app.id, app.storage_key, code);
      }
    }

    if (!code) {
      return jsonRpcErrorResponse(id, INTERNAL_ERROR, 'App code not found');
    }

    // Get user's BYOK configuration for AI service
    const userProfile = await userService.getUser(userId);
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
            usage: { input_tokens: 0, output_tokens: 0, cost_cents: 0 },
            error: 'API key not found. Please re-add your API key in Settings.',
          }),
        };
      }
    } else {
      aiServiceInstance = {
        call: async () => ({
          content: '',
          model: 'none',
          usage: { input_tokens: 0, output_tokens: 0, cost_cents: 0 },
          error: 'BYOK not configured. Please add your API key in Settings.',
        }),
      };
    }

    // Convert args object to array (positional arguments)
    // For now, pass as single object argument
    const argsArray = Object.keys(args).length > 0 ? [args] : [];

    // Decrypt environment variables for the app (universal env vars set by owner)
    const encryptedEnvVars = (app as Record<string, unknown>).env_vars as Record<string, string> || {};
    let envVars: Record<string, string> = {};
    try {
      envVars = await decryptEnvVars(encryptedEnvVars);
    } catch (err) {
      console.error('Failed to decrypt env vars:', err);
      // Continue with empty env vars
    }

    // Merge per-user secrets (from ul.connect) into envVars
    // Per-user secrets override universal env vars for the same key
    const appRecord = app as Record<string, unknown>;
    const envSchema = (appRecord.env_schema || {}) as Record<string, { scope: string; required?: boolean; description?: string }>;
    const perUserKeys = Object.entries(envSchema)
      .filter(([, v]) => v.scope === 'per_user')
      .map(([k]) => k);

    if (perUserKeys.length > 0) {
      try {
        // @ts-ignore
        const Deno = globalThis.Deno;
        const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
        const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

        const secretsRes = await fetch(
          `${SUPABASE_URL}/rest/v1/user_app_secrets?user_id=eq.${userId}&app_id=eq.${app.id}&select=key,value_encrypted`,
          {
            headers: {
              'apikey': SUPABASE_SERVICE_ROLE_KEY,
              'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            },
          }
        );

        if (secretsRes.ok) {
          const userSecrets = await secretsRes.json() as Array<{ key: string; value_encrypted: string }>;
          for (const secret of userSecrets) {
            try {
              envVars[secret.key] = await decryptEnvVar(secret.value_encrypted);
            } catch (err) {
              console.error(`Failed to decrypt per-user secret ${secret.key}:`, err);
            }
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
      } catch (err) {
        console.error('Failed to fetch per-user secrets:', err);
        // Continue without per-user secrets — app may still work if keys are optional
      }
    }

    // Resolve Supabase config: prefer config_id (new model), fall back to legacy app-level, then platform-level
    let supabaseConfig: { url: string; anonKey: string; serviceKey?: string } | undefined;

    if (appRecord.supabase_config_id) {
      try {
        const { getDecryptedSupabaseConfig } = await import('./user.ts');
        const config = await getDecryptedSupabaseConfig(appRecord.supabase_config_id as string);
        if (config) supabaseConfig = config;
      } catch (err) {
        console.error('Failed to get Supabase config by ID:', err);
      }
    }

    // Legacy fallback: app-level creds
    if (!supabaseConfig && appRecord.supabase_enabled && appRecord.supabase_url && appRecord.supabase_anon_key_encrypted) {
      try {
        const anonKey = await decryptEnvVar(appRecord.supabase_anon_key_encrypted as string);
        supabaseConfig = { url: appRecord.supabase_url as string, anonKey };
        if (appRecord.supabase_service_key_encrypted) {
          supabaseConfig.serviceKey = await decryptEnvVar(appRecord.supabase_service_key_encrypted as string);
        }
      } catch (err) {
        console.error('Failed to decrypt legacy Supabase config:', err);
      }
    }

    // Legacy fallback: user platform-level config
    if (!supabaseConfig && appRecord.supabase_enabled) {
      try {
        const { getDecryptedPlatformSupabase } = await import('./user.ts');
        const platformConfig = await getDecryptedPlatformSupabase(app.owner_id);
        if (platformConfig) supabaseConfig = platformConfig;
      } catch (err) {
        console.error('Failed to get platform Supabase config:', err);
      }
    }

    // Execute in sandbox
    // Create memory adapter: binds userId + app scope to the sandbox's simple interface
    const memService = getMemoryService();
    const memoryAdapter = memService ? {
      remember: async (key: string, value: unknown) => {
        await memService.remember(userId, `app:${app.id}`, key, value);
      },
      recall: async (key: string) => {
        return await memService.recall(userId, `app:${app.id}`, key);
      },
    } : null;

    const execStart = Date.now();
    const result = await executeInSandbox(
      {
        appId: app.id,
        userId,
        executionId: crypto.randomUUID(),
        code,
        permissions: ['memory:read', 'memory:write', 'ai:call', 'net:fetch', 'cron:read', 'cron:write'],
        userApiKey,
        user,
        appDataService,
        memoryService: memoryAdapter,
        aiService: aiServiceInstance as { call: (request: import('../../shared/types/index.ts').AIRequest, apiKey: string) => Promise<import('../../shared/types/index.ts').AIResponse> },
        envVars,
        supabase: supabaseConfig,
      },
      functionName,
      argsArray
    );
    const execDuration = Date.now() - execStart;

    // Log the call (fire-and-forget)
    const { logMcpCall } = await import('../services/call-logger.ts');
    logMcpCall({
      userId,
      appId: app.id,
      appName: (appRecord.name as string) || (appRecord.slug as string),
      functionName,
      method: 'tools/call',
      success: result.success,
      durationMs: execDuration,
      errorMessage: result.success ? undefined : String(result.error),
      inputArgs: args,
      outputResult: result.success ? result.result : result.error,
      userTier: user?.tier,
      appVersion: (appRecord.current_version as string) || undefined,
      aiCostCents: result.aiCostCents || 0,
      sessionId: meta?.sessionId,
      sequenceNumber: nextSequenceNumber(meta?.sessionId),
      userQuery: meta?.userQuery,
    });

    if (result.success) {
      return jsonRpcResponse(id, formatToolResult(result.result, result.logs));
    } else {
      return jsonRpcResponse(id, formatToolError(result.error));
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
    for (const [name, schema] of Object.entries(fn.parameters)) {
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
function formatToolResult(result: unknown, logs?: Array<{ message: string }>): MCPToolCallResponse {
  const content: MCPContent[] = [];

  // Add result as text
  if (result !== undefined && result !== null) {
    content.push({
      type: 'text',
      text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
    });
  }

  // Add logs if present
  if (logs && logs.length > 0) {
    content.push({
      type: 'text',
      text: `\n--- Logs ---\n${logs.map(l => l.message).join('\n')}`,
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
function jsonRpcResponse(id: string | number | null, result: unknown): Response {
  const response: JsonRpcResponse = {
    jsonrpc: '2.0',
    id,
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
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown
): Response {
  const response: JsonRpcResponse = {
    jsonrpc: '2.0',
    id,
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

    const discovery: MCPServerInfo = {
      name: app.name || app.slug,
      version: '1.0.0',
      description: app.description || undefined,
      capabilities: {
        tools: { listChanged: false },
        resources: { subscribe: false, listChanged: false },
      },
      endpoints: {
        mcp: `/mcp/${appId}`,
      },
    };

    // Add extra metadata
    const response = {
      ...discovery,
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
