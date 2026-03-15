// GPU Compute Runtime — Billing Service
// Computes GPU call costs, applies failure chargeability rules, and settles
// balances via the existing transfer_balance RPC. Reuses the same atomic
// transfer mechanism as Deno per-call pricing in mcp.ts.

import type { GpuType, GpuPricingConfig, GpuPricingMode } from './types.ts';
import { computeGpuCostCents, classifyFailure } from './types.ts';
import type { GpuExecuteResult } from './executor.ts';
import type { App } from '../../../shared/types/index.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Breakdown of costs for a single GPU call. */
export interface GpuCostBreakdown {
  /** Platform GPU compute cost in cents (rate_per_ms × duration). */
  computeCostCents: number;
  /** Developer's fee in cents (per_call / per_unit / per_duration). */
  developerFeeCents: number;
  /** Total cost to caller in cents (compute + developer fee). */
  totalCostCents: number;
  /** Revenue transferred to owner in cents (developer fee only). */
  ownerRevenueCents: number;
}

/** Result from settling a GPU execution's billing. */
export interface GpuSettlementResult {
  /** Whether any charge was applied. */
  charged: boolean;
  /** Actual amount charged to caller in cents. */
  chargedCents: number;
  /** Full cost breakdown (before failure policy adjustments). */
  breakdown: GpuCostBreakdown;
  /** Which failure policy was applied. */
  failurePolicy: 'full_charge' | 'compute_only' | 'full_refund';
  /** True if transfer failed due to insufficient balance. */
  insufficientBalance?: boolean;
  /** Pre-formatted error message for the handler to return to caller. */
  insufficientBalanceMessage?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default max duration for cost estimation when not specified. */
const DEFAULT_MAX_DURATION_MS = 60_000;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute the full cost breakdown for a GPU call.
 *
 * Uses the executor's computed gpuCostCents for compute, and the app's
 * gpu_pricing_config for the developer fee.
 */
export function computeGpuCallCost(
  app: App,
  functionName: string,
  args: Record<string, unknown>,
  gpuResult: GpuExecuteResult,
): GpuCostBreakdown {
  const computeCostCents = gpuResult.gpuCostCents;
  const developerFeeCents = computeDeveloperFee(app, functionName, args, gpuResult);
  const totalCostCents = computeCostCents + developerFeeCents;

  return {
    computeCostCents,
    developerFeeCents,
    totalCostCents,
    ownerRevenueCents: developerFeeCents, // Platform keeps compute, owner gets dev fee
  };
}

/**
 * Estimate the maximum possible cost for a GPU call (pre-execution).
 *
 * Uses gpu_max_duration_ms with the GPU rate to compute worst-case compute
 * cost, plus the maximum possible developer fee. Useful for future
 * balance-locking (not used in MVP).
 */
export function estimateMaxGpuCost(
  app: App,
  _functionName: string,
  args: Record<string, unknown>,
): number {
  const gpuTypeRaw = app.gpu_type ?? '';
  const maxDurationMs = app.gpu_max_duration_ms ?? DEFAULT_MAX_DURATION_MS;

  // Worst-case compute cost
  let maxComputeCents = 0;
  try {
    maxComputeCents = computeGpuCostCents(gpuTypeRaw as GpuType, maxDurationMs);
  } catch {
    // Invalid gpu_type — skip
  }

  // Max developer fee (same as actual for per_call and per_unit)
  const pricingConfig = app.gpu_pricing_config as GpuPricingConfig | null;
  let maxDevFee = 0;
  if (pricingConfig) {
    switch (pricingConfig.mode) {
      case 'per_call':
        maxDevFee = pricingConfig.flat_fee_cents ?? 0;
        break;
      case 'per_unit': {
        const unitCount = pricingConfig.unit_count_from
          ? extractUnitCount(args, pricingConfig.unit_count_from)
          : 1;
        maxDevFee = (pricingConfig.unit_price_cents ?? 0) * unitCount;
        break;
      }
      case 'per_duration':
        // Worst case: max duration compute + markup
        maxDevFee = maxComputeCents + (pricingConfig.duration_markup_cents ?? 0);
        break;
    }
  }

  return maxComputeCents + maxDevFee;
}

/**
 * Settle billing for a completed GPU execution.
 *
 * Applies failure chargeability rules, performs atomic balance transfer
 * via transfer_balance RPC, logs the transfer, and returns settlement details.
 *
 * Failure policy:
 * - success       → full charge (compute + developer fee)
 * - oom/timeout/exception → compute only (developer fee refunded)
 * - infra_error    → nothing charged (full refund)
 *
 * If caller === owner, billing is skipped entirely (self-calls are free).
 */
export async function settleGpuExecution(
  userId: string,
  app: App,
  functionName: string,
  args: Record<string, unknown>,
  gpuResult: GpuExecuteResult,
): Promise<GpuSettlementResult> {
  // Compute full breakdown
  const breakdown = computeGpuCallCost(app, functionName, args, gpuResult);

  // Apply failure chargeability
  const chargeability = classifyFailure(gpuResult.exitCode);
  let failurePolicy: GpuSettlementResult['failurePolicy'];
  let chargeableCents: number;

  switch (chargeability) {
    case 'chargeable':
      if (gpuResult.exitCode === 'success') {
        failurePolicy = 'full_charge';
        chargeableCents = breakdown.totalCostCents;
      } else {
        // oom, timeout, exception — compute only, no developer fee
        failurePolicy = 'compute_only';
        chargeableCents = breakdown.computeCostCents;
      }
      break;
    case 'non_chargeable':
      failurePolicy = 'full_refund';
      chargeableCents = 0;
      break;
    case 'partial':
      // Not currently used but handle gracefully
      failurePolicy = 'compute_only';
      chargeableCents = breakdown.computeCostCents;
      break;
  }

  // Skip billing for self-calls
  if (userId === app.owner_id) {
    return {
      charged: false,
      chargedCents: 0,
      breakdown,
      failurePolicy,
    };
  }

  // Nothing to charge
  if (chargeableCents <= 0) {
    return {
      charged: false,
      chargedCents: 0,
      breakdown,
      failurePolicy,
    };
  }

  // ── Atomic transfer via transfer_balance RPC ──
  const supabaseUrl = globalThis.Deno?.env?.get('SUPABASE_URL') || '';
  const supabaseKey = globalThis.Deno?.env?.get('SUPABASE_SERVICE_ROLE_KEY') || '';

  if (!supabaseUrl || !supabaseKey) {
    console.error('[GPU-BILLING] Supabase not configured, skipping billing');
    return {
      charged: false,
      chargedCents: 0,
      breakdown,
      failurePolicy,
    };
  }

  try {
    const transferRes = await fetch(
      `${supabaseUrl}/rest/v1/rpc/transfer_balance`,
      {
        method: 'POST',
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          p_from_user: userId,
          p_to_user: app.owner_id,
          p_amount_cents: chargeableCents,
        }),
      },
    );

    if (transferRes.ok) {
      const rows = await transferRes.json() as Array<{
        from_new_balance: number;
        to_new_balance: number;
      }>;

      if (!rows || rows.length === 0) {
        // Empty result = insufficient balance
        const costDisplay = chargeableCents < 1
          ? chargeableCents.toFixed(3)
          : String(chargeableCents);

        return {
          charged: false,
          chargedCents: 0,
          breakdown,
          failurePolicy,
          insufficientBalance: true,
          insufficientBalanceMessage:
            `Insufficient balance. This GPU function costs ${costDisplay}¢ per call. ` +
            `Add funds to your wallet at https://ultralight-api-iikqz.ondigitalocean.app/settings/billing ` +
            `or enable auto top-up to avoid interruptions.`,
        };
      }

      // Log the transfer (fire-and-forget)
      fetch(`${supabaseUrl}/rest/v1/transfers`, {
        method: 'POST',
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({
          from_user_id: userId,
          to_user_id: app.owner_id,
          amount_cents: chargeableCents,
          reason: 'gpu_call',
          app_id: app.id,
          function_name: functionName,
        }),
      }).catch(() => {});

      console.log(
        `[GPU-BILLING] ${userId} → ${app.owner_id}: ${chargeableCents.toFixed(4)}¢ ` +
          `(${failurePolicy}) for ${app.id}.${functionName}`,
      );

      return {
        charged: true,
        chargedCents: chargeableCents,
        breakdown,
        failurePolicy,
      };
    } else {
      // Transfer RPC failed — don't block the call, just log
      console.error(
        `[GPU-BILLING] Transfer failed for ${userId} → ${app.owner_id}:`,
        await transferRes.text(),
      );
      return {
        charged: false,
        chargedCents: 0,
        breakdown,
        failurePolicy,
      };
    }
  } catch (err) {
    console.error('[GPU-BILLING] Settlement error:', err);
    return {
      charged: false,
      chargedCents: 0,
      breakdown,
      failurePolicy,
    };
  }
}

/**
 * Extract a numeric value from args using a dot-path.
 *
 * Supports:
 * - Simple keys: "count" → args.count
 * - Nested keys: "images.count" → args.images.count
 * - Array length: "images.length" → args.images.length
 *
 * Returns 1 as fallback if path doesn't resolve or value isn't numeric.
 */
export function extractUnitCount(
  args: Record<string, unknown>,
  path: string,
): number {
  try {
    const parts = path.split('.');
    let current: unknown = args;

    for (const part of parts) {
      if (current === null || current === undefined) return 1;

      if (part === 'length' && Array.isArray(current)) {
        return current.length;
      }

      if (typeof current === 'object' && current !== null) {
        current = (current as Record<string, unknown>)[part];
      } else {
        return 1;
      }
    }

    if (typeof current === 'number' && !isNaN(current) && current > 0) {
      return Math.floor(current); // Unit counts must be integers
    }

    return 1;
  } catch {
    return 1;
  }
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

/**
 * Compute the developer fee based on the app's gpu_pricing_config.
 * Returns 0 if no pricing is configured.
 */
function computeDeveloperFee(
  app: App,
  _functionName: string,
  args: Record<string, unknown>,
  gpuResult: GpuExecuteResult,
): number {
  const pricingConfig = app.gpu_pricing_config as GpuPricingConfig | null;
  if (!pricingConfig) return 0;

  switch (pricingConfig.mode) {
    case 'per_call':
      return pricingConfig.flat_fee_cents ?? 0;

    case 'per_unit': {
      const unitCount = pricingConfig.unit_count_from
        ? extractUnitCount(args, pricingConfig.unit_count_from)
        : 1;
      return (pricingConfig.unit_price_cents ?? 0) * unitCount;
    }

    case 'per_duration':
      // Pass-through compute cost + optional fixed markup
      return gpuResult.gpuCostCents + (pricingConfig.duration_markup_cents ?? 0);

    default:
      return 0;
  }
}
