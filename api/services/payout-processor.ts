// Payout Processor Service
// Hourly job that releases held payouts whose 14-day hold period has elapsed.
// Same pattern as hosting-billing.ts: startup delay + setInterval.
//
// Flow per payout:
//   1. Query get_releasable_payouts() RPC for mature held payouts
//   2. For each: mark_payout_releasing() to atomically transition held → pending
//   3. Execute Stripe Transfer (platform → connected account) — amount in USD = Light / 800
//   4. Execute Stripe Payout (connected account → bank)
//   5. Update payout record with Stripe IDs and status
//   6. On failure: call fail_payout_refund() to restore developer balance
//
// No platform fee on withdrawal — the 10% fee is already taken on every transfer_balance() call.

import { getEnv } from '../lib/env.ts';
import {
  createTransfer,
  createPayout,
} from './stripe-connect.ts';
import { LIGHT_PER_DOLLAR_PAYOUT, formatLight } from '../../shared/types/index.ts';

interface ReleasablePayout {
  id: string;
  user_id: string;
  amount_light: number;
  created_at: string;
  release_at: string;
}

export interface PayoutProcessorResult {
  processed: number;
  succeeded: number;
  failed: number;
  errors: string[];
}

/** Convert a Light amount to USD cents at the payout rate (800 Light/$1). */
function lightToUsdCents(amountLight: number): number {
  return Math.round((amountLight / LIGHT_PER_DOLLAR_PAYOUT) * 100);
}

/**
 * Process all held payouts whose 14-day hold period has elapsed.
 * Called hourly by the background job.
 */
export async function processHeldPayouts(): Promise<PayoutProcessorResult> {
  const SUPABASE_URL = getEnv('SUPABASE_URL');
  const SUPABASE_SERVICE_ROLE_KEY = getEnv('SUPABASE_SERVICE_ROLE_KEY');

  const result: PayoutProcessorResult = {
    processed: 0,
    succeeded: 0,
    failed: 0,
    errors: [],
  };

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.warn('[PAYOUT-PROC] Supabase not configured, skipping');
    return result;
  }

  const sbHeaders = {
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  };
  const sbWriteHeaders = {
    ...sbHeaders,
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal',
  };

  try {
    // 1. Get all releasable payouts (held + release_at <= now)
    const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_releasable_payouts`, {
      method: 'POST',
      headers: { ...sbHeaders, 'Content-Type': 'application/json' },
      body: '{}',
    });

    if (!rpcRes.ok) {
      const err = await rpcRes.text();
      result.errors.push(`Failed to query releasable payouts: ${err}`);
      console.error('[PAYOUT-PROC] RPC failed:', err);
      return result;
    }

    const payouts = await rpcRes.json() as ReleasablePayout[];

    if (payouts.length === 0) {
      return result; // Nothing to process
    }

    console.log(`[PAYOUT-PROC] Found ${payouts.length} payout(s) ready for release`);

    // 2. Process each payout
    for (const payout of payouts) {
      result.processed++;

      try {
        // 2a. Atomically transition held → pending (prevents double-processing)
        const markRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/mark_payout_releasing`, {
          method: 'POST',
          headers: { ...sbHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ p_payout_id: payout.id }),
        });

        if (!markRes.ok) {
          result.errors.push(`Failed to mark payout ${payout.id} as releasing`);
          result.failed++;
          continue;
        }

        const wasMarked = await markRes.json();
        if (!wasMarked) {
          // Another instance already picked this up
          console.log(`[PAYOUT-PROC] Payout ${payout.id} already claimed by another worker`);
          result.processed--;
          continue;
        }

        // 2b. Look up the user's connected account
        const userRes = await fetch(
          `${SUPABASE_URL}/rest/v1/users?id=eq.${payout.user_id}&select=stripe_connect_account_id,stripe_connect_payouts_enabled`,
          { headers: sbHeaders }
        );

        if (!userRes.ok) {
          await failPayout(SUPABASE_URL, sbWriteHeaders, payout.id, 'user_lookup_failed');
          result.errors.push(`User lookup failed for payout ${payout.id}`);
          result.failed++;
          continue;
        }

        const userData = ((await userRes.json()) as Array<{
          stripe_connect_account_id: string | null;
          stripe_connect_payouts_enabled: boolean;
        }>)[0];

        if (!userData?.stripe_connect_account_id || !userData.stripe_connect_payouts_enabled) {
          await failPayout(SUPABASE_URL, sbWriteHeaders, payout.id, 'connect_account_not_ready');
          result.errors.push(`Connect account not ready for payout ${payout.id} (user ${payout.user_id})`);
          result.failed++;
          continue;
        }

        // 2c. Convert Light to USD cents — no platform fee on withdrawal
        const transferAmountCents = lightToUsdCents(payout.amount_light);

        if (transferAmountCents <= 0) {
          await failPayout(SUPABASE_URL, sbWriteHeaders, payout.id, 'transfer_amount_zero');
          result.errors.push(`Transfer amount zero for payout ${payout.id}`);
          result.failed++;
          continue;
        }

        // 2d. Execute Stripe Transfer (platform → connected account)
        let transferResult;
        try {
          transferResult = await createTransfer(
            transferAmountCents,
            userData.stripe_connect_account_id,
            {
              payout_id: payout.id,
              user_id: payout.user_id,
              amount_light: String(payout.amount_light),
            }
          );
        } catch (transferErr) {
          console.error(`[PAYOUT-PROC] Transfer failed for payout ${payout.id}:`, transferErr);
          await failPayout(SUPABASE_URL, sbWriteHeaders, payout.id, 'stripe_transfer_failed');
          result.errors.push(`Stripe transfer failed for payout ${payout.id}`);
          result.failed++;
          continue;
        }

        // 2e. Update payout record with transfer ID, mark as processing
        await fetch(`${SUPABASE_URL}/rest/v1/payouts?id=eq.${payout.id}`, {
          method: 'PATCH',
          headers: sbWriteHeaders,
          body: JSON.stringify({
            stripe_transfer_id: transferResult.transfer_id,
            status: 'processing',
          }),
        });

        // 2f. Execute Stripe Payout (connected account → bank)
        // Fire-and-forget style — Stripe webhook confirms final status
        try {
          const payoutResult = await createPayout(
            transferAmountCents,
            userData.stripe_connect_account_id
          );

          await fetch(`${SUPABASE_URL}/rest/v1/payouts?id=eq.${payout.id}`, {
            method: 'PATCH',
            headers: sbWriteHeaders,
            body: JSON.stringify({
              stripe_payout_id: payoutResult.payout_id,
            }),
          });
        } catch (payoutErr) {
          // Transfer succeeded but payout creation failed.
          // Money is in the connected account — developer can trigger from Stripe Express Dashboard.
          console.error(`[PAYOUT-PROC] Payout trigger failed (transfer succeeded) for ${payout.id}:`, payoutErr);
        }

        result.succeeded++;
        console.log(
          `[PAYOUT-PROC] Released payout ${payout.id}: ` +
          `${formatLight(payout.amount_light)} → $${(transferAmountCents / 100).toFixed(2)} transferred`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push(`Error processing payout ${payout.id}: ${msg}`);
        result.failed++;
        console.error(`[PAYOUT-PROC] Error processing ${payout.id}:`, msg);
      }
    }

    if (result.processed > 0) {
      console.log(
        `[PAYOUT-PROC] Complete: ${result.processed} processed, ` +
        `${result.succeeded} succeeded, ${result.failed} failed`
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.errors.push(`Fatal error: ${msg}`);
    console.error('[PAYOUT-PROC] Fatal error:', msg);
  }

  return result;
}

/**
 * Helper: fail a payout and refund via the atomic RPC.
 */
async function failPayout(
  supabaseUrl: string,
  headers: Record<string, string>,
  payoutId: string,
  reason: string
): Promise<void> {
  try {
    await fetch(`${supabaseUrl}/rest/v1/rpc/fail_payout_refund`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        p_payout_id: payoutId,
        p_failure_reason: reason,
      }),
    });
  } catch (err) {
    console.error(`[PAYOUT-PROC] Failed to refund payout ${payoutId}:`, err);
  }
}

/**
 * Start the payout processor job.
 * Runs after a 30-second startup delay, then every hour.
 * Staggered from hosting billing (15s) to avoid thundering herd.
 */
export function startPayoutProcessorJob(): void {
  const INTERVAL_MS = 60 * 60 * 1000; // 1 hour

  console.log('[PAYOUT-PROC] Starting payout processor job (hourly)');

  // Run on startup (after a delay to let the server initialize)
  setTimeout(async () => {
    try {
      await processHeldPayouts();
    } catch (err) {
      console.error('[PAYOUT-PROC] Startup processing failed:', err);
    }
  }, 30_000); // 30 second delay (staggered from billing at 15s)

  // Then run every hour
  setInterval(async () => {
    try {
      await processHeldPayouts();
    } catch (err) {
      console.error('[PAYOUT-PROC] Scheduled processing failed:', err);
    }
  }, INTERVAL_MS);
}
