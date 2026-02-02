// App Router
// Routes requests to appropriate handlers

import { handleUpload } from './upload.ts';
import { handleRun } from './run.ts';
import { handleAuth } from './auth.ts';
import { handleApps } from './apps.ts';
import { getUploadPageHTML } from '../../web/upload-page.ts';
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
        return json({ status: 'ok', version: '0.1.0', deployed: '2025-02-01T18:15:00Z' });
      }

      // Debug endpoint - test auth without upload
      if (path === '/api/debug/auth' && method === 'GET') {
        const authHeader = request.headers.get('Authorization');
        if (!authHeader) {
          return json({ error: 'No auth header', headers: Object.fromEntries(request.headers.entries()) });
        }
        try {
          const { authenticate } = await import('./auth.ts');
          const user = await authenticate(request);
          return json({ success: true, user });
        } catch (err: unknown) {
          return json({ error: 'Auth failed', message: err instanceof Error ? err.message : String(err) });
        }
      }

      // Upload page (HTML UI)
      if (path === '/upload' && method === 'GET') {
        return new Response(getUploadPageHTML(), {
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

      // Apps listing
      if (path === '/api/apps') {
        return handleApps(request);
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

        try {
          const appsService = createAppsService();
          const r2Service = createR2Service();

          const app = await appsService.findById(appId);
          if (!app) {
            return json({ error: 'App not found' }, 404);
          }

          // Fetch the app code from R2
          const storageKey = app.storage_key;
          let code: string | null = null;

          try {
            code = await r2Service.fetchTextFile(`${storageKey}index.ts`);
          } catch {
            try {
              code = await r2Service.fetchTextFile(`${storageKey}index.js`);
            } catch {
              return json({ error: 'App code not found' }, 404);
            }
          }

          // Detect app type by checking for handler function
          // After bundling, exports are transformed, so we check for:
          // 1. Original export patterns (unbundled code)
          // 2. Transformed handler function/variable (bundled code)
          const isServerApp =
            // Original export patterns
            /export\s+(default\s+)?(async\s+)?function\s+handler\s*\(/.test(code) ||
            /export\s+default\s+handler/.test(code) ||
            /export\s+\{\s*handler\s*\}/.test(code) ||
            // Bundled/transformed patterns - function named handler
            /^(async\s+)?function\s+handler\s*\(/m.test(code) ||
            // IIFE exports pattern from esbuild
            /var\s+handler\s*=/.test(code) ||
            /__ultralight_exports__/.test(code);

          if (isServerApp) {
            // Server-side execution: run the handler function
            return await executeServerApp(code, request, appId, subPath);
          } else {
            // Browser app: serve the runner HTML (only for GET requests to root)
            if (method === 'GET' && (subPath === '/' || subPath === '')) {
              return new Response(getAppRunnerHTML(appId, app.name || app.slug, code), {
                headers: { 'Content-Type': 'text/html' },
              });
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
