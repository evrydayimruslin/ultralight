// D1 Provisioning Service
// Lazy-creates a Cloudflare D1 database per app via the Cloudflare API.
// Called on first ultralight.db.* invocation.
// Tracks provisioning state in Supabase apps table (d1_database_id, d1_status).

import { getEnv } from '../lib/env.ts';

// ============================================
// TYPES
// ============================================

export interface D1ProvisionResult {
  databaseId: string;
  databaseName: string;
  status: 'ready' | 'error';
  error?: string;
}

interface CloudflareD1CreateResponse {
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  result: {
    uuid: string;
    name: string;
    created_at: string;
  };
}

// ============================================
// CONSTANTS
// ============================================

const CF_API_BASE = 'https://api.cloudflare.com/client/v4';

// System tables created in every new D1 database
const SYSTEM_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS _migrations (
  version INTEGER PRIMARY KEY,
  filename TEXT NOT NULL,
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS _usage (
  user_id TEXT NOT NULL,
  rows_read_total INTEGER NOT NULL DEFAULT 0,
  rows_written_total INTEGER NOT NULL DEFAULT 0,
  storage_bytes_estimate INTEGER NOT NULL DEFAULT 0,
  last_updated TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id)
);
`;

// ============================================
// PROVISIONING
// ============================================

/**
 * Provision a D1 database for an app. Idempotent — returns existing database if already provisioned.
 *
 * Flow:
 * 1. Check apps.d1_database_id in Supabase
 * 2. If already ready, return existing database ID
 * 3. If null, claim the provisioning slot (optimistic lock)
 * 4. Create D1 via Cloudflare API
 * 5. Run system table DDL
 * 6. Update apps row with database ID and status=ready
 */
export async function provisionD1ForApp(appId: string): Promise<D1ProvisionResult> {
  const cfAccountId = getEnv('CF_ACCOUNT_ID');
  const cfApiToken = getEnv('CF_API_TOKEN');
  const supabaseUrl = getEnv('SUPABASE_URL');
  const supabaseKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');

  if (!cfAccountId || !cfApiToken) {
    return { databaseId: '', databaseName: '', status: 'error', error: 'Missing CF_ACCOUNT_ID or CF_API_TOKEN' };
  }

  // 1. Check current state
  const existing = await getAppD1State(appId, supabaseUrl, supabaseKey);

  if (existing?.d1_status === 'ready' && existing.d1_database_id) {
    return { databaseId: existing.d1_database_id, databaseName: `ultralight-${appId}`, status: 'ready' };
  }

  if (existing?.d1_status === 'provisioning') {
    // Another request is creating it — wait and retry
    return await waitForProvisioning(appId, supabaseUrl, supabaseKey);
  }

  // 2. Claim provisioning slot (optimistic lock)
  const claimed = await claimProvisioningSlot(appId, supabaseUrl, supabaseKey);
  if (!claimed) {
    // Lost race — another request is provisioning, wait for it
    return await waitForProvisioning(appId, supabaseUrl, supabaseKey);
  }

  try {
    // 3. Create D1 database via Cloudflare API
    const databaseName = `ultralight-${appId}`;
    const createRes = await fetch(
      `${CF_API_BASE}/accounts/${cfAccountId}/d1/database`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${cfApiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: databaseName }),
      }
    );

    if (!createRes.ok) {
      const errText = await createRes.text();
      await setD1Status(appId, 'error', null, supabaseUrl, supabaseKey);
      return { databaseId: '', databaseName, status: 'error', error: `CF API error (${createRes.status}): ${errText}` };
    }

    const createData = await createRes.json() as CloudflareD1CreateResponse;
    if (!createData.success || !createData.result?.uuid) {
      const errMsg = createData.errors?.[0]?.message || 'Unknown CF API error';
      await setD1Status(appId, 'error', null, supabaseUrl, supabaseKey);
      return { databaseId: '', databaseName, status: 'error', error: errMsg };
    }

    const databaseId = createData.result.uuid;

    // 4. Create system tables
    await executeD1Sql(cfAccountId, cfApiToken, databaseId, SYSTEM_TABLES_SQL);

    // 5. Mark as ready
    await setD1Status(appId, 'ready', databaseId, supabaseUrl, supabaseKey);

    console.log(`[D1-PROVISION] Created database ${databaseName} (${databaseId}) for app ${appId}`);

    return { databaseId, databaseName, status: 'ready' };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[D1-PROVISION] Failed for app ${appId}:`, errMsg);
    await setD1Status(appId, 'error', null, supabaseUrl, supabaseKey);
    return { databaseId: '', databaseName: `ultralight-${appId}`, status: 'error', error: errMsg };
  }
}

/**
 * Get the D1 database ID for an app. Returns null if not provisioned.
 */
export async function getD1DatabaseId(appId: string): Promise<string | null> {
  const supabaseUrl = getEnv('SUPABASE_URL');
  const supabaseKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');
  const state = await getAppD1State(appId, supabaseUrl, supabaseKey);
  return state?.d1_database_id || null;
}

/**
 * Delete the D1 database for an app. Called on app deletion.
 */
export async function deleteD1ForApp(appId: string): Promise<void> {
  const cfAccountId = getEnv('CF_ACCOUNT_ID');
  const cfApiToken = getEnv('CF_API_TOKEN');
  const supabaseUrl = getEnv('SUPABASE_URL');
  const supabaseKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');

  const databaseId = await getD1DatabaseId(appId);
  if (!databaseId) return;

  try {
    const res = await fetch(
      `${CF_API_BASE}/accounts/${cfAccountId}/d1/database/${databaseId}`,
      {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${cfApiToken}` },
      }
    );

    if (!res.ok && res.status !== 404) {
      console.error(`[D1-PROVISION] Failed to delete D1 for app ${appId}:`, await res.text());
    }

    // Clear D1 columns in apps table
    await setD1Status(appId, null, null, supabaseUrl, supabaseKey);
    console.log(`[D1-PROVISION] Deleted database for app ${appId}`);
  } catch (err) {
    console.error(`[D1-PROVISION] Error deleting D1 for app ${appId}:`, err);
  }
}

// ============================================
// D1 SQL EXECUTION (via Cloudflare HTTP API)
// ============================================

/**
 * Execute SQL against a D1 database via the Cloudflare REST API.
 * Used for provisioning (system tables) and migrations.
 * For runtime queries, use the Worker proxy (d1-data.ts).
 */
export async function executeD1Sql(
  cfAccountId: string,
  cfApiToken: string,
  databaseId: string,
  sql: string,
  params?: unknown[],
): Promise<D1QueryResponse> {
  const res = await fetch(
    `${CF_API_BASE}/accounts/${cfAccountId}/d1/database/${databaseId}/query`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${cfApiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sql, params: params || [] }),
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`D1 query failed (${res.status}): ${errText}`);
  }

  return await res.json() as D1QueryResponse;
}

export interface D1QueryResponse {
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
      served_by: string;
    };
  }>;
}

// ============================================
// SUPABASE HELPERS
// ============================================

interface AppD1State {
  d1_database_id: string | null;
  d1_status: string | null;
  d1_provisioned_at: string | null;
  d1_last_migration_version: number;
}

async function getAppD1State(
  appId: string,
  supabaseUrl: string,
  supabaseKey: string,
): Promise<AppD1State | null> {
  if (!supabaseUrl || !supabaseKey) return null;

  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/apps?id=eq.${appId}&select=d1_database_id,d1_status,d1_provisioned_at,d1_last_migration_version`,
      {
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
        },
      }
    );
    if (!res.ok) return null;
    const rows = await res.json() as AppD1State[];
    return rows?.[0] || null;
  } catch {
    return null;
  }
}

async function claimProvisioningSlot(
  appId: string,
  supabaseUrl: string,
  supabaseKey: string,
): Promise<boolean> {
  if (!supabaseUrl || !supabaseKey) return false;

  try {
    // Optimistic lock: only update if d1_status is NULL (not yet claimed)
    const res = await fetch(
      `${supabaseUrl}/rest/v1/apps?id=eq.${appId}&d1_status=is.null`,
      {
        method: 'PATCH',
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({ d1_status: 'provisioning' }),
      }
    );

    // If the PATCH matched a row, we claimed it
    // Supabase returns 204 with content-range header showing count
    const contentRange = res.headers.get('content-range');
    if (contentRange) {
      // Format: */0 means no rows matched, */1 means 1 row matched
      return !contentRange.endsWith('/0');
    }
    return res.ok;
  } catch {
    return false;
  }
}

async function setD1Status(
  appId: string,
  status: string | null,
  databaseId: string | null,
  supabaseUrl: string,
  supabaseKey: string,
): Promise<void> {
  if (!supabaseUrl || !supabaseKey) return;

  try {
    const body: Record<string, unknown> = {
      d1_status: status,
      d1_database_id: databaseId,
    };
    if (status === 'ready') {
      body.d1_provisioned_at = new Date().toISOString();
    }
    if (status === null) {
      // Clearing — reset all D1 columns
      body.d1_provisioned_at = null;
      body.d1_last_migration_version = 0;
    }

    await fetch(
      `${supabaseUrl}/rest/v1/apps?id=eq.${appId}`,
      {
        method: 'PATCH',
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify(body),
      }
    );
  } catch (err) {
    console.error(`[D1-PROVISION] Failed to set status for app ${appId}:`, err);
  }
}

async function waitForProvisioning(
  appId: string,
  supabaseUrl: string,
  supabaseKey: string,
  maxWaitMs = 15000,
): Promise<D1ProvisionResult> {
  const start = Date.now();
  const pollIntervalMs = 500;

  while (Date.now() - start < maxWaitMs) {
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    const state = await getAppD1State(appId, supabaseUrl, supabaseKey);

    if (state?.d1_status === 'ready' && state.d1_database_id) {
      return { databaseId: state.d1_database_id, databaseName: `ultralight-${appId}`, status: 'ready' };
    }
    if (state?.d1_status === 'error') {
      return { databaseId: '', databaseName: `ultralight-${appId}`, status: 'error', error: 'Provisioning failed (set by another request)' };
    }
  }

  return { databaseId: '', databaseName: `ultralight-${appId}`, status: 'error', error: 'Provisioning timeout' };
}
