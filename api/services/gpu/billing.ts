// GPU Compute Runtime — Billing Service
// Computes GPU call costs in Light (✦), applies failure chargeability rules,
// and settles balances via two mechanisms:
//   1. transfer_balance — developer fee from caller to app owner (10% platform fee)
//   2. debit_balance — compute cost burned from caller (platform revenue)
// Same pattern as chat-billing.ts for the burn, and mcp.ts for the transfer.

import type { GpuType, GpuPricingConfig, GpuPricingMode } from './types.ts';
import { computeGpuCostLight, classifyFailure } from './types.ts';
import type { GpuExecuteResult } from './executor.ts';
import type { App } from '../../../shared/types/index.ts';
import { formatLight } from '../../../shared/types/index.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Breakdown of costs for a single GPU call. */
export interface GpuCostBreakdown {
  /** Platform GPU compute cost in Light (rate_per_ms × duration). */
  computeCostLight: number;
  /** Developer's fee in Light (per_call / per_unit / per_duration). */
  developerFeeLight: number;
  /** Total cost to caller in Light (compute + developer fee). */
  totalCostLight: number;
  /** Revenue transferred to owner in Light (developer fee minus 10% platform fee). */
  ownerRevenueLight: number;
}

/** Result from settling a GPU execution's billing. */
export interface GpuSettlementResult {
  /** Whether any charge was applied. */
  charged: boolean;
  /** Actual amount charged to caller in Light (compute debit + developer transfer). */
  chargedLight: number;
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
 * Uses the executor's computed gpuCostLight for compute, and the app's
 * gpu_pricing_config for the developer fee.
 */
export function computeGpuCallCost(
  app: App,
  functionName: string,
  args: Record<string, unknown>,
  gpuResult: GpuExecuteResult,
): GpuCostBreakdown {
  const pricingConfig = app.gpu_pricing_config as GpuPricingConfig | null;
  const developerFeeLight = computeDeveloperFee(app, functionName, args, gpuResult);

  // For per_duration mode, compute cost is embedded in the developer fee
  // (the developer passes through compute to the caller as their fee).
  // For per_call/per_unit, compute is a separate platform cost.
  const isPassThrough = pricingConfig?.mode === 'per_duration';
  const computeCostLight = isPassThrough ? 0 : gpuResult.gpuCostLight;
  const totalCostLight = computeCostLight + developerFeeLight;

  return {
    computeCostLight,
    developerFeeLight,
    totalCostLight,
    ownerRevenueLight: developerFeeLight * 0.9, // 10% platform fee on transfer
  };
}

/**
 * Estimate the maximum possible cost for a GPU call (pre-execution).
 *
 * Uses gpu_max_duration_ms with the GPU rate to compute worst-case compute
 * cost, plus the maximum possible developer fee.
 */
export function estimateMaxGpuCost(
  app: App,
  _functionName: string,
  args: Record<string, unknown>,
): number {
  const gpuTypeRaw = app.gpu_type ?? '';
  const maxDurationMs = app.gpu_max_duration_ms ?? DEFAULT_MAX_DURATION_MS;

  // Worst-case compute cost
  let maxComputeLight = 0;
  try {
    maxComputeLight = computeGpuCostLight(gpuTypeRaw as GpuType, maxDurationMs);
  } catch {
    // Invalid gpu_type — skip
  }

  // Max developer fee (same as actual for per_call and per_unit)
  const pricingConfig = app.gpu_pricing_config as GpuPricingConfig | null;
  let maxDevFee = 0;
  if (pricingConfig) {
    switch (pricingConfig.mode) {
      case 'per_call':
        maxDevFee = pricingConfig.flat_fee_light ?? 0;
        break;
      case 'per_unit': {
        const unitCount = pricingConfig.unit_count_from
          ? extractUnitCount(args, pricingConfig.unit_count_from)
          : 1;
        maxDevFee = (pricingConfig.unit_price_light ?? 0) * unitCount;
        break;
      }
      case 'per_duration':
        maxDevFee = maxComputeLight + (pricingConfig.duration_markup_light ?? 0);
        return maxDevFee;
    }
  }

  return maxComputeLight + maxDevFee;
}

/**
 * Settle billing for a completed GPU execution.
 *
 * Uses two settlement mechanisms:
 *   - transfer_balance: developer fee from caller → owner (10% platform fee deducted)
 *   - debit_balance: compute cost burned from caller (platform revenue)
 *
 * Failure policy:
 * - success       → full charge (transfer dev fee + debit compute)
 * - oom/timeout/exception → compute only (debit compute, no dev fee)
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
  let devFeeToTransfer: number;
  let computeToDebit: number;

  switch (chargeability) {
    case 'chargeable':
      if (gpuResult.exitCode === 'success') {
        failurePolicy = 'full_charge';
        devFeeToTransfer = breakdown.developerFeeLight;
        computeToDebit = breakdown.computeCostLight;
      } else {
        failurePolicy = 'compute_only';
        devFeeToTransfer = 0;
        computeToDebit = breakdown.computeCostLight;
      }
      break;
    case 'non_chargeable':
      failurePolicy = 'full_refund';
      devFeeToTransfer = 0;
      computeToDebit = 0;
      break;
    case 'partial':
      failurePolicy = 'compute_only';
      devFeeToTransfer = 0;
      computeToDebit = breakdown.computeCostLight;
      break;
  }

  // Skip billing for self-calls
  if (userId === app.owner_id) {
    return {
      charged: false,
      chargedLight: 0,
      breakdown,
      failurePolicy,
    };
  }

  // Nothing to charge
  const totalCharge = devFeeToTransfer + computeToDebit;
  if (totalCharge <= 0) {
    return {
      charged: false,
      chargedLight: 0,
      breakdown,
      failurePolicy,
    };
  }

  // ── Supabase config ──
  const supabaseUrl = globalThis.Deno?.env?.get('SUPABASE_URL') || '';
  const supabaseKey = globalThis.Deno?.env?.get('SUPABASE_SERVICE_ROLE_KEY') || '';

  if (!supabaseUrl || !supabaseKey) {
    console.error('[GPU-BILLING] Supabase not configured, skipping billing');
    return {
      charged: false,
      chargedLight: 0,
      breakdown,
      failurePolicy,
    };
  }

  const rpcHeaders = {
    'apikey': supabaseKey,
    'Authorization': `Bearer ${supabaseKey}`,
    'Content-Type': 'application/json',
  };

  try {
    let actualDevFeeCharged = 0;
    let actualComputeCharged = 0;

    // ── Step 1: Transfer developer fee to owner (if any) ──
    // transfer_balance now includes 10% platform fee (owner receives 90%).
    if (devFeeToTransfer > 0) {
      const transferRes = await fetch(
        `${supabaseUrl}/rest/v1/rpc/transfer_balance`,
        {
          method: 'POST',
          headers: rpcHeaders,
          body: JSON.stringify({
            p_from_user: userId,
            p_to_user: app.owner_id,
            p_amount_light: devFeeToTransfer,
          }),
        },
      );

      if (transferRes.ok) {
        const rows = await transferRes.json() as Array<{
          from_new_balance: number;
          to_new_balance: number;
          platform_fee: number;
        }>;

        if (!rows || rows.length === 0) {
          return {
            charged: false,
            chargedLight: 0,
            breakdown,
            failurePolicy,
            insufficientBalance: true,
            insufficientBalanceMessage:
              `Insufficient balance. This GPU function costs ~${formatLight(totalCharge)} per call. ` +
              `Add funds to your wallet at https://ultralight-api-iikqz.ondigitalocean.app/settings/billing ` +
              `or enable auto top-up to avoid interruptions.`,
          };
        }

        actualDevFeeCharged = devFeeToTransfer;

        // Log the developer fee transfer (fire-and-forget)
        fetch(`${supabaseUrl}/rest/v1/transfers`, {
          method: 'POST',
          headers: { ...rpcHeaders, 'Prefer': 'return=minimal' },
          body: JSON.stringify({
            from_user_id: userId,
            to_user_id: app.owner_id,
            amount_light: devFeeToTransfer,
            reason: 'gpu_call',
            app_id: app.id,
            function_name: functionName,
          }),
        }).catch(() => {});
      } else {
        console.error(
          `[GPU-BILLING] Transfer failed for ${userId} → ${app.owner_id}:`,
          await transferRes.text(),
        );
      }
    }

    // ── Step 2: Debit compute cost from caller (platform revenue) ──
    if (computeToDebit > 0) {
      const debitRes = await fetch(
        `${supabaseUrl}/rest/v1/rpc/debit_balance`,
        {
          method: 'POST',
          headers: rpcHeaders,
          body: JSON.stringify({
            p_user_id: userId,
            p_amount: computeToDebit,
            p_update_billed_at: false,
          }),
        },
      );

      if (debitRes.ok) {
        const debitResult = await debitRes.json() as Array<{
          old_balance: number;
          new_balance: number;
          was_depleted: boolean;
        }>;

        if (debitResult && debitResult.length > 0) {
          actualComputeCharged = computeToDebit;

          // Log compute deduction to billing_transactions (fire-and-forget)
          fetch(`${supabaseUrl}/rest/v1/billing_transactions`, {
            method: 'POST',
            headers: { ...rpcHeaders, 'Prefer': 'return=minimal' },
            body: JSON.stringify({
              user_id: userId,
              type: 'charge',
              category: 'gpu_compute',
              description: `GPU: ${app.gpu_type || 'unknown'} ${gpuResult.durationMs}ms — ${app.name || app.slug}.${functionName}`,
              amount_light: -computeToDebit,
              balance_after_light: debitResult[0].new_balance,
              metadata: {
                app_id: app.id,
                function_name: functionName,
                gpu_type: gpuResult.gpuType,
                duration_ms: gpuResult.durationMs,
                exit_code: gpuResult.exitCode,
                compute_cost_light: computeToDebit,
                failure_policy: failurePolicy,
              },
            }),
          }).catch(() => {});
        }
      } else {
        console.error(
          `[GPU-BILLING] Compute debit failed for ${userId}:`,
          await debitRes.text(),
        );
      }
    }

    const totalCharged = actualDevFeeCharged + actualComputeCharged;

    console.log(
      `[GPU-BILLING] ${userId}: dev_fee=${formatLight(actualDevFeeCharged)} → ${app.owner_id}, ` +
        `compute=${formatLight(actualComputeCharged)} (burned) ` +
        `[${failurePolicy}] for ${app.id}.${functionName}`,
    );

    return {
      charged: totalCharged > 0,
      chargedLight: totalCharged,
      breakdown,
      failurePolicy,
    };
  } catch (err) {
    console.error('[GPU-BILLING] Settlement error:', err);
    return {
      charged: false,
      chargedLight: 0,
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
      return Math.floor(current);
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
      return pricingConfig.flat_fee_light ?? 0;

    case 'per_unit': {
      const unitCount = pricingConfig.unit_count_from
        ? extractUnitCount(args, pricingConfig.unit_count_from)
        : 1;
      return (pricingConfig.unit_price_light ?? 0) * unitCount;
    }

    case 'per_duration':
      return gpuResult.gpuCostLight + (pricingConfig.duration_markup_light ?? 0);

    default:
      return 0;
  }
}
