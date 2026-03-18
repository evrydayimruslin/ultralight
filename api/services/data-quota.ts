// Data Storage Quota Service
// Tracks user-generated data storage (via ultralight.store/batchStore) per user.
// Combined with storage_used_bytes (app source code) to enforce a 100MB free tier.
// Overage billed at DATA_RATE_LIGHT_PER_MB_PER_HOUR from balance_light.

// @ts-ignore
const Deno = globalThis.Deno;

import { COMBINED_FREE_TIER_BYTES } from '../../shared/types/index.ts';

// ============================================
// TYPES
// ============================================

export interface DataQuotaResult {
  allowed: boolean;
  source_used_bytes: number;
  data_used_bytes: number;
  combined_used_bytes: number;
  limit_bytes: number;
  remaining_bytes: number;
  has_hosting_balance: boolean;
}

export interface DataStorageAdjustResult {
  new_bytes: number;
  combined_bytes: number;
  storage_limit: number;
  over_limit: boolean;
}

// ============================================
// QUOTA CHECK
// ============================================

/**
 * Check whether a user has enough data storage quota.
 * Combined budget: storage_used_bytes (source code) + data_storage_used_bytes (user data) <= 100MB.
 * Allowed if under limit OR user has hosting balance to cover overage.
 * Fails open on DB errors (same pattern as storage-quota.ts).
 */
export async function checkDataQuota(
  userId: string,
  additionalBytes: number
): Promise<DataQuotaResult> {
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    // Can't check — fail open
    return {
      allowed: true,
      source_used_bytes: 0,
      data_used_bytes: 0,
      combined_used_bytes: 0,
      limit_bytes: COMBINED_FREE_TIER_BYTES,
      remaining_bytes: COMBINED_FREE_TIER_BYTES,
      has_hosting_balance: false,
    };
  }

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/check_data_storage_quota`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_user_id: userId,
        p_additional_bytes: additionalBytes,
      }),
    });

    if (!res.ok) {
      console.warn('[DATA-QUOTA] RPC check_data_storage_quota failed, allowing:', await res.text());
      return {
        allowed: true,
        source_used_bytes: 0,
        data_used_bytes: 0,
        combined_used_bytes: 0,
        limit_bytes: COMBINED_FREE_TIER_BYTES,
        remaining_bytes: COMBINED_FREE_TIER_BYTES,
        has_hosting_balance: false,
      };
    }

    const rows = await res.json() as DataQuotaResult[];
    if (!rows || rows.length === 0) {
      // User not found — fail open
      return {
        allowed: true,
        source_used_bytes: 0,
        data_used_bytes: 0,
        combined_used_bytes: 0,
        limit_bytes: COMBINED_FREE_TIER_BYTES,
        remaining_bytes: COMBINED_FREE_TIER_BYTES,
        has_hosting_balance: false,
      };
    }

    return rows[0];
  } catch (err) {
    console.error('[DATA-QUOTA] Error checking data quota, allowing:', err);
    return {
      allowed: true,
      source_used_bytes: 0,
      data_used_bytes: 0,
      combined_used_bytes: 0,
      limit_bytes: COMBINED_FREE_TIER_BYTES,
      remaining_bytes: COMBINED_FREE_TIER_BYTES,
      has_hosting_balance: false,
    };
  }
}

// ============================================
// STORAGE ADJUSTMENT
// ============================================

/**
 * Atomically adjust a user's data_storage_used_bytes by a delta (positive or negative).
 * Called after every store() and remove() operation.
 * Uses GREATEST(0, ...) in SQL to prevent negative values.
 * Fails silently on error — storage tracking is best-effort (reconciliation cron corrects drift).
 */
export async function adjustDataStorage(
  userId: string,
  deltaBytes: number
): Promise<DataStorageAdjustResult | null> {
  if (deltaBytes === 0) return null;

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/adjust_data_storage`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_user_id: userId,
        p_delta_bytes: deltaBytes,
      }),
    });

    if (!res.ok) {
      console.warn('[DATA-QUOTA] adjust_data_storage RPC failed:', await res.text());
      return null;
    }

    const rows = await res.json() as DataStorageAdjustResult[];
    return rows?.[0] ?? null;
  } catch (err) {
    console.error('[DATA-QUOTA] Error adjusting data storage:', err);
    return null;
  }
}
