// RPC Database Binding for Dynamic Workers
// Wraps D1 HTTP API calls behind a WorkerEntrypoint.
// The Dynamic Worker sees env.DB.query() but never sees CF credentials.
//
// This is the security boundary: credentials stay in the parent Worker,
// the Dynamic Worker only has access to the methods exposed here.

import { WorkerEntrypoint } from 'cloudflare:workers';
import { getEnv } from '../../lib/env.ts';

// ============================================
// TYPES
// ============================================

interface DatabaseBindingProps {
  databaseId: string;
  appId: string;
  userId: string;
}

interface D1QueryResult {
  success: boolean;
  results: Record<string, unknown>[];
  meta: {
    changes: number;
    last_row_id: number;
    duration: number;
    rows_read: number;
    rows_written: number;
  };
}

// ============================================
// RPC BINDING
// ============================================

export class DatabaseBinding extends WorkerEntrypoint<unknown, DatabaseBindingProps> {

  /**
   * Execute a D1 query via the Cloudflare HTTP API.
   * Credentials (CF_ACCOUNT_ID, CF_API_TOKEN) are read from the parent Worker's env,
   * never exposed to the Dynamic Worker.
   */
  private async queryD1(sql: string, params: unknown[] = []): Promise<D1QueryResult> {
    const cfAccountId = getEnv('CF_ACCOUNT_ID');
    const cfApiToken = getEnv('CF_API_TOKEN');
    const { databaseId } = this.ctx.props;

    if (!cfAccountId || !cfApiToken) {
      throw new Error('D1 not configured: missing CF_ACCOUNT_ID or CF_API_TOKEN');
    }

    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${cfAccountId}/d1/database/${databaseId}/query`,
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

    const data = await res.json() as {
      success: boolean;
      errors: Array<{ message: string }>;
      result: D1QueryResult[];
    };

    if (!data.success) {
      const errMsg = data.errors?.[0]?.message || 'Unknown D1 error';
      throw new Error(`D1 query error: ${errMsg}`);
    }

    return data.result?.[0] || { success: true, results: [], meta: { changes: 0, last_row_id: 0, duration: 0, rows_read: 0, rows_written: 0 } };
  }

  // ── D1DataService interface (matches ultralight.db.*) ──

  async run(sql: string, params?: unknown[]) {
    const r = await this.queryD1(sql, params || []);
    return {
      success: r.success,
      meta: {
        changes: r.meta?.changes ?? 0,
        last_row_id: r.meta?.last_row_id ?? 0,
        duration: r.meta?.duration ?? 0,
        rows_read: r.meta?.rows_read ?? 0,
        rows_written: r.meta?.rows_written ?? 0,
      },
    };
  }

  async all(sql: string, params?: unknown[]) {
    const r = await this.queryD1(sql, params || []);
    return r.results ?? [];
  }

  async first(sql: string, params?: unknown[]) {
    const r = await this.queryD1(sql, params || []);
    return r.results?.[0] ?? null;
  }

  async batch(statements: Array<{ sql: string; params?: unknown[] }>) {
    // Execute sequentially (D1 REST API doesn't support batch transactions)
    const results = [];
    for (const stmt of statements) {
      const r = await this.queryD1(stmt.sql, stmt.params || []);
      results.push({
        success: r.success,
        meta: {
          changes: r.meta?.changes ?? 0,
          last_row_id: r.meta?.last_row_id ?? 0,
          duration: r.meta?.duration ?? 0,
          rows_read: r.meta?.rows_read ?? 0,
          rows_written: r.meta?.rows_written ?? 0,
        },
      });
    }
    return results;
  }
}
