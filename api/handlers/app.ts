// App Router
// Routes requests to appropriate handlers

import { handleUpload } from './upload.ts';
import { handleRun } from './run.ts';
import { handleAuth } from './auth.ts';
import { handleApps } from './apps.ts';
import { handleUser } from './user.ts';
import { handleCron } from './cron.ts';
import { handleMcp, handleMcpDiscovery } from './mcp.ts';
import { handlePlatformMcp, handlePlatformMcpDiscovery } from './platform-mcp.ts';
import { handleDiscover } from './discover.ts';
import { handleHttpEndpoint, handleHttpOptions } from './http.ts';
import { handleTierChange } from './tier.ts';
import { getLayoutHTML } from '../../web/layout.ts';
import { createAppsService } from '../services/apps.ts';
import { createR2Service } from '../services/storage.ts';
import { getCodeCache } from '../services/codecache.ts';
import type { AppManifest } from '../../shared/types/index.ts';

// ============================================
// CACHE HELPERS
// ============================================

/**
 * Generate a strong ETag from app version and update timestamp.
 * This changes whenever the app is published or updated.
 */
function generateAppETag(app: { current_version?: string; updated_at?: string; storage_key: string }): string {
  const version = app.current_version || '0';
  const updated = app.updated_at || '0';
  // Use a short hash of version + timestamp for the ETag
  let hash = 0;
  const str = `${version}:${updated}:${app.storage_key}`;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return `"app-${Math.abs(hash).toString(36)}"`;
}

/**
 * Check If-None-Match and return 304 if ETag matches.
 * Returns null if no match (caller should serve full response).
 */
function checkConditionalRequest(request: Request, etag: string): Response | null {
  const ifNoneMatch = request.headers.get('If-None-Match');
  if (ifNoneMatch && (ifNoneMatch === etag || ifNoneMatch === `W/${etag}`)) {
    return new Response(null, {
      status: 304,
      headers: {
        'ETag': etag,
        'Cache-Control': 'public, max-age=3600',
      },
    });
  }
  return null;
}

/**
 * Add standard cache headers to an app response.
 * - HTML pages: 1 hour cache with ETag for revalidation
 * - Versioned assets: 1 year immutable cache
 */
function addCacheHeaders(headers: Record<string, string>, etag: string, immutable = false): Record<string, string> {
  if (immutable) {
    return {
      ...headers,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'ETag': etag,
    };
  }
  return {
    ...headers,
    'Cache-Control': 'public, max-age=3600',
    'ETag': etag,
    'Vary': 'Accept-Encoding',
  };
}

export function createApp() {
  return {
    async handle(request: Request): Promise<Response> {
      const url = new URL(request.url);
      const path = url.pathname;
      const method = request.method;

      // Home page (unified landing + upload + dashboard)
      if (path === '/' && method === 'GET') {
        return new Response(getLayoutHTML({ initialView: 'dashboard' }), {
          headers: { 'Content-Type': 'text/html' },
        });
      }

      // Health check - includes deploy timestamp and cache stats
      if (path === '/health') {
        const cacheStats = getCodeCache().stats;
        return json({
          status: 'ok',
          version: '0.2.3',
          deployed: new Date().toISOString(),
          cache: cacheStats,
        });
      }

      // Upload page (HTML UI with sidebar)
      // Legacy /upload redirects to home
      if (path === '/upload' && method === 'GET') {
        return new Response(null, {
          status: 302,
          headers: { 'Location': '/' },
        });
      }

      // Auth routes
      if (path.startsWith('/auth')) {
        return handleAuth(request);
      }

      // Upload route
      if (path === '/api/upload' && method === 'POST') {
        return handleUpload(request);
      }

      // Run route
      if (path.startsWith('/api/run/') && method === 'POST') {
        const appId = path.replace('/api/run/', '');
        return handleRun(request, appId);
      }

      // User API routes - handle all /api/user/* paths (must be before /api/apps)
      if (path.startsWith('/api/user')) {
        return handleUser(request);
      }

      // Apps API routes - handle all /api/apps/* paths
      if (path.startsWith('/api/apps')) {
        return handleApps(request);
      }

      // Cron API routes - handle all /api/cron/* paths
      if (path.startsWith('/api/cron')) {
        return handleCron(request);
      }

      // Tier change route (service-to-service, secured by secret)
      if (path === '/api/tier/change' && method === 'POST') {
        return handleTierChange(request);
      }

      // Discovery API routes - semantic search for apps
      if (path.startsWith('/api/discover')) {
        return handleDiscover(request);
      }

      // Platform MCP well-known discovery
      if (path === '/.well-known/mcp.json' && method === 'GET') {
        return handlePlatformMcpDiscovery();
      }

      // Platform MCP routes - POST /mcp/platform for JSON-RPC
      if (path === '/mcp/platform') {
        return handlePlatformMcp(request);
      }

      // App-specific MCP routes - POST /mcp/:appId for JSON-RPC
      if (path.startsWith('/mcp/')) {
        const appId = path.slice(5); // Remove '/mcp/'
        return handleMcp(request, appId);
      }

      // HTTP endpoints - /http/:appId/:functionName/* - direct HTTP access to app functions
      // Enables webhooks, public APIs, mobile app backends, etc.
      if (path.startsWith('/http/')) {
        const pathParts = path.slice(6).split('/'); // Remove '/http/'
        const appId = pathParts[0];
        const subPath = pathParts.slice(1).join('/');

        // Handle CORS preflight
        if (method === 'OPTIONS') {
          return handleHttpOptions(appId);
        }

        // Platform-level generic dashboard at /_ui
        if (subPath === '_ui' && method === 'GET') {
          return handleGenericDashboard(request, appId);
        }

        return handleHttpEndpoint(request, appId, subPath);
      }

      // Published markdown pages - GET /p/:userId/:slug
      // Public, no auth required. Renders user-published markdown as styled HTML.
      if (path.startsWith('/p/') && method === 'GET') {
        return handlePublishedPage(request, path);
      }

      // App runner - /a/:appId/* - serves deployed apps
      // Supports two patterns:
      // 1. Browser apps: export default function(app, ultralight) - renders UI in browser
      // 2. Server apps: export default async function handler(req) - handles HTTP requests
      if (path.startsWith('/a/')) {
        // Extract appId (first segment after /a/)
        const pathParts = path.slice(3).split('/');
        const appId = pathParts[0];
        const subPath = '/' + pathParts.slice(1).join('/'); // Everything after appId

        // Handle MCP discovery endpoint: /a/:appId/.well-known/mcp.json
        if (subPath === '/.well-known/mcp.json' && method === 'GET') {
          return handleMcpDiscovery(request, appId);
        }

        try {
          const appsService = createAppsService();
          const r2Service = createR2Service();

          const app = await appsService.findById(appId);
          if (!app) {
            return json({ error: 'App not found' }, 404);
          }

          // Generate ETag and check for conditional request (304)
          const etag = generateAppETag(app as { current_version?: string; updated_at?: string; storage_key: string });
          const conditionalResponse = checkConditionalRequest(request, etag);
          if (conditionalResponse) {
            console.log(`App runner: 304 Not Modified for app ${appId}`);
            return conditionalResponse;
          }

          // Fetch the app code — check in-memory cache first, then R2
          const storageKey = app.storage_key;
          const codeCache = getCodeCache();
          let code: string | null = null;

          // Check cache for code
          code = codeCache.get(appId, storageKey);
          if (code) {
            console.log(`App runner: code cache HIT for app ${appId}`);
          }

          if (!code) {
            const entryFiles = ['index.tsx', 'index.ts', 'index.jsx', 'index.js'];
            for (const entryFile of entryFiles) {
              try {
                code = await r2Service.fetchTextFile(`${storageKey}${entryFile}`);
                console.log(`App runner: loaded ${entryFile} for app ${appId}`);
                codeCache.set(appId, storageKey, code);
                break;
              } catch {
                // Try next entry file
              }
            }
          }

          if (!code) {
            console.error(`App runner: no entry file found for app ${appId}, storageKey: ${storageKey}`);
            return json({ error: 'App code not found' }, 404);
          }

          // Determine app type: HTTP server or MCP-only
          // (Browser/UI apps are no longer supported)
          let isHttpServerApp = false;

          const hasHandlerFunction =
            /export\s+(default\s+)?(async\s+)?function\s+handler\s*\(/.test(code) ||
            /export\s+default\s+handler/.test(code) ||
            /export\s+\{\s*handler\s*\}/.test(code) ||
            /^(async\s+)?function\s+handler\s*\(/m.test(code) ||
            /var\s+handler\s*=/.test(code) ||
            /handler:\s*\(\)\s*=>/.test(code);

          isHttpServerApp = hasHandlerFunction;

          // Cache headers for all app HTML responses
          const cacheHeaders = addCacheHeaders({ 'Content-Type': 'text/html' }, etag);

          if (isHttpServerApp) {
            // HTTP Server app - execute handler function
            const isEmbed = url.searchParams.get('embed') === '1';

            if (isEmbed || method !== 'GET' || (subPath !== '/' && subPath !== '')) {
              return await executeServerApp(code, request, appId, subPath);
            } else {
              return new Response(getLayoutHTML({
                title: app.name || app.slug,
                activeAppId: appId,
                initialView: 'app',
                appName: app.name || app.slug,
              }), {
                headers: cacheHeaders,
              });
            }
          } else {
            // MCP-only app - show info page with available tools
            const isEmbed = url.searchParams.get('embed') === '1';

            if (isEmbed) {
              // Return an info page for the iframe showing MCP tools
              return new Response(getMcpAppInfoHTML(appId, app.name || app.slug, app.skills_parsed || []), {
                headers: cacheHeaders,
              });
            } else {
              // Normal view with sidebar
              return new Response(getLayoutHTML({
                title: app.name || app.slug,
                activeAppId: appId,
                initialView: 'app',
                appName: app.name || app.slug,
              }), {
                headers: cacheHeaders,
              });
            }
          }
        } catch (err) {
          console.error('Error loading app:', err);
          return json({ error: 'Failed to load app' }, 500);
        }
      }

      // 404
      return json({ error: 'Not found' }, 404);
    },
  };
}

/**
 * Execute a server-side app handler using native ES modules
 * Apps export: export default async function handler(req: Request): Promise<Response>
 *
 * This uses dynamic import() with data URLs to execute ES modules natively.
 * Deno supports importing TypeScript directly via data URLs!
 */
async function executeServerApp(
  code: string,
  originalRequest: Request,
  appId: string,
  subPath: string
): Promise<Response> {
  try {
    // Create a modified request with the subPath as the URL path
    const originalUrl = new URL(originalRequest.url);
    const appUrl = new URL(subPath + originalUrl.search, originalUrl.origin);

    // Clone request with new URL for the app
    const appRequest = new Request(appUrl.toString(), {
      method: originalRequest.method,
      headers: originalRequest.headers,
      body: originalRequest.body,
    });

    // Deno can import TypeScript directly via data URLs!
    // Use application/typescript MIME type for TypeScript code
    // This completely eliminates the need for any transpilation or regex hacks
    const mimeType = 'application/typescript';
    const dataUrl = `data:${mimeType};base64,${btoa(unescape(encodeURIComponent(code)))}`;

    // Import the module - Deno handles TypeScript natively
    const module = await import(dataUrl);

    // Find the handler function
    const handlerFn = module.handler || module.default;

    if (typeof handlerFn !== 'function') {
      return json({
        error: 'No handler function found',
        message: 'Server apps must export a function named "handler" or use export default'
      }, 500);
    }

    // Execute the handler with the request
    const response = await handlerFn(appRequest);

    // Validate response
    if (!(response instanceof Response)) {
      return json({ error: 'Handler must return a Response object' }, 500);
    }

    return response;

  } catch (err) {
    console.error('Server app execution error:', err);
    return json({
      error: 'App execution failed',
      message: err instanceof Error ? err.message : String(err),
    }, 500);
  }
}

/**
 * Generate an info page for MCP-only apps
 * Shows available tools and how to use them
 */
function getMcpAppInfoHTML(appId: string, appName: string, skills: Array<{ name: string; description?: string; parameters?: unknown[] }>): string {
  const toolsList = skills.length > 0
    ? skills.map(s => `
      <div class="tool-item">
        <div class="tool-name">${s.name}</div>
        ${s.description ? `<div class="tool-desc">${s.description}</div>` : ''}
      </div>
    `).join('')
    : '<p class="no-tools">No tools documented yet. Generate documentation in app settings.</p>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${appName} - MCP App</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0a0a0f;
      color: #e4e4e7;
      padding: 2rem;
      min-height: 100vh;
    }
    .container { max-width: 600px; margin: 0 auto; }
    .header {
      display: flex;
      align-items: center;
      gap: 1rem;
      margin-bottom: 2rem;
    }
    .icon {
      width: 48px;
      height: 48px;
      background: linear-gradient(135deg, #6366f1, #8b5cf6);
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.5rem;
    }
    h1 { font-size: 1.5rem; font-weight: 600; }
    .badge {
      display: inline-block;
      background: rgba(139, 92, 246, 0.2);
      color: #a78bfa;
      padding: 0.25rem 0.75rem;
      border-radius: 9999px;
      font-size: 0.75rem;
      font-weight: 500;
      margin-top: 0.5rem;
    }
    .section {
      background: #18181b;
      border: 1px solid #27272a;
      border-radius: 12px;
      padding: 1.5rem;
      margin-bottom: 1.5rem;
    }
    .section-title {
      font-size: 0.875rem;
      color: #71717a;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 1rem;
    }
    .mcp-url {
      background: #09090b;
      border: 1px solid #27272a;
      border-radius: 8px;
      padding: 0.75rem 1rem;
      font-family: monospace;
      font-size: 0.875rem;
      color: #a78bfa;
      word-break: break-all;
    }
    .tool-item {
      padding: 0.75rem 0;
      border-bottom: 1px solid #27272a;
    }
    .tool-item:last-child { border-bottom: none; }
    .tool-name {
      font-family: monospace;
      color: #22c55e;
      font-weight: 500;
    }
    .tool-desc {
      font-size: 0.875rem;
      color: #71717a;
      margin-top: 0.25rem;
    }
    .no-tools { color: #71717a; font-style: italic; }
    .info-text {
      font-size: 0.875rem;
      color: #71717a;
      line-height: 1.6;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="icon">🔧</div>
      <div>
        <h1>${appName}</h1>
        <span class="badge">MCP Server</span>
      </div>
    </div>

    <div class="section">
      <div class="section-title">MCP Endpoint</div>
      <div class="mcp-url">${typeof location !== 'undefined' ? location.origin : ''}/mcp/${appId}</div>
      <a href="/http/${appId}/_ui" style="display:inline-flex;align-items:center;gap:0.5rem;margin-top:0.75rem;background:rgba(99,102,241,.15);color:#a78bfa;padding:0.5rem 1rem;border-radius:8px;text-decoration:none;font-weight:500;font-size:0.8125rem;transition:background 0.15s;">&#9881; Open Dashboard</a>
      <p class="info-text" style="margin-top: 0.75rem;">
        Connect via MCP client, or open the dashboard to view and manage data from your browser.
      </p>
    </div>

    <div class="section">
      <div class="section-title">Available Tools (${skills.length})</div>
      ${toolsList}
    </div>

    <div class="section">
      <p class="info-text">
        This is an MCP (Model Context Protocol) app. It provides tools that AI assistants
        can use to perform actions. Add the MCP endpoint URL to your client's configuration
        to start using these tools.
      </p>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Serve a generic auto-generated dashboard for any MCP app.
 * Reads skills_parsed/manifest to discover tools and renders an interactive UI.
 * Accessible at: GET /http/{appId}/_ui
 */
async function handleGenericDashboard(request: Request, appId: string): Promise<Response> {
  try {
    const appsService = createAppsService();
    const app = await appsService.findById(appId);

    if (!app) {
      return json({ error: 'App not found' }, 404);
    }

    const appName = app.name || app.slug;
    const skills = app.skills_parsed || [];
    const functions = Array.isArray(skills)
      ? skills as Array<{ name: string; description?: string; parameters?: Record<string, unknown> }>
      : (skills as { functions?: Array<{ name: string; description?: string; parameters?: Record<string, unknown> }> }).functions || [];

    // Extract token from query param if provided
    const url = new URL(request.url);
    const tokenFromQuery = url.searchParams.get('token') || '';

    const html = generateGenericDashboardHTML(appId, appName, functions, tokenFromQuery);
    return new Response(html, {
      headers: { 'Content-Type': 'text/html' },
    });
  } catch (err) {
    console.error('[Dashboard] Error:', err);
    return json({ error: 'Failed to load dashboard' }, 500);
  }
}

/**
 * Generate a fully self-contained generic dashboard HTML for any MCP app.
 * Auto-discovers tools from skills_parsed and renders forms for each.
 */
function generateGenericDashboardHTML(
  appId: string,
  appName: string,
  functions: Array<{ name: string; description?: string; parameters?: Record<string, unknown> }>,
  tokenFromQuery: string
): string {
  // Build tool definitions as JSON for the client-side JS
  const toolDefs = JSON.stringify(functions.map(fn => ({
    name: fn.name,
    description: fn.description || '',
    parameters: fn.parameters || {},
  })));

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${appName} — Dashboard</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#0a0a0a;--surface:#141414;--surface2:#1e1e1e;--border:#2a2a2a;--text:#e5e5e5;--text2:#888;--accent:#6366f1;--accent-hover:#4f46e5;--green:#22c55e;--red:#ef4444;--yellow:#eab308;--mono:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:var(--bg);color:var(--text);min-height:100vh}
.container{max-width:800px;margin:0 auto;padding:24px 16px}
/* Auth */
.auth-screen{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:60vh;gap:16px}
.auth-screen h2{font-size:22px;font-weight:700}
.auth-screen p{color:var(--text2);font-size:14px;text-align:center;max-width:400px}
.token-input{width:100%;max-width:420px;padding:12px 16px;background:var(--surface);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:14px;font-family:var(--mono);outline:none}
.token-input:focus{border-color:var(--accent)}
/* Header */
.header{display:flex;align-items:center;gap:12px;margin-bottom:24px}
.header-icon{width:44px;height:44px;background:linear-gradient(135deg,#6366f1,#8b5cf6);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:1.3rem}
.header h1{font-size:22px;font-weight:700}
.header .badge{display:inline-block;background:rgba(99,102,241,.15);color:#a5b4fc;padding:3px 10px;border-radius:99px;font-size:11px;font-weight:600;margin-left:8px}
/* Tool cards */
.tool-grid{display:flex;flex-direction:column;gap:16px}
.tool-card{background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden;transition:border-color .15s}
.tool-card:hover{border-color:#333}
.tool-header{padding:16px;cursor:pointer;display:flex;align-items:center;gap:12px;user-select:none}
.tool-header:hover{background:var(--surface2)}
.tool-name{font-family:var(--mono);font-size:14px;font-weight:600;color:var(--green)}
.tool-desc{font-size:13px;color:var(--text2);flex:1}
.tool-toggle{color:var(--text2);font-size:18px;transition:transform .2s}
.tool-toggle.open{transform:rotate(90deg)}
.tool-body{display:none;padding:0 16px 16px;border-top:1px solid var(--border)}
.tool-body.open{display:block}
/* Form */
.param-group{margin-top:12px}
.param-label{display:block;font-size:12px;color:var(--text2);margin-bottom:4px;font-weight:600;text-transform:uppercase;letter-spacing:.3px}
.param-label .req{color:var(--red);margin-left:2px}
.param-desc{font-size:11px;color:var(--text2);margin-bottom:6px;font-style:italic}
.param-input{width:100%;padding:10px 12px;background:var(--bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:13px;font-family:inherit;outline:none}
.param-input:focus{border-color:var(--accent)}
textarea.param-input{min-height:60px;resize:vertical;font-family:inherit}
/* Buttons */
button{cursor:pointer;border:none;border-radius:8px;font-size:13px;font-weight:600;padding:10px 20px;transition:all .15s}
.btn-primary{background:var(--accent);color:#fff}
.btn-primary:hover{background:var(--accent-hover)}
.btn-primary:disabled{opacity:.4;cursor:not-allowed}
.btn-secondary{background:var(--surface2);color:var(--text2);padding:8px 14px}
.btn-secondary:hover{color:var(--text)}
/* Result */
.result-area{margin-top:12px;background:var(--bg);border:1px solid var(--border);border-radius:8px;overflow:hidden;display:none}
.result-header{padding:8px 12px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;display:flex;align-items:center;justify-content:space-between}
.result-header.success{color:var(--green);background:rgba(34,197,94,.05)}
.result-header.error{color:var(--red);background:rgba(239,68,68,.05)}
.result-body{padding:12px;font-family:var(--mono);font-size:12px;line-height:1.6;overflow-x:auto;white-space:pre-wrap;word-break:break-word;max-height:300px;overflow-y:auto}
/* Toast */
.toast{position:fixed;bottom:24px;right:24px;background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:12px 20px;border-radius:10px;font-size:13px;opacity:0;transform:translateY(10px);transition:all .3s;pointer-events:none;z-index:99}
.toast.show{opacity:1;transform:translateY(0)}
.toast.error{border-color:var(--red);color:var(--red)}
/* Scrollbar */
::-webkit-scrollbar{width:6px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:var(--border);border-radius:3px}
/* Custom UI link */
.custom-ui-link{display:inline-block;margin-top:8px;padding:8px 16px;background:var(--surface2);border:1px solid var(--border);border-radius:8px;color:var(--accent);font-size:13px;font-weight:600;text-decoration:none;transition:all .15s}
.custom-ui-link:hover{background:var(--surface);border-color:var(--accent)}
/* Empty */
.empty{text-align:center;padding:48px 16px;color:var(--text2)}
.empty-icon{font-size:48px;margin-bottom:12px}
</style>
</head>
<body>
<div class="container">

<!-- Auth screen -->
<div id="auth-screen" class="auth-screen">
<div style="font-size:48px">&#9881;</div>
<h2>${appName}</h2>
<p>Enter your Ultralight API token to access this app's dashboard. Your token stays in the browser only.</p>
<input type="password" id="token-input" class="token-input" placeholder="ul_..." />
<button class="btn-primary" onclick="submitToken()">Connect</button>
<p style="font-size:11px;color:var(--text2)">Tip: add ?token=ul_... to the URL to skip this step</p>
</div>

<!-- Main app -->
<div id="app" style="display:none">
<div class="header">
<div class="header-icon">&#9881;</div>
<div>
<h1>${appName}<span class="badge">MCP Dashboard</span></h1>
</div>
</div>

<div id="custom-ui-banner"></div>

<div id="tool-grid" class="tool-grid">
<div class="empty"><div class="empty-icon">&#9881;</div>Loading tools...</div>
</div>
</div>

<div id="toast" class="toast"></div>

</div>

<script>
var APP_ID = ${JSON.stringify(appId)};
var TOKEN = sessionStorage.getItem("ul_token") || "";
var PARAM_TOKEN = ${JSON.stringify(tokenFromQuery)};
var TOOL_PREFIX = "";
var TOOLS = ${toolDefs};

if (PARAM_TOKEN) { TOKEN = PARAM_TOKEN; sessionStorage.setItem("ul_token", TOKEN); }
if (TOKEN) { showApp(); }

function submitToken() {
  var t = document.getElementById("token-input").value.trim();
  if (!t) return;
  TOKEN = t; sessionStorage.setItem("ul_token", TOKEN);
  showApp();
}

document.getElementById("token-input").addEventListener("keydown", function(e) {
  if (e.key === "Enter") submitToken();
});

function showApp() {
  document.getElementById("auth-screen").style.display = "none";
  document.getElementById("app").style.display = "block";
  init();
}

async function discoverPrefix() {
  try {
    var res = await fetch("/mcp/" + APP_ID, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + TOKEN },
      body: JSON.stringify({ jsonrpc: "2.0", id: 0, method: "tools/list" })
    });
    var data = await res.json();
    if (data.result && data.result.tools && data.result.tools.length > 0) {
      var first = data.result.tools[0];
      if (first.name && first.name.indexOf("_") > -1) {
        TOOL_PREFIX = first.name.substring(0, first.name.lastIndexOf("_") + 1);
      }
      // Check if app has a custom "ui" function
      var hasCustomUI = data.result.tools.some(function(t) {
        return t.title === "ui" || t.name.endsWith("_ui");
      });
      if (hasCustomUI) {
        document.getElementById("custom-ui-banner").innerHTML =
          '<a class="custom-ui-link" href="/http/' + APP_ID + '/ui' + (TOKEN ? '?token=' + encodeURIComponent(TOKEN) : '') + '">&#10024; This app has a custom UI &rarr; Open it</a>';
      }
    }
  } catch(e) { console.warn("Could not discover prefix:", e); }
}

async function mcp(tool, args) {
  var res = await fetch("/mcp/" + APP_ID, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + TOKEN },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method: "tools/call", params: { name: TOOL_PREFIX + tool, arguments: args || {} } })
  });
  var data = await res.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  if (data.result && data.result.isError) throw new Error(data.result.content[0].text);
  return data.result ? (data.result.structuredContent || data.result) : null;
}

var toastTimer;
function toast(msg, isError) {
  var el = document.getElementById("toast");
  el.textContent = msg;
  el.className = "toast show" + (isError ? " error" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function() { el.className = "toast"; }, 2500);
}

async function init() {
  await discoverPrefix();
  renderTools();
}

function renderTools() {
  var container = document.getElementById("tool-grid");
  if (!TOOLS || TOOLS.length === 0) {
    container.innerHTML = '<div class="empty"><div class="empty-icon">&#128268;</div>No tools found for this app.</div>';
    return;
  }

  // Filter out the "ui" function from the tool list (it's a UI endpoint, not a data tool)
  var visibleTools = TOOLS.filter(function(t) { return t.name !== "ui"; });

  container.innerHTML = visibleTools.map(function(tool, idx) {
    var params = tool.parameters || {};
    var paramKeys = Object.keys(params);

    var formHTML = paramKeys.map(function(key) {
      var p = params[key];
      var pType = (p && p.type) || "string";
      var pDesc = (p && p.description) || "";
      var isRequired = p && p.required;
      var inputType = pType === "number" ? "number" : "text";
      var isLongText = pDesc.toLowerCase().indexOf("text") > -1 || pDesc.toLowerCase().indexOf("content") > -1 || key === "text";

      return '<div class="param-group">' +
        '<label class="param-label">' + escHtml(key) + (isRequired ? '<span class="req">*</span>' : '') + '</label>' +
        (pDesc ? '<div class="param-desc">' + escHtml(pDesc) + '</div>' : '') +
        (isLongText
          ? '<textarea class="param-input" data-tool="' + idx + '" data-param="' + escAttr(key) + '" placeholder="' + escAttr(pType) + '"></textarea>'
          : '<input type="' + inputType + '" class="param-input" data-tool="' + idx + '" data-param="' + escAttr(key) + '" placeholder="' + escAttr(pType) + '" />') +
        '</div>';
    }).join("");

    var noParams = paramKeys.length === 0;

    return '<div class="tool-card" id="tool-card-' + idx + '">' +
      '<div class="tool-header" onclick="toggleTool(' + idx + ')">' +
        '<span class="tool-name">' + escHtml(tool.name) + '</span>' +
        '<span class="tool-desc">' + escHtml(tool.description) + '</span>' +
        '<span class="tool-toggle" id="tool-toggle-' + idx + '">&#9654;</span>' +
      '</div>' +
      '<div class="tool-body" id="tool-body-' + idx + '">' +
        formHTML +
        '<div style="margin-top:16px;display:flex;gap:8px;align-items:center">' +
          '<button class="btn-primary" onclick="callTool(' + idx + ')">' + (noParams ? 'Run' : 'Call') + '</button>' +
          '<button class="btn-secondary" onclick="clearResult(' + idx + ')">Clear</button>' +
        '</div>' +
        '<div class="result-area" id="result-' + idx + '">' +
          '<div class="result-header" id="result-header-' + idx + '"></div>' +
          '<div class="result-body" id="result-body-' + idx + '"></div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }).join("");
}

function toggleTool(idx) {
  var body = document.getElementById("tool-body-" + idx);
  var toggle = document.getElementById("tool-toggle-" + idx);
  var isOpen = body.classList.contains("open");
  body.classList.toggle("open");
  toggle.classList.toggle("open");
}

async function callTool(idx) {
  var visibleTools = TOOLS.filter(function(t) { return t.name !== "ui"; });
  var tool = visibleTools[idx];
  var params = tool.parameters || {};
  var args = {};
  var inputs = document.querySelectorAll('[data-tool="' + idx + '"]');

  inputs.forEach(function(input) {
    var key = input.getAttribute("data-param");
    var val = input.value.trim();
    if (val) {
      var pType = params[key] && params[key].type;
      if (pType === "number") {
        args[key] = parseFloat(val);
      } else {
        args[key] = val;
      }
    }
  });

  var resultArea = document.getElementById("result-" + idx);
  var resultHeader = document.getElementById("result-header-" + idx);
  var resultBody = document.getElementById("result-body-" + idx);

  resultArea.style.display = "block";
  resultHeader.className = "result-header";
  resultHeader.textContent = "Running...";
  resultBody.textContent = "";

  try {
    var result = await mcp(tool.name, args);
    resultHeader.className = "result-header success";
    resultHeader.innerHTML = "&#10003; Success";
    resultBody.textContent = JSON.stringify(result, null, 2);
    toast("Called " + tool.name);
  } catch(e) {
    resultHeader.className = "result-header error";
    resultHeader.innerHTML = "&#10007; Error";
    resultBody.textContent = e.message;
    toast("Failed: " + e.message, true);
  }
}

function clearResult(idx) {
  document.getElementById("result-" + idx).style.display = "none";
}

function escHtml(s) { if (!s) return ""; var d = document.createElement("div"); d.textContent = s; return d.innerHTML; }
function escAttr(s) { return String(s).replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
</script>
</body>
</html>`;
}

// ============================================
// PUBLISHED MARKDOWN PAGES
// ============================================

async function handlePublishedPage(_request: Request, path: string): Promise<Response> {
  // Parse /p/{userId}/{slug} or /p/{userId}/{slug}.md
  const parts = path.slice(3).split('/'); // Remove '/p/'
  if (parts.length < 2) {
    return new Response('Not found', { status: 404 });
  }
  const userId = parts[0];
  let slug = parts.slice(1).join('/');
  // Strip .md extension if present in URL
  if (slug.endsWith('.md')) slug = slug.slice(0, -3);

  const r2Service = createR2Service();
  let content: string;
  try {
    content = await r2Service.fetchTextFile(`users/${userId}/pages/${slug}.md`);
  } catch {
    return new Response('Page not found', { status: 404 });
  }

  // Parse front-matter style title from first H1, or use slug
  let title = slug;
  const h1Match = content.match(/^#\s+(.+)$/m);
  if (h1Match) title = h1Match[1];

  const html = renderMarkdownPage(title, content);
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=60',
    },
  });
}

/**
 * Render markdown content as a clean, readable HTML page.
 * Uses simple regex-based markdown→HTML (no external deps).
 */
function renderMarkdownPage(title: string, markdown: string): string {
  // Basic markdown → HTML conversion
  let html = escapeHtml(markdown);

  // Code blocks (``` ... ```) — must be before inline code
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, lang, code) =>
    `<pre><code class="language-${lang}">${code.trim()}</code></pre>`
  );
  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Headers
  html = html.replace(/^######\s+(.+)$/gm, '<h6>$1</h6>');
  html = html.replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>');
  html = html.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');
  // Bold + italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  // Horizontal rules
  html = html.replace(/^---+$/gm, '<hr>');
  // Unordered lists
  html = html.replace(/^[-*]\s+(.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`);
  // Ordered lists
  html = html.replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>');
  // Blockquotes
  html = html.replace(/^>\s+(.+)$/gm, '<blockquote>$1</blockquote>');
  // Paragraphs (double newlines)
  html = html.replace(/\n\n+/g, '</p><p>');
  html = `<p>${html}</p>`;
  // Clean up empty paragraphs around block elements
  html = html.replace(/<p>\s*(<h[1-6]|<pre|<ul|<ol|<hr|<blockquote)/g, '$1');
  html = html.replace(/(<\/h[1-6]>|<\/pre>|<\/ul>|<\/ol>|<hr>|<\/blockquote>)\s*<\/p>/g, '$1');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)} — Ultralight</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    line-height: 1.7;
    color: #1a1a2e;
    background: #fafafa;
    padding: 2rem 1rem;
  }
  article {
    max-width: 720px;
    margin: 0 auto;
    background: #fff;
    padding: 3rem;
    border-radius: 12px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.06);
  }
  h1 { font-size: 2rem; margin-bottom: 1rem; color: #0f0f23; }
  h2 { font-size: 1.5rem; margin: 2rem 0 0.75rem; color: #16213e; border-bottom: 1px solid #eee; padding-bottom: 0.3rem; }
  h3 { font-size: 1.25rem; margin: 1.5rem 0 0.5rem; color: #1a1a2e; }
  h4, h5, h6 { margin: 1.25rem 0 0.5rem; }
  p { margin: 0.75rem 0; }
  a { color: #4361ee; text-decoration: none; }
  a:hover { text-decoration: underline; }
  code {
    font-family: 'SF Mono', 'Fira Code', monospace;
    font-size: 0.9em;
    background: #f0f0f5;
    padding: 0.15em 0.4em;
    border-radius: 4px;
  }
  pre {
    margin: 1rem 0;
    padding: 1rem;
    background: #1a1a2e;
    color: #e0e0e0;
    border-radius: 8px;
    overflow-x: auto;
  }
  pre code { background: none; padding: 0; color: inherit; font-size: 0.85em; }
  ul, ol { margin: 0.75rem 0; padding-left: 1.5rem; }
  li { margin: 0.25rem 0; }
  blockquote {
    margin: 1rem 0;
    padding: 0.75rem 1rem;
    border-left: 3px solid #4361ee;
    background: #f8f9ff;
    color: #444;
  }
  hr { margin: 2rem 0; border: none; border-top: 1px solid #eee; }
  .footer {
    text-align: center;
    margin-top: 2rem;
    padding-top: 1rem;
    border-top: 1px solid #eee;
    font-size: 0.8rem;
    color: #999;
  }
  .footer a { color: #999; }
  @media (max-width: 600px) {
    body { padding: 1rem 0.5rem; }
    article { padding: 1.5rem; }
  }
</style>
</head>
<body>
<article>
${html}
<div class="footer">Published with <a href="https://ultralight.dev">Ultralight</a></div>
</article>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function json(data: unknown, status = 200): Response {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: { 'Content-Type': 'application/json' },
    },
  );
}

export function error(message: string, status = 400): Response {
  return json({ error: message }, status);
}
