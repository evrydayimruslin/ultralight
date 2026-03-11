// Hosting Billing Service
// Charges $0.025/MB/hour for ALL published apps + markdown pages (publisher pays).
// Charges $0.0005/MB/hour for user data storage exceeding the 100MB free tier (user pays).
// Both charges debit from the same hosting_balance_cents pool.
// No free tier for hosting — every published MB costs from the first byte.
// 100MB free tier for user data — overage billed hourly.
// Users hold a hosting_balance_cents that drains continuously.
// Balance → 0 = published content goes offline (hosting_suspended = true).
// Runs hourly via setInterval (same pattern as subscription-expiry.ts).

// @ts-ignore
const Deno = globalThis.Deno;

import { HOSTING_RATE_CENTS_PER_MB_PER_HOUR, DATA_RATE_CENTS_PER_MB_PER_HOUR, COMBINED_FREE_TIER_BYTES } from '../../shared/types/index.ts';

const RATE_CENTS_PER_MB_PER_HOUR = HOSTING_RATE_CENTS_PER_MB_PER_HOUR;
const DATA_RATE = DATA_RATE_CENTS_PER_MB_PER_HOUR;

interface BillingUser {
  id: string;
  hosting_balance_cents: number;
  hosting_last_billed_at: string;
  auto_topup_enabled: boolean;
  auto_topup_threshold_cents: number;
  auto_topup_amount_cents: number;
  stripe_customer_id: string | null;
  // Data storage metering fields
  data_storage_used_bytes: number;
  storage_used_bytes: number;
  storage_limit_bytes: number;
}

interface UserStorage {
  app_bytes: number;
  content_bytes: number;
}

export interface BillingResult {
  usersProcessed: number;
  usersSuspended: number;
  totalChargedCents: number;
  errors: string[];
  details: {
    userId: string;
    storageMb: number;
    hostingChargedCents: number;
    dataOverageMb: number;
    dataOverageCents: number;
    totalChargedCents: number;
    newBalance: number;
    suspended: boolean;
  }[];
}

/**
 * Process hosting billing for all users with published content.
 *
 * 1. Query users who have non-zero balance or published content
 * 2. For each user, calculate total storage (apps + pages)
 * 3. Compute cost based on hours since last billed
 * 4. Deduct from balance; suspend if depleted
 */
export async function processHostingBilling(): Promise<BillingResult> {
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

  const result: BillingResult = {
    usersProcessed: 0,
    usersSuspended: 0,
    totalChargedCents: 0,
    errors: [],
    details: [],
  };

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.warn('[BILLING] Supabase not configured, skipping');
    return result;
  }

  const headers = {
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  };
  const writeHeaders = {
    ...headers,
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal',
  };

  try {
    // 1. Find users who need billing:
    //    - hosting_balance_cents > 0 (have balance for publisher hosting), OR
    //    - data_storage_used_bytes > 0 (have user data that may need overage billing)
    const usersRes = await fetch(
      `${SUPABASE_URL}/rest/v1/users?or=(hosting_balance_cents.gt.0,data_storage_used_bytes.gt.0)` +
      `&select=id,hosting_balance_cents,hosting_last_billed_at,auto_topup_enabled,auto_topup_threshold_cents,auto_topup_amount_cents,stripe_customer_id,data_storage_used_bytes,storage_used_bytes,storage_limit_bytes`,
      { headers }
    );

    if (!usersRes.ok) {
      const err = await usersRes.text();
      result.errors.push(`Failed to query users: ${err}`);
      console.error('[BILLING] User query failed:', err);
      return result;
    }

    const users: BillingUser[] = await usersRes.json();

    if (users.length === 0) {
      return result; // No billable users
    }

    console.log(`[BILLING] Processing ${users.length} user(s) with positive balance`);

    // 2. Process each user
    for (const user of users) {
      try {
        // 2a. Calculate total storage for published (non-suspended) apps
        const appStorageRes = await fetch(
          `${SUPABASE_URL}/rest/v1/apps?owner_id=eq.${user.id}&deleted_at=is.null&hosting_suspended=eq.false` +
          `&visibility=in.(public,unlisted)&select=storage_bytes`,
          { headers }
        );

        let appBytes = 0;
        let publishedAppCount = 0;
        if (appStorageRes.ok) {
          const apps = await appStorageRes.json() as Array<{ storage_bytes: number | null }>;
          publishedAppCount = apps.length;
          appBytes = apps.reduce((sum, a) => sum + (a.storage_bytes || 0), 0);
        }

        // 2b. Calculate total storage for published (non-suspended) pages
        const contentStorageRes = await fetch(
          `${SUPABASE_URL}/rest/v1/content?owner_id=eq.${user.id}&type=eq.page&hosting_suspended=eq.false` +
          `&visibility=eq.public&select=size`,
          { headers }
        );

        let contentBytes = 0;
        if (contentStorageRes.ok) {
          const pages = await contentStorageRes.json() as Array<{ size: number | null }>;
          contentBytes = pages.reduce((sum, p) => sum + (p.size || 0), 0);
        }

        const totalHostingBytes = appBytes + contentBytes;

        // 2c. Calculate data storage overage (user data exceeding 100MB combined free tier)
        const combinedStorageBytes = (user.storage_used_bytes || 0) + (user.data_storage_used_bytes || 0);
        const freeBytes = user.storage_limit_bytes || COMBINED_FREE_TIER_BYTES;
        const overageBytes = Math.max(0, combinedStorageBytes - freeBytes);
        const dataOverageMb = overageBytes / (1024 * 1024);

        // Skip users with nothing to bill (no published apps AND no data overage)
        if (totalHostingBytes === 0 && overageBytes === 0) continue;

        // 2d. Calculate hours since last billed
        const lastBilled = new Date(user.hosting_last_billed_at);
        const now = new Date();
        const hoursSinceLastBilled = Math.max(
          (now.getTime() - lastBilled.getTime()) / (1000 * 60 * 60),
          0
        );

        // Skip if less than 1 minute since last bill (prevent double-billing)
        if (hoursSinceLastBilled < 1 / 60) continue;

        // 2e. Calculate publisher hosting cost — every published MB costs from the first byte
        const totalMb = totalHostingBytes / (1024 * 1024);
        const hostingCostCents = totalMb * RATE_CENTS_PER_MB_PER_HOUR * hoursSinceLastBilled;

        // 2f. Calculate user data overage cost — $0.0005/MB/hr for storage above 100MB
        const dataOverageCostCents = dataOverageMb * DATA_RATE * hoursSinceLastBilled;

        // Combined charge (hosting + data overage)
        const totalCostCents = hostingCostCents + dataOverageCostCents;

        // Round to 2 decimal places (sub-cent precision for fractional rates)
        const chargedCents = Math.max(Math.round(totalCostCents * 100) / 100, totalCostCents > 0 ? 0.01 : 0);

        // 2e. Atomic debit via Postgres RPC — prevents race with concurrent webhook credits
        const debitRes = await fetch(
          `${SUPABASE_URL}/rest/v1/rpc/debit_hosting_balance`,
          {
            method: 'POST',
            headers: {
              ...headers,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              p_user_id: user.id,
              p_amount: chargedCents,
              p_update_billed_at: true,
            }),
          }
        );

        if (!debitRes.ok) {
          const err = await debitRes.text();
          result.errors.push(`Failed to debit balance for ${user.id}: ${err}`);
          continue;
        }

        const debitResult = await debitRes.json() as Array<{
          old_balance: number;
          new_balance: number;
          was_depleted: boolean;
        }>;

        if (!debitResult || debitResult.length === 0) {
          result.errors.push(`Debit RPC returned empty for ${user.id}`);
          continue;
        }

        const { new_balance: newBalance, was_depleted: suspended } = debitResult[0];

        // Log billing transaction(s) — separate line items for hosting vs data overage
        try {
          const txRows: Array<Record<string, unknown>> = [];
          if (hostingCostCents > 0) {
            txRows.push({
              user_id: user.id,
              type: 'charge',
              category: 'hosting',
              description: `Hosting: ${publishedAppCount} app(s), ${totalMb.toFixed(2)} MB`,
              amount_cents: -Math.max(Math.round(hostingCostCents * 100) / 100, 0.01),
              balance_after: newBalance + (dataOverageCostCents > 0 ? Math.max(Math.round(dataOverageCostCents * 100) / 100, 0.01) : 0),
              metadata: { hosting_mb: totalMb, hours: hoursSinceLastBilled, rate: RATE_CENTS_PER_MB_PER_HOUR, apps: publishedAppCount },
            });
          }
          if (dataOverageCostCents > 0) {
            txRows.push({
              user_id: user.id,
              type: 'charge',
              category: 'data_storage',
              description: `Data storage overage: ${dataOverageMb.toFixed(2)} MB over ${(freeBytes / (1024 * 1024)).toFixed(0)} MB free`,
              amount_cents: -Math.max(Math.round(dataOverageCostCents * 100) / 100, 0.01),
              balance_after: newBalance,
              metadata: { overage_mb: dataOverageMb, hours: hoursSinceLastBilled, rate: DATA_RATE },
            });
          }
          if (txRows.length > 0) {
            await fetch(`${SUPABASE_URL}/rest/v1/billing_transactions`, {
              method: 'POST',
              headers: writeHeaders,
              body: JSON.stringify(txRows),
            }).catch(() => {}); // Fire-and-forget — don't break billing if tx log fails
          }
        } catch { /* never break billing for logging */ }

        // 2f. Auto top-up: if balance dropped below threshold, trigger a charge
        if (
          user.auto_topup_enabled &&
          user.stripe_customer_id &&
          newBalance < (user.auto_topup_threshold_cents || 0)
        ) {
          // Fire-and-forget — don't block the billing loop for other users
          triggerAutoTopup(
            user.id,
            user.stripe_customer_id,
            user.auto_topup_amount_cents || 1000,
            SUPABASE_URL,
            SUPABASE_SERVICE_ROLE_KEY
          ).catch(err => {
            console.error(`[BILLING] Auto top-up trigger failed for ${user.id}:`, err);
          });
          // Note: we still proceed with suspension if balance hit zero.
          // The webhook will unsuspend when payment succeeds (fail-CLOSED).
        }

        // 2g. If balance depleted, suspend all their published content
        if (suspended) {
          // Suspend apps
          await fetch(
            `${SUPABASE_URL}/rest/v1/apps?owner_id=eq.${user.id}&deleted_at=is.null&hosting_suspended=eq.false` +
            `&visibility=in.(public,unlisted)`,
            {
              method: 'PATCH',
              headers: writeHeaders,
              body: JSON.stringify({ hosting_suspended: true }),
            }
          ).catch(() => {});

          // Suspend pages
          await fetch(
            `${SUPABASE_URL}/rest/v1/content?owner_id=eq.${user.id}&type=eq.page&hosting_suspended=eq.false`,
            {
              method: 'PATCH',
              headers: writeHeaders,
              body: JSON.stringify({ hosting_suspended: true }),
            }
          ).catch(() => {});

          result.usersSuspended++;
          console.log(
            `[BILLING] User ${user.id}: SUSPENDED — balance depleted ` +
            `(hosting: ${totalMb.toFixed(2)} MB, data overage: ${dataOverageMb.toFixed(2)} MB, charged ${chargedCents.toFixed(2)}¢)`
          );
        }

        result.usersProcessed++;
        result.totalChargedCents += chargedCents;
        const hostingRounded = Math.max(Math.round(hostingCostCents * 100) / 100, hostingCostCents > 0 ? 0.01 : 0);
        const dataOverageRounded = Math.round(dataOverageCostCents * 100) / 100;
        result.details.push({
          userId: user.id,
          storageMb: totalMb,
          hostingChargedCents: hostingRounded,
          dataOverageMb,
          dataOverageCents: dataOverageRounded,
          totalChargedCents: chargedCents,
          newBalance,
          suspended,
        });
      } catch (userErr) {
        const msg = userErr instanceof Error ? userErr.message : String(userErr);
        result.errors.push(`Error processing ${user.id}: ${msg}`);
        console.error(`[BILLING] Error processing ${user.id}:`, msg);
      }
    }

    if (result.usersProcessed > 0) {
      console.log(
        `[BILLING] Complete: ${result.usersProcessed} user(s) billed, ` +
        `${result.usersSuspended} suspended, ` +
        `${result.totalChargedCents.toFixed(2)}¢ total charged, ` +
        `${result.errors.length} error(s)`
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.errors.push(`Fatal error: ${msg}`);
    console.error('[BILLING] Fatal error:', msg);
  }

  return result;
}

/**
 * Unsuspend all content for a user after they top up their balance.
 */
export async function unsuspendContent(userId: string): Promise<{ apps: number; pages: number }> {
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

  const writeHeaders = {
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
  };

  // Unsuspend apps
  const appsRes = await fetch(
    `${SUPABASE_URL}/rest/v1/apps?owner_id=eq.${userId}&hosting_suspended=eq.true&select=id`,
    {
      method: 'PATCH',
      headers: writeHeaders,
      body: JSON.stringify({ hosting_suspended: false }),
    }
  );
  const appsUnsuspended = appsRes.ok ? (await appsRes.json()).length : 0;

  // Unsuspend pages
  const pagesRes = await fetch(
    `${SUPABASE_URL}/rest/v1/content?owner_id=eq.${userId}&type=eq.page&hosting_suspended=eq.true&select=id`,
    {
      method: 'PATCH',
      headers: writeHeaders,
      body: JSON.stringify({ hosting_suspended: false }),
    }
  );
  const pagesUnsuspended = pagesRes.ok ? (await pagesRes.json()).length : 0;

  if (appsUnsuspended > 0 || pagesUnsuspended > 0) {
    console.log(`[BILLING] Unsuspended ${appsUnsuspended} app(s), ${pagesUnsuspended} page(s) for user ${userId}`);
  }

  return { apps: appsUnsuspended, pages: pagesUnsuspended };
}

/**
 * Trigger an auto top-up charge via Stripe PaymentIntent.
 * Creates an off-session PaymentIntent using the customer's saved payment method.
 * On success, the payment_intent.succeeded webhook will credit the balance.
 * On failure, disables auto-topup for this user.
 */
async function triggerAutoTopup(
  userId: string,
  stripeCustomerId: string,
  amountCents: number,
  supabaseUrl: string,
  supabaseKey: string
): Promise<void> {
  const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') || '';

  if (!STRIPE_SECRET_KEY) {
    console.warn('[BILLING] Stripe not configured, skipping auto top-up');
    return;
  }

  console.log(`[BILLING] Triggering auto top-up for user ${userId}: ${amountCents} cents`);

  // Step 1: Get the customer's default payment method
  const custRes = await fetch(
    `https://api.stripe.com/v1/customers/${stripeCustomerId}`,
    {
      headers: { 'Authorization': `Bearer ${STRIPE_SECRET_KEY}` },
    }
  );

  if (!custRes.ok) {
    console.error(`[BILLING] Failed to fetch Stripe customer for ${userId}:`, await custRes.text());
    await disableAutoTopup(userId, supabaseUrl, supabaseKey);
    return;
  }

  const customer = await custRes.json() as {
    invoice_settings?: { default_payment_method?: string };
    default_source?: string;
  };

  // Try default payment method, then fall back to listing payment methods
  // Check cards first, then bank accounts (ACH)
  let paymentMethodId = customer.invoice_settings?.default_payment_method || customer.default_source;

  if (!paymentMethodId) {
    // Try cards first
    const cardRes = await fetch(
      `https://api.stripe.com/v1/payment_methods?customer=${stripeCustomerId}&type=card&limit=1`,
      {
        headers: { 'Authorization': `Bearer ${STRIPE_SECRET_KEY}` },
      }
    );
    if (cardRes.ok) {
      const cardData = await cardRes.json() as { data: Array<{ id: string }> };
      paymentMethodId = cardData.data?.[0]?.id;
    }
  }

  if (!paymentMethodId) {
    // Fall back to ACH bank accounts
    const bankRes = await fetch(
      `https://api.stripe.com/v1/payment_methods?customer=${stripeCustomerId}&type=us_bank_account&limit=1`,
      {
        headers: { 'Authorization': `Bearer ${STRIPE_SECRET_KEY}` },
      }
    );
    if (bankRes.ok) {
      const bankData = await bankRes.json() as { data: Array<{ id: string }> };
      paymentMethodId = bankData.data?.[0]?.id;
    }
  }

  if (!paymentMethodId) {
    console.warn(`[BILLING] No payment method found for user ${userId}, disabling auto top-up`);
    await disableAutoTopup(userId, supabaseUrl, supabaseKey);
    return;
  }

  // Step 2: Create PaymentIntent (off-session, confirm immediately)
  // Charge exactly the deposit amount — platform absorbs Stripe fees.
  // metadata.amount_cents is the deposit credited to the user's balance.
  const chargeCents = amountCents;

  const intentRes = await fetch('https://api.stripe.com/v1/payment_intents', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      'amount': String(chargeCents),
      'currency': 'usd',
      'customer': stripeCustomerId,
      'payment_method': paymentMethodId,
      'off_session': 'true',
      'confirm': 'true',
      'metadata[user_id]': userId,
      'metadata[amount_cents]': String(amountCents),
      'metadata[type]': 'auto_topup',
      'description': `Ultralight auto top-up: $${(amountCents / 100).toFixed(2)} balance credit`,
    }).toString(),
  });

  if (!intentRes.ok) {
    const stripeErr = await intentRes.text();
    console.error(`[BILLING] Auto top-up PaymentIntent failed for ${userId}:`, stripeErr);
    await disableAutoTopup(userId, supabaseUrl, supabaseKey);
    return;
  }

  const intent = await intentRes.json() as { id: string; status: string };
  console.log(`[BILLING] Auto top-up PaymentIntent created: ${intent.id} (status: ${intent.status})`);
  // Balance credit happens via the payment_intent.succeeded webhook
}

/**
 * Disable auto top-up for a user after a payment failure.
 */
async function disableAutoTopup(
  userId: string,
  supabaseUrl: string,
  supabaseKey: string
): Promise<void> {
  try {
    await fetch(
      `${supabaseUrl}/rest/v1/users?id=eq.${userId}`,
      {
        method: 'PATCH',
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({
          auto_topup_enabled: false,
          auto_topup_last_failed_at: new Date().toISOString(),
        }),
      }
    );
    console.log(`[BILLING] Disabled auto top-up for user ${userId} due to payment failure`);
  } catch (err) {
    console.error(`[BILLING] Failed to disable auto top-up for ${userId}:`, err);
  }
}

/**
 * Start the hosting billing job.
 * Runs after a short startup delay, then every hour.
 */
export function startHostingBillingJob(): void {
  const INTERVAL_MS = 60 * 60 * 1000; // 1 hour

  console.log('[BILLING] Starting hosting billing job (hourly)');

  // Run on startup (after a short delay to let the server initialize)
  setTimeout(async () => {
    try {
      await processHostingBilling();
    } catch (err) {
      console.error('[BILLING] Startup billing failed:', err);
    }
  }, 15_000); // 15 second delay (staggered from other startup jobs)

  // Then run every hour
  setInterval(async () => {
    try {
      await processHostingBilling();
    } catch (err) {
      console.error('[BILLING] Scheduled billing failed:', err);
    }
  }, INTERVAL_MS);
}
