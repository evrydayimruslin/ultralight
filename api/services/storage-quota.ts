// Storage Quota Service
// Tracks storage usage per app and per user via Supabase RPC functions.
// Used by the hosting billing system to calculate hosting costs.
// Enforces a platform-wide 25MB storage limit per user.

// @ts-ignore
const Deno = globalThis.Deno;

import { TIER_LIMITS } from '../../shared/types/index.ts';

/** Platform-wide storage limit — same for everyone. */
const STORAGE_LIMIT_BYTES = TIER_LIMITS.free.max_storage_bytes; // 25 MB

export interface StorageQuotaResult {
  allowed: boolean;
  used_bytes: number;
  limit_bytes: number;
  remaining_bytes: number;
}

/**
 * Check whether a user has enough storage quota for an upload.
 * Queries users.storage_used_bytes and compares against platform limit (25MB).
 * Falls back to allowing the upload if the DB query fails (fail-open).
 */
export async function checkStorageQuota(
  userId: string,
  uploadSizeBytes: number
): Promise<StorageQuotaResult> {
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    // Can't check — fail open
    return { allowed: true, used_bytes: 0, limit_bytes: 0, remaining_bytes: 0 };
  }

  try {
    // Query current storage usage from users table
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/users?id=eq.${userId}&select=storage_used_bytes`,
      {
        headers: {
          'apikey': SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
      }
    );

    if (!res.ok) {
      console.warn('[STORAGE] Failed to query storage_used_bytes, allowing upload:', await res.text());
      return { allowed: true, used_bytes: 0, limit_bytes: STORAGE_LIMIT_BYTES, remaining_bytes: STORAGE_LIMIT_BYTES };
    }

    const rows = await res.json() as Array<{ storage_used_bytes: number | null }>;
    const usedBytes = rows[0]?.storage_used_bytes ?? 0;
    const remaining = Math.max(0, STORAGE_LIMIT_BYTES - usedBytes);

    return {
      allowed: (usedBytes + uploadSizeBytes) <= STORAGE_LIMIT_BYTES,
      used_bytes: usedBytes,
      limit_bytes: STORAGE_LIMIT_BYTES,
      remaining_bytes: remaining,
    };
  } catch (err) {
    console.error('[STORAGE] Error checking storage quota, allowing upload:', err);
    return { allowed: true, used_bytes: 0, limit_bytes: STORAGE_LIMIT_BYTES, remaining_bytes: STORAGE_LIMIT_BYTES };
  }
}

/**
 * Record storage usage after a successful upload.
 * Calls the record_upload_storage RPC which updates:
 * - users.storage_used_bytes (increment)
 * - apps.storage_bytes (set to this version's size)
 * - apps.version_metadata (append new version entry)
 */
export async function recordUploadStorage(
  userId: string,
  appId: string,
  version: string,
  sizeBytes: number
): Promise<void> {
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return;

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/record_upload_storage`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_user_id: userId,
        p_app_id: appId,
        p_version: version,
        p_size_bytes: sizeBytes,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error(`[STORAGE] Failed to record upload storage: ${err}`);
    }
  } catch (err) {
    console.error('[STORAGE] Error recording upload storage:', err);
  }
}

/**
 * Reclaim storage when an app is deleted.
 * Calls the reclaim_app_storage RPC which updates users.storage_used_bytes.
 */
export async function reclaimAppStorage(
  userId: string,
  appId: string
): Promise<number> {
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return 0;

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/reclaim_app_storage`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_user_id: userId,
        p_app_id: appId,
      }),
    });

    if (res.ok) {
      const result = await res.json();
      return typeof result === 'number' ? result : 0;
    }
  } catch (err) {
    console.error('[STORAGE] Error reclaiming app storage:', err);
  }
  return 0;
}

/**
 * Reclaim storage for a specific version.
 */
export async function reclaimVersionStorage(
  userId: string,
  appId: string,
  version: string
): Promise<number> {
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return 0;

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/reclaim_version_storage`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_user_id: userId,
        p_app_id: appId,
        p_version: version,
      }),
    });

    if (res.ok) {
      const result = await res.json();
      return typeof result === 'number' ? result : 0;
    }
  } catch (err) {
    console.error('[STORAGE] Error reclaiming version storage:', err);
  }
  return 0;
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}
