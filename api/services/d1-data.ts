// D1 Data Service
// Executes SQL queries against an app's D1 database via the Cloudflare HTTP API.
// This is the runtime data layer — called from sandbox.ts for every ultralight.db.* invocation.
// For provisioning and migrations, see d1-provisioning.ts and d1-migrations.ts.

import { getEnv } from '../lib/env.ts';
import { provisionD1ForApp } from './d1-provisioning.ts';

// ============================================
// TYPES
// ============================================

export interface D1RunResult {
  success: boolean;
  meta: {
    changes: number;
    last_row_id: number;
    duration: number;
    rows_read: number;
    rows_written: number;
  };
}

export interface D1ExecResult {
  success: boolean;
  count: number;
}

export interface D1DataService {
  /** Execute INSERT/UPDATE/DELETE — returns meta with changes count */
  run(sql: string, params?: unknown[]): Promise<D1RunResult>;

  /** Execute SELECT — returns all matching rows */
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;

  /** Execute SELECT — returns first row or null */
  first<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null>;

  /** Execute raw DDL/multi-statement SQL. Only used during migrations, blocked at runtime. */
  exec(sql: string): Promise<D1ExecResult>;

  /** Execute multiple statements atomically (transaction) */
  batch(statements: Array<{ sql: string; params?: unknown[] }>): Promise<D1RunResult[]>;
}

// ============================================
// CF D1 HTTP API RESPONSE TYPES
// ============================================

interface CfD1ApiResponse {
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

// ============================================
// IMPLEMENTATION
// ============================================

/**
 * Create a D1 data service for an app.
 * Handles lazy provisioning: if the app has no D1 yet, provisions one on first call.
 *
 * @param appId - The app identifier
 * @param databaseId - Pre-resolved D1 database ID (null if not yet provisioned)
 */
export function createD1DataService(
  appId: string,
  databaseId: string | null,
): D1DataService {
  const cfAccountId = getEnv('CF_ACCOUNT_ID');
  const cfApiToken = getEnv('CF_API_TOKEN');

  // Mutable reference — gets set on first call if null (lazy provisioning)
  let resolvedDbId: string | null = databaseId;

  async function ensureDatabase(): Promise<string> {
    if (resolvedDbId) return resolvedDbId;

    const result = await provisionD1ForApp(appId);
    if (result.status !== 'ready' || !result.databaseId) {
      throw new Error(`D1 provisioning failed for app ${appId}: ${result.error || 'unknown error'}`);
    }
    resolvedDbId = result.databaseId;
    return resolvedDbId;
  }

  async function queryD1(sql: string, params: unknown[] = []): Promise<CfD1ApiResponse> {
    const dbId = await ensureDatabase();

    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${cfAccountId}/d1/database/${dbId}/query`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${cfApiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sql, params }),
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`D1 query failed (${res.status}): ${errText}`);
    }

    const data = await res.json() as CfD1ApiResponse;
    if (!data.success) {
      const errMsg = data.errors?.[0]?.message || 'Unknown D1 error';
      throw new Error(`D1 query error: ${errMsg}`);
    }

    return data;
  }

  return {
    async run(sql: string, params?: unknown[]): Promise<D1RunResult> {
      const data = await queryD1(sql, params || []);
      const first = data.result?.[0];
      return {
        success: first?.success ?? false,
        meta: {
          changes: first?.meta?.changes ?? 0,
          last_row_id: first?.meta?.last_row_id ?? 0,
          duration: first?.meta?.duration ?? 0,
          rows_read: first?.meta?.rows_read ?? 0,
          rows_written: first?.meta?.rows_written ?? 0,
        },
      };
    },

    async all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
      const data = await queryD1(sql, params || []);
      return (data.result?.[0]?.results ?? []) as T[];
    },

    async first<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null> {
      const data = await queryD1(sql, params || []);
      const rows = data.result?.[0]?.results ?? [];
      return (rows[0] as T) ?? null;
    },

    async exec(sql: string): Promise<D1ExecResult> {
      // exec runs raw multi-statement SQL — used for migrations only
      const dbId = await ensureDatabase();

      const res = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${cfAccountId}/d1/database/${dbId}/raw`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${cfApiToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ sql }),
        }
      );

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`D1 exec failed (${res.status}): ${errText}`);
      }

      const data = await res.json() as CfD1ApiResponse;
      return {
        success: data.success,
        count: data.result?.length ?? 0,
      };
    },

    async batch(statements: Array<{ sql: string; params?: unknown[] }>): Promise<D1RunResult[]> {
      // Execute statements sequentially via the single-query endpoint.
      // D1 REST API /query expects a single {sql, params} object, not an array.
      // Note: D1 REST API does not support BEGIN/COMMIT transactions.
      const results: D1RunResult[] = [];

      for (const stmt of statements) {
        const data = await queryD1(stmt.sql, stmt.params || []);
        const r = data.result?.[0];
        results.push({
          success: r?.success ?? true,
          meta: {
            changes: r?.meta?.changes ?? 0,
            last_row_id: r?.meta?.last_row_id ?? 0,
            duration: r?.meta?.duration ?? 0,
            rows_read: r?.meta?.rows_read ?? 0,
            rows_written: r?.meta?.rows_written ?? 0,
          },
        });
      }

      return results;
    },
  };
}
