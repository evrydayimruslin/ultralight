// Platform MCP Handler
// Implements JSON-RPC 2.0 protocol for platform-level app management
// Endpoint: POST /mcp/platform
// Spec: https://modelcontextprotocol.io/specification/draft/server/tools

import { json, error } from './app.ts';
import { authenticate } from './auth.ts';
import { isApiToken } from '../services/tokens.ts';
import { createAppsService } from '../services/apps.ts';
import { createR2Service } from '../services/storage.ts';
import { checkRateLimit } from '../services/ratelimit.ts';
import { checkAndIncrementWeeklyCalls } from '../services/weekly-calls.ts';
import { getPermissionsForUser } from './user.ts';
import { type Tier } from '../../shared/types/index.ts';
import { handleUploadFiles, type UploadFile } from './upload.ts';
import { handleDraftUploadFiles } from './upload.ts';
import {
  generateSkillsMd,
  validateAndParseSkillsMd,
  generateEmbeddingText,
} from '../services/docgen.ts';
import { createEmbeddingService } from '../services/embedding.ts';
import { handleDiscover as discoverApps } from './discover.ts';
import { executeInSandbox, type UserContext } from '../runtime/sandbox.ts';
import { createAppDataService } from '../services/appdata.ts';
import { decryptEnvVars, decryptEnvVar } from '../services/envvars.ts';
import { checkVisibilityAllowed } from '../services/tier-enforcement.ts';
import type {
  MCPTool,
  MCPJsonSchema,
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
// PLATFORM MCP TOOLS DEFINITIONS
// ============================================

const PLATFORM_TOOLS: MCPTool[] = [
  // ============================================
  // APP LIFECYCLE
  // ============================================
  {
    name: 'platform.apps.list',
    title: 'List Apps',
    description: 'List all apps owned by the authenticated user. Returns app metadata including name, slug, visibility, version, and run statistics.',
    inputSchema: {
      type: 'object',
      properties: {
        visibility: {
          type: 'string',
          enum: ['all', 'public', 'private', 'unlisted'],
          description: 'Filter by visibility (default: all)',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results (default: 50, max: 100)',
        },
        offset: {
          type: 'number',
          description: 'Number of results to skip for pagination',
        },
        include_drafts: {
          type: 'boolean',
          description: 'Include draft information in response',
        },
      },
    },
  },
  {
    name: 'platform.apps.get',
    title: 'Get App Details',
    description: 'Get detailed information about a specific app including metadata, skills, exports, and optionally source code.',
    inputSchema: {
      type: 'object',
      properties: {
        app_id: {
          type: 'string',
          description: 'App ID (UUID) or slug',
        },
        include_code: {
          type: 'boolean',
          description: 'Include source code in response',
        },
        include_skills: {
          type: 'boolean',
          description: 'Include parsed skills data',
        },
      },
      required: ['app_id'],
    },
  },
  {
    name: 'platform.apps.create',
    title: 'Create App',
    description: 'Create a new app by uploading source code files. Returns the created app with ID, URL, and build status.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Display name for the app',
        },
        slug: {
          type: 'string',
          description: 'URL-friendly slug (auto-generated if omitted)',
        },
        description: {
          type: 'string',
          description: 'App description',
        },
        visibility: {
          type: 'string',
          enum: ['private', 'unlisted', 'public'],
          description: 'App visibility (default: private)',
        },
        files: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'File path relative to project root (e.g., "index.ts", "lib/utils.ts")',
              },
              content: {
                type: 'string',
                description: 'File content (plain text or base64 encoded)',
              },
              encoding: {
                type: 'string',
                enum: ['text', 'base64'],
                description: 'Content encoding (default: text)',
              },
            },
            required: ['path', 'content'],
          },
          description: 'Source files to upload. Must include an entry file (index.ts/tsx/js/jsx)',
        },
        auto_generate_docs: {
          type: 'boolean',
          description: 'Automatically generate Skills.md documentation (default: true)',
        },
        app_type: {
          type: 'string',
          enum: ['mcp'],
          description: 'App type: mcp (functions only), ui (React UI only), hybrid (both). Auto-detected if not specified.',
        },
        functions_entry: {
          type: 'string',
          description: 'Entry file for MCP functions (e.g., "functions.ts"). Required for mcp/hybrid if not using index.ts',
        },
        ui_entry: {
          type: 'string',
          description: 'Entry file for UI component (e.g., "ui.tsx"). Required for ui/hybrid if not using index.tsx',
        },
      },
      required: ['files'],
    },
  },
  {
    name: 'platform.apps.update',
    title: 'Update App Metadata',
    description: 'Update app metadata (name, description, visibility, tags). Does not modify code - use draft.upload for code changes.',
    inputSchema: {
      type: 'object',
      properties: {
        app_id: {
          type: 'string',
          description: 'App ID or slug',
        },
        name: {
          type: 'string',
          description: 'New display name',
        },
        description: {
          type: 'string',
          description: 'New description',
        },
        visibility: {
          type: 'string',
          enum: ['private', 'unlisted', 'public'],
          description: 'New visibility setting',
        },
        category: {
          type: 'string',
          description: 'App category',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'App tags for discovery',
        },
      },
      required: ['app_id'],
    },
  },
  {
    name: 'platform.apps.delete',
    title: 'Delete App',
    description: 'Soft-delete an app. The app can potentially be restored by contacting support.',
    inputSchema: {
      type: 'object',
      properties: {
        app_id: {
          type: 'string',
          description: 'App ID or slug to delete',
        },
        confirm: {
          type: 'boolean',
          description: 'Must be true to confirm deletion',
        },
      },
      required: ['app_id', 'confirm'],
    },
  },

  // ============================================
  // DRAFT/PUBLISH WORKFLOW
  // ============================================
  {
    name: 'platform.draft.upload',
    title: 'Upload Draft',
    description: 'Upload new code as a draft without affecting the production version. Use platform.draft.publish to deploy.',
    inputSchema: {
      type: 'object',
      properties: {
        app_id: {
          type: 'string',
          description: 'App ID or slug',
        },
        files: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              content: { type: 'string' },
              encoding: { type: 'string', enum: ['text', 'base64'] },
            },
            required: ['path', 'content'],
          },
          description: 'Source files for the draft',
        },
        app_type: {
          type: 'string',
          enum: ['mcp'],
          description: 'App type override for the draft',
        },
        functions_entry: {
          type: 'string',
          description: 'Entry file for MCP functions',
        },
        ui_entry: {
          type: 'string',
          description: 'Entry file for UI component',
        },
      },
      required: ['app_id', 'files'],
    },
  },
  {
    name: 'platform.draft.get',
    title: 'Get Draft Info',
    description: 'Get information about the current draft including uploaded files and comparison with production.',
    inputSchema: {
      type: 'object',
      properties: {
        app_id: {
          type: 'string',
          description: 'App ID or slug',
        },
        include_diff: {
          type: 'boolean',
          description: 'Include diff summary with production version',
        },
      },
      required: ['app_id'],
    },
  },
  {
    name: 'platform.draft.publish',
    title: 'Publish Draft',
    description: 'Publish the current draft to production. Increments the version number and optionally regenerates documentation.',
    inputSchema: {
      type: 'object',
      properties: {
        app_id: {
          type: 'string',
          description: 'App ID or slug',
        },
        regenerate_docs: {
          type: 'boolean',
          description: 'Regenerate Skills.md from new code (default: true)',
        },
        version_bump: {
          type: 'string',
          enum: ['patch', 'minor', 'major'],
          description: 'Version increment type (default: patch)',
        },
      },
      required: ['app_id'],
    },
  },
  {
    name: 'platform.draft.discard',
    title: 'Discard Draft',
    description: 'Discard the current draft without publishing. This action cannot be undone.',
    inputSchema: {
      type: 'object',
      properties: {
        app_id: {
          type: 'string',
          description: 'App ID or slug',
        },
      },
      required: ['app_id'],
    },
  },

  // ============================================
  // DOCUMENTATION
  // ============================================
  {
    name: 'platform.docs.generate',
    title: 'Generate Documentation',
    description: 'Generate or regenerate Skills.md documentation by parsing the app source code.',
    inputSchema: {
      type: 'object',
      properties: {
        app_id: {
          type: 'string',
          description: 'App ID or slug',
        },
        ai_enhance: {
          type: 'boolean',
          description: 'Use AI to improve descriptions (requires BYOK)',
        },
      },
      required: ['app_id'],
    },
  },
  {
    name: 'platform.docs.get',
    title: 'Get Documentation',
    description: 'Get the Skills.md documentation for an app.',
    inputSchema: {
      type: 'object',
      properties: {
        app_id: {
          type: 'string',
          description: 'App ID or slug',
        },
        format: {
          type: 'string',
          enum: ['markdown', 'json', 'mcp'],
          description: 'Output format (default: markdown)',
        },
      },
      required: ['app_id'],
    },
  },
  {
    name: 'platform.docs.update',
    title: 'Update Documentation',
    description: 'Update the Skills.md documentation manually. The content is validated before saving.',
    inputSchema: {
      type: 'object',
      properties: {
        app_id: {
          type: 'string',
          description: 'App ID or slug',
        },
        skills_md: {
          type: 'string',
          description: 'New Skills.md content in markdown format',
        },
      },
      required: ['app_id', 'skills_md'],
    },
  },

  // ============================================
  // DISCOVERY
  // ============================================
  {
    name: 'platform.discover',
    title: 'Discover Apps',
    description: 'Search for apps using natural language semantic search. Finds apps by capability, description, or function names.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Natural language search query (e.g., "weather API", "send emails")',
        },
        limit: {
          type: 'number',
          description: 'Maximum results (default: 10)',
        },
        include_private: {
          type: 'boolean',
          description: 'Include your own private apps in results',
        },
        min_similarity: {
          type: 'number',
          description: 'Minimum similarity threshold 0-1 (default: 0.5)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'platform.apps.search',
    title: 'Search Apps',
    description: 'Search apps by name, description, or tags using text matching.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query',
        },
        filters: {
          type: 'object',
          properties: {
            category: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' } },
            visibility: { type: 'string', enum: ['public', 'unlisted'] },
          },
          description: 'Optional filters',
        },
        limit: { type: 'number' },
        offset: { type: 'number' },
      },
      required: ['query'],
    },
  },

  // ============================================
  // EXECUTION & TESTING
  // ============================================
  {
    name: 'platform.run',
    title: 'Run App Function',
    description: 'Execute a function exported by an app. Returns the function result and any logs.',
    inputSchema: {
      type: 'object',
      properties: {
        app_id: {
          type: 'string',
          description: 'App ID or slug',
        },
        function: {
          type: 'string',
          description: 'Name of the exported function to call',
        },
        args: {
          description: 'Arguments to pass to the function',
        },
        use_draft: {
          type: 'boolean',
          description: 'Run against draft code instead of production',
        },
      },
      required: ['app_id', 'function'],
    },
  },

  // ============================================
  // ANALYTICS
  // ============================================
  {
    name: 'platform.analytics.app',
    title: 'Get App Analytics',
    description: 'Get usage analytics for an app including run counts and unique users.',
    inputSchema: {
      type: 'object',
      properties: {
        app_id: {
          type: 'string',
          description: 'App ID or slug',
        },
        period: {
          type: 'string',
          enum: ['7d', '30d', '90d', 'all'],
          description: 'Time period (default: 30d)',
        },
      },
      required: ['app_id'],
    },
  },
  {
    name: 'platform.analytics.overview',
    title: 'Get Platform Analytics',
    description: 'Get overall usage analytics across all your apps.',
    inputSchema: {
      type: 'object',
      properties: {
        period: {
          type: 'string',
          enum: ['7d', '30d', '90d'],
          description: 'Time period (default: 30d)',
        },
      },
    },
  },

  // ============================================
  // USER
  // ============================================
  {
    name: 'platform.user.profile',
    title: 'Get User Profile',
    description: 'Get current user profile including tier, settings, and quotas.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

// ============================================
// MAIN PLATFORM MCP HANDLER
// ============================================

/**
 * Handle Platform MCP JSON-RPC requests
 * POST /mcp/platform
 */
export async function handlePlatformMcp(request: Request): Promise<Response> {
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
  let user: UserContext;
  try {
    const authUser = await authenticate(request);
    userId = authUser.id;

    // Extract display name and avatar from JWT user_metadata
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
    let errorType = 'AUTH_REQUIRED';
    if (message.includes('expired')) errorType = 'AUTH_TOKEN_EXPIRED';
    else if (message.includes('Missing')) errorType = 'AUTH_MISSING_TOKEN';
    else if (message.includes('Invalid JWT') || message.includes('decode')) errorType = 'AUTH_INVALID_TOKEN';

    console.error(`Platform MCP auth failed [${errorType}]:`, message);

    return jsonRpcErrorResponse(
      rpcRequest.id,
      AUTH_REQUIRED,
      message,
      { type: errorType }
    );
  }

  // Check per-minute rate limit
  const rateLimitEndpoint = `platform:${rpcRequest.method}`;
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
        `Weekly call limit reached (${weeklyResult.limit.toLocaleString()} calls/week). ` +
        `Upgrade your plan for more calls.`
      );
    }
  }

  // Route to method handler
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
    version: '1.0.0',
    description: 'Platform-level MCP server for managing Ultralight apps programmatically',
    capabilities: {
      tools: { listChanged: false },
    },
    endpoints: {
      mcp: '/mcp/platform',
    },
  };

  return jsonRpcResponse(id, result);
}

function handleToolsList(id: string | number): Response {
  const result: MCPToolsListResponse = {
    tools: PLATFORM_TOOLS,
  };

  return jsonRpcResponse(id, result);
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
  const toolArgs = args || {};

  try {
    let result: unknown;

    switch (name) {
      // App Lifecycle
      case 'platform.apps.list':
        result = await executeAppsList(userId, toolArgs);
        break;
      case 'platform.apps.get':
        result = await executeAppsGet(userId, toolArgs);
        break;
      case 'platform.apps.create':
        result = await executeAppsCreate(userId, toolArgs, user.tier);
        break;
      case 'platform.apps.update':
        result = await executeAppsUpdate(userId, toolArgs, user.tier);
        break;
      case 'platform.apps.delete':
        result = await executeAppsDelete(userId, toolArgs);
        break;

      // Draft/Publish
      case 'platform.draft.upload':
        result = await executeDraftUpload(userId, toolArgs);
        break;
      case 'platform.draft.get':
        result = await executeDraftGet(userId, toolArgs);
        break;
      case 'platform.draft.publish':
        result = await executeDraftPublish(userId, toolArgs, user.tier);
        break;
      case 'platform.draft.discard':
        result = await executeDraftDiscard(userId, toolArgs);
        break;

      // Documentation
      case 'platform.docs.generate':
        result = await executeDocsGenerate(userId, toolArgs);
        break;
      case 'platform.docs.get':
        result = await executeDocsGet(userId, toolArgs);
        break;
      case 'platform.docs.update':
        result = await executeDocsUpdate(userId, toolArgs);
        break;

      // Discovery
      case 'platform.discover':
        result = await executeDiscover(userId, toolArgs);
        break;
      case 'platform.apps.search':
        result = await executeAppsSearch(userId, toolArgs);
        break;

      // Execution
      case 'platform.run':
        result = await executeRun(userId, user, toolArgs);
        break;

      // Analytics
      case 'platform.analytics.app':
        result = await executeAnalyticsApp(userId, toolArgs);
        break;
      case 'platform.analytics.overview':
        result = await executeAnalyticsOverview(userId, toolArgs);
        break;

      // User
      case 'platform.user.profile':
        result = await executeUserProfile(userId);
        break;

      default:
        return jsonRpcErrorResponse(id, INVALID_PARAMS, `Unknown tool: ${name}`);
    }

    return jsonRpcResponse(id, formatToolResult(result));

  } catch (err) {
    console.error(`Platform tool ${name} error:`, err);

    // Check for specific error types
    if (err instanceof ToolError) {
      return jsonRpcErrorResponse(id, err.code, err.message);
    }

    return jsonRpcResponse(id, formatToolError(err));
  }
}

// ============================================
// TOOL ERROR CLASS
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
// TOOL IMPLEMENTATIONS
// ============================================

// Helper to resolve app ID from ID or slug
async function resolveAppId(userId: string, appIdOrSlug: string): Promise<App> {
  const appsService = createAppsService();

  // Try UUID first
  let app = await appsService.findById(appIdOrSlug);

  // If not found, try slug
  if (!app) {
    app = await appsService.findBySlug(userId, appIdOrSlug);
  }

  if (!app) {
    throw new ToolError(NOT_FOUND, `App not found: ${appIdOrSlug}`);
  }

  // Check ownership
  if (app.owner_id !== userId) {
    throw new ToolError(FORBIDDEN, 'You do not have permission to access this app');
  }

  return app;
}

// ----- APP LIFECYCLE -----

async function executeAppsList(
  userId: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const appsService = createAppsService();
  const visibility = args.visibility as string | undefined;
  const limit = Math.min(args.limit as number || 50, 100);
  const offset = args.offset as number || 0;
  const includeDrafts = args.include_drafts as boolean || false;

  let apps = await appsService.listByOwner(userId);

  // Filter by visibility
  if (visibility && visibility !== 'all') {
    apps = apps.filter(app => app.visibility === visibility);
  }

  // Pagination
  const total = apps.length;
  apps = apps.slice(offset, offset + limit);

  // Transform response
  const result = apps.map(app => ({
    id: app.id,
    slug: app.slug,
    name: app.name,
    description: app.description,
    visibility: app.visibility,
    current_version: app.current_version,
    total_runs: app.total_runs,
    runs_30d: app.runs_30d,
    created_at: app.created_at,
    updated_at: app.updated_at,
    ...(includeDrafts && {
      has_draft: !!(app as AppWithDraft).draft_storage_key,
      draft_uploaded_at: (app as AppWithDraft).draft_uploaded_at,
    }),
  }));

  return {
    apps: result,
    total,
    limit,
    offset,
  };
}

async function executeAppsGet(
  userId: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const appId = args.app_id as string;
  if (!appId) {
    throw new ToolError(INVALID_PARAMS, 'app_id is required');
  }

  const app = await resolveAppId(userId, appId);
  const includeCode = args.include_code as boolean || false;
  const includeSkills = args.include_skills as boolean || false;

  const result: Record<string, unknown> = {
    id: app.id,
    slug: app.slug,
    name: app.name,
    description: app.description,
    visibility: app.visibility,
    current_version: app.current_version,
    versions: app.versions,
    exports: app.exports,
    category: app.category,
    tags: app.tags,
    total_runs: app.total_runs,
    total_unique_users: app.total_unique_users,
    runs_7d: app.runs_7d,
    runs_30d: app.runs_30d,
    created_at: app.created_at,
    updated_at: app.updated_at,
    mcp_endpoint: `/mcp/${app.id}`,
    app_url: `/a/${app.id}`,
  };

  // Include draft info
  const appWithDraft = app as AppWithDraft;
  if (appWithDraft.draft_storage_key) {
    result.draft = {
      version: appWithDraft.draft_version,
      uploaded_at: appWithDraft.draft_uploaded_at,
      exports: appWithDraft.draft_exports,
    };
  }

  // Include code if requested
  if (includeCode) {
    const r2Service = createR2Service();
    try {
      const code = await r2Service.fetchTextFile(`${app.storage_key}index.ts`);
      result.code = code;
    } catch {
      try {
        const code = await r2Service.fetchTextFile(`${app.storage_key}index.js`);
        result.code = code;
      } catch {
        result.code = null;
        result.code_error = 'Could not fetch code';
      }
    }
  }

  // Include skills if requested
  if (includeSkills) {
    result.skills_md = app.skills_md;
    result.skills_parsed = app.skills_parsed;
  }

  return result;
}

async function executeAppsCreate(
  userId: string,
  args: Record<string, unknown>,
  userTier: string = 'free'
): Promise<unknown> {
  const files = args.files as Array<{ path: string; content: string; encoding?: string }>;
  if (!files || !Array.isArray(files) || files.length === 0) {
    throw new ToolError(INVALID_PARAMS, 'files array is required and must not be empty');
  }

  // Gate visibility by tier before creating
  const requestedVisibility = (args.visibility as string) || 'private';
  if (requestedVisibility !== 'private') {
    const visibilityErr = checkVisibilityAllowed(
      userTier,
      requestedVisibility as 'private' | 'unlisted' | 'public'
    );
    if (visibilityErr) {
      throw new ToolError(FORBIDDEN, visibilityErr);
    }
  }

  // Check for entry file - either manifest.json, explicit entry options, or default index files
  const hasManifest = files.some(f => f.path === 'manifest.json');
  const hasExplicitEntry = args.functions_entry || args.ui_entry;
  const entryFiles = ['index.ts', 'index.tsx', 'index.js', 'index.jsx'];
  const hasDefaultEntry = files.some(f => entryFiles.includes(f.path));

  if (!hasManifest && !hasExplicitEntry && !hasDefaultEntry) {
    throw new ToolError(VALIDATION_ERROR, 'Must include entry file(s). Options: manifest.json, functions_entry/ui_entry params, or index.ts/tsx');
  }

  // Convert files to upload format
  const uploadFiles: UploadFile[] = files.map(f => {
    let content = f.content;
    if (f.encoding === 'base64') {
      content = atob(f.content);
    }
    return {
      name: f.path,
      content,
      size: content.length,
    };
  });

  // Use the upload handler with all options
  const result = await handleUploadFiles(userId, uploadFiles, {
    name: args.name as string,
    slug: args.slug as string,
    description: args.description as string,
    visibility: args.visibility as 'private' | 'unlisted' | 'public',
    // v2 architecture options
    app_type: 'mcp',
    functions_entry: args.functions_entry as string | undefined,
    ui_entry: args.ui_entry as string | undefined,
  });

  // Auto-generate docs if requested (default true)
  const autoGenerateDocs = args.auto_generate_docs !== false;
  if (autoGenerateDocs && result.app_id) {
    try {
      await executeDocsGenerate(userId, { app_id: result.app_id });
      result.docs_generated = true;
    } catch (err) {
      result.docs_generated = false;
      result.docs_error = err instanceof Error ? err.message : 'Failed to generate docs';
    }
  }

  return result;
}

async function executeAppsUpdate(
  userId: string,
  args: Record<string, unknown>,
  userTier: string = 'free'
): Promise<unknown> {
  const appId = args.app_id as string;
  if (!appId) {
    throw new ToolError(INVALID_PARAMS, 'app_id is required');
  }

  const app = await resolveAppId(userId, appId);
  const appsService = createAppsService();

  const updates: Partial<App> = {};
  if (args.name !== undefined) updates.name = args.name as string;
  if (args.description !== undefined) updates.description = args.description as string;
  if (args.visibility !== undefined) updates.visibility = args.visibility as 'private' | 'unlisted' | 'public';
  if (args.category !== undefined) updates.category = args.category as string;
  if (args.tags !== undefined) updates.tags = args.tags as string[];

  if (Object.keys(updates).length === 0) {
    throw new ToolError(INVALID_PARAMS, 'No update fields provided');
  }

  // Gate visibility changes by user tier
  if (updates.visibility) {
    const visibilityErr = checkVisibilityAllowed(userTier, updates.visibility);
    if (visibilityErr) {
      throw new ToolError(FORBIDDEN, visibilityErr);
    }
  }

  await appsService.update(app.id, updates);

  return {
    success: true,
    app_id: app.id,
    updated_fields: Object.keys(updates),
  };
}

async function executeAppsDelete(
  userId: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const appId = args.app_id as string;
  const confirm = args.confirm as boolean;

  if (!appId) {
    throw new ToolError(INVALID_PARAMS, 'app_id is required');
  }
  if (confirm !== true) {
    throw new ToolError(INVALID_PARAMS, 'confirm must be true to delete app');
  }

  const app = await resolveAppId(userId, appId);
  const appsService = createAppsService();

  await appsService.softDelete(app.id);

  return {
    success: true,
    app_id: app.id,
    message: 'App has been deleted',
  };
}

// ----- DRAFT/PUBLISH -----

async function executeDraftUpload(
  userId: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const appId = args.app_id as string;
  const files = args.files as Array<{ path: string; content: string; encoding?: string }>;

  if (!appId) {
    throw new ToolError(INVALID_PARAMS, 'app_id is required');
  }
  if (!files || !Array.isArray(files) || files.length === 0) {
    throw new ToolError(INVALID_PARAMS, 'files array is required');
  }

  const app = await resolveAppId(userId, appId);

  // Convert files
  const uploadFiles: UploadFile[] = files.map(f => {
    let content = f.content;
    if (f.encoding === 'base64') {
      content = atob(f.content);
    }
    return {
      name: f.path,
      content,
      size: content.length,
    };
  });

  const result = await handleDraftUploadFiles(app.id, userId, uploadFiles);

  return result;
}

async function executeDraftGet(
  userId: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const appId = args.app_id as string;
  if (!appId) {
    throw new ToolError(INVALID_PARAMS, 'app_id is required');
  }

  const app = await resolveAppId(userId, appId) as AppWithDraft;

  if (!app.draft_storage_key) {
    return {
      has_draft: false,
      message: 'No draft exists for this app',
    };
  }

  const result: Record<string, unknown> = {
    has_draft: true,
    draft_version: app.draft_version,
    draft_uploaded_at: app.draft_uploaded_at,
    draft_exports: app.draft_exports,
    current_version: app.current_version,
  };

  // Include diff if requested
  if (args.include_diff) {
    result.exports_diff = {
      added: (app.draft_exports || []).filter(e => !app.exports.includes(e)),
      removed: app.exports.filter(e => !(app.draft_exports || []).includes(e)),
      unchanged: app.exports.filter(e => (app.draft_exports || []).includes(e)),
    };
  }

  return result;
}

async function executeDraftPublish(
  userId: string,
  args: Record<string, unknown>,
  userTier: string = 'free'
): Promise<unknown> {
  const appId = args.app_id as string;
  if (!appId) {
    throw new ToolError(INVALID_PARAMS, 'app_id is required');
  }

  const app = await resolveAppId(userId, appId) as AppWithDraft;

  if (!app.draft_storage_key) {
    throw new ToolError(VALIDATION_ERROR, 'No draft exists to publish');
  }

  // Gate: free tier cannot publish non-private apps
  if (app.visibility !== 'private') {
    const visibilityErr = checkVisibilityAllowed(userTier, app.visibility as 'private' | 'unlisted' | 'public');
    if (visibilityErr) {
      throw new ToolError(FORBIDDEN, `Cannot publish: ${visibilityErr} Change the app to private first, or upgrade to Pro.`);
    }
  }

  const appsService = createAppsService();
  const r2Service = createR2Service();
  const regenerateDocs = args.regenerate_docs !== false;
  const versionBump = (args.version_bump as string) || 'patch';

  // Calculate new version
  const [major, minor, patch] = (app.current_version || '1.0.0').split('.').map(Number);
  let newVersion: string;
  switch (versionBump) {
    case 'major':
      newVersion = `${major + 1}.0.0`;
      break;
    case 'minor':
      newVersion = `${major}.${minor + 1}.0`;
      break;
    default:
      newVersion = `${major}.${minor}.${patch + 1}`;
  }

  // Copy draft files to new version
  const newStorageKey = `apps/${app.id}/${newVersion}/`;
  const draftFiles = await r2Service.listFiles(app.draft_storage_key);

  for (const file of draftFiles) {
    const content = await r2Service.fetchFile(file.key);
    const newKey = file.key.replace(app.draft_storage_key, newStorageKey);
    await r2Service.uploadFile(newKey, content);
  }

  // Update app record
  const versions = [...(app.versions || []), newVersion];
  await appsService.update(app.id, {
    current_version: newVersion,
    versions,
    storage_key: newStorageKey,
    exports: app.draft_exports || app.exports,
    // Clear draft fields
    draft_storage_key: null,
    draft_version: null,
    draft_uploaded_at: null,
    draft_exports: null,
  } as Partial<AppWithDraft>);

  // Regenerate docs if requested
  let docsGenerated = false;
  if (regenerateDocs) {
    try {
      await executeDocsGenerate(userId, { app_id: app.id });
      docsGenerated = true;
    } catch (err) {
      console.error('Failed to regenerate docs:', err);
    }
  }

  // Clean up old draft files
  for (const file of draftFiles) {
    try {
      await r2Service.deleteFile(file.key);
    } catch {
      // Ignore cleanup errors
    }
  }

  return {
    success: true,
    app_id: app.id,
    previous_version: app.current_version,
    new_version: newVersion,
    docs_regenerated: docsGenerated,
  };
}

async function executeDraftDiscard(
  userId: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const appId = args.app_id as string;
  if (!appId) {
    throw new ToolError(INVALID_PARAMS, 'app_id is required');
  }

  const app = await resolveAppId(userId, appId) as AppWithDraft;

  if (!app.draft_storage_key) {
    return {
      success: true,
      message: 'No draft exists',
    };
  }

  const appsService = createAppsService();
  const r2Service = createR2Service();

  // Delete draft files
  const draftFiles = await r2Service.listFiles(app.draft_storage_key);
  for (const file of draftFiles) {
    try {
      await r2Service.deleteFile(file.key);
    } catch {
      // Ignore
    }
  }

  // Clear draft fields
  await appsService.update(app.id, {
    draft_storage_key: null,
    draft_version: null,
    draft_uploaded_at: null,
    draft_exports: null,
  } as Partial<AppWithDraft>);

  return {
    success: true,
    app_id: app.id,
    message: 'Draft discarded',
  };
}

// ----- DOCUMENTATION -----

async function executeDocsGenerate(
  userId: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const appId = args.app_id as string;
  if (!appId) {
    throw new ToolError(INVALID_PARAMS, 'app_id is required');
  }

  const app = await resolveAppId(userId, appId);
  const appsService = createAppsService();
  const r2Service = createR2Service();

  // Fetch code
  let code: string | null = null;
  const entryFiles = ['index.ts', 'index.tsx', 'index.js', 'index.jsx'];
  for (const entry of entryFiles) {
    try {
      code = await r2Service.fetchTextFile(`${app.storage_key}${entry}`);
      break;
    } catch {
      // Try next
    }
  }

  if (!code) {
    throw new ToolError(INTERNAL_ERROR, 'Could not fetch app code');
  }

  // Generate docs
  const genResult = await generateSkillsMd(code, app.name);
  if (!genResult.success || !genResult.skills_md) {
    throw new ToolError(BUILD_FAILED, `Failed to generate docs: ${genResult.errors.map(e => e.message).join(', ')}`);
  }

  // Validate and parse
  const validation = await validateAndParseSkillsMd(genResult.skills_md);
  if (!validation.valid) {
    throw new ToolError(VALIDATION_ERROR, `Invalid Skills.md: ${validation.errors.map(e => e.message).join(', ')}`);
  }

  // Generate embedding
  let embeddingGenerated = false;
  try {
    const embeddingService = createEmbeddingService();
    if (embeddingService) {
      const embeddingText = generateEmbeddingText(app.name, app.description || '', validation.skills_parsed!);
      const result = await embeddingService.embed(embeddingText);
      await appsService.updateEmbedding(app.id, result.embedding);
      embeddingGenerated = true;
    }
  } catch (err) {
    console.error('Failed to generate embedding:', err);
  }

  // Save
  await appsService.update(app.id, {
    skills_md: genResult.skills_md,
    skills_parsed: validation.skills_parsed,
    docs_generated_at: new Date().toISOString(),
  } as Partial<AppWithDraft>);

  return {
    success: true,
    app_id: app.id,
    functions_found: validation.skills_parsed?.functions.length || 0,
    embedding_generated: embeddingGenerated,
  };
}

async function executeDocsGet(
  userId: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const appId = args.app_id as string;
  const format = (args.format as string) || 'markdown';

  if (!appId) {
    throw new ToolError(INVALID_PARAMS, 'app_id is required');
  }

  const app = await resolveAppId(userId, appId);

  if (!app.skills_md) {
    return {
      exists: false,
      message: 'No documentation generated. Use platform.docs.generate to create.',
    };
  }

  switch (format) {
    case 'json':
      return {
        exists: true,
        skills_parsed: app.skills_parsed,
      };
    case 'mcp':
      // Convert to MCP tool format
      const tools = (app.skills_parsed?.functions || []).map(fn => ({
        name: fn.name,
        description: fn.description,
        inputSchema: {
          type: 'object',
          properties: fn.parameters,
        },
        outputSchema: fn.returns,
      }));
      return {
        exists: true,
        tools,
      };
    default:
      return {
        exists: true,
        skills_md: app.skills_md,
      };
  }
}

async function executeDocsUpdate(
  userId: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const appId = args.app_id as string;
  const skillsMd = args.skills_md as string;

  if (!appId) {
    throw new ToolError(INVALID_PARAMS, 'app_id is required');
  }
  if (!skillsMd) {
    throw new ToolError(INVALID_PARAMS, 'skills_md is required');
  }

  const app = await resolveAppId(userId, appId);
  const appsService = createAppsService();

  // Validate
  const validation = await validateAndParseSkillsMd(skillsMd);
  if (!validation.valid) {
    throw new ToolError(VALIDATION_ERROR, `Invalid Skills.md: ${validation.errors.map(e => e.message).join(', ')}`);
  }

  // Update embedding
  let embeddingGenerated = false;
  try {
    const embeddingService = createEmbeddingService();
    if (embeddingService) {
      const embeddingText = generateEmbeddingText(app.name, app.description || '', validation.skills_parsed!);
      const result = await embeddingService.embed(embeddingText);
      await appsService.updateEmbedding(app.id, result.embedding);
      embeddingGenerated = true;
    }
  } catch (err) {
    console.error('Failed to generate embedding:', err);
  }

  // Save
  await appsService.update(app.id, {
    skills_md: skillsMd,
    skills_parsed: validation.skills_parsed,
    docs_generated_at: new Date().toISOString(),
  } as Partial<AppWithDraft>);

  return {
    success: true,
    app_id: app.id,
    functions_found: validation.skills_parsed?.functions.length || 0,
    embedding_generated: embeddingGenerated,
    warnings: validation.warnings,
  };
}

// ----- DISCOVERY -----

async function executeDiscover(
  userId: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const query = args.query as string;
  if (!query) {
    throw new ToolError(INVALID_PARAMS, 'query is required');
  }

  const limit = args.limit as number || 10;
  const includePrivate = args.include_private as boolean || false;
  const minSimilarity = args.min_similarity as number || 0.5;

  // Generate embedding for query
  const embeddingService = createEmbeddingService();
  if (!embeddingService) {
    throw new ToolError(INTERNAL_ERROR, 'Embedding service not available');
  }
  const embeddingResult = await embeddingService.embed(query);
  const queryEmbedding = embeddingResult.embedding;

  // Search using Supabase RPC
  const appsService = createAppsService();
  const results = await appsService.searchByEmbedding(
    queryEmbedding,
    userId,
    includePrivate,
    limit,
    minSimilarity
  );

  return {
    query,
    results: results.map(r => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      description: r.description,
      similarity: r.similarity,
      is_owner: r.owner_id === userId,
      mcp_endpoint: `/mcp/${r.id}`,
    })),
    total: results.length,
  };
}

async function executeAppsSearch(
  userId: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const query = args.query as string;
  if (!query) {
    throw new ToolError(INVALID_PARAMS, 'query is required');
  }

  const appsService = createAppsService();
  const limit = args.limit as number || 20;
  const offset = args.offset as number || 0;
  const filters = args.filters as Record<string, unknown> || {};

  // Text search (basic implementation)
  let apps = await appsService.listPublic();

  // Also include user's own apps
  const userApps = await appsService.listByOwner(userId);
  apps = [...apps, ...userApps.filter(a => !apps.some(p => p.id === a.id))];

  // Filter by query
  const queryLower = query.toLowerCase();
  apps = apps.filter(app =>
    app.name.toLowerCase().includes(queryLower) ||
    (app.description || '').toLowerCase().includes(queryLower) ||
    (app.tags || []).some(t => t.toLowerCase().includes(queryLower))
  );

  // Apply filters
  if (filters.category) {
    apps = apps.filter(app => app.category === filters.category);
  }
  if (filters.tags && Array.isArray(filters.tags)) {
    apps = apps.filter(app =>
      (filters.tags as string[]).some(t => (app.tags || []).includes(t))
    );
  }
  if (filters.visibility) {
    apps = apps.filter(app => app.visibility === filters.visibility);
  }

  const total = apps.length;
  apps = apps.slice(offset, offset + limit);

  return {
    query,
    results: apps.map(app => ({
      id: app.id,
      name: app.name,
      slug: app.slug,
      description: app.description,
      visibility: app.visibility,
      is_owner: app.owner_id === userId,
    })),
    total,
    limit,
    offset,
  };
}

// ----- EXECUTION -----

async function executeRun(
  userId: string,
  user: UserContext,
  args: Record<string, unknown>
): Promise<unknown> {
  const appId = args.app_id as string;
  const functionName = args.function as string;
  const fnArgs = args.args;
  const useDraft = args.use_draft as boolean || false;

  if (!appId) {
    throw new ToolError(INVALID_PARAMS, 'app_id is required');
  }
  if (!functionName) {
    throw new ToolError(INVALID_PARAMS, 'function is required');
  }

  const app = await resolveAppId(userId, appId) as AppWithDraft;

  // Permission check: for private apps, verify non-owner has function access
  if (app.visibility === 'private') {
    const allowedFunctions = await getPermissionsForUser(userId, app.id, app.owner_id, app.visibility);
    if (allowedFunctions !== null && !allowedFunctions.has(functionName)) {
      throw new ToolError(
        -32003,
        `Permission denied: you do not have access to function '${functionName}'. Ask the app owner to grant you access.`
      );
    }
  }
  const r2Service = createR2Service();

  // Get storage key (draft or production)
  const storageKey = useDraft && app.draft_storage_key
    ? app.draft_storage_key
    : app.storage_key;

  if (useDraft && !app.draft_storage_key) {
    throw new ToolError(VALIDATION_ERROR, 'No draft exists. Upload a draft first.');
  }

  // Fetch code
  let code: string | null = null;
  const entryFiles = ['index.ts', 'index.tsx', 'index.js', 'index.jsx'];
  for (const entry of entryFiles) {
    try {
      code = await r2Service.fetchTextFile(`${storageKey}${entry}`);
      break;
    } catch {
      // Try next
    }
  }

  if (!code) {
    throw new ToolError(INTERNAL_ERROR, 'Could not fetch app code');
  }

  // Check if function exists
  const exports = useDraft ? (app.draft_exports || []) : app.exports;
  if (!exports.includes(functionName)) {
    throw new ToolError(VALIDATION_ERROR, `Function "${functionName}" not found. Available: ${exports.join(', ')}`);
  }

  // Execute
  const appDataService = createAppDataService(app.id, userId);
  const startTime = Date.now();

  // Decrypt environment variables
  const encryptedEnvVars = (app as Record<string, unknown>).env_vars as Record<string, string> || {};
  let envVars: Record<string, string> = {};
  try {
    envVars = await decryptEnvVars(encryptedEnvVars);
  } catch (err) {
    console.error('Failed to decrypt env vars:', err);
  }

  // Resolve Supabase config: prefer config_id, fall back to legacy app-level, then platform-level
  const appRecord = app as Record<string, unknown>;
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

  if (!supabaseConfig && appRecord.supabase_enabled) {
    try {
      const { getDecryptedPlatformSupabase } = await import('./user.ts');
      const platformConfig = await getDecryptedPlatformSupabase(userId);
      if (platformConfig) supabaseConfig = platformConfig;
    } catch (err) {
      console.error('Failed to get platform Supabase config:', err);
    }
  }

  const result = await executeInSandbox(
    {
      appId: app.id,
      userId,
      executionId: crypto.randomUUID(),
      code,
      permissions: ['memory:read', 'memory:write', 'ai:call', 'net:fetch'],
      userApiKey: null,
      user,
      appDataService,
      memoryService: null,
      aiService: {
        call: async (request, apiKey) => ({
          content: 'AI placeholder - configure BYOK',
          model: request.model || 'gpt-4',
          usage: { input_tokens: 0, output_tokens: 0, cost_cents: 0 },
        }),
      },
      envVars,
      supabase: supabaseConfig,
    },
    functionName,
    fnArgs ? [fnArgs] : []
  );

  const duration = Date.now() - startTime;

  // Log the call (fire-and-forget)
  const { logMcpCall } = await import('../services/call-logger.ts');
  logMcpCall({
    userId,
    appId: app.id,
    appName: app.name || app.slug,
    functionName,
    method: 'tools/call',
    success: result.success,
    durationMs: duration,
    errorMessage: result.success ? undefined : String(result.error),
  });

  return {
    success: result.success,
    result: result.result,
    error: result.error,
    logs: result.logs,
    duration_ms: duration,
    used_draft: useDraft,
  };
}

// ----- ANALYTICS -----

async function executeAnalyticsApp(
  userId: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const appId = args.app_id as string;
  if (!appId) {
    throw new ToolError(INVALID_PARAMS, 'app_id is required');
  }

  const app = await resolveAppId(userId, appId);

  return {
    app_id: app.id,
    name: app.name,
    total_runs: app.total_runs,
    total_unique_users: app.total_unique_users,
    runs_7d: app.runs_7d,
    runs_30d: app.runs_30d,
    current_version: app.current_version,
    versions_count: (app.versions || []).length,
    created_at: app.created_at,
  };
}

async function executeAnalyticsOverview(
  userId: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const appsService = createAppsService();
  const apps = await appsService.listByOwner(userId);

  const totalRuns = apps.reduce((sum, app) => sum + (app.total_runs || 0), 0);
  const runs30d = apps.reduce((sum, app) => sum + (app.runs_30d || 0), 0);
  const runs7d = apps.reduce((sum, app) => sum + (app.runs_7d || 0), 0);

  return {
    total_apps: apps.length,
    public_apps: apps.filter(a => a.visibility === 'public').length,
    private_apps: apps.filter(a => a.visibility === 'private').length,
    total_runs: totalRuns,
    runs_30d: runs30d,
    runs_7d: runs7d,
    top_apps: apps
      .sort((a, b) => (b.runs_30d || 0) - (a.runs_30d || 0))
      .slice(0, 5)
      .map(a => ({
        id: a.id,
        name: a.name,
        runs_30d: a.runs_30d,
      })),
  };
}

// ----- USER -----

async function executeUserProfile(userId: string): Promise<unknown> {
  // Get user from Supabase
  // @ts-ignore
  const Deno = globalThis.Deno;
  const supabaseUrl = Deno?.env?.get('SUPABASE_URL');
  const supabaseKey = Deno?.env?.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !supabaseKey) {
    throw new ToolError(INTERNAL_ERROR, 'Database not configured');
  }

  const response = await fetch(`${supabaseUrl}/rest/v1/users?id=eq.${userId}`, {
    headers: {
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
    },
  });

  if (!response.ok) {
    throw new ToolError(INTERNAL_ERROR, 'Failed to fetch user');
  }

  const users = await response.json();
  if (users.length === 0) {
    throw new ToolError(NOT_FOUND, 'User not found');
  }

  const user = users[0];

  return {
    id: user.id,
    email: user.email,
    display_name: user.display_name,
    avatar_url: user.avatar_url,
    tier: user.tier,
    tier_expires_at: user.tier_expires_at,
    byok_enabled: user.byok_enabled,
    byok_provider: user.byok_provider,
    created_at: user.created_at,
  };
}

// ============================================
// HELPERS
// ============================================

function formatToolResult(result: unknown): MCPToolCallResponse {
  const content: MCPContent[] = [];

  if (result !== undefined && result !== null) {
    content.push({
      type: 'text',
      text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
    });
  }

  return {
    content,
    structuredContent: result,
    isError: false,
  };
}

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
// WELL-KNOWN DISCOVERY
// ============================================

/**
 * Handle platform MCP discovery endpoint
 * GET /.well-known/mcp.json
 */
export function handlePlatformMcpDiscovery(): Response {
  const discovery = {
    name: 'Ultralight Platform',
    version: '1.0.0',
    description: 'Serverless app platform with AI integration. Create, deploy, and manage apps programmatically.',
    capabilities: {
      tools: { listChanged: false },
    },
    endpoints: {
      platform: '/mcp/platform',
      apps: '/mcp/{appId}',
    },
    tools_count: PLATFORM_TOOLS.length,
    documentation: 'https://ultralight.dev/docs/mcp',
  };

  return json(discovery);
}
