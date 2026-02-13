// Platform MCP Handler — v2
// Implements JSON-RPC 2.0 for the ul.* tool namespace
// Endpoint: POST /mcp/platform
// Tools: upload, download, set.version, set.visibility, set.download, set.supabase,
//        permissions.grant, permissions.revoke, permissions.list,
//        discover.desk, discover.library, discover.appstore, like, dislike, logs,
//        connect, connections

import { json, error } from './app.ts';
import { authenticate } from './auth.ts';
import { isApiToken } from '../services/tokens.ts';
import { createAppsService } from '../services/apps.ts';
import { createR2Service } from '../services/storage.ts';
import { checkRateLimit } from '../services/ratelimit.ts';
import { checkAndIncrementWeeklyCalls } from '../services/weekly-calls.ts';
import { getPermissionsForUser } from './user.ts';
import { type Tier, isProTier } from '../../shared/types/index.ts';
import { handleUploadFiles, type UploadFile } from './upload.ts';
import { validateAndParseSkillsMd } from '../services/docgen.ts';
import { createEmbeddingService } from '../services/embedding.ts';
import { checkVisibilityAllowed } from '../services/tier-enforcement.ts';
import {
  generateSkillsForVersion,
  rebuildUserLibrary,
} from '../services/library.ts';
import { encryptEnvVar, decryptEnvVar } from '../services/envvars.ts';
import { type UserContext } from '../runtime/sandbox.ts';
import type {
  EnvSchemaEntry,
  MCPTool,
  MCPToolsListResponse,
  MCPToolCallRequest,
  MCPToolCallResponse,
  MCPContent,
  MCPServerInfo,
  App,
  AppWithDraft,
} from '../../shared/types/index.ts';

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

// JSON-RPC error codes
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

// Custom error codes
const RATE_LIMITED = -32000;
const AUTH_REQUIRED = -32001;
const NOT_FOUND = -32002;
const FORBIDDEN = -32003;
const QUOTA_EXCEEDED = -32004;
const BUILD_FAILED = -32005;
const VALIDATION_ERROR = -32006;

// ============================================
// PLATFORM MCP TOOLS — ul.* namespace
// ============================================

const PLATFORM_TOOLS: MCPTool[] = [
  // ── Upload & Download ──────────────────────────
  {
    name: 'ul.upload',
    title: 'Upload App',
    description:
      'Upload source code to create a new app or add a new version to an existing app. ' +
      'No app_id → new app (v1.0.0, set live automatically). ' +
      'With app_id → new version (NOT set live — use ul.set.version). ' +
      'Auto-generates Skills.md, library entry, and embedding per version.',
    inputSchema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Relative file path (e.g. "index.ts")' },
              content: { type: 'string', description: 'File content (text or base64)' },
              encoding: { type: 'string', enum: ['text', 'base64'], description: 'Default: text' },
            },
            required: ['path', 'content'],
          },
          description: 'Source files to upload. Must include an entry file (index.ts/tsx/js/jsx)',
        },
        app_id: {
          type: 'string',
          description: 'Existing app ID or slug. Omit to create a new app.',
        },
        name: { type: 'string', description: 'App name (new apps only)' },
        description: { type: 'string', description: 'App description' },
        visibility: {
          type: 'string',
          enum: ['private', 'unlisted', 'published'],
          description: 'Default: private',
        },
        version: {
          type: 'string',
          description: 'Explicit version (e.g. "2.0.0"). Default: patch bump X.Y.Z+1',
        },
      },
      required: ['files'],
    },
  },
  {
    name: 'ul.download',
    title: 'Download Source Code',
    description: 'Download the source code for an app version as a list of files. Respects download_access settings.',
    inputSchema: {
      type: 'object',
      properties: {
        app_id: { type: 'string', description: 'App ID or slug' },
        version: { type: 'string', description: 'Version to download. Default: live version' },
      },
      required: ['app_id'],
    },
  },

  // ── Set Suite ──────────────────────────────────
  {
    name: 'ul.set.version',
    title: 'Set Live Version',
    description: 'Set the live version for an app. Triggers Library.md rebuild for the user.',
    inputSchema: {
      type: 'object',
      properties: {
        app_id: { type: 'string', description: 'App ID or slug' },
        version: { type: 'string', description: 'Version string to set as live' },
      },
      required: ['app_id', 'version'],
    },
  },
  {
    name: 'ul.set.visibility',
    title: 'Set App Visibility',
    description:
      'Change app visibility. Setting to "published" adds the app to the global app store index. ' +
      'Removing from "published" removes it.',
    inputSchema: {
      type: 'object',
      properties: {
        app_id: { type: 'string', description: 'App ID or slug' },
        visibility: {
          type: 'string',
          enum: ['private', 'unlisted', 'published'],
          description: 'New visibility',
        },
      },
      required: ['app_id', 'visibility'],
    },
  },
  {
    name: 'ul.set.download',
    title: 'Set Download Access',
    description: 'Control who can download the source code.',
    inputSchema: {
      type: 'object',
      properties: {
        app_id: { type: 'string', description: 'App ID or slug' },
        access: {
          type: 'string',
          enum: ['owner', 'public'],
          description: 'Who can download source code',
        },
      },
      required: ['app_id', 'access'],
    },
  },
  {
    name: 'ul.set.supabase',
    title: 'Assign Supabase Server',
    description: 'Assign or unassign a Supabase server to an app. Pass server_name: null to unassign.',
    inputSchema: {
      type: 'object',
      properties: {
        app_id: { type: 'string', description: 'App ID or slug' },
        server_name: {
          type: ['string', 'null'],
          description: 'Name of the user\'s Supabase config. null to unassign.',
        },
      },
      required: ['app_id', 'server_name'],
    },
  },

  // ── Permissions ────────────────────────────────
  {
    name: 'ul.permissions.grant',
    title: 'Grant Permissions',
    description:
      'Grant a user access to specific functions on a private app. ' +
      'Additive — does not remove existing grants. Omit functions to grant ALL.',
    inputSchema: {
      type: 'object',
      properties: {
        app_id: { type: 'string', description: 'App ID or slug' },
        email: { type: 'string', description: 'Email of the user to grant access to' },
        functions: {
          type: 'array',
          items: { type: 'string' },
          description: 'Function names to grant. Omit to grant all current functions.',
        },
      },
      required: ['app_id', 'email'],
    },
  },
  {
    name: 'ul.permissions.revoke',
    title: 'Revoke Permissions',
    description:
      'Revoke access to a private app. ' +
      'With email: revokes that user. Without email: revokes ALL users. ' +
      'With functions: revokes only those functions. Without functions: revokes all access.',
    inputSchema: {
      type: 'object',
      properties: {
        app_id: { type: 'string', description: 'App ID or slug' },
        email: { type: 'string', description: 'Email of user to revoke. Omit to revoke ALL users.' },
        functions: {
          type: 'array',
          items: { type: 'string' },
          description: 'Specific functions to revoke. Omit to revoke all access.',
        },
      },
      required: ['app_id'],
    },
  },
  {
    name: 'ul.permissions.list',
    title: 'List Permissions',
    description: 'List granted users and their function permissions for an app. Filterable by emails and/or functions.',
    inputSchema: {
      type: 'object',
      properties: {
        app_id: { type: 'string', description: 'App ID or slug' },
        emails: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter to these users. Omit for all granted users.',
        },
        functions: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter to these functions. Omit for all functions.',
        },
      },
      required: ['app_id'],
    },
  },

  // ── Discovery ──────────────────────────────────
  {
    name: 'ul.discover.desk',
    title: 'Check Desk',
    description:
      'Returns the last 3 distinct apps the user has called. ' +
      'This is the fastest lookup — check here first before searching library or app store.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'ul.discover.library',
    title: 'Search Your Apps',
    description:
      'Search your apps (owned + liked). No query returns full Library.md. ' +
      'With query: semantic search. Includes apps saved via like.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Semantic search query. Omit to list all your apps.',
        },
      },
    },
  },
  {
    name: 'ul.discover.appstore',
    title: 'Search App Store',
    description:
      'Semantic search across all published apps in the global app store. ' +
      'Results ranked by relevancy, community signal, and native capability. ' +
      'Excludes apps you have disliked.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Natural language search query (e.g. "weather API", "send emails")',
        },
        limit: { type: 'number', description: 'Max results (default: 10)' },
      },
      required: ['query'],
    },
  },

  // ── Like/Dislike ─────────────────────────────────
  {
    name: 'ul.like',
    title: 'Like an App',
    description:
      'Like an app to save it to your library. Works on public, unlisted, and private apps. ' +
      'Cannot like your own apps. ' +
      'Calling again on an already-liked app removes the like (toggle). ' +
      'Liking a previously disliked app removes the dislike.',
    inputSchema: {
      type: 'object',
      properties: {
        app_id: { type: 'string', description: 'App ID or slug' },
      },
      required: ['app_id'],
    },
  },
  {
    name: 'ul.dislike',
    title: 'Dislike an App',
    description:
      'Dislike an app to remove it from your library and hide it from future app store results. ' +
      'Works on public, unlisted, and private apps. Cannot dislike your own apps. ' +
      'Calling again on an already-disliked app removes the dislike (toggle). ' +
      'Disliking a previously liked app removes the like.',
    inputSchema: {
      type: 'object',
      properties: {
        app_id: { type: 'string', description: 'App ID or slug' },
      },
      required: ['app_id'],
    },
  },

  // ── Logs ────────────────────────────────────────
  {
    name: 'ul.logs',
    title: 'View MCP Call Logs',
    description:
      'View MCP call logs for an app you own. ' +
      'Filter by caller emails and/or function names.',
    inputSchema: {
      type: 'object',
      properties: {
        app_id: { type: 'string', description: 'App ID or slug (must be owned by you)' },
        emails: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter to calls by these users. Omit for all callers.',
        },
        functions: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter to these function names. Omit for all functions.',
        },
        limit: { type: 'number', description: 'Max log entries (default: 50, max: 200)' },
        since: { type: 'string', description: 'ISO timestamp — only logs after this time.' },
      },
      required: ['app_id'],
    },
  },

  // ── Connections (per-user secrets) ─────────────
  {
    name: 'ul.connect',
    title: 'Connect to App',
    description:
      'Set, update, or remove your per-user secrets for an app. ' +
      'Apps declare required secrets (e.g. API keys) via env_schema. ' +
      'Pass a secret value as null to remove that key. ' +
      'Pass all values as null to fully disconnect.',
    inputSchema: {
      type: 'object',
      properties: {
        app_id: { type: 'string', description: 'App ID or slug to connect to' },
        secrets: {
          type: 'object',
          description: 'Key-value pairs of secrets to set. Use null value to remove a key.',
          additionalProperties: {
            type: ['string', 'null'],
          },
        },
      },
      required: ['app_id', 'secrets'],
    },
  },
  // ── Connections ────────────────────────────────
  {
    name: 'ul.connections',
    title: 'View Connections',
    description:
      'View your connections to apps. ' +
      'No app_id → list all apps you have connected to. ' +
      'With app_id → show required secrets, which you\'ve provided, and connection status.',
    inputSchema: {
      type: 'object',
      properties: {
        app_id: {
          type: 'string',
          description: 'App ID or slug. Omit to list all your connections.',
        },
      },
    },
  },
];

// ============================================
// MAIN HANDLER
// ============================================

export async function handlePlatformMcp(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return error('Method not allowed. Use POST for MCP requests.', 405);
  }

  let rpcRequest: JsonRpcRequest;
  try {
    rpcRequest = await request.json();
  } catch {
    return jsonRpcErrorResponse(null, PARSE_ERROR, 'Parse error: Invalid JSON');
  }

  if (rpcRequest.jsonrpc !== '2.0' || !rpcRequest.method) {
    return jsonRpcErrorResponse(
      rpcRequest.id ?? null,
      INVALID_REQUEST,
      'Invalid Request: Missing jsonrpc version or method'
    );
  }

  // Authenticate
  let userId: string;
  let user: UserContext;
  try {
    const authUser = await authenticate(request);
    userId = authUser.id;

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
      } catch { /* best-effort */ }
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
    let errorType = 'AUTH_REQUIRED';
    if (message.includes('expired')) errorType = 'AUTH_TOKEN_EXPIRED';
    else if (message.includes('Missing')) errorType = 'AUTH_MISSING_TOKEN';
    else if (message.includes('Invalid JWT') || message.includes('decode')) errorType = 'AUTH_INVALID_TOKEN';

    return jsonRpcErrorResponse(rpcRequest.id, AUTH_REQUIRED, message, { type: errorType });
  }

  // Rate limit
  const rateLimitEndpoint = `platform:${rpcRequest.method}`;
  const rateResult = await checkRateLimit(userId, rateLimitEndpoint);
  if (!rateResult.allowed) {
    return jsonRpcErrorResponse(
      rpcRequest.id,
      RATE_LIMITED,
      `Rate limit exceeded. Try again after ${rateResult.resetAt.toISOString()}`
    );
  }

  // Weekly call limit for tool calls
  if (rpcRequest.method === 'tools/call') {
    const weeklyResult = await checkAndIncrementWeeklyCalls(userId, user.tier);
    if (!weeklyResult.allowed) {
      return jsonRpcErrorResponse(
        rpcRequest.id,
        RATE_LIMITED,
        `Weekly call limit reached (${weeklyResult.limit.toLocaleString()} calls/week). Upgrade your plan.`
      );
    }
  }

  const { method, params, id } = rpcRequest;

  try {
    switch (method) {
      case 'initialize':
        return handleInitialize(id);
      case 'tools/list':
        return handleToolsList(id);
      case 'tools/call':
        return await handleToolsCall(id, params, userId, user);
      default:
        return jsonRpcErrorResponse(id, METHOD_NOT_FOUND, `Method not found: ${method}`);
    }
  } catch (err) {
    console.error(`Platform MCP ${method} error:`, err);
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

function handleInitialize(id: string | number): Response {
  const result: MCPServerInfo = {
    name: 'Ultralight Platform',
    version: '2.0.0',
    description: 'MCP-first app hosting platform. Upload, configure, and discover apps.',
    capabilities: { tools: { listChanged: false } },
    endpoints: { mcp: '/mcp/platform' },
  };
  return jsonRpcResponse(id, result);
}

function handleToolsList(id: string | number): Response {
  return jsonRpcResponse(id, { tools: PLATFORM_TOOLS } as MCPToolsListResponse);
}

async function handleToolsCall(
  id: string | number,
  params: unknown,
  userId: string,
  user: UserContext
): Promise<Response> {
  const callParams = params as MCPToolCallRequest | undefined;
  if (!callParams?.name) {
    return jsonRpcErrorResponse(id, INVALID_PARAMS, 'Missing tool name');
  }

  const { name, arguments: args } = callParams;

  // Extract agent meta (_user_query, _session_id) before passing to tool handlers
  const { extractCallMeta } = await import('../services/call-logger.ts');
  const { cleanArgs, userQuery, sessionId } = extractCallMeta(args || {});
  const toolArgs = cleanArgs;

  const execStart = Date.now();

  try {
    let result: unknown;

    switch (name) {
      // Upload & Download
      case 'ul.upload':
        result = await executeUpload(userId, toolArgs, user.tier);
        break;
      case 'ul.download':
        result = await executeDownload(userId, toolArgs);
        break;

      // Set suite
      case 'ul.set.version':
        result = await executeSetVersion(userId, toolArgs);
        break;
      case 'ul.set.visibility':
        result = await executeSetVisibility(userId, toolArgs, user.tier);
        break;
      case 'ul.set.download':
        result = await executeSetDownload(userId, toolArgs);
        break;
      case 'ul.set.supabase':
        result = await executeSetSupabase(userId, toolArgs);
        break;

      // Permissions
      case 'ul.permissions.grant':
        result = await executePermissionsGrant(userId, toolArgs, user.tier);
        break;
      case 'ul.permissions.revoke':
        result = await executePermissionsRevoke(userId, toolArgs, user.tier);
        break;
      case 'ul.permissions.list':
        result = await executePermissionsList(userId, toolArgs);
        break;

      // Discovery
      case 'ul.discover.desk':
        result = await executeDiscoverDesk(userId);
        break;
      case 'ul.discover.library':
        result = await executeDiscoverLibrary(userId, toolArgs);
        break;
      case 'ul.discover.appstore':
        result = await executeDiscoverAppstore(userId, toolArgs);
        break;

      // Like/Dislike
      case 'ul.like':
        result = await executeLikeDislike(userId, toolArgs, true);
        break;
      case 'ul.dislike':
        result = await executeLikeDislike(userId, toolArgs, false);
        break;

      // Logs
      case 'ul.logs':
        result = await executeLogs(userId, toolArgs, user.tier);
        break;

      // Connections (per-user secrets)
      case 'ul.connect':
        result = await executeConnect(userId, toolArgs);
        break;
      case 'ul.connections':
        result = await executeConnections(userId, toolArgs);
        break;

      default:
        return jsonRpcErrorResponse(id, INVALID_PARAMS, `Unknown tool: ${name}`);
    }

    const durationMs = Date.now() - execStart;

    // Log the call
    const { logMcpCall } = await import('../services/call-logger.ts');
    logMcpCall({
      userId,
      functionName: name,
      method: 'tools/call',
      success: true,
      durationMs,
      inputArgs: toolArgs,
      outputResult: result,
      userTier: user.tier,
      sessionId,
      userQuery,
    });

    return jsonRpcResponse(id, formatToolResult(result));
  } catch (err) {
    console.error(`Platform tool ${name} error:`, err);

    const durationMs = Date.now() - execStart;

    const { logMcpCall } = await import('../services/call-logger.ts');
    logMcpCall({
      userId,
      functionName: name,
      method: 'tools/call',
      success: false,
      durationMs,
      errorMessage: err instanceof Error ? err.message : String(err),
      inputArgs: toolArgs,
      outputResult: { error: err instanceof Error ? err.message : String(err) },
      userTier: user.tier,
      sessionId,
      userQuery,
    });

    if (err instanceof ToolError) {
      return jsonRpcErrorResponse(id, err.code, err.message);
    }
    return jsonRpcResponse(id, formatToolError(err));
  }
}

// ============================================
// TOOL ERROR
// ============================================

class ToolError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
    this.name = 'ToolError';
  }
}

// ============================================
// HELPERS
// ============================================

/** Resolve app from ID or slug, verify ownership */
async function resolveApp(userId: string, appIdOrSlug: string): Promise<App> {
  const appsService = createAppsService();
  let app = await appsService.findById(appIdOrSlug);
  if (!app) {
    app = await appsService.findBySlug(userId, appIdOrSlug);
  }
  if (!app) throw new ToolError(NOT_FOUND, `App not found: ${appIdOrSlug}`);
  if (app.owner_id !== userId) throw new ToolError(FORBIDDEN, 'You do not own this app');
  return app;
}

function getSupabaseEnv() {
  // @ts-ignore
  const Deno = globalThis.Deno;
  return {
    SUPABASE_URL: Deno.env.get('SUPABASE_URL') || '',
    SUPABASE_SERVICE_ROLE_KEY: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
  };
}

/** Bump version: default patch, or use explicit version */
function bumpVersion(current: string | null, explicit?: string): string {
  if (explicit) return explicit;
  const [major, minor, patch] = (current || '1.0.0').split('.').map(Number);
  return `${major}.${minor}.${patch + 1}`;
}

// generateSkillsForVersion, generateLibraryEntry, rebuildUserLibrary
// are imported from ../services/library.ts

// ============================================
// TOOL IMPLEMENTATIONS
// ============================================

// ── ul.upload ────────────────────────────────────

async function executeUpload(
  userId: string,
  args: Record<string, unknown>,
  userTier: Tier
): Promise<unknown> {
  const files = args.files as Array<{ path: string; content: string; encoding?: string }>;
  if (!files || !Array.isArray(files) || files.length === 0) {
    throw new ToolError(INVALID_PARAMS, 'files array is required and must not be empty');
  }

  const appIdOrSlug = args.app_id as string | undefined;
  const requestedVisibility = (args.visibility as string) || 'private';

  // Gate visibility by tier
  if (requestedVisibility !== 'private') {
    const visibilityErr = checkVisibilityAllowed(userTier, requestedVisibility as 'private' | 'unlisted' | 'public');
    if (visibilityErr) throw new ToolError(FORBIDDEN, visibilityErr);
  }

  // Convert files to UploadFile format
  const uploadFiles: UploadFile[] = files.map(f => {
    let content = f.content;
    if (f.encoding === 'base64') content = atob(f.content);
    return { name: f.path, content, size: content.length };
  });

  if (appIdOrSlug) {
    // ── Existing app: new version (NOT live) ──
    const app = await resolveApp(userId, appIdOrSlug);
    const newVersion = bumpVersion(app.current_version, args.version as string | undefined);

    // Check for version conflict
    if ((app.versions || []).includes(newVersion)) {
      throw new ToolError(VALIDATION_ERROR, `Version ${newVersion} already exists. Use a different version.`);
    }

    // Validate entry file
    const entryFiles = ['index.ts', 'index.tsx', 'index.js', 'index.jsx'];
    const hasEntry = uploadFiles.some(f => entryFiles.includes(f.name.split('/').pop() || f.name));
    if (!hasEntry) throw new ToolError(VALIDATION_ERROR, 'Must include an entry file (index.ts/tsx/js/jsx)');

    // Bundle and upload to R2 at versioned path
    const { bundleCode } = await import('../services/bundler.ts');
    const validatedFiles = uploadFiles.map(f => ({ name: f.name, content: f.content }));
    const entryFile = validatedFiles.find(f => entryFiles.includes(f.name.split('/').pop() || f.name))!;

    let bundledCode = entryFile.content;
    try {
      const bundleResult = await bundleCode(validatedFiles, entryFile.name);
      if (bundleResult.success && bundleResult.code !== entryFile.content) {
        bundledCode = bundleResult.code;
      }
    } catch { /* use unbundled */ }

    // Extract exports
    const exportRegex = /export\s+(?:async\s+)?function\s+(\w+)/g;
    const constRegex = /export\s+(?:const|let|var)\s+(\w+)\s*=/g;
    const exports: string[] = [];
    let match;
    while ((match = exportRegex.exec(entryFile.content)) !== null) exports.push(match[1]);
    while ((match = constRegex.exec(entryFile.content)) !== null) exports.push(match[1]);

    const r2Service = createR2Service();
    const storageKey = `apps/${app.id}/${newVersion}/`;

    // Upload bundled + source
    const filesToUpload = [
      { name: entryFile.name, content: new TextEncoder().encode(bundledCode), contentType: 'text/typescript' },
      { name: `_source_${entryFile.name}`, content: new TextEncoder().encode(entryFile.content), contentType: 'text/typescript' },
      ...validatedFiles
        .filter(f => f.name !== entryFile.name)
        .map(f => ({ name: f.name, content: new TextEncoder().encode(f.content), contentType: 'text/plain' })),
    ];
    await r2Service.uploadFiles(storageKey, filesToUpload);

    // Update app: add version but do NOT change current_version
    const appsService = createAppsService();
    const versions = [...(app.versions || []), newVersion];
    await appsService.update(app.id, { versions } as Partial<App>);

    // Auto-generate Skills.md + embedding for this version
    const skills = await generateSkillsForVersion(app, storageKey, newVersion);

    return {
      app_id: app.id,
      slug: app.slug,
      version: newVersion,
      live_version: app.current_version,
      is_live: false,
      exports,
      skills_generated: !!skills.skillsMd,
      message: `Version ${newVersion} uploaded. Use ul.set.version to make it live.`,
    };
  } else {
    // ── New app: create + v1.0.0 live ──
    const result = await handleUploadFiles(userId, uploadFiles, {
      name: args.name as string,
      description: args.description as string,
      visibility: requestedVisibility as 'private' | 'unlisted' | 'public',
      app_type: 'mcp',
    });

    // Auto-generate Skills.md + embedding
    if (result.app_id) {
      const appsService = createAppsService();
      const app = await appsService.findById(result.app_id);
      if (app) {
        const skills = await generateSkillsForVersion(app, app.storage_key, result.version);
        // Rebuild library for new app
        rebuildUserLibrary(userId).catch(err => console.error('Library rebuild failed:', err));

        return {
          app_id: result.app_id,
          slug: result.slug,
          version: result.version,
          live_version: result.version,
          is_live: true,
          exports: result.exports,
          skills_generated: !!skills.skillsMd,
          url: result.url,
          mcp_endpoint: `/mcp/${result.app_id}`,
        };
      }
    }

    return result;
  }
}

// ── ul.download ──────────────────────────────────

async function executeDownload(
  userId: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const appIdOrSlug = args.app_id as string;
  if (!appIdOrSlug) throw new ToolError(INVALID_PARAMS, 'app_id is required');

  const appsService = createAppsService();
  let app = await appsService.findById(appIdOrSlug);
  if (!app) app = await appsService.findBySlug(userId, appIdOrSlug);
  if (!app) throw new ToolError(NOT_FOUND, `App not found: ${appIdOrSlug}`);

  // Check download access
  if (app.owner_id !== userId && app.download_access !== 'public') {
    throw new ToolError(FORBIDDEN, 'Source code download not allowed for this app');
  }

  const version = (args.version as string) || app.current_version;
  const storageKey = `apps/${app.id}/${version}/`;
  const r2Service = createR2Service();

  // List all files in this version
  const fileKeys = await r2Service.listFiles(storageKey);
  const files: Array<{ path: string; content: string }> = [];

  for (const key of fileKeys) {
    // Skip bundled files, only return source
    const relativePath = key.replace(storageKey, '');
    if (relativePath.startsWith('_source_') || !relativePath.includes('_source_')) {
      try {
        const content = await r2Service.fetchTextFile(key);
        const cleanPath = relativePath.replace('_source_', '');
        // Skip internal artifacts
        if (['skills.md', 'library.txt', 'embedding.json'].includes(cleanPath)) continue;
        files.push({ path: cleanPath, content });
      } catch { /* skip unreadable */ }
    }
  }

  return {
    app_id: app.id,
    name: app.name,
    version,
    files,
    file_count: files.length,
  };
}

// ── ul.set.version ───────────────────────────────

async function executeSetVersion(
  userId: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const appIdOrSlug = args.app_id as string;
  const version = args.version as string;
  if (!appIdOrSlug) throw new ToolError(INVALID_PARAMS, 'app_id is required');
  if (!version) throw new ToolError(INVALID_PARAMS, 'version is required');

  const app = await resolveApp(userId, appIdOrSlug);

  if (!(app.versions || []).includes(version)) {
    throw new ToolError(VALIDATION_ERROR, `Version ${version} does not exist. Available: ${(app.versions || []).join(', ')}`);
  }

  const previousVersion = app.current_version;
  const newStorageKey = `apps/${app.id}/${version}/`;

  // Read exports from the version's source
  const r2Service = createR2Service();
  let exports = app.exports;
  try {
    const entryNames = ['_source_index.ts', '_source_index.tsx', 'index.ts', 'index.tsx', 'index.js'];
    for (const entry of entryNames) {
      try {
        const code = await r2Service.fetchTextFile(`${newStorageKey}${entry}`);
        const exportRegex = /export\s+(?:async\s+)?function\s+(\w+)/g;
        const constRegex = /export\s+(?:const|let|var)\s+(\w+)\s*=/g;
        const newExports: string[] = [];
        let m;
        while ((m = exportRegex.exec(code)) !== null) newExports.push(m[1]);
        while ((m = constRegex.exec(code)) !== null) newExports.push(m[1]);
        if (newExports.length > 0) exports = newExports;
        break;
      } catch { /* try next */ }
    }
  } catch { /* keep existing exports */ }

  // Update app
  const appsService = createAppsService();
  await appsService.update(app.id, {
    current_version: version,
    storage_key: newStorageKey,
    exports,
  });

  // Load skills from this version's R2 artifacts
  try {
    const skillsMd = await r2Service.fetchTextFile(`${newStorageKey}skills.md`);
    const validation = validateAndParseSkillsMd(skillsMd);
    await appsService.update(app.id, {
      skills_md: skillsMd,
      skills_parsed: validation.skills_parsed,
    } as Partial<AppWithDraft>);
  } catch { /* no skills for this version */ }

  // Load embedding from this version
  try {
    const embeddingStr = await r2Service.fetchTextFile(`${newStorageKey}embedding.json`);
    const embedding = JSON.parse(embeddingStr);
    if (Array.isArray(embedding)) {
      await appsService.updateEmbedding(app.id, embedding);
    }
  } catch { /* no embedding */ }

  // Rebuild user Library.md (live versions only)
  rebuildUserLibrary(userId).catch(err => console.error('Library rebuild failed:', err));

  // If app is published, update global discovery index
  if (app.visibility === 'public') {
    try {
      const embeddingStr = await r2Service.fetchTextFile(`${newStorageKey}embedding.json`);
      const embedding = JSON.parse(embeddingStr);
      if (Array.isArray(embedding)) {
        await appsService.updateEmbedding(app.id, embedding);
      }
    } catch { /* best effort */ }
  }

  return {
    app_id: app.id,
    previous_version: previousVersion,
    live_version: version,
    exports,
  };
}

// ── ul.set.visibility ────────────────────────────

async function executeSetVisibility(
  userId: string,
  args: Record<string, unknown>,
  userTier: Tier
): Promise<unknown> {
  const appIdOrSlug = args.app_id as string;
  const visibility = args.visibility as string;
  if (!appIdOrSlug) throw new ToolError(INVALID_PARAMS, 'app_id is required');
  if (!visibility) throw new ToolError(INVALID_PARAMS, 'visibility is required');

  // Map 'published' → 'public' for DB storage (DB uses 'public')
  const dbVisibility = visibility === 'published' ? 'public' : visibility;

  const visibilityErr = checkVisibilityAllowed(userTier, dbVisibility as 'private' | 'unlisted' | 'public');
  if (visibilityErr) throw new ToolError(FORBIDDEN, visibilityErr);

  const app = await resolveApp(userId, appIdOrSlug);
  const previousVisibility = app.visibility;
  const appsService = createAppsService();

  await appsService.update(app.id, { visibility: dbVisibility as 'private' | 'unlisted' | 'public' });

  // If going TO published: ensure embedding is in global index
  if (dbVisibility === 'public' && previousVisibility !== 'public') {
    try {
      const r2Service = createR2Service();
      const embeddingStr = await r2Service.fetchTextFile(`${app.storage_key}embedding.json`);
      const embedding = JSON.parse(embeddingStr);
      if (Array.isArray(embedding)) {
        await appsService.updateEmbedding(app.id, embedding);
      }
    } catch { /* best effort */ }
  }

  // If going AWAY from published: clear embedding from global search
  if (dbVisibility !== 'public' && previousVisibility === 'public') {
    try {
      const { clearAppEmbedding } = await import('../services/embedding.ts');
      await clearAppEmbedding(app.id);
    } catch { /* best effort */ }
  }

  return {
    app_id: app.id,
    previous_visibility: previousVisibility,
    visibility: dbVisibility,
  };
}

// ── ul.set.download ──────────────────────────────

async function executeSetDownload(
  userId: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const appIdOrSlug = args.app_id as string;
  const access = args.access as string;
  if (!appIdOrSlug) throw new ToolError(INVALID_PARAMS, 'app_id is required');
  if (!access || !['owner', 'public'].includes(access)) {
    throw new ToolError(INVALID_PARAMS, 'access must be "owner" or "public"');
  }

  const app = await resolveApp(userId, appIdOrSlug);
  const appsService = createAppsService();
  await appsService.update(app.id, { download_access: access as 'owner' | 'public' });

  return { app_id: app.id, download_access: access };
}

// ── ul.set.supabase ──────────────────────────────

async function executeSetSupabase(
  userId: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const appIdOrSlug = args.app_id as string;
  const serverName = args.server_name;
  if (!appIdOrSlug) throw new ToolError(INVALID_PARAMS, 'app_id is required');

  const app = await resolveApp(userId, appIdOrSlug);
  const appsService = createAppsService();
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = getSupabaseEnv();

  if (serverName === null || serverName === undefined) {
    // Unassign supabase
    await appsService.update(app.id, {
      supabase_enabled: false,
      supabase_url: null,
      supabase_anon_key_encrypted: null,
      supabase_service_key_encrypted: null,
    } as Partial<App>);

    // Also clear supabase_config_id if it exists
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/apps?id=eq.${app.id}`, {
        method: 'PATCH',
        headers: {
          'apikey': SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ supabase_config_id: null }),
      });
    } catch { /* best effort */ }

    return { app_id: app.id, supabase: null, message: 'Supabase unassigned' };
  }

  // Look up user's supabase configs by name
  const { listSupabaseConfigs } = await import('./user.ts');
  const configs = await listSupabaseConfigs(userId);
  const config = configs.find((c: { name: string }) => c.name === serverName);

  if (!config) {
    throw new ToolError(NOT_FOUND, `Supabase config "${serverName}" not found. Available: ${configs.map((c: { name: string }) => c.name).join(', ') || 'none'}`);
  }

  // Assign config to app
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/apps?id=eq.${app.id}`, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        supabase_config_id: config.id,
        supabase_enabled: true,
        updated_at: new Date().toISOString(),
      }),
    });
  } catch (err) {
    throw new ToolError(INTERNAL_ERROR, `Failed to assign Supabase config: ${err instanceof Error ? err.message : String(err)}`);
  }

  return { app_id: app.id, supabase: serverName, config_id: config.id };
}

// ── ul.permissions.grant ─────────────────────────

async function executePermissionsGrant(
  userId: string,
  args: Record<string, unknown>,
  callerTier: Tier
): Promise<unknown> {
  const appIdOrSlug = args.app_id as string;
  const email = args.email as string;
  const functions = args.functions as string[] | undefined;

  if (!appIdOrSlug) throw new ToolError(INVALID_PARAMS, 'app_id is required');
  if (!email) throw new ToolError(INVALID_PARAMS, 'email is required');

  const app = await resolveApp(userId, appIdOrSlug);
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = getSupabaseEnv();

  // Resolve email → user_id + tier
  const userRes = await fetch(
    `${SUPABASE_URL}/rest/v1/users?email=eq.${encodeURIComponent(email)}&select=id,tier`,
    { headers: { 'apikey': SUPABASE_SERVICE_ROLE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } }
  );
  if (!userRes.ok) throw new ToolError(INTERNAL_ERROR, 'Failed to look up user');
  const userRows = await userRes.json();

  // If user doesn't exist yet, create a pending invite
  if (userRows.length === 0) {
    const functionsToGrant = (isProTier(callerTier) && functions && functions.length > 0)
      ? functions
      : (app.exports || []);
    if (functionsToGrant.length === 0) {
      throw new ToolError(VALIDATION_ERROR, 'App has no exported functions to grant');
    }
    const pendingRows = functionsToGrant.map(fn => ({
      app_id: app.id,
      invited_email: email.toLowerCase(),
      granted_by_user_id: userId,
      function_name: fn,
      allowed: true,
    }));
    const pendingRes = await fetch(
      `${SUPABASE_URL}/rest/v1/pending_permissions`,
      {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates',
        },
        body: JSON.stringify(pendingRows),
      }
    );
    if (!pendingRes.ok) {
      throw new ToolError(INTERNAL_ERROR, `Failed to create pending invite: ${await pendingRes.text()}`);
    }
    return {
      app_id: app.id,
      email,
      status: 'pending',
      functions_granted: functionsToGrant,
      note: `User "${email}" has not signed up yet. Permissions will activate when they create an account.`,
    };
  }

  const targetUserId = userRows[0].id;
  const targetTier = (userRows[0].tier || 'free') as Tier;

  if (targetUserId === userId) throw new ToolError(INVALID_PARAMS, 'Cannot grant permissions to yourself (owner has full access)');

  // Granular per-function permissions require both parties to be Pro
  const bothPro = isProTier(callerTier) && isProTier(targetTier);

  // Determine which functions to grant
  let functionsToGrant: string[];
  if (bothPro && functions && functions.length > 0) {
    // Pro→Pro: honour the granular functions list
    functionsToGrant = functions;
  } else {
    // Binary access: always grant ALL functions
    functionsToGrant = app.exports || [];
  }

  if (functionsToGrant.length === 0) {
    throw new ToolError(VALIDATION_ERROR, 'App has no exported functions to grant');
  }

  // Upsert permissions (additive — use ON CONFLICT)
  const rows = functionsToGrant.map(fn => ({
    app_id: app.id,
    granted_to_user_id: targetUserId,
    granted_by_user_id: userId,
    function_name: fn,
    allowed: true,
  }));

  const insertRes = await fetch(
    `${SUPABASE_URL}/rest/v1/user_app_permissions`,
    {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates',
      },
      body: JSON.stringify(rows),
    }
  );

  if (!insertRes.ok) {
    throw new ToolError(INTERNAL_ERROR, `Failed to grant permissions: ${await insertRes.text()}`);
  }

  return {
    app_id: app.id,
    email,
    user_id: targetUserId,
    functions_granted: functionsToGrant,
    ...(!bothPro && functions && functions.length > 0
      ? { note: 'Per-function permissions require both users to be on Pro. Granted all-or-nothing access.' }
      : {}),
  };
}

// ── ul.permissions.revoke ────────────────────────

async function executePermissionsRevoke(
  userId: string,
  args: Record<string, unknown>,
  callerTier: Tier
): Promise<unknown> {
  const appIdOrSlug = args.app_id as string;
  const email = args.email as string | undefined;
  const functions = args.functions as string[] | undefined;

  if (!appIdOrSlug) throw new ToolError(INVALID_PARAMS, 'app_id is required');

  const app = await resolveApp(userId, appIdOrSlug);
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = getSupabaseEnv();
  const headers = {
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  };

  // ── No email: revoke ALL users ──
  if (!email) {
    // Per-function revoke across all users requires Pro caller
    if (functions && functions.length > 0 && !isProTier(callerTier)) {
      // Free: ignore functions filter, revoke all access for all users
      const deleteUrl = `${SUPABASE_URL}/rest/v1/user_app_permissions?app_id=eq.${app.id}`;
      const res = await fetch(deleteUrl, { method: 'DELETE', headers });
      if (!res.ok) throw new ToolError(INTERNAL_ERROR, `Revoke failed: ${await res.text()}`);
      await fetch(`${SUPABASE_URL}/rest/v1/pending_permissions?app_id=eq.${app.id}`, { method: 'DELETE', headers });
      return { app_id: app.id, all_users: true, all_access_revoked: true, note: 'Per-function revoke requires Pro. Revoked all access instead.' };
    }

    let deleteUrl = `${SUPABASE_URL}/rest/v1/user_app_permissions?app_id=eq.${app.id}`;
    if (functions && functions.length > 0) {
      deleteUrl += `&function_name=in.(${functions.map(f => encodeURIComponent(f)).join(',')})`;
    }
    const res = await fetch(deleteUrl, { method: 'DELETE', headers });
    if (!res.ok) throw new ToolError(INTERNAL_ERROR, `Revoke failed: ${await res.text()}`);

    // Also revoke all pending invites for this app
    await fetch(`${SUPABASE_URL}/rest/v1/pending_permissions?app_id=eq.${app.id}`, { method: 'DELETE', headers });

    return functions && functions.length > 0
      ? { app_id: app.id, all_users: true, functions_revoked: functions }
      : { app_id: app.id, all_users: true, all_access_revoked: true };
  }

  // ── With email: revoke specific user ──
  const userRes = await fetch(
    `${SUPABASE_URL}/rest/v1/users?email=eq.${encodeURIComponent(email)}&select=id,tier`,
    { headers }
  );
  if (!userRes.ok) throw new ToolError(INTERNAL_ERROR, 'Failed to look up user');
  const userRows = await userRes.json();

  // User doesn't exist — try revoking pending invite
  if (userRows.length === 0) {
    const pendingDeleteUrl = `${SUPABASE_URL}/rest/v1/pending_permissions?app_id=eq.${app.id}&invited_email=eq.${encodeURIComponent(email.toLowerCase())}`;
    const res = await fetch(pendingDeleteUrl, { method: 'DELETE', headers });
    if (!res.ok) throw new ToolError(INTERNAL_ERROR, `Revoke failed: ${await res.text()}`);
    return { app_id: app.id, email, pending_invite_revoked: true };
  }
  const targetUserId = userRows[0].id;
  const targetTier = (userRows[0].tier || 'free') as Tier;

  const bothPro = isProTier(callerTier) && isProTier(targetTier);

  if (functions && functions.length > 0 && bothPro) {
    // Pro→Pro: revoke specific functions for specific user
    const deleteUrl = `${SUPABASE_URL}/rest/v1/user_app_permissions?granted_to_user_id=eq.${targetUserId}&app_id=eq.${app.id}&function_name=in.(${functions.map(f => encodeURIComponent(f)).join(',')})`;
    const res = await fetch(deleteUrl, { method: 'DELETE', headers });
    if (!res.ok) throw new ToolError(INTERNAL_ERROR, `Revoke failed: ${await res.text()}`);
    return { app_id: app.id, email, functions_revoked: functions };
  } else {
    // Binary: revoke all functions for specific user
    const deleteUrl = `${SUPABASE_URL}/rest/v1/user_app_permissions?granted_to_user_id=eq.${targetUserId}&app_id=eq.${app.id}`;
    const res = await fetch(deleteUrl, { method: 'DELETE', headers });
    if (!res.ok) throw new ToolError(INTERNAL_ERROR, `Revoke failed: ${await res.text()}`);
    return {
      app_id: app.id,
      email,
      all_access_revoked: true,
      ...(functions && functions.length > 0 && !bothPro
        ? { note: 'Per-function revoke requires both users to be on Pro. Revoked all access instead.' }
        : {}),
    };
  }
}

// ── ul.permissions.list ──────────────────────────

async function executePermissionsList(
  userId: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const appIdOrSlug = args.app_id as string;
  const emails = args.emails as string[] | undefined;
  const functions = args.functions as string[] | undefined;

  if (!appIdOrSlug) throw new ToolError(INVALID_PARAMS, 'app_id is required');

  const app = await resolveApp(userId, appIdOrSlug);
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = getSupabaseEnv();

  // Build query with optional filters
  let url = `${SUPABASE_URL}/rest/v1/user_app_permissions?app_id=eq.${app.id}&allowed=eq.true&select=granted_to_user_id,function_name,users!user_app_permissions_granted_to_user_id_fkey(email,display_name)`;

  // Filter by functions if provided
  if (functions && functions.length > 0) {
    url += `&function_name=in.(${functions.map(f => encodeURIComponent(f)).join(',')})`;
  }

  const response = await fetch(url, {
    headers: {
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });

  if (!response.ok) {
    // Fall back to simpler query without join
    const fallbackUrl = `${SUPABASE_URL}/rest/v1/user_app_permissions?app_id=eq.${app.id}&allowed=eq.true&select=granted_to_user_id,function_name`;
    const fallbackRes = await fetch(fallbackUrl, {
      headers: {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    });

    if (!fallbackRes.ok) throw new ToolError(INTERNAL_ERROR, 'Failed to fetch permissions');

    const rows = await fallbackRes.json();

    // Resolve user IDs to emails manually
    const userIds = [...new Set(rows.map((r: { granted_to_user_id: string }) => r.granted_to_user_id))] as string[];

    // Fetch user details
    const usersMap = new Map<string, { email: string; display_name: string | null }>();
    if (userIds.length > 0) {
      const usersRes = await fetch(
        `${SUPABASE_URL}/rest/v1/users?id=in.(${userIds.join(',')})&select=id,email,display_name`,
        {
          headers: {
            'apikey': SUPABASE_SERVICE_ROLE_KEY,
            'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
        }
      );
      if (usersRes.ok) {
        const users = await usersRes.json();
        for (const u of users) {
          usersMap.set(u.id, { email: u.email, display_name: u.display_name });
        }
      }
    }

    // Group by user
    const userPerms = new Map<string, { email: string; display_name: string | null; functions: string[] }>();
    for (const row of rows) {
      const userInfo = usersMap.get(row.granted_to_user_id);
      if (!userInfo) continue;

      // Filter by emails if provided
      if (emails && emails.length > 0 && !emails.includes(userInfo.email)) continue;

      if (!userPerms.has(row.granted_to_user_id)) {
        userPerms.set(row.granted_to_user_id, { email: userInfo.email, display_name: userInfo.display_name, functions: [] });
      }
      userPerms.get(row.granted_to_user_id)!.functions.push(row.function_name);
    }

    return {
      app_id: app.id,
      users: [...Array.from(userPerms.values()), ...await getPendingUsers(app.id, emails, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)],
    };
  }

  let rows = await response.json();

  // Group by user
  const userPerms = new Map<string, { email: string; display_name: string | null; functions: string[] }>();
  for (const row of rows) {
    const userInfo = row.users;
    if (!userInfo) continue;
    const userEmail = userInfo.email;

    // Filter by emails if provided
    if (emails && emails.length > 0 && !emails.includes(userEmail)) continue;

    if (!userPerms.has(row.granted_to_user_id)) {
      userPerms.set(row.granted_to_user_id, { email: userEmail, display_name: userInfo.display_name, functions: [] });
    }
    userPerms.get(row.granted_to_user_id)!.functions.push(row.function_name);
  }

  return {
    app_id: app.id,
    users: [...Array.from(userPerms.values()), ...await getPendingUsers(app.id, emails, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)],
  };
}

/** Fetch pending invites for an app and return as user-like objects */
async function getPendingUsers(
  appId: string,
  emailFilter: string[] | undefined,
  supabaseUrl: string,
  serviceKey: string
): Promise<Array<{ email: string; display_name: null; functions: string[]; status: 'pending' }>> {
  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/pending_permissions?app_id=eq.${appId}&allowed=eq.true&select=invited_email,function_name`,
      { headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` } }
    );
    if (!res.ok) return [];
    const rows = await res.json() as Array<{ invited_email: string; function_name: string }>;
    const pendingMap = new Map<string, { email: string; display_name: null; functions: string[]; status: 'pending' }>();
    for (const row of rows) {
      if (emailFilter && emailFilter.length > 0 && !emailFilter.includes(row.invited_email)) continue;
      if (!pendingMap.has(row.invited_email)) {
        pendingMap.set(row.invited_email, { email: row.invited_email, display_name: null, functions: [], status: 'pending' as const });
      }
      pendingMap.get(row.invited_email)!.functions.push(row.function_name);
    }
    return Array.from(pendingMap.values());
  } catch {
    return [];
  }
}

// ── ul.like / ul.dislike ──────────────────────────────────────

async function executeLikeDislike(
  userId: string,
  args: Record<string, unknown>,
  positive: boolean
): Promise<unknown> {
  const appIdOrSlug = args.app_id as string;
  if (!appIdOrSlug) throw new ToolError(INVALID_PARAMS, 'app_id is required');

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = getSupabaseEnv();
  const headers = {
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  };

  // Look up the app (don't use resolveApp which checks ownership)
  const appsService = createAppsService();
  let app = await appsService.findById(appIdOrSlug);
  if (!app) {
    const slugRes = await fetch(
      `${SUPABASE_URL}/rest/v1/apps?slug=eq.${encodeURIComponent(appIdOrSlug)}&deleted_at=is.null&select=id,owner_id,name,slug,visibility,likes,dislikes&limit=1`,
      { headers }
    );
    if (slugRes.ok) {
      const rows = await slugRes.json();
      if (rows.length > 0) app = rows[0] as App;
    }
  }
  if (!app) throw new ToolError(NOT_FOUND, `App not found: ${appIdOrSlug}`);

  if (app.owner_id === userId) {
    throw new ToolError(FORBIDDEN, `You cannot ${positive ? 'like' : 'dislike'} your own app`);
  }

  // Check if user already has a like/dislike for this app
  const existingRes = await fetch(
    `${SUPABASE_URL}/rest/v1/app_likes?user_id=eq.${userId}&app_id=eq.${app.id}&select=positive&limit=1`,
    { headers }
  );
  const existingRows = existingRes.ok ? await existingRes.json() : [];
  const existing = existingRows.length > 0 ? existingRows[0] : null;

  // Toggle: if already set to the same value, remove it
  if (existing && existing.positive === positive) {
    await fetch(
      `${SUPABASE_URL}/rest/v1/app_likes?user_id=eq.${userId}&app_id=eq.${app.id}`,
      { method: 'DELETE', headers }
    );
    // Clean up side-effect tables
    await fetch(
      `${SUPABASE_URL}/rest/v1/user_app_library?user_id=eq.${userId}&app_id=eq.${app.id}`,
      { method: 'DELETE', headers }
    );
    await fetch(
      `${SUPABASE_URL}/rest/v1/user_app_blocks?user_id=eq.${userId}&app_id=eq.${app.id}`,
      { method: 'DELETE', headers }
    );

    const updatedApp = await appsService.findById(app.id);
    return {
      app_id: app.id,
      app_name: app.name,
      action: positive ? 'unliked' : 'undisliked',
      likes: updatedApp?.likes ?? 0,
      dislikes: updatedApp?.dislikes ?? 0,
    };
  }

  // Upsert the like/dislike
  const upsertRes = await fetch(
    `${SUPABASE_URL}/rest/v1/app_likes`,
    {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates,return=representation',
      },
      body: JSON.stringify({
        app_id: app.id,
        user_id: userId,
        positive,
        updated_at: new Date().toISOString(),
      }),
    }
  );

  if (!upsertRes.ok) {
    throw new ToolError(INTERNAL_ERROR, `Failed to ${positive ? 'like' : 'dislike'}: ${await upsertRes.text()}`);
  }

  // Read back the updated app counters (trigger has already fired)
  const updatedApp = await appsService.findById(app.id);

  // Side-effects: library save / block
  try {
    if (positive) {
      await fetch(`${SUPABASE_URL}/rest/v1/user_app_library`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify({ user_id: userId, app_id: app.id, source: 'like' }),
      });
      await fetch(
        `${SUPABASE_URL}/rest/v1/user_app_blocks?user_id=eq.${userId}&app_id=eq.${app.id}`,
        { method: 'DELETE', headers }
      );
    } else {
      await fetch(`${SUPABASE_URL}/rest/v1/user_app_blocks`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify({ user_id: userId, app_id: app.id, reason: 'dislike' }),
      });
      await fetch(
        `${SUPABASE_URL}/rest/v1/user_app_library?user_id=eq.${userId}&app_id=eq.${app.id}`,
        { method: 'DELETE', headers }
      );
    }
  } catch (err) {
    console.error('Like/dislike side-effect error:', err);
  }

  return {
    app_id: app.id,
    app_name: app.name,
    action: positive ? 'liked' : 'disliked',
    saved_to_library: positive,
    blocked_from_appstore: !positive,
    likes: updatedApp?.likes ?? 0,
    dislikes: updatedApp?.dislikes ?? 0,
  };
}

// ── ul.logs ──────────────────────────────────────

async function executeLogs(
  userId: string,
  args: Record<string, unknown>,
  callerTier: Tier
): Promise<unknown> {
  const appIdOrSlug = args.app_id as string;
  const emails = args.emails as string[] | undefined;
  const functions = args.functions as string[] | undefined;
  const limit = Math.min((args.limit as number) || 50, 200);
  const since = args.since as string | undefined;

  if (!appIdOrSlug) throw new ToolError(INVALID_PARAMS, 'app_id is required');

  const app = await resolveApp(userId, appIdOrSlug);
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = getSupabaseEnv();
  const headers = {
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  };

  // ── Determine allowed user scope based on tier ──
  // Free: can only see own calls
  // Pro: can see own calls + calls from explicitly granted users (any visibility)
  //   Visibility doesn't gate historical log access — if you granted someone
  //   access while the app was private and later made it unlisted, you should
  //   still be able to see their historical logs. The permission rows are the
  //   source of truth for the trust relationship, not current visibility.
  let allowedUserIds: string[];

  if (!isProTier(callerTier)) {
    // Free tier: only own calls
    allowedUserIds = [userId];
  } else {
    // Pro: own calls + any explicitly granted users
    const permsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/user_app_permissions?app_id=eq.${app.id}&select=granted_to_user_id`,
      { headers }
    );
    const grantedRows = permsRes.ok
      ? await permsRes.json() as Array<{ granted_to_user_id: string }>
      : [];
    const grantedIds = [...new Set(grantedRows.map(r => r.granted_to_user_id))];
    allowedUserIds = [userId, ...grantedIds];
  }

  // Build PostgREST query against mcp_call_logs
  let url = `${SUPABASE_URL}/rest/v1/mcp_call_logs?app_id=eq.${app.id}&order=created_at.desc&limit=${limit}`;
  url += '&select=id,user_id,function_name,method,success,duration_ms,error_message,created_at';

  // Always scope to allowed users
  url += `&user_id=in.(${allowedUserIds.join(',')})`;

  if (since) {
    url += `&created_at=gt.${encodeURIComponent(since)}`;
  }

  if (functions && functions.length > 0) {
    url += `&function_name=in.(${functions.map(f => encodeURIComponent(f)).join(',')})`;
  }

  // If filtering by emails, resolve and intersect with allowed users
  if (emails && emails.length > 0) {
    const usersRes = await fetch(
      `${SUPABASE_URL}/rest/v1/users?email=in.(${emails.map(e => encodeURIComponent(e)).join(',')})&select=id,email`,
      { headers }
    );
    if (!usersRes.ok) throw new ToolError(INTERNAL_ERROR, 'Failed to resolve emails');
    const users = await usersRes.json() as Array<{ id: string; email: string }>;
    // Intersect with allowed users
    const filteredIds = users.map(u => u.id).filter(id => allowedUserIds.includes(id));

    if (filteredIds.length === 0) {
      return { app_id: app.id, logs: [], total: 0, message: 'No matching users found (or not in your permissions scope)' };
    }

    // Override the user_id filter with the intersected set
    url = url.replace(
      `&user_id=in.(${allowedUserIds.join(',')})`,
      `&user_id=in.(${filteredIds.join(',')})`
    );
  }

  const response = await fetch(url, { headers });
  if (!response.ok) throw new ToolError(INTERNAL_ERROR, `Failed to fetch logs: ${await response.text()}`);

  const rows = await response.json() as Array<{
    id: string;
    user_id: string;
    function_name: string;
    method: string;
    success: boolean;
    duration_ms: number | null;
    error_message: string | null;
    created_at: string;
  }>;

  // Resolve user_ids → emails for display
  const userMap = new Map<string, string>();
  const userIdsInResults = [...new Set(rows.map(r => r.user_id))];
  if (userIdsInResults.length > 0) {
    const usersRes = await fetch(
      `${SUPABASE_URL}/rest/v1/users?id=in.(${userIdsInResults.join(',')})&select=id,email`,
      { headers }
    );
    if (usersRes.ok) {
      for (const u of await usersRes.json() as Array<{ id: string; email: string }>) {
        userMap.set(u.id, u.email);
      }
    }
  }

  const logs = rows.map(r => ({
    id: r.id,
    caller_email: userMap.get(r.user_id) || r.user_id,
    function_name: r.function_name,
    method: r.method,
    success: r.success,
    duration_ms: r.duration_ms,
    error_message: r.error_message,
    created_at: r.created_at,
  }));

  return {
    app_id: app.id,
    app_name: app.name,
    logs,
    total: logs.length,
    ...(since ? { since } : {}),
    ...(!isProTier(callerTier) ? { scope: 'own_calls_only' } : { scope: 'granted_users' }),
  };
}

// ── ul.connect ───────────────────────────────────

async function executeConnect(
  userId: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const appIdOrSlug = args.app_id as string;
  const secrets = args.secrets as Record<string, string | null>;

  if (!appIdOrSlug) throw new ToolError(INVALID_PARAMS, 'app_id is required');
  if (!secrets || typeof secrets !== 'object') throw new ToolError(INVALID_PARAMS, 'secrets must be an object');

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = getSupabaseEnv();
  const headers = {
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };

  // Look up the app (anyone can connect to a public/unlisted app, or a private app they have permissions on)
  const appsService = createAppsService();
  let app = await appsService.findById(appIdOrSlug);
  if (!app) {
    // Try slug lookup across all apps
    const slugRes = await fetch(
      `${SUPABASE_URL}/rest/v1/apps?slug=eq.${encodeURIComponent(appIdOrSlug)}&deleted_at=is.null&select=id,owner_id,name,slug,visibility,env_schema&limit=1`,
      { headers }
    );
    if (slugRes.ok) {
      const rows = await slugRes.json();
      if (rows.length > 0) app = rows[0] as App;
    }
  }
  if (!app) throw new ToolError(NOT_FOUND, `App not found: ${appIdOrSlug}`);

  // Get env_schema to validate keys
  const envSchema = ((app as Record<string, unknown>).env_schema || {}) as Record<string, EnvSchemaEntry>;
  const perUserKeys = Object.entries(envSchema)
    .filter(([, v]) => v.scope === 'per_user')
    .map(([k]) => k);

  // Validate that submitted keys are declared per_user keys (if schema exists and has per_user keys)
  if (perUserKeys.length > 0) {
    for (const key of Object.keys(secrets)) {
      if (!perUserKeys.includes(key)) {
        throw new ToolError(INVALID_PARAMS, `Key "${key}" is not a declared per-user secret. Available: ${perUserKeys.join(', ')}`);
      }
    }
  }

  const setKeys: string[] = [];
  const removedKeys: string[] = [];

  for (const [key, value] of Object.entries(secrets)) {
    if (value === null) {
      // Remove this key
      const deleteRes = await fetch(
        `${SUPABASE_URL}/rest/v1/user_app_secrets?user_id=eq.${userId}&app_id=eq.${app.id}&key=eq.${encodeURIComponent(key)}`,
        { method: 'DELETE', headers }
      );
      if (!deleteRes.ok) {
        throw new ToolError(INTERNAL_ERROR, `Failed to remove secret "${key}": ${await deleteRes.text()}`);
      }
      removedKeys.push(key);
    } else {
      // Encrypt and upsert the value
      const encrypted = await encryptEnvVar(value);

      const upsertRes = await fetch(
        `${SUPABASE_URL}/rest/v1/user_app_secrets`,
        {
          method: 'POST',
          headers: {
            ...headers,
            'Prefer': 'resolution=merge-duplicates',
          },
          body: JSON.stringify({
            user_id: userId,
            app_id: app.id,
            key,
            value_encrypted: encrypted,
            updated_at: new Date().toISOString(),
          }),
        }
      );
      if (!upsertRes.ok) {
        throw new ToolError(INTERNAL_ERROR, `Failed to set secret "${key}": ${await upsertRes.text()}`);
      }
      setKeys.push(key);
    }
  }

  // Check connection status after changes
  const remainingRes = await fetch(
    `${SUPABASE_URL}/rest/v1/user_app_secrets?user_id=eq.${userId}&app_id=eq.${app.id}&select=key`,
    { headers }
  );
  const remainingRows = remainingRes.ok ? await remainingRes.json() as Array<{ key: string }> : [];
  const connectedKeys = remainingRows.map(r => r.key);

  // Determine if all required per_user keys are provided
  const requiredKeys = Object.entries(envSchema)
    .filter(([, v]) => v.scope === 'per_user' && v.required)
    .map(([k]) => k);
  const missingRequired = requiredKeys.filter(k => !connectedKeys.includes(k));

  return {
    app_id: app.id,
    app_name: app.name,
    keys_set: setKeys,
    keys_removed: removedKeys,
    connected_keys: connectedKeys,
    missing_required: missingRequired,
    fully_connected: missingRequired.length === 0 && connectedKeys.length > 0,
  };
}

// ── ul.connections ───────────────────────────────

async function executeConnections(
  userId: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const appIdOrSlug = args.app_id as string | undefined;
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = getSupabaseEnv();
  const headers = {
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  };

  if (!appIdOrSlug) {
    // ── No app_id: list all apps the user has secrets for ──
    const secretsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/user_app_secrets?user_id=eq.${userId}&select=app_id,key`,
      { headers }
    );
    if (!secretsRes.ok) throw new ToolError(INTERNAL_ERROR, 'Failed to fetch connections');
    const secretRows = await secretsRes.json() as Array<{ app_id: string; key: string }>;

    if (secretRows.length === 0) {
      return { connections: [], total: 0 };
    }

    // Group by app_id
    const appSecrets = new Map<string, string[]>();
    for (const row of secretRows) {
      if (!appSecrets.has(row.app_id)) appSecrets.set(row.app_id, []);
      appSecrets.get(row.app_id)!.push(row.key);
    }

    // Fetch app details
    const appIds = [...appSecrets.keys()];
    const appsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/apps?id=in.(${appIds.join(',')})&deleted_at=is.null&select=id,name,slug,env_schema`,
      { headers }
    );
    const apps = appsRes.ok ? await appsRes.json() as Array<{ id: string; name: string; slug: string; env_schema: Record<string, EnvSchemaEntry> | null }> : [];

    const connections = apps.map(a => {
      const connectedKeys = appSecrets.get(a.id) || [];
      const schema = a.env_schema || {};
      const requiredKeys = Object.entries(schema)
        .filter(([, v]) => v.scope === 'per_user' && v.required)
        .map(([k]) => k);
      const missingRequired = requiredKeys.filter(k => !connectedKeys.includes(k));

      return {
        app_id: a.id,
        app_name: a.name,
        app_slug: a.slug,
        connected_keys: connectedKeys,
        missing_required: missingRequired,
        fully_connected: missingRequired.length === 0,
        mcp_endpoint: `/mcp/${a.id}`,
      };
    });

    return { connections, total: connections.length };
  }

  // ── With app_id: show detail for one app ──
  const appsService = createAppsService();
  let app = await appsService.findById(appIdOrSlug);
  if (!app) {
    const slugRes = await fetch(
      `${SUPABASE_URL}/rest/v1/apps?slug=eq.${encodeURIComponent(appIdOrSlug)}&deleted_at=is.null&select=id,owner_id,name,slug,visibility,env_schema&limit=1`,
      { headers }
    );
    if (slugRes.ok) {
      const rows = await slugRes.json();
      if (rows.length > 0) app = rows[0] as App;
    }
  }
  if (!app) throw new ToolError(NOT_FOUND, `App not found: ${appIdOrSlug}`);

  const envSchema = ((app as Record<string, unknown>).env_schema || {}) as Record<string, EnvSchemaEntry>;

  // Get per_user schema entries
  const perUserSchema = Object.entries(envSchema)
    .filter(([, v]) => v.scope === 'per_user')
    .map(([key, v]) => ({
      key,
      description: v.description || null,
      required: v.required ?? false,
    }));

  // Get user's connected keys for this app
  const secretsRes = await fetch(
    `${SUPABASE_URL}/rest/v1/user_app_secrets?user_id=eq.${userId}&app_id=eq.${app.id}&select=key,updated_at`,
    { headers }
  );
  const secretRows = secretsRes.ok
    ? await secretsRes.json() as Array<{ key: string; updated_at: string }>
    : [];
  const connectedKeys = secretRows.map(r => r.key);
  const keyDates = new Map(secretRows.map(r => [r.key, r.updated_at]));

  // Build status per key
  const requiredPerUser = perUserSchema.filter(s => s.required).map(s => s.key);
  const missingRequired = requiredPerUser.filter(k => !connectedKeys.includes(k));

  const secretStatus = perUserSchema.map(s => ({
    key: s.key,
    description: s.description,
    required: s.required,
    connected: connectedKeys.includes(s.key),
    updated_at: keyDates.get(s.key) || null,
  }));

  // Also show any user-provided keys not in schema (legacy or manual)
  const schemaKeys = perUserSchema.map(s => s.key);
  const extraKeys = connectedKeys.filter(k => !schemaKeys.includes(k));
  for (const key of extraKeys) {
    secretStatus.push({
      key,
      description: null,
      required: false,
      connected: true,
      updated_at: keyDates.get(key) || null,
    });
  }

  return {
    app_id: app.id,
    app_name: app.name,
    app_slug: app.slug,
    mcp_endpoint: `/mcp/${app.id}`,
    required_secrets: perUserSchema,
    secret_status: secretStatus,
    connected_keys: connectedKeys,
    missing_required: missingRequired,
    fully_connected: missingRequired.length === 0 && (connectedKeys.length > 0 || perUserSchema.length === 0),
  };
}

// ── ul.discover.desk ─────────────────────────────

async function executeDiscoverDesk(userId: string): Promise<unknown> {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = getSupabaseEnv();
  const headers = {
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  };

  // Get the last 3 distinct apps the user has called, ordered by most recent
  // Uses mcp_call_logs which already has idx_mcp_logs_user_time index
  const logsRes = await fetch(
    `${SUPABASE_URL}/rest/v1/mcp_call_logs?user_id=eq.${userId}&select=app_id,app_name,created_at&order=created_at.desc&limit=50`,
    { headers }
  );

  if (!logsRes.ok) {
    return { desk: [], total: 0 };
  }

  const logs = await logsRes.json() as Array<{ app_id: string | null; app_name: string | null; created_at: string }>;

  // Deduplicate by app_id, keep first (most recent) occurrence, limit to 3
  const seen = new Set<string>();
  const recentAppIds: Array<{ app_id: string; last_used: string }> = [];
  for (const log of logs) {
    if (!log.app_id || seen.has(log.app_id)) continue;
    seen.add(log.app_id);
    recentAppIds.push({ app_id: log.app_id, last_used: log.created_at });
    if (recentAppIds.length >= 3) break;
  }

  if (recentAppIds.length === 0) {
    return { desk: [], total: 0 };
  }

  // Fetch app details for the recent apps
  const appIds = recentAppIds.map(r => r.app_id);
  const appsRes = await fetch(
    `${SUPABASE_URL}/rest/v1/apps?id=in.(${appIds.join(',')})&deleted_at=is.null&select=id,name,slug,description,owner_id,visibility`,
    { headers }
  );

  if (!appsRes.ok) {
    return { desk: [], total: 0 };
  }

  const apps = await appsRes.json() as Array<{ id: string; name: string; slug: string; description: string | null; owner_id: string; visibility: string }>;
  const appMap = new Map(apps.map(a => [a.id, a]));

  const desk = recentAppIds
    .map(r => {
      const app = appMap.get(r.app_id);
      if (!app) return null;
      return {
        id: app.id,
        name: app.name,
        slug: app.slug,
        description: app.description,
        is_owner: app.owner_id === userId,
        mcp_endpoint: `/mcp/${app.id}`,
        last_used: r.last_used,
      };
    })
    .filter(Boolean);

  return { desk, total: desk.length };
}

// ── ul.discover.library ──────────────────────────

async function executeDiscoverLibrary(
  userId: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const query = args.query as string | undefined;
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = getSupabaseEnv();
  const headers = {
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  };

  // Fetch saved app IDs from user_app_library (liked apps)
  let savedAppIds: string[] = [];
  try {
    const savedRes = await fetch(
      `${SUPABASE_URL}/rest/v1/user_app_library?user_id=eq.${userId}&select=app_id`,
      { headers }
    );
    if (savedRes.ok) {
      const rows = await savedRes.json() as Array<{ app_id: string }>;
      savedAppIds = rows.map(r => r.app_id);
    }
  } catch { /* best effort */ }

  // Fetch saved app details if any exist
  let savedApps: App[] = [];
  if (savedAppIds.length > 0) {
    try {
      const appsRes = await fetch(
        `${SUPABASE_URL}/rest/v1/apps?id=in.(${savedAppIds.join(',')})&deleted_at=is.null&select=*`,
        { headers }
      );
      if (appsRes.ok) {
        savedApps = await appsRes.json() as App[];
      }
    } catch { /* best effort */ }
  }

  if (!query) {
    // Return full Library.md + saved apps list
    const r2Service = createR2Service();
    let libraryMd: string | null = null;
    try {
      libraryMd = await r2Service.fetchTextFile(`users/${userId}/library.md`);
    } catch {
      await rebuildUserLibrary(userId);
      try {
        libraryMd = await r2Service.fetchTextFile(`users/${userId}/library.md`);
      } catch { /* no library yet */ }
    }

    if (!libraryMd) {
      // Inline list as fallback
      const appsService = createAppsService();
      const apps = await appsService.listByOwner(userId);
      const ownedList = apps.map(a => ({
        id: a.id, name: a.name, slug: a.slug, description: a.description,
        visibility: a.visibility, version: a.current_version,
        source: 'owned' as const, mcp_endpoint: `/mcp/${a.id}`,
      }));
      const savedList = savedApps.map(a => ({
        id: a.id, name: a.name, slug: a.slug, description: a.description,
        visibility: a.visibility, version: a.current_version,
        source: 'saved' as const, mcp_endpoint: `/mcp/${a.id}`,
      }));
      return { library: [...ownedList, ...savedList] };
    }

    // Append saved apps section to Library.md
    if (savedApps.length > 0) {
      const savedSection = '\n\n## Saved Apps\n\nApps you\'ve liked.\n\n' +
        savedApps.map(a =>
          `## ${a.name || a.slug}\n${a.description || 'No description'}\nMCP: /mcp/${a.id}`
        ).join('\n\n');
      libraryMd += savedSection;
    }

    return { library: libraryMd };
  }

  // Semantic search against user's app embeddings
  const embeddingService = createEmbeddingService();
  if (!embeddingService) {
    // Fall back to text search across owned + saved
    const appsService = createAppsService();
    const ownedApps = await appsService.listByOwner(userId);
    const allApps = [...ownedApps, ...savedApps.filter(sa => sa.owner_id !== userId)];
    const queryLower = query.toLowerCase();
    const matches = allApps.filter(a =>
      a.name.toLowerCase().includes(queryLower) ||
      (a.description || '').toLowerCase().includes(queryLower) ||
      (a.tags || []).some(t => t.toLowerCase().includes(queryLower))
    );
    return {
      query,
      results: matches.map(a => ({
        id: a.id, name: a.name, slug: a.slug, description: a.description,
        source: a.owner_id === userId ? 'owned' : 'saved',
        mcp_endpoint: `/mcp/${a.id}`,
      })),
    };
  }

  // Generate query embedding and search (includes own private apps)
  const queryResult = await embeddingService.embed(query);
  const appsService = createAppsService();
  const results = await appsService.searchByEmbedding(
    queryResult.embedding,
    userId,
    true, // include private (own apps)
    20,
    0.3
  );

  // Filter to own apps + saved apps
  const savedAppIdSet = new Set(savedAppIds);
  const libraryResults = results.filter(r =>
    r.owner_id === userId || savedAppIdSet.has(r.id)
  );

  return {
    query,
    results: libraryResults.map(r => ({
      id: r.id, name: r.name, slug: r.slug, description: r.description,
      similarity: r.similarity,
      source: r.owner_id === userId ? 'owned' : 'saved',
      mcp_endpoint: `/mcp/${r.id}`,
    })),
  };
}

// ── ul.discover.appstore ─────────────────────────

async function executeDiscoverAppstore(
  userId: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const query = args.query as string;
  if (!query) throw new ToolError(INVALID_PARAMS, 'query is required');

  const limit = (args.limit as number) || 10;
  const overFetchLimit = limit * 3; // Over-fetch 3x for re-ranking pool

  const embeddingService = createEmbeddingService();
  if (!embeddingService) {
    throw new ToolError(INTERNAL_ERROR, 'Embedding service not available');
  }

  const queryResult = await embeddingService.embed(query);
  const appsService = createAppsService();
  const results = await appsService.searchByEmbedding(
    queryResult.embedding,
    userId,
    false, // public only
    overFetchLimit,
    0.4
  );

  // Filter out blocked apps (disliked)
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = getSupabaseEnv();
  const headers = {
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  };

  let blockedAppIds = new Set<string>();
  try {
    const blocksRes = await fetch(
      `${SUPABASE_URL}/rest/v1/user_app_blocks?user_id=eq.${userId}&select=app_id`,
      { headers }
    );
    if (blocksRes.ok) {
      const rows = await blocksRes.json() as Array<{ app_id: string }>;
      blockedAppIds = new Set(rows.map(r => r.app_id));
    }
  } catch { /* best effort */ }

  const filteredResults = results.filter(r => !blockedAppIds.has(r.id));

  // Fetch env_schema and user connection status for re-ranking
  const appIds = filteredResults.map(r => r.id);

  let envSchemas = new Map<string, Record<string, EnvSchemaEntry>>();
  if (appIds.length > 0) {
    try {
      const schemaRes = await fetch(
        `${SUPABASE_URL}/rest/v1/apps?id=in.(${appIds.join(',')})&select=id,env_schema`,
        { headers }
      );
      if (schemaRes.ok) {
        const rows = await schemaRes.json() as Array<{ id: string; env_schema: Record<string, EnvSchemaEntry> | null }>;
        for (const row of rows) {
          if (row.env_schema) envSchemas.set(row.id, row.env_schema);
        }
      }
    } catch { /* best effort */ }
  }

  let userConnections = new Map<string, string[]>();
  if (appIds.length > 0) {
    try {
      const secretsRes = await fetch(
        `${SUPABASE_URL}/rest/v1/user_app_secrets?user_id=eq.${userId}&app_id=in.(${appIds.join(',')})&select=app_id,key`,
        { headers }
      );
      if (secretsRes.ok) {
        const rows = await secretsRes.json() as Array<{ app_id: string; key: string }>;
        for (const row of rows) {
          if (!userConnections.has(row.app_id)) userConnections.set(row.app_id, []);
          userConnections.get(row.app_id)!.push(row.key);
        }
      }
    } catch { /* best effort */ }
  }

  // ── COMPOSITE RE-RANKING ──
  // final_score = (similarity * 0.7) + (native_boost * 0.15) + (like_signal * 0.15)

  const scored = filteredResults.map(r => {
    const rr = r as App & { similarity: number; weighted_likes?: number; weighted_dislikes?: number };

    // native_boost: reward apps that need no user configuration
    const schema = envSchemas.get(rr.id) || {};
    const perUserEntries = Object.entries(schema).filter(([, v]) => v.scope === 'per_user');
    const requiredPerUser = perUserEntries.filter(([, v]) => v.required);
    const connectedKeys = userConnections.get(rr.id) || [];

    let nativeBoost: number;
    if (perUserEntries.length === 0) {
      nativeBoost = 1.0; // fully native — no per-user env vars
    } else if (requiredPerUser.length === 0) {
      nativeBoost = 0.3; // optional per-user keys only
    } else {
      const requiredKeys = requiredPerUser.map(([key]) => key);
      const missingRequired = requiredKeys.filter(k => !connectedKeys.includes(k));
      nativeBoost = missingRequired.length === 0 ? 0.8 : 0.0;
    }

    // like_signal: paid-tier likes only (free likes have zero weight)
    const wLikes = rr.weighted_likes ?? 0;
    const wDislikes = rr.weighted_dislikes ?? 0;
    const likeSignal = wLikes / (wLikes + wDislikes + 1);

    // composite score
    const finalScore = (rr.similarity * 0.7) + (nativeBoost * 0.15) + (likeSignal * 0.15);

    // connection info (computed here so we don't recompute in formatting)
    const requiredSecrets = Object.entries(schema)
      .filter(([, v]) => v.scope === 'per_user')
      .map(([key, v]) => ({ key, description: v.description || null, required: v.required ?? false }));
    const requiredKeys = requiredSecrets.filter(s => s.required).map(s => s.key);
    const missingRequired = requiredKeys.filter(k => !connectedKeys.includes(k));

    return {
      id: rr.id,
      name: rr.name,
      slug: rr.slug,
      description: rr.description,
      owner_id: rr.owner_id,
      similarity: rr.similarity,
      likes: rr.likes ?? 0,
      dislikes: rr.dislikes ?? 0,
      finalScore,
      requiredSecrets,
      connected: connectedKeys.length > 0,
      fullyConnected: requiredSecrets.length === 0 || missingRequired.length === 0,
    };
  });

  // Sort by final_score DESC
  scored.sort((a, b) => b.finalScore - a.finalScore);

  // ── LUCK SHUFFLE (top 5) ──
  // Among the top 5 results, add a random bonus proportional to the gap from #1.
  // Close competitors swap frequently; distant results rarely overtake.
  if (scored.length >= 2) {
    const shuffleCount = Math.min(5, scored.length);
    const topSlice = scored.slice(0, shuffleCount);
    const topScore = topSlice[0].finalScore;

    const shuffled = topSlice.map(app => {
      const gap = topScore - app.finalScore;
      const luckBonus = Math.random() * gap * 0.5;
      return { app, shuffledScore: app.finalScore + luckBonus };
    });
    shuffled.sort((a, b) => b.shuffledScore - a.shuffledScore);

    for (let i = 0; i < shuffleCount; i++) {
      scored[i] = shuffled[i].app;
    }
  }

  // Truncate to requested limit
  const finalResults = scored.slice(0, limit);

  // ── LOG QUERY (fire-and-forget) ──
  const queryId = crypto.randomUUID();
  try {
    const resultsForLog = finalResults.map((r, i) => ({
      app_id: r.id,
      position: i + 1,
      final_score: Math.round(r.finalScore * 10000) / 10000,
      similarity: Math.round(r.similarity * 10000) / 10000,
    }));
    fetch(`${SUPABASE_URL}/rest/v1/appstore_queries`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: queryId,
        query,
        top_similarity: finalResults.length > 0 ? Math.round(finalResults[0].similarity * 10000) / 10000 : null,
        top_final_score: finalResults.length > 0 ? Math.round(finalResults[0].finalScore * 10000) / 10000 : null,
        result_count: finalResults.length,
        results: resultsForLog,
      }),
    }).catch(err => console.error('Failed to log appstore query:', err));
  } catch { /* best effort */ }

  // ── FORMAT RESPONSE ──
  return {
    query,
    query_id: queryId,
    results: finalResults.map(r => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      description: r.description,
      similarity: r.similarity,
      final_score: Math.round(r.finalScore * 10000) / 10000,
      is_owner: r.owner_id === userId,
      mcp_endpoint: `/mcp/${r.id}`,
      likes: r.likes,
      dislikes: r.dislikes,
      required_secrets: r.requiredSecrets.length > 0 ? r.requiredSecrets : undefined,
      connected: r.connected,
      fully_connected: r.fullyConnected,
    })),
    total: finalResults.length,
  };
}

// ============================================
// RESPONSE HELPERS
// ============================================

function formatToolResult(result: unknown): MCPToolCallResponse {
  const content: MCPContent[] = [];
  if (result !== undefined && result !== null) {
    content.push({
      type: 'text',
      text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
    });
  }
  return { content, structuredContent: result, isError: false };
}

function formatToolError(err: unknown): MCPToolCallResponse {
  const message = err instanceof Error
    ? err.message
    : (err as { message?: string })?.message || String(err);
  return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
}

function jsonRpcResponse(id: string | number | null, result: unknown): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

function jsonRpcErrorResponse(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown
): Response {
  return new Response(
    JSON.stringify({ jsonrpc: '2.0', id, error: { code, message, data } }),
    {
      status: code === RATE_LIMITED ? 429 : code < 0 ? 400 : 500,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

// ============================================
// WELL-KNOWN DISCOVERY
// ============================================

export function handlePlatformMcpDiscovery(): Response {
  const discovery = {
    name: 'Ultralight Platform',
    version: '2.0.0',
    description: 'MCP-first app hosting. Upload, configure, discover, manage permissions, and view logs.',
    capabilities: { tools: { listChanged: false } },
    endpoints: {
      platform: '/mcp/platform',
      apps: '/mcp/{appId}',
    },
    tools_count: PLATFORM_TOOLS.length,
    documentation: 'https://ultralight.dev/docs/mcp',
  };
  return json(discovery);
}
