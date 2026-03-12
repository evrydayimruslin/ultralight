// Chat Billing Service
// Handles balance checks and post-stream cost deduction for /chat/stream.
// Reuses hosting_balance_cents wallet and billing_transactions audit trail.
// Uses debit_hosting_balance RPC with p_update_billed_at=false (chat doesn't affect hosting clock).

// @ts-ignore
const Deno = globalThis.Deno;

import { CHAT_MIN_BALANCE_CENTS, CHAT_PLATFORM_MARKUP } from '../../shared/types/index.ts';
import type { ChatUsage, ChatBillingResult } from '../../shared/types/index.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const headers: Record<string, string> = {
  'apikey': SUPABASE_SERVICE_ROLE_KEY,
  'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
};

const writeHeaders: Record<string, string> = {
  ...headers,
  'Content-Type': 'application/json',
  'Prefer': 'return=minimal',
};

// ============================================
// BALANCE CHECK
// ============================================

/**
 * Check if user has sufficient balance for chat.
 * Returns the current balance in cents.
 */
export async function checkChatBalance(userId: string): Promise<number> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/users?id=eq.${userId}&select=hosting_balance_cents`,
    { headers }
  );
  if (!res.ok) throw new Error('Failed to query user balance');
  const rows = await res.json();
  if (!rows || rows.length === 0) throw new Error('User not found');
  return rows[0].hosting_balance_cents ?? 0;
}

// ============================================
// COST CALCULATION
// ============================================

/** Per-model pricing fallback (USD per million tokens). Conservative estimates. */
const MODEL_RATES: Record<string, { inputPerMillion: number; outputPerMillion: number }> = {
  'anthropic/claude-sonnet-4-20250514': { inputPerMillion: 3, outputPerMillion: 15 },
  'anthropic/claude-3.5-sonnet': { inputPerMillion: 3, outputPerMillion: 15 },
  'anthropic/claude-3-opus': { inputPerMillion: 15, outputPerMillion: 75 },
  'openai/gpt-4o': { inputPerMillion: 5, outputPerMillion: 15 },
  'openai/gpt-4o-mini': { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  'google/gemini-pro-1.5': { inputPerMillion: 2.5, outputPerMillion: 7.5 },
  'deepseek/deepseek-chat': { inputPerMillion: 0.14, outputPerMillion: 0.28 },
};

/** Conservative default for unknown models */
const DEFAULT_RATES = { inputPerMillion: 5, outputPerMillion: 15 };

/**
 * Calculate cost in cents from usage data.
 * Prefers OpenRouter's reported total_cost (USD) if available.
 * Falls back to static per-model rate table.
 * Applies platform markup (1.2x = 20%).
 */
export function calculateCostCents(
  usage: ChatUsage,
  model: string,
  openRouterTotalCostUsd?: number,
): number {
  let baseCostCents: number;

  if (openRouterTotalCostUsd !== undefined && openRouterTotalCostUsd > 0) {
    // OpenRouter reports cost in USD; convert to cents
    baseCostCents = openRouterTotalCostUsd * 100;
  } else {
    // Fallback: estimate from token counts
    const rates = MODEL_RATES[model] || DEFAULT_RATES;
    baseCostCents =
      (usage.prompt_tokens / 1_000_000) * rates.inputPerMillion * 100 +
      (usage.completion_tokens / 1_000_000) * rates.outputPerMillion * 100;
  }

  // Apply platform markup
  const totalCents = baseCostCents * CHAT_PLATFORM_MARKUP;

  // Round to 4 decimal places (sub-cent precision, same as hosting billing)
  return Math.round(totalCents * 10000) / 10000;
}

// ============================================
// BALANCE DEDUCTION
// ============================================

/**
 * Deduct chat cost from user balance after stream completes.
 * Uses atomic debit_hosting_balance RPC (clamps at 0, never goes negative).
 * Logs transaction to billing_transactions (fire-and-forget).
 */
export async function deductChatCost(
  userId: string,
  usage: ChatUsage,
  model: string,
  openRouterTotalCostUsd?: number,
): Promise<ChatBillingResult> {
  const costCents = calculateCostCents(usage, model, openRouterTotalCostUsd);

  // Skip deduction for zero-cost (e.g., empty response)
  if (costCents <= 0) {
    return { cost_cents: 0, balance_after: 0, was_depleted: false };
  }

  // Atomic debit — p_update_billed_at=false to not touch hosting billing clock
  const debitRes = await fetch(
    `${SUPABASE_URL}/rest/v1/rpc/debit_hosting_balance`,
    {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p_user_id: userId,
        p_amount: costCents,
        p_update_billed_at: false,
      }),
    }
  );

  if (!debitRes.ok) {
    const err = await debitRes.text();
    console.error(`[CHAT-BILLING] Debit failed for ${userId}: ${err}`);
    throw new Error('Balance deduction failed');
  }

  const debitResult = await debitRes.json() as Array<{
    old_balance: number;
    new_balance: number;
    was_depleted: boolean;
  }>;

  if (!debitResult || debitResult.length === 0) {
    console.error(`[CHAT-BILLING] Debit RPC returned empty for ${userId}`);
    throw new Error('Debit RPC returned empty');
  }

  const { new_balance, was_depleted } = debitResult[0];

  // Log transaction (fire-and-forget — never break billing for logging)
  logChatTransaction(userId, costCents, new_balance, usage, model).catch(() => {});

  return {
    cost_cents: costCents,
    balance_after: new_balance,
    was_depleted,
  };
}

// ============================================
// TRANSACTION LOGGING
// ============================================

/** Fire-and-forget billing transaction log. Matches hosting-billing.ts pattern. */
async function logChatTransaction(
  userId: string,
  costCents: number,
  balanceAfter: number,
  usage: ChatUsage,
  model: string,
): Promise<void> {
  await fetch(`${SUPABASE_URL}/rest/v1/billing_transactions`, {
    method: 'POST',
    headers: writeHeaders,
    body: JSON.stringify({
      user_id: userId,
      type: 'charge',
      category: 'chat_inference',
      description: `Chat: ${model} (${usage.prompt_tokens}+${usage.completion_tokens} tokens)`,
      amount_cents: -costCents, // negative = charge (same convention as hosting)
      balance_after: balanceAfter,
      metadata: {
        model,
        prompt_tokens: usage.prompt_tokens,
        completion_tokens: usage.completion_tokens,
        total_tokens: usage.total_tokens,
        cost_cents: costCents,
        markup: CHAT_PLATFORM_MARKUP,
      },
    }),
  });
}

// ============================================
// EXPORTS (for testing)
// ============================================

export { CHAT_MIN_BALANCE_CENTS };
