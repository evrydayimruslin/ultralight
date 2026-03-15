// GPU Compute Runtime — Module Entry Point
// Singleton factory for the GPU provider and re-exports for all GPU types.

import type { GPUProvider } from './provider.ts';
import { RunPodProvider } from './runpod.ts';

// ---------------------------------------------------------------------------
// Provider Singleton
// ---------------------------------------------------------------------------

let _provider: GPUProvider | null = null;

/**
 * Get the GPU compute provider singleton.
 *
 * Lazily initializes on first call. Throws if RUNPOD_API_KEY is not configured.
 * The provider is shared across all requests — it holds no per-request state.
 */
export function getGPUProvider(): GPUProvider {
  if (!_provider) {
    const apiKey = globalThis.Deno?.env?.get('RUNPOD_API_KEY');
    if (!apiKey) {
      throw Object.assign(
        new Error('GPU compute is not configured. RUNPOD_API_KEY environment variable is required.'),
        { status: 503 },
      );
    }
    _provider = new RunPodProvider(apiKey);
  }
  return _provider;
}

/**
 * Check if GPU compute is available (API key configured).
 * Use this for feature-gating without throwing.
 */
export function isGpuAvailable(): boolean {
  try {
    getGPUProvider();
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

// Types — everything other modules need
export type {
  GpuType,
  GpuRateEntry,
  GpuStatus,
  GpuConfig,
  GpuExitCode,
  GpuExecutionResult,
  GpuDispatchStrategy,
  GpuPricingMode,
  GpuPricingConfig,
  GpuEndpoint,
  BenchmarkStats,
  FailureChargeability,
} from './types.ts';

// Constants and helpers
export {
  GPU_RATE_TABLE,
  GPU_TYPES,
  isValidGpuType,
  getGpuRate,
  getGpuVram,
  computeGpuCostCents,
  classifyFailure,
} from './types.ts';

// Provider interface
export type {
  GPUProvider,
  BuildContainerParams,
  BuildContainerResult,
  ExecuteParams,
  EndpointStatus,
} from './provider.ts';

// RunPod implementation (for direct access / testing)
export { RunPodProvider } from './runpod.ts';

// Config parser (Phase 2A)
export { detectGpuConfig, parseGpuConfig } from './config.ts';
export type { GpuConfigValidation } from './config.ts';

// Container builder (Phase 2C)
export { triggerGpuBuild, generateDockerfile } from './builder.ts';

// Benchmark pipeline (Phase 2E)
export { startGpuBuildProcessorJob, computeBenchmarkStats } from './benchmark.ts';

// Executor (Phase 3A)
export { executeGpuFunction } from './executor.ts';
export type { GpuExecuteParams, GpuExecuteResult } from './executor.ts';

// Concurrency tracker (Phase 3B)
export { acquireGpuSlot, releaseGpuSlot, getGpuConcurrency, GpuConcurrencyError } from './concurrency.ts';
export type { GpuSlot } from './concurrency.ts';

// Billing (Phase 3C)
export { computeGpuCallCost, settleGpuExecution, estimateMaxGpuCost, extractUnitCount } from './billing.ts';
export type { GpuCostBreakdown, GpuSettlementResult } from './billing.ts';
