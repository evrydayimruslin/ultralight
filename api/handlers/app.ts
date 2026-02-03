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
import { getLayoutHTML } from '../../web/layout.ts';
import { getAppRunnerHTML } from '../../web/app-runner.ts';
import { createAppsService } from '../services/apps.ts';
import { createR2Service } from '../services/storage.ts';

export function createApp() {
  return {
    async handle(request: Request): Promise<Response> {
      const url = new URL(request.url);
      const path = url.pathname;
      const method = request.method;

      // Root redirect to upload page
      if (path === '/' && method === 'GET') {
        return new Response(null, {
          status: 302,
          headers: { 'Location': '/upload' },
        });
      }

      // Health check - includes deploy timestamp to verify we're running latest code
      if (path === '/health') {
        return json({ status: 'ok', version: '0.2.2', deployed: new Date().toISOString(), app_type_fix: true });
      }

      // Debug endpoint - test auth and database connection
      if (path === '/api/debug/auth' && method === 'GET') {
        const authHeader = request.headers.get('Authorization');
        const result: Record<string, unknown> = {
          hasAuthHeader: !!authHeader,
          authHeaderPreview: authHeader ? authHeader.substring(0, 30) + '...' : null,
        };

        // Test auth
        if (authHeader) {
          try {
            const { authenticate } = await import('./auth.ts');
            const user = await authenticate(request);
            result.authSuccess = true;
            result.user = user;
          } catch (err: unknown) {
            result.authSuccess = false;
            result.authError = err instanceof Error ? err.message : String(err);
          }
        }

        // Test Supabase connection
        try {
          const appsService = createAppsService();
          result.supabaseConfigured = true;

          // Try a simple query
          if (result.user && typeof result.user === 'object' && 'id' in result.user) {
            const apps = await appsService.listByOwner((result.user as { id: string }).id);
            result.appsCount = apps.length;
            result.dbQuerySuccess = true;
          }
        } catch (err: unknown) {
          result.supabaseConfigured = false;
          result.supabaseError = err instanceof Error ? err.message : String(err);
        }

        // Check env vars (without exposing values)
        // @ts-ignore
        const Deno = globalThis.Deno;
        result.envVars = {
          SUPABASE_URL: !!Deno?.env?.get('SUPABASE_URL'),
          SUPABASE_SERVICE_ROLE_KEY: !!Deno?.env?.get('SUPABASE_SERVICE_ROLE_KEY'),
          R2_ACCOUNT_ID: !!Deno?.env?.get('R2_ACCOUNT_ID'),
          R2_ACCESS_KEY_ID: !!Deno?.env?.get('R2_ACCESS_KEY_ID'),
          R2_SECRET_ACCESS_KEY: !!Deno?.env?.get('R2_SECRET_ACCESS_KEY'),
          R2_BUCKET_NAME: !!Deno?.env?.get('R2_BUCKET_NAME'),
        };

        return json(result);
      }

      // Upload page (HTML UI with sidebar)
      if (path === '/upload' && method === 'GET') {
        return new Response(getLayoutHTML({
          title: 'Upload',
          initialView: 'upload',
        }), {
          headers: { 'Content-Type': 'text/html' },
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

        return handleHttpEndpoint(request, appId, subPath);
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

          // Fetch the app code from R2
          // We have two bundles:
          // - IIFE bundle (index.tsx) - for MCP sandbox execution
          // - ESM bundle (index.esm.js) - for browser UI rendering
          const storageKey = app.storage_key;
          let code: string | null = null;  // IIFE bundle for type detection & MCP
          let esmCode: string | null = null;  // ESM bundle for browser UI

          // First try to load ESM bundle (for browser rendering)
          try {
            esmCode = await r2Service.fetchTextFile(`${storageKey}index.esm.js`);
            console.log(`App runner: loaded ESM bundle for app ${appId}`);
          } catch {
            // ESM bundle not available (older apps or unbundled)
          }

          // Try entry files in order of preference for IIFE/type detection
          const entryFiles = ['index.tsx', 'index.ts', 'index.jsx', 'index.js'];
          for (const entryFile of entryFiles) {
            try {
              code = await r2Service.fetchTextFile(`${storageKey}${entryFile}`);
              console.log(`App runner: loaded ${entryFile} for app ${appId}`);
              break;
            } catch {
              // Try next entry file
            }
          }

          if (!code) {
            console.error(`App runner: no entry file found for app ${appId}, storageKey: ${storageKey}`);
            return json({ error: 'App code not found' }, 404);
          }

          // Use ESM code for browser if available, otherwise fall back to IIFE
          const browserCode = esmCode || code;

          // Detect app type:
          // - HTTP Server apps: Have a handler function for direct HTTP request handling
          // - Browser apps: Have a default export (React UI component)
          // - MCP-only apps: Only have named function exports, no default export, no handler
          //
          // Priority: handler function > default export (UI) > named exports only (MCP)
          // Detection works for both ESM and IIFE bundles:
          // - ESM: export default function render(...)
          // - IIFE: __export(exports, { default: () => render, ... })
          const hasDefaultExport =
            // ESM patterns
            /export\s+default\s+/.test(code) ||
            /export\s*\{[^}]*default[^}]*\}/.test(code) ||
            // IIFE bundle patterns (esbuild output)
            /default:\s*\(\)\s*=>/.test(code) ||  // __export(x, { default: () => fn })
            /["']default["']\s*:\s*\(\)\s*=>/.test(code);  // Quoted version

          const hasHandlerFunction =
            /export\s+(default\s+)?(async\s+)?function\s+handler\s*\(/.test(code) ||
            /export\s+default\s+handler/.test(code) ||
            /export\s+\{\s*handler\s*\}/.test(code) ||
            /^(async\s+)?function\s+handler\s*\(/m.test(code) ||
            /var\s+handler\s*=/.test(code) ||
            // IIFE bundle pattern
            /handler:\s*\(\)\s*=>/.test(code);

          // Determine app type with clear priority:
          // 1. HTTP Server app - has handler function (highest priority)
          // 2. Browser app - has default export (React/UI component)
          // 3. MCP-only app - everything else (only named exports, no UI)
          const isHttpServerApp = hasHandlerFunction;
          const isBrowserApp = !isHttpServerApp && hasDefaultExport;
          const isMcpOnlyApp = !isHttpServerApp && !isBrowserApp;

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
                headers: { 'Content-Type': 'text/html' },
              });
            }
          } else if (isMcpOnlyApp) {
            // MCP-only app - show info page with available tools
            const isEmbed = url.searchParams.get('embed') === '1';

            if (isEmbed) {
              // Return an info page for the iframe showing MCP tools
              return new Response(getMcpAppInfoHTML(appId, app.name || app.slug, app.skills_parsed || []), {
                headers: { 'Content-Type': 'text/html' },
              });
            } else {
              // Normal view with sidebar
              return new Response(getLayoutHTML({
                title: app.name || app.slug,
                activeAppId: appId,
                initialView: 'app',
                appName: app.name || app.slug,
              }), {
                headers: { 'Content-Type': 'text/html' },
              });
            }
          } else {
            // Browser app: serve the layout HTML with app embedded (only for GET requests to root)
            if (method === 'GET' && (subPath === '/' || subPath === '')) {
              // Check for embed mode (used by iframe in sidebar)
              const isEmbed = url.searchParams.get('embed') === '1';

              if (isEmbed) {
                // Embed mode: serve app without sidebar using app-runner
                // Use ESM bundle for browser rendering (falls back to IIFE if no ESM)
                return new Response(getAppRunnerHTML(appId, app.name || app.slug, browserCode), {
                  headers: { 'Content-Type': 'text/html' },
                });
              } else {
                // Normal mode: serve with sidebar layout
                // The app will be loaded via iframe for consistency (single source of truth)
                // This ensures apps render the same whether accessed directly or via sidebar navigation
                return new Response(getLayoutHTML({
                  title: app.name || app.slug,
                  activeAppId: appId,
                  initialView: 'app',
                  // Don't pass appCode - the layout will load it via iframe instead
                  appName: app.name || app.slug,
                }), {
                  headers: { 'Content-Type': 'text/html' },
                });
              }
            } else {
              return json({ error: 'Browser apps only support GET requests to root' }, 400);
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
      <p class="info-text" style="margin-top: 1rem;">
        Connect to this app using any MCP-compatible client (Claude Desktop, Cursor, etc.)
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
