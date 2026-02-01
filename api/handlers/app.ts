// App Router
// Routes requests to appropriate handlers

import { handleUpload } from './upload.ts';
import { handleRun } from './run.ts';
import { handleAuth } from './auth.ts';
import { handleApps } from './apps.ts';
import { getUploadPageHTML } from '../../web/upload-page.ts';

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
        return json({ status: 'ok', version: '0.1.0', deployed: '2025-02-01T18:00:00Z' });
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

      // 404
      return json({ error: 'Not found' }, 404);
    },
  };
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
