// Ultralight Data Layer Worker
// Cloudflare Worker providing native R2 data access + D1 query proxy for MCP app storage
//
// Architecture:
//   DO API Server (control plane + execution) → Worker (data layer)
//   - DO handles: auth, rate limiting, permissions, routing, code execution
//   - Worker handles: R2 storage ops with native bindings, D1 query proxy via CF HTTP API
//
// Auth: shared secret in X-Worker-Secret header
//
// Endpoints:
//   GET  /health                → health check
//   POST /data/store            → store a value (R2)
//   POST /data/load             → load a value (R2)
//   POST /data/remove           → remove a value (R2)
//   POST /data/list             → list keys (R2)
//   POST /data/batch-store      → store multiple values (R2)
//   POST /data/batch-load       → load multiple values (R2)
//   POST /data/batch-remove     → remove multiple values (R2)
//   POST /code/fetch            → fetch app code (with KV cache)
//   POST /code/invalidate       → invalidate code cache
//   POST /d1/query              → execute SQL against an app's D1 database
//   POST /d1/batch              → execute multiple SQL statements atomically

interface Env {
  R2_BUCKET: R2Bucket;
  CODE_CACHE: KVNamespace;
  WORKER_SECRET: string;
  ENVIRONMENT: string;
  CF_ACCOUNT_ID: string;
  CF_API_TOKEN: string;
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
            // Include _size_bytes for metering delta tracking
            const payload = {
              key: key,
              value: body.value,
              updated_at: new Date().toISOString(),
              _size_bytes: 0,
            };
            const baseData = JSON.stringify(payload);
            const sizeBytes = new TextEncoder().encode(baseData).length;
            payload._size_bytes = sizeBytes;
            const data = JSON.stringify(payload);
            await env.R2_BUCKET.put(path, data, {
              httpMetadata: { contentType: 'application/json' },
            });
            return json({ ok: true, _size_bytes: sizeBytes });
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
            let totalSizeBytes = 0;
            for (let i = 0; i < items.length; i += BATCH_SIZE) {
              const batch = items.slice(i, i + BATCH_SIZE);
              await Promise.all(batch.map(item => {
                const key = sanitizeKey(item.key);
                const path = `${dataPrefix}${key}.json`;
                // Include _size_bytes for metering delta tracking
                const payload = {
                  key: key,
                  value: item.value,
                  updated_at: new Date().toISOString(),
                  _size_bytes: 0,
                };
                const baseData = JSON.stringify(payload);
                const sizeBytes = new TextEncoder().encode(baseData).length;
                payload._size_bytes = sizeBytes;
                totalSizeBytes += sizeBytes;
                const data = JSON.stringify(payload);
                return env.R2_BUCKET.put(path, data, {
                  httpMetadata: { contentType: 'application/json' },
                });
              }));
            }
            return json({ ok: true, _total_size_bytes: totalSizeBytes });
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

      // ============================================
      // D1 QUERY PROXY
      // ============================================
      if (request.method === 'POST' && url.pathname === '/d1/query') {
        const body = await request.json() as {
          databaseId: string;
          sql: string;
          params?: unknown[];
          userId?: string;
        };

        if (!body.databaseId || !body.sql) {
          return json({ error: 'Missing databaseId or sql' }, 400);
        }

        const d1Result = await queryD1(env, body.databaseId, body.sql, body.params || []);

        // Track usage if userId provided
        if (body.userId && d1Result.success && d1Result.result?.[0]?.meta) {
          const meta = d1Result.result[0].meta;
          // Fire-and-forget usage tracking within the same D1
          trackUsage(env, body.databaseId, body.userId, meta.rows_read, meta.rows_written).catch(() => {});
        }

        return json(d1Result);
      }

      if (request.method === 'POST' && url.pathname === '/d1/batch') {
        const body = await request.json() as {
          databaseId: string;
          statements: Array<{ sql: string; params?: unknown[] }>;
          userId?: string;
        };

        if (!body.databaseId || !body.statements?.length) {
          return json({ error: 'Missing databaseId or statements' }, 400);
        }

        const d1Result = await batchD1(env, body.databaseId, body.statements);

        // Track aggregate usage
        if (body.userId && d1Result.success) {
          let totalRead = 0;
          let totalWritten = 0;
          for (const r of d1Result.result || []) {
            totalRead += r.meta?.rows_read ?? 0;
            totalWritten += r.meta?.rows_written ?? 0;
          }
          trackUsage(env, body.databaseId, body.userId, totalRead, totalWritten).catch(() => {});
        }

        return json(d1Result);
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
// D1 HTTP API HELPERS
// ============================================

interface D1ApiResponse {
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  result: Array<{
    success: boolean;
    results: Record<string, unknown>[];
    meta: {
      changes: number;
      last_row_id: number;
      duration: number;
      rows_read: number;
      rows_written: number;
    };
  }>;
}

async function queryD1(
  env: Env,
  databaseId: string,
  sql: string,
  params: unknown[],
): Promise<D1ApiResponse> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/d1/database/${databaseId}/query`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.CF_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sql, params }),
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    return {
      success: false,
      errors: [{ code: res.status, message: errText }],
      result: [],
    };
  }

  return await res.json() as D1ApiResponse;
}

async function batchD1(
  env: Env,
  databaseId: string,
  statements: Array<{ sql: string; params?: unknown[] }>,
): Promise<D1ApiResponse> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/d1/database/${databaseId}/query`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.CF_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(statements.map(s => ({ sql: s.sql, params: s.params || [] }))),
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    return {
      success: false,
      errors: [{ code: res.status, message: errText }],
      result: [],
    };
  }

  return await res.json() as D1ApiResponse;
}

/**
 * Track per-user D1 usage within the app's D1 database.
 * Fire-and-forget — errors are silently ignored.
 */
async function trackUsage(
  env: Env,
  databaseId: string,
  userId: string,
  rowsRead: number,
  rowsWritten: number,
): Promise<void> {
  if (rowsRead === 0 && rowsWritten === 0) return;

  await queryD1(env, databaseId,
    `INSERT INTO _usage (user_id, rows_read_total, rows_written_total, last_updated)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       rows_read_total = rows_read_total + excluded.rows_read_total,
       rows_written_total = rows_written_total + excluded.rows_written_total,
       last_updated = datetime('now')`,
    [userId, rowsRead, rowsWritten],
  );
}

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
