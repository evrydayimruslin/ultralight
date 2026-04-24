// Storage Quota Service
// Tracks storage usage per app and per user via Supabase RPC functions.
// Used by the hosting billing system to calculate hosting costs.
// Enforces a combined 100MB storage limit per user (source code + user data).

import { getEnv } from '../lib/env.ts';
import { COMBINED_FREE_TIER_BYTES } from '../../shared/types/index.ts';
import { resolveEnforcementOptions, type EnforcementOptions } from './enforcement.ts';

/** Combined storage limit: source code + user data = 100MB. */
const STORAGE_LIMIT_BYTES = COMBINED_FREE_TIER_BYTES; // 100 MB

export interface StorageQuotaResult {
  allowed: boolean;
  used_bytes: number;
  limit_bytes: number;
  remaining_bytes: number;
  reason?: 'quota_exceeded' | 'service_unavailable';
}

function unavailableStorageQuotaResult(
  uploadSizeBytes: number,
  options?: EnforcementOptions,
  detail?: unknown,
): StorageQuotaResult {
  const enforcement = resolveEnforcementOptions(options, 'storage quota check');
  const suffix = enforcement.mode === 'fail_closed'
    ? 'blocking upload (fail-closed)'
    : 'allowing upload (fail-open)';

  console.error(
    `[STORAGE] Quota backend unavailable for ${enforcement.resource}, ${suffix}. Upload bytes=${uploadSizeBytes}:`,
    detail,
  );

  return {
    allowed: enforcement.mode !== 'fail_closed',
    used_bytes: 0,
    limit_bytes: STORAGE_LIMIT_BYTES,
    remaining_bytes: enforcement.mode === 'fail_closed' ? 0 : STORAGE_LIMIT_BYTES,
    reason: 'service_unavailable',
  };
}

/**
 * Check whether a user has enough storage quota for a source code upload.
 * Queries users.storage_used_bytes + data_storage_used_bytes (combined budget)
 * and compares against the 100MB combined limit.
 */
export async function checkStorageQuota(
  userId: string,
  uploadSizeBytes: number,
  options?: EnforcementOptions,
): Promise<StorageQuotaResult> {
  const SUPABASE_URL = getEnv('SUPABASE_URL');
  const SUPABASE_SERVICE_ROLE_KEY = getEnv('SUPABASE_SERVICE_ROLE_KEY');

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return unavailableStorageQuotaResult(uploadSizeBytes, options, 'Supabase credentials not configured');
  }

  try {
    // Query combined storage usage (source code + user data) from users table
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/users?id=eq.${userId}&select=storage_used_bytes,data_storage_used_bytes`,
      {
        headers: {
          'apikey': SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
      }
    );

    if (!res.ok) {
      return unavailableStorageQuotaResult(uploadSizeBytes, options, await res.text());
    }

    const rows = await res.json() as Array<{ storage_used_bytes: number | null; data_storage_used_bytes: number | null }>;
    if (!rows || rows.length === 0) {
      return unavailableStorageQuotaResult(uploadSizeBytes, options, 'User row missing during quota check');
    }
    const sourceBytes = rows[0]?.storage_used_bytes ?? 0;
    const dataBytes = rows[0]?.data_storage_used_bytes ?? 0;
    const combinedUsed = sourceBytes + dataBytes;
    const remaining = Math.max(0, STORAGE_LIMIT_BYTES - combinedUsed);
    const allowed = (combinedUsed + uploadSizeBytes) <= STORAGE_LIMIT_BYTES;

    return {
      allowed,
      used_bytes: combinedUsed,
      limit_bytes: STORAGE_LIMIT_BYTES,
      remaining_bytes: remaining,
      reason: allowed ? undefined : 'quota_exceeded',
    };
  } catch (err) {
    return unavailableStorageQuotaResult(uploadSizeBytes, options, err);
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
  const SUPABASE_URL = getEnv('SUPABASE_URL');
  const SUPABASE_SERVICE_ROLE_KEY = getEnv('SUPABASE_SERVICE_ROLE_KEY');

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
  const SUPABASE_URL = getEnv('SUPABASE_URL');
  const SUPABASE_SERVICE_ROLE_KEY = getEnv('SUPABASE_SERVICE_ROLE_KEY');

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
  const SUPABASE_URL = getEnv('SUPABASE_URL');
  const SUPABASE_SERVICE_ROLE_KEY = getEnv('SUPABASE_SERVICE_ROLE_KEY');

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
