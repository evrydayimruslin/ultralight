// Stripe Connect Service
// Handles Express account lifecycle, transfers, and payouts.
// All Stripe API calls use raw fetch — no SDK dependency.
// Gracefully handles missing API keys (throws 503 with descriptive message).
// Internal ledger is in Light (✦); Stripe boundary uses USD cents.

import { getEnv } from '../lib/env.ts';
import { MIN_WITHDRAWAL_LIGHT, LIGHT_PER_DOLLAR_PAYOUT, formatLight } from '../../shared/types/index.ts';

// ============================================
// TYPES
// ============================================

export interface ConnectAccountStatus {
  account_id: string | null;
  onboarded: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
  charges_enabled?: boolean;
  country?: string;
  default_currency?: string;
}

export interface PayoutEstimate {
  gross_light: number;        // Light deducted from balance
  gross_usd_cents: number;    // USD cents equivalent (light / 100 * 100)
  stripe_fee_cents: number;   // estimated Stripe payout fee (in USD cents)
  net_cents: number;          // estimated bank deposit (in USD cents)
}

export interface TransferResult {
  transfer_id: string;
  amount_cents: number;
}

export interface PayoutResult {
  payout_id: string;
  amount_cents: number;
}

// ============================================
// CONSTANTS
// ============================================

// Stripe Express Standard payout fee: 0.25% + $0.25
export const PAYOUT_FEE_PERCENT = 0.0025;
export const PAYOUT_FEE_FIXED_CENTS = 25;

// Cross-border FX fee: 2% on transfers to non-USD connected accounts
export const CROSS_BORDER_FX_PERCENT = 0.02;

// Payout hold period: 14 days before Stripe transfer is executed
export const PAYOUT_HOLD_DAYS = 14;

// ============================================
// HELPERS
// ============================================

function getStripeKey(): string {
  return getEnv('STRIPE_SECRET_KEY');
}

function ensureStripeKey(): string {
  const key = getStripeKey();
  if (!key) {
    throw Object.assign(
      new Error('Stripe is not configured. Withdrawals will be available soon.'),
      { status: 503 }
    );
  }
  return key;
}

/** Convert a Light amount to USD cents at the payout rate (100 Light/$1). */
function lightToUsdCents(amountLight: number): number {
  return Math.round((amountLight / LIGHT_PER_DOLLAR_PAYOUT) * 100);
}

/**
 * Estimate the Stripe payout fee for a given withdrawal in Light.
 * Converts Light to USD at payout rate, then calculates Stripe fees in USD cents.
 * Cross-border payouts (non-US connected accounts) incur an additional 2% FX fee.
 */
export function estimatePayoutFee(amountLight: number, isCrossBorder = false): PayoutEstimate {
  const grossCents = lightToUsdCents(amountLight);
  let feeCents = Math.ceil(grossCents * PAYOUT_FEE_PERCENT + PAYOUT_FEE_FIXED_CENTS);
  if (isCrossBorder) {
    feeCents += Math.ceil(grossCents * CROSS_BORDER_FX_PERCENT);
  }
  return {
    gross_light: amountLight,
    gross_usd_cents: grossCents,
    stripe_fee_cents: feeCents,
    net_cents: grossCents - feeCents,
  };
}

// ============================================
// 1. CREATE CONNECTED ACCOUNT
// Creates a Stripe Express account with manual payout schedule.
// ============================================

export async function createConnectedAccount(
  email: string,
  userId: string,
  country: string = 'US'
): Promise<{ account_id: string }> {
  const STRIPE_KEY = ensureStripeKey();

  const res = await fetch('https://api.stripe.com/v1/accounts', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${STRIPE_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      'type': 'express',
      'country': country,
      'email': email,
      'capabilities[transfers][requested]': 'true',
      'metadata[user_id]': userId,
      'metadata[platform]': 'ultralight',
      'settings[payouts][schedule][interval]': 'manual',
    }).toString(),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('[CONNECT] Account creation failed:', err);
    throw new Error('Failed to create connected account');
  }

  const account = await res.json() as { id: string };
  return { account_id: account.id };
}

// ============================================
// 2. CREATE ONBOARDING LINK
// Generates a Stripe-hosted onboarding URL for the Express account.
// Developer completes KYC, links bank account, etc. on Stripe's UI.
// ============================================

export async function createOnboardingLink(
  accountId: string,
  returnUrl: string,
  refreshUrl: string
): Promise<{ url: string; expires_at: number }> {
  const STRIPE_KEY = ensureStripeKey();

  const res = await fetch('https://api.stripe.com/v1/account_links', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${STRIPE_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      'account': accountId,
      'type': 'account_onboarding',
      'return_url': returnUrl,
      'refresh_url': refreshUrl,
    }).toString(),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('[CONNECT] Onboarding link creation failed:', err);
    throw new Error('Failed to create onboarding link');
  }

  const link = await res.json() as { url: string; expires_at: number };
  return { url: link.url, expires_at: link.expires_at };
}

// ============================================
// 3. GET ACCOUNT STATUS
// Checks whether onboarding is complete and payouts are enabled.
// ============================================

export async function getAccountStatus(
  accountId: string
): Promise<ConnectAccountStatus> {
  const STRIPE_KEY = ensureStripeKey();

  const res = await fetch(`https://api.stripe.com/v1/accounts/${encodeURIComponent(accountId)}`, {
    headers: { 'Authorization': `Bearer ${STRIPE_KEY}` },
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('[CONNECT] Account status check failed:', err);
    throw new Error('Failed to check account status');
  }

  const account = await res.json() as {
    id: string;
    details_submitted: boolean;
    charges_enabled: boolean;
    payouts_enabled: boolean;
    country: string;
    default_currency: string;
  };

  return {
    account_id: account.id,
    onboarded: account.details_submitted,
    payouts_enabled: account.payouts_enabled,
    details_submitted: account.details_submitted,
    charges_enabled: account.charges_enabled,
    country: account.country,
    default_currency: account.default_currency,
  };
}

// ============================================
// 4. CREATE TRANSFER
// Moves money from the platform Stripe balance to a connected account.
// Transfers are free — no Stripe fee.
// ============================================

export async function createTransfer(
  amountCents: number,
  accountId: string,
  metadata: Record<string, string> = {}
): Promise<TransferResult> {
  const STRIPE_KEY = ensureStripeKey();

  // Stripe transfers deal in integers (whole cents)
  const transferAmount = Math.round(amountCents);

  const params = new URLSearchParams({
    'amount': String(transferAmount),
    'currency': 'usd',
    'destination': accountId,
  });

  for (const [k, v] of Object.entries(metadata)) {
    params.set(`metadata[${k}]`, v);
  }

  const res = await fetch('https://api.stripe.com/v1/transfers', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${STRIPE_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('[CONNECT] Transfer creation failed:', err);
    throw new Error('Failed to create transfer to connected account');
  }

  const transfer = await res.json() as { id: string; amount: number };
  return { transfer_id: transfer.id, amount_cents: transfer.amount };
}

// ============================================
// 5. CREATE PAYOUT
// Triggers a payout from the connected account to their linked bank.
// Uses Stripe-Account header to act on behalf of the connected account.
// Stripe deducts its payout fee (0.25% + $0.25) from the amount.
// ============================================

export async function createPayout(
  amountCents: number,
  accountId: string
): Promise<PayoutResult> {
  const STRIPE_KEY = ensureStripeKey();

  const payoutAmount = Math.round(amountCents);

  const res = await fetch('https://api.stripe.com/v1/payouts', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${STRIPE_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Stripe-Account': accountId,
    },
    body: new URLSearchParams({
      'amount': String(payoutAmount),
      'currency': 'usd',
    }).toString(),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('[CONNECT] Payout creation failed:', err);
    throw new Error('Failed to create payout to bank account');
  }

  const payout = await res.json() as { id: string; amount: number };
  return { payout_id: payout.id, amount_cents: payout.amount };
}

// ============================================
// 6. GET CONNECTED BALANCE
// Checks the available and pending balance in a connected account.
// ============================================

export async function getConnectedBalance(
  accountId: string
): Promise<{ available_cents: number; pending_cents: number }> {
  const STRIPE_KEY = ensureStripeKey();

  const res = await fetch('https://api.stripe.com/v1/balance', {
    headers: {
      'Authorization': `Bearer ${STRIPE_KEY}`,
      'Stripe-Account': accountId,
    },
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('[CONNECT] Balance check failed:', err);
    throw new Error('Failed to check connected account balance');
  }

  const balance = await res.json() as {
    available: Array<{ amount: number; currency: string }>;
    pending: Array<{ amount: number; currency: string }>;
  };

  const usdAvailable = balance.available.find(b => b.currency === 'usd');
  const usdPending = balance.pending.find(b => b.currency === 'usd');

  return {
    available_cents: usdAvailable?.amount || 0,
    pending_cents: usdPending?.amount || 0,
  };
}
