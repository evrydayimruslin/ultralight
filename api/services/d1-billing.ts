// D1 Billing Service
// Background cron job that syncs per-user D1 usage from app D1 databases to Supabase,
// then charges overage fees from the user's bucketed Light balance.
// Runs every 5 minutes via startD1BillingJob().

import { getEnv } from '../lib/env.ts';
import { D1_FREE_TIER, D1_BILLING_RATES } from '../../shared/types/index.ts';
import { cleanupRateLimitBuckets } from './d1-metering.ts';
import { executeD1Sql } from './d1-provisioning.ts';

// ============================================
// TYPES
// ============================================

interface AppD1Info {
  id: string;
  d1_database_id: string;
}

interface D1UsageRow {
  user_id: string;
  rows_read_total: number;
  rows_written_total: number;
  storage_bytes_estimate: number;
}

// ============================================
// BILLING CRON
// ============================================

/**
 * Start the D1 billing background job.
 * Runs every 5 minutes to:
 * 1. Query _usage from each app's D1
 * 2. Sync aggregated usage to Supabase users table
 * 3. Charge overage fees
 * 4. Reset _usage counters in D1
 */
export function startD1BillingJob(): void {
  const intervalMs = 5 * 60 * 1000; // 5 minutes

  console.log('[D1-BILLING] Starting billing job (interval: 5m)');

  setInterval(async () => {
    try {
      await runD1BillingCycle();
    } catch (err) {
      console.error('[D1-BILLING] Billing cycle error:', err);
    }
  }, intervalMs);
}

export async function runD1BillingCycle(): Promise<void> {
  const cfAccountId = getEnv('CF_ACCOUNT_ID');
  const cfApiToken = getEnv('CF_API_TOKEN');
  const supabaseUrl = getEnv('SUPABASE_URL');
  const supabaseKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');

  if (!cfAccountId || !cfApiToken || !supabaseUrl || !supabaseKey) return;

  // 1. Get all apps with provisioned D1 databases
  const apps = await getAppsWithD1(supabaseUrl, supabaseKey);
  if (apps.length === 0) return;

  let totalSynced = 0;

  // 2. For each app, read _usage and sync to Supabase
  for (const app of apps) {
    try {
      // Read all user usage from this app's D1
      const usageResult = await executeD1Sql(
        cfAccountId,
        cfApiToken,
        app.d1_database_id,
        'SELECT user_id, rows_read_total, rows_written_total, storage_bytes_estimate FROM _usage WHERE rows_read_total > 0 OR rows_written_total > 0',
      );

      const usageRows = (usageResult.result?.[0]?.results ?? []) as unknown as D1UsageRow[];
      if (usageRows.length === 0) continue;

      // Sync each user's usage to Supabase
      for (const usage of usageRows) {
        await syncUsageToSupabase(
          supabaseUrl,
          supabaseKey,
          usage.user_id,
          usage.rows_read_total,
          usage.rows_written_total,
          usage.storage_bytes_estimate,
        );
        totalSynced++;
      }

      // Reset counters in D1 (keep storage_bytes_estimate, reset operation counts)
      await executeD1Sql(
        cfAccountId,
        cfApiToken,
        app.d1_database_id,
        'UPDATE _usage SET rows_read_total = 0, rows_written_total = 0, last_updated = datetime(\'now\')',
      );
    } catch (err) {
      console.error(`[D1-BILLING] Error processing app ${app.id}:`, err);
    }
  }

  // 3. Charge overage fees for users over free tier
  await chargeD1Overage(supabaseUrl, supabaseKey);

  // 4. Cleanup stale rate limit buckets
  const cleaned = cleanupRateLimitBuckets();

  if (totalSynced > 0 || cleaned > 0) {
    console.log(`[D1-BILLING] Cycle complete: ${totalSynced} usage records synced, ${cleaned} rate buckets cleaned`);
  }
}

// ============================================
// SUPABASE OPERATIONS
// ============================================

async function getAppsWithD1(
  supabaseUrl: string,
  supabaseKey: string,
): Promise<AppD1Info[]> {
  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/apps?d1_status=eq.ready&d1_database_id=not.is.null&select=id,d1_database_id&deleted_at=is.null`,
      {
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
        },
      }
    );
    if (!res.ok) return [];
    return await res.json() as AppD1Info[];
  } catch {
    return [];
  }
}

async function syncUsageToSupabase(
  supabaseUrl: string,
  supabaseKey: string,
  userId: string,
  rowsRead: number,
  rowsWritten: number,
  storageBytes: number,
): Promise<void> {
  try {
    await fetch(`${supabaseUrl}/rest/v1/rpc/sync_d1_usage`, {
      method: 'POST',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_user_id: userId,
        p_rows_read: rowsRead,
        p_rows_written: rowsWritten,
        p_storage_bytes: storageBytes,
      }),
    });
  } catch (err) {
    console.error(`[D1-BILLING] Failed to sync usage for user ${userId}:`, err);
  }
}

/**
 * Charge overage fees for users who have exceeded D1 free tier.
 * Deducts from bucketed Light balance based on accumulated usage above thresholds.
 */
export async function chargeD1Overage(
  supabaseUrl: string,
  supabaseKey: string,
): Promise<void> {
  try {
    // Find users over free tier with positive balance
    const res = await fetch(
      `${supabaseUrl}/rest/v1/users?` +
      `or=(d1_rows_read_total.gte.${D1_FREE_TIER.ROWS_READ},d1_rows_written_total.gte.${D1_FREE_TIER.ROWS_WRITTEN})` +
      `&balance_light=gt.0` +
      `&select=id,balance_light,d1_rows_read_total,d1_rows_written_total,d1_storage_bytes`,
      {
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
        },
      }
    );

    if (!res.ok) return;

    const users = await res.json() as Array<{
      id: string;
      balance_light: number;
      d1_rows_read_total: number;
      d1_rows_written_total: number;
      d1_storage_bytes: number;
    }>;

    for (const user of users) {
      // Calculate overage reads/writes this billing cycle
      const overageReads = Math.max(0, user.d1_rows_read_total - D1_FREE_TIER.ROWS_READ);
      const overageWrites = Math.max(0, user.d1_rows_written_total - D1_FREE_TIER.ROWS_WRITTEN);

      const readCost = (overageReads / 1000) * D1_BILLING_RATES.RATE_PER_1K_READS;
      const writeCost = (overageWrites / 1000) * D1_BILLING_RATES.RATE_PER_1K_WRITES;
      const totalCost = readCost + writeCost;

      if (totalCost < 0.01) continue; // Skip negligible charges

      await fetch(
        `${supabaseUrl}/rest/v1/rpc/debit_light`,
        {
          method: 'POST',
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            p_user_id: user.id,
            p_amount_light: totalCost,
            p_reason: 'd1_overage',
            p_update_billed_at: false,
            p_allow_partial: true,
            p_metadata: {
              overage_reads: overageReads,
              overage_writes: overageWrites,
              read_cost_light: readCost,
              write_cost_light: writeCost,
              storage_bytes: user.d1_storage_bytes,
            },
          }),
        }
      );
    }
  } catch (err) {
    console.error('[D1-BILLING] Error charging overage:', err);
  }
}
