// Storage Quota Service
// Handles storage tracking and enforcement via Supabase RPCs
// Used by upload, publish, and delete handlers to manage per-user storage quotas.

// @ts-ignore - Deno is available in Deno Deploy
const Deno = globalThis.Deno;

export interface StorageQuotaResult {
  allowed: boolean;
  used_bytes: number;
  limit_bytes: number;
  remaining_bytes: number;
}

/**
 * Check if a user has enough storage quota for an upload.
 * Calls the check_storage_quota() Supabase RPC.
 */
export async function checkStorageQuota(
  userId: string,
  uploadSizeBytes: number
): Promise<StorageQuotaResult> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/check_storage_quota`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${supabaseKey}`,
      'apikey': supabaseKey!,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      p_user_id: userId,
      p_upload_size: uploadSizeBytes,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error('check_storage_quota RPC failed:', error);
    // Fail open: allow upload if quota check fails (don't block users on infra issues)
    return {
      allowed: true,
      used_bytes: 0,
      limit_bytes: 0,
      remaining_bytes: 0,
    };
  }

  const results = await response.json();

  // RPC returns a set of rows; we get the first row
  if (Array.isArray(results) && results.length > 0) {
    return results[0] as StorageQuotaResult;
  }

  // Single row result (Supabase may return object directly for single-row RETURNS TABLE)
  if (results && typeof results === 'object' && 'allowed' in results) {
    return results as StorageQuotaResult;
  }

  // Fallback: allow
  console.warn('check_storage_quota returned unexpected result:', results);
  return { allowed: true, used_bytes: 0, limit_bytes: 0, remaining_bytes: 0 };
}

/**
 * Record storage usage after a successful upload.
 * Calls the record_upload_storage() Supabase RPC.
 * This is fire-and-forget — upload success should not depend on this.
 */
export async function recordUploadStorage(
  userId: string,
  appId: string,
  version: string,
  sizeBytes: number
): Promise<void> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/record_upload_storage`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseKey}`,
        'apikey': supabaseKey!,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_user_id: userId,
        p_app_id: appId,
        p_version: version,
        p_size_bytes: sizeBytes,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('record_upload_storage RPC failed:', error);
    }
  } catch (err) {
    console.error('record_upload_storage failed:', err);
  }
}

/**
 * Reclaim all storage for an app (on soft delete).
 * Calls the reclaim_app_storage() Supabase RPC.
 * Returns the number of bytes reclaimed.
 */
export async function reclaimAppStorage(
  userId: string,
  appId: string
): Promise<number> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/reclaim_app_storage`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseKey}`,
        'apikey': supabaseKey!,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_user_id: userId,
        p_app_id: appId,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('reclaim_app_storage RPC failed:', error);
      return 0;
    }

    const result = await response.json();
    return typeof result === 'number' ? result : 0;
  } catch (err) {
    console.error('reclaim_app_storage failed:', err);
    return 0;
  }
}

/**
 * Reclaim storage for a single version (on version delete).
 * Calls the reclaim_version_storage() Supabase RPC.
 * Returns the number of bytes reclaimed.
 */
export async function reclaimVersionStorage(
  userId: string,
  appId: string,
  version: string
): Promise<number> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/reclaim_version_storage`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseKey}`,
        'apikey': supabaseKey!,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_user_id: userId,
        p_app_id: appId,
        p_version: version,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('reclaim_version_storage RPC failed:', error);
      return 0;
    }

    const result = await response.json();
    return typeof result === 'number' ? result : 0;
  } catch (err) {
    console.error('reclaim_version_storage failed:', err);
    return 0;
  }
}

/**
 * Format bytes to human-readable string.
 * Used in error messages for quota violations.
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}
