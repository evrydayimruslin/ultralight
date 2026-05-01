// Payout Processor Service
// Hourly job that releases held payouts whose scheduled monthly run is due.
// Same pattern as hosting-billing.ts: startup delay + setInterval.
//
// Flow per payout:
//   1. Query get_releasable_payouts() RPC for due monthly payout runs
//   2. For each: mark_payout_releasing() to atomically claim retryable work
//   3. Execute missing Stripe Transfer using the payout's Light/USD rate snapshot
//   4. Execute missing Stripe Payout (connected account → bank)
//   5. Update separate transfer/payout operation state for reconciliation
//
// No platform fee on withdrawal — the 10% fee is already taken on internal earning transfers.

import { getEnv } from '../lib/env.ts';
import {
  createPayout,
  createTransfer,
  StripeConnectRequestError,
} from './stripe-connect.ts';
import { formatLight } from '../../shared/types/index.ts';
import { lightToUsdCents } from './billing-config.ts';

interface ReleasablePayout {
  id: string;
  user_id: string;
  amount_light: number;
  created_at: string;
  release_at: string;
  light_per_usd_snapshot?: number;
  payout_run_id?: string | null;
  scheduled_payout_date?: string | null;
  payout_cutoff_at?: string | null;
  payout_policy_version?: number | null;
  stripe_transfer_id?: string | null;
  stripe_payout_id?: string | null;
  stripe_transfer_status?: string | null;
  stripe_payout_status?: string | null;
  stripe_transfer_attempts?: number | null;
  stripe_payout_attempts?: number | null;
  stripe_transfer_idempotency_key?: string | null;
  stripe_payout_idempotency_key?: string | null;
}

export interface PayoutProcessorResult {
  processed: number;
  succeeded: number;
  failed: number;
  errors: string[];
  payout_runs: string[];
}

export interface PayoutProcessorOptions {
  payoutRunId?: string;
  scheduledPayoutDate?: string;
  limit?: number;
}

/**
 * Process all held payouts whose scheduled monthly payout run is due.
 * Called hourly by the background job and by the admin retry action.
 */
export async function processHeldPayouts(
  options: PayoutProcessorOptions = {},
): Promise<PayoutProcessorResult> {
  const SUPABASE_URL = getEnv('SUPABASE_URL');
  const SUPABASE_SERVICE_ROLE_KEY = getEnv('SUPABASE_SERVICE_ROLE_KEY');

  const result: PayoutProcessorResult = {
    processed: 0,
    succeeded: 0,
    failed: 0,
    errors: [],
    payout_runs: [],
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
    const rpcRes = await fetch(
      `${SUPABASE_URL}/rest/v1/rpc/get_releasable_payouts`,
      {
        method: 'POST',
        headers: { ...sbHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          p_payout_run_id: options.payoutRunId || null,
          p_scheduled_payout_date: options.scheduledPayoutDate || null,
          p_limit: options.limit || 50,
        }),
      },
    );

    if (!rpcRes.ok) {
      const err = await rpcRes.text();
      result.errors.push(`Failed to query releasable payouts: ${err}`);
      console.error('[PAYOUT-PROC] RPC failed:', err);
      return result;
    }

    const payouts = await rpcRes.json() as ReleasablePayout[];
    if (payouts.length === 0) {
      return result;
    }

    result.payout_runs = Array.from(
      new Set(
        payouts.map((p) => p.payout_run_id).filter((id): id is string => !!id),
      ),
    );
    await Promise.all(
      result.payout_runs.map((runId) =>
        patchPayoutRun(SUPABASE_URL, sbWriteHeaders, runId, {
          status: 'processing',
        })
      ),
    );

    console.log(
      `[PAYOUT-PROC] Found ${payouts.length} payout(s) ready for release`,
    );

    for (const payout of payouts) {
      result.processed++;

      try {
        const markRes = await fetch(
          `${SUPABASE_URL}/rest/v1/rpc/mark_payout_releasing`,
          {
            method: 'POST',
            headers: { ...sbHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ p_payout_id: payout.id }),
          },
        );

        if (!markRes.ok) {
          result.errors.push(`Failed to mark payout ${payout.id} as releasing`);
          result.failed++;
          continue;
        }

        const wasMarked = await markRes.json();
        if (!wasMarked) {
          console.log(
            `[PAYOUT-PROC] Payout ${payout.id} already claimed by another worker`,
          );
          result.processed--;
          continue;
        }

        const userRes = await fetch(
          `${SUPABASE_URL}/rest/v1/users?id=eq.${payout.user_id}&select=stripe_connect_account_id,stripe_connect_payouts_enabled`,
          { headers: sbHeaders },
        );

        if (!userRes.ok) {
          await markRetryableTransferFailure(
            SUPABASE_URL,
            sbWriteHeaders,
            payout.id,
            'user_lookup_failed',
            await safeResponseText(userRes),
          );
          result.errors.push(`User lookup failed for payout ${payout.id}`);
          result.failed++;
          continue;
        }

        const userData = ((await userRes.json()) as Array<{
          stripe_connect_account_id: string | null;
          stripe_connect_payouts_enabled: boolean;
        }>)[0];

        if (
          !userData?.stripe_connect_account_id ||
          !userData.stripe_connect_payouts_enabled
        ) {
          await markRetryableTransferFailure(
            SUPABASE_URL,
            sbWriteHeaders,
            payout.id,
            'connect_account_not_ready',
            'Connected account is missing or payouts are disabled',
          );
          result.errors.push(
            `Connect account not ready for payout ${payout.id} (user ${payout.user_id})`,
          );
          result.failed++;
          continue;
        }

        const transferAmountCents = lightToUsdCents(
          payout.amount_light,
          payout.light_per_usd_snapshot || 100,
        );
        if (transferAmountCents <= 0) {
          await failPayout(
            SUPABASE_URL,
            sbWriteHeaders,
            payout.id,
            'transfer_amount_zero',
          );
          result.errors.push(`Transfer amount zero for payout ${payout.id}`);
          result.failed++;
          continue;
        }

        const transferKey = payout.stripe_transfer_idempotency_key ||
          `ul:payout:${payout.id}:transfer:v1`;
        const payoutKey = payout.stripe_payout_idempotency_key ||
          `ul:payout:${payout.id}:payout:v1`;
        const metadata = {
          payout_id: payout.id,
          user_id: payout.user_id,
          amount_light: String(payout.amount_light),
          ...(payout.payout_run_id
            ? { payout_run_id: payout.payout_run_id }
            : {}),
          ...(payout.scheduled_payout_date
            ? { scheduled_payout_date: payout.scheduled_payout_date }
            : {}),
        };

        let transferId = payout.stripe_transfer_id || null;
        const transferAlreadySucceeded =
          payout.stripe_transfer_status === 'succeeded' && transferId;

        if (!transferAlreadySucceeded) {
          await patchPayout(SUPABASE_URL, sbWriteHeaders, payout.id, {
            stripe_transfer_status: 'pending',
            stripe_transfer_requested_at: new Date().toISOString(),
            stripe_transfer_idempotency_key: transferKey,
            stripe_transfer_error: null,
            failure_reason: null,
          });

          try {
            const transferResult = await createTransfer(
              transferAmountCents,
              userData.stripe_connect_account_id,
              metadata,
              { idempotencyKey: transferKey },
            );
            transferId = transferResult.transfer_id;
            await patchPayout(SUPABASE_URL, sbWriteHeaders, payout.id, {
              stripe_transfer_id: transferResult.transfer_id,
              stripe_transfer_status: 'succeeded',
              stripe_transfer_completed_at: new Date().toISOString(),
              stripe_transfer_response: transferResult.response,
              stripe_transfer_error: null,
              status: 'processing',
            });
          } catch (transferErr) {
            console.error(
              `[PAYOUT-PROC] Transfer failed for payout ${payout.id}:`,
              transferErr,
            );
            await markRetryableTransferFailure(
              SUPABASE_URL,
              sbWriteHeaders,
              payout.id,
              'stripe_transfer_failed',
              serializeStripeError(transferErr),
            );
            result.errors.push(`Stripe transfer failed for payout ${payout.id}`);
            result.failed++;
            continue;
          }
        }

        await patchPayout(SUPABASE_URL, sbWriteHeaders, payout.id, {
          stripe_payout_status: 'pending',
          stripe_payout_requested_at: new Date().toISOString(),
          stripe_payout_idempotency_key: payoutKey,
          stripe_payout_error: null,
          status: 'processing',
        });

        try {
          const payoutResult = await createPayout(
            transferAmountCents,
            userData.stripe_connect_account_id,
            {
              idempotencyKey: payoutKey,
              metadata: {
                ...metadata,
                ...(transferId ? { stripe_transfer_id: transferId } : {}),
              },
            },
          );

          await patchPayout(SUPABASE_URL, sbWriteHeaders, payout.id, {
            stripe_payout_id: payoutResult.payout_id,
            stripe_payout_status: 'pending',
            stripe_payout_response: payoutResult.response,
            stripe_payout_error: null,
            processor_claimed_at: null,
            status: 'processing',
          });
        } catch (payoutErr) {
          console.error(
            `[PAYOUT-PROC] Payout trigger failed (transfer succeeded) for ${payout.id}:`,
            payoutErr,
          );
          await patchPayout(SUPABASE_URL, sbWriteHeaders, payout.id, {
            stripe_payout_status: 'failed',
            stripe_payout_error: serializeStripeError(payoutErr),
            failure_reason: 'stripe_payout_failed',
            processor_claimed_at: null,
            status: 'processing',
          });
          result.errors.push(`Stripe payout failed for payout ${payout.id}`);
          result.failed++;
          continue;
        }

        result.succeeded++;
        console.log(
          `[PAYOUT-PROC] Released payout ${payout.id}: ` +
            `${formatLight(payout.amount_light)} → $${
              (transferAmountCents / 100).toFixed(2)
            } transferred` +
            (payout.scheduled_payout_date
              ? ` for ${payout.scheduled_payout_date} run`
              : ''),
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
          `${result.succeeded} succeeded, ${result.failed} failed`,
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.errors.push(`Fatal error: ${msg}`);
    console.error('[PAYOUT-PROC] Fatal error:', msg);
  }

  return result;
}

async function safeResponseText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return `HTTP ${response.status}`;
  }
}

function serializeStripeError(err: unknown): Record<string, unknown> {
  if (err instanceof StripeConnectRequestError) {
    return {
      message: err.message,
      status: err.status,
      response: err.responseText,
    };
  }
  if (err instanceof Error) {
    return {
      message: err.message,
      name: err.name,
    };
  }
  if (typeof err === 'object' && err !== null) {
    return { value: err };
  }
  return { message: String(err) };
}

async function patchPayout(
  supabaseUrl: string,
  headers: Record<string, string>,
  payoutId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const res = await fetch(`${supabaseUrl}/rest/v1/payouts?id=eq.${payoutId}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    throw new Error(`Failed to patch payout ${payoutId}: ${await res.text()}`);
  }
}

async function patchPayoutRun(
  supabaseUrl: string,
  headers: Record<string, string>,
  runId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const res = await fetch(`${supabaseUrl}/rest/v1/payout_runs?id=eq.${runId}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
  });
  if (!res.ok) {
    console.warn(`[PAYOUT-PROC] Failed to patch payout run ${runId}`);
  }
}

async function markRetryableTransferFailure(
  supabaseUrl: string,
  headers: Record<string, string>,
  payoutId: string,
  reason: string,
  details: unknown,
): Promise<void> {
  await patchPayout(supabaseUrl, headers, payoutId, {
    status: 'pending',
    stripe_transfer_status: 'failed',
    stripe_transfer_error: typeof details === 'string'
      ? { message: details }
      : details,
    failure_reason: reason,
    processor_claimed_at: null,
  });
}

/**
 * Helper: fail a payout and refund via the atomic RPC.
 */
async function failPayout(
  supabaseUrl: string,
  headers: Record<string, string>,
  payoutId: string,
  reason: string,
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
