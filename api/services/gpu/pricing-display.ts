// GPU Compute Runtime — Pricing Display Service
// Generates human-readable pricing strings and marketplace display objects
// from a GPU app's config + benchmark stats. Pure utility — no API calls.

import type { GpuType, GpuPricingConfig, BenchmarkStats } from './types.ts';
import { computeGpuCostCents, isValidGpuType } from './types.ts';
import type { App } from '../../../shared/types/index.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Marketplace-friendly pricing display for a GPU function. */
export interface GpuPricingDisplay {
  /** Pricing model label, e.g. "Per Call", "Per Image", "Per Duration" */
  mode_label: string;
  /** Developer fee display, e.g. "10¢ per call", "5¢ per image", "Compute + 2¢" */
  developer_fee: string;
  /** Estimated compute cost, e.g. "~0.25¢ compute (A100, ~5s)" */
  estimated_compute: string;
  /** Total estimate, e.g. "~10.25¢ per call" */
  total_estimate: string;
  /** GPU type, e.g. "A100-80GB-SXM" */
  gpu_type: string;
  /** Mean duration from benchmark, e.g. "5.2s" */
  avg_duration: string | null;
  /** Unit label for per_unit mode, e.g. "image" */
  unit_label: string | null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate marketplace pricing display for a GPU app.
 *
 * Reads gpu_pricing_config, gpu_benchmark, and gpu_type from the app record
 * to produce human-readable pricing strings for marketplace display.
 */
export function formatGpuPricing(app: App): GpuPricingDisplay {
  const gpuTypeRaw = app.gpu_type ?? '';
  const gpuType = gpuTypeRaw || 'unknown';
  const pricingConfig = app.gpu_pricing_config as GpuPricingConfig | null;
  const benchmark = app.gpu_benchmark as BenchmarkStats | null;

  // Compute baseline: estimated compute cost from benchmark mean
  const meanMs = benchmark?.mean_ms ?? null;
  const avgDuration = meanMs !== null ? `${(meanMs / 1000).toFixed(1)}s` : null;

  let estimatedComputeCents = 0;
  if (meanMs !== null && isValidGpuType(gpuTypeRaw)) {
    estimatedComputeCents = computeGpuCostCents(gpuTypeRaw as GpuType, meanMs);
  }

  const computeDisplay = formatGpuCostEstimate(gpuType, meanMs, estimatedComputeCents);

  // No pricing config → free (compute only)
  if (!pricingConfig) {
    return {
      mode_label: 'Compute Only',
      developer_fee: 'No developer fee',
      estimated_compute: computeDisplay,
      total_estimate: estimatedComputeCents > 0
        ? `~${formatCents(estimatedComputeCents)} per call`
        : 'Variable (compute only)',
      gpu_type: gpuType,
      avg_duration: avgDuration,
      unit_label: null,
    };
  }

  // Format based on pricing mode
  switch (pricingConfig.mode) {
    case 'per_call': {
      const flatFee = pricingConfig.flat_fee_cents ?? 0;
      const total = estimatedComputeCents + flatFee;
      return {
        mode_label: 'Per Call',
        developer_fee: `${formatCents(flatFee)} per call`,
        estimated_compute: computeDisplay,
        total_estimate: `~${formatCents(total)} per call`,
        gpu_type: gpuType,
        avg_duration: avgDuration,
        unit_label: null,
      };
    }

    case 'per_unit': {
      const unitPrice = pricingConfig.unit_price_cents ?? 0;
      const label = pricingConfig.unit_label ?? 'unit';
      return {
        mode_label: `Per ${capitalize(label)}`,
        developer_fee: `${formatCents(unitPrice)} per ${label}`,
        estimated_compute: computeDisplay,
        total_estimate: `compute + ${formatCents(unitPrice)} × ${label}s`,
        gpu_type: gpuType,
        avg_duration: avgDuration,
        unit_label: label,
      };
    }

    case 'per_duration': {
      const markup = pricingConfig.duration_markup_cents ?? 0;
      const totalEstimate = estimatedComputeCents + markup; // compute (pass-through) + markup
      return {
        mode_label: 'Per Duration',
        developer_fee: markup > 0
          ? `Compute pass-through + ${formatCents(markup)}`
          : 'Compute pass-through',
        estimated_compute: computeDisplay,
        total_estimate: totalEstimate > 0
          ? `~${formatCents(totalEstimate)} per call (est.)`
          : 'Variable (duration-based)',
        gpu_type: gpuType,
        avg_duration: avgDuration,
        unit_label: null,
      };
    }

    default:
      return {
        mode_label: 'Custom',
        developer_fee: 'Custom pricing',
        estimated_compute: computeDisplay,
        total_estimate: 'Contact developer',
        gpu_type: gpuType,
        avg_duration: avgDuration,
        unit_label: null,
      };
  }
}

/**
 * Format a GPU cost estimate string.
 * Returns e.g. "~0.25¢ compute (A100, ~5.0s)" or "Variable compute" if no benchmark.
 */
export function formatGpuCostEstimate(
  gpuType: string,
  meanMs: number | null,
  computeCents?: number,
): string {
  if (meanMs === null) {
    return `Variable compute (${gpuType})`;
  }

  const cents = computeCents ?? 0;
  const durationDisplay = `${(meanMs / 1000).toFixed(1)}s`;
  return `~${formatCents(cents)} compute (${gpuType}, ~${durationDisplay})`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format cents as a human-readable string. */
function formatCents(cents: number): string {
  if (cents === 0) return '0¢';
  if (cents < 0.01) return `${cents.toFixed(4)}¢`;
  if (cents < 1) return `${cents.toFixed(2)}¢`;
  if (cents < 100) return `${cents.toFixed(1)}¢`;
  return `$${(cents / 100).toFixed(2)}`;
}

/** Capitalize first letter. */
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
