// Ultralight Data Layer Worker
// Cloudflare Worker providing native R2 data access for MCP app storage
//
// Architecture:
//   DO API Server (control plane + execution) → Worker (data layer)
//   - DO handles: auth, rate limiting, permissions, routing, code execution
//   - Worker handles: R2 storage ops with native bindings (~10x faster than HTTP-signed S3)
//
// Auth: shared secret in X-Worker-Secret header
//
// Endpoints:
//   GET  /health                → health check
//   POST /data/store            → store a value
//   POST /data/load             → load a value
//   POST /data/remove           → remove a value
//   POST /data/list             → list keys
//   POST /data/batch-store      → store multiple values
//   POST /data/batch-load       → load multiple values
//   POST /data/batch-remove     → remove multiple values
//   GET  /code/:storageKey/*    → fetch app code (with KV cache)

interface Env {
  R2_BUCKET: R2Bucket;
  CODE_CACHE: KVNamespace;
  WORKER_SECRET: string;
  ENVIRONMENT: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Health check (no auth required)
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
      return json({ status: 'ok', service: 'ultralight-data-worker' });
    }

    // Authenticate all other requests
    const secret = request.headers.get('X-Worker-Secret');
    if (!secret || secret !== env.WORKER_SECRET) {
      return json({ error: 'Unauthorized' }, 401);
    }

    try {
      // ============================================
      // CODE FETCH (with KV cache)
      // ============================================
      if (request.method === 'POST' && url.pathname === '/code/fetch') {
        const { appId, storageKey } = await request.json() as { appId: string; storageKey: string };
        if (!appId || !storageKey) return json({ error: 'Missing appId or storageKey' }, 400);

        // Check KV cache first
        const cacheKey = `code:${appId}:${storageKey}`;
        const cached = await env.CODE_CACHE.get(cacheKey);
        if (cached) {
          return json({ code: cached, source: 'kv-cache' });
        }

        // Try each entry file from R2
        const entryFiles = ['index.tsx', 'index.ts', 'index.jsx', 'index.js'];
        for (const entryFile of entryFiles) {
          const obj = await env.R2_BUCKET.get(`${storageKey}${entryFile}`);
          if (obj) {
            const code = await obj.text();
            // Cache in KV (5 min TTL)
            await env.CODE_CACHE.put(cacheKey, code, { expirationTtl: 300 });
            return json({ code: code, source: 'r2' });
          }
        }

        return json({ code: null, source: 'not-found' });
      }

      // ============================================
      // CODE CACHE INVALIDATION
      // ============================================
      if (request.method === 'POST' && url.pathname === '/code/invalidate') {
        const { appId } = await request.json() as { appId: string };
        if (!appId) return json({ error: 'Missing appId' }, 400);

        // KV doesn't support prefix deletion, so we just let entries expire (5 min TTL)
        // For immediate invalidation, the caller can pass the specific storageKey
        return json({ ok: true });
      }

      // ============================================
      // DATA OPERATIONS
      // ============================================
      if (request.method === 'POST' && url.pathname.startsWith('/data/')) {
        const op = url.pathname.replace('/data/', '');
        const body = await request.json() as Record<string, unknown>;
        const appId = body.appId as string;
        const userId = body.userId as string | undefined;

        if (!appId) return json({ error: 'Missing appId' }, 400);

        const dataPrefix = userId
          ? `apps/${appId}/users/${userId}/data/`
          : `apps/${appId}/data/`;

        switch (op) {
          case 'store': {
            const key = sanitizeKey(body.key as string);
            const path = `${dataPrefix}${key}.json`;
            const data = JSON.stringify({
              key: key,
              value: body.value,
              updated_at: new Date().toISOString(),
            });
            await env.R2_BUCKET.put(path, data, {
              httpMetadata: { contentType: 'application/json' },
            });
            return json({ ok: true });
          }

          case 'load': {
            const key = sanitizeKey(body.key as string);
            const path = `${dataPrefix}${key}.json`;
            const obj = await env.R2_BUCKET.get(path);
            if (!obj) return json({ value: null });
            const parsed = JSON.parse(await obj.text());
            return json({ value: parsed.value });
          }

          case 'remove': {
            const key = sanitizeKey(body.key as string);
            const path = `${dataPrefix}${key}.json`;
            await env.R2_BUCKET.delete(path);
            return json({ ok: true });
          }

          case 'list': {
            const prefix = body.prefix as string | undefined;
            const searchPrefix = prefix
              ? `${dataPrefix}${sanitizeKey(prefix)}`
              : dataPrefix;
            const listed = await env.R2_BUCKET.list({ prefix: searchPrefix });
            const keys = listed.objects
              .filter(obj => obj.key.endsWith('.json'))
              .map(obj => obj.key.replace(dataPrefix, '').replace('.json', ''));
            return json({ keys: keys });
          }

          case 'batch-store': {
            const items = body.items as Array<{ key: string; value: unknown }>;
            if (!items || !Array.isArray(items)) return json({ error: 'Missing items array' }, 400);

            // Process in parallel batches of 10
            const BATCH_SIZE = 10;
            for (let i = 0; i < items.length; i += BATCH_SIZE) {
              const batch = items.slice(i, i + BATCH_SIZE);
              await Promise.all(batch.map(item => {
                const key = sanitizeKey(item.key);
                const path = `${dataPrefix}${key}.json`;
                const data = JSON.stringify({
                  key: key,
                  value: item.value,
                  updated_at: new Date().toISOString(),
                });
                return env.R2_BUCKET.put(path, data, {
                  httpMetadata: { contentType: 'application/json' },
                });
              }));
            }
            return json({ ok: true });
          }

          case 'batch-load': {
            const keys = body.keys as string[];
            if (!keys || !Array.isArray(keys)) return json({ error: 'Missing keys array' }, 400);

            const results = await Promise.all(keys.map(async (k) => {
              const key = sanitizeKey(k);
              const path = `${dataPrefix}${key}.json`;
              const obj = await env.R2_BUCKET.get(path);
              if (!obj) return { key: k, value: null };
              try {
                const parsed = JSON.parse(await obj.text());
                return { key: k, value: parsed.value };
              } catch {
                return { key: k, value: null };
              }
            }));
            return json({ items: results });
          }

          case 'batch-remove': {
            const keys = body.keys as string[];
            if (!keys || !Array.isArray(keys)) return json({ error: 'Missing keys array' }, 400);

            // R2 supports multi-delete
            const paths = keys.map(k => `${dataPrefix}${sanitizeKey(k)}.json`);
            const BATCH_SIZE = 100;
            for (let i = 0; i < paths.length; i += BATCH_SIZE) {
              await env.R2_BUCKET.delete(paths.slice(i, i + BATCH_SIZE));
            }
            return json({ ok: true });
          }

          default:
            return json({ error: `Unknown operation: ${op}` }, 404);
        }
      }

      return json({ error: 'Not found' }, 404);

    } catch (err) {
      console.error('[WORKER] Error:', err);
      const message = err instanceof Error ? err.message : String(err);
      return json({ error: message }, 500);
    }
  },
};

// ============================================
// HELPERS
// ============================================

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status: status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function sanitizeKey(key: string): string {
  return key
    .replace(/[^a-zA-Z0-9\-_\/]/g, '_')
    .replace(/\/+/g, '/')
    .replace(/^\//, '')
    .replace(/\/$/, '');
}
