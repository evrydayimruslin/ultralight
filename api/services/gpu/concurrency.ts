// GPU Compute Runtime — Concurrency Tracker
// In-memory per-endpoint concurrency limiter. Enforces gpu_concurrency_limit
// (default 5) with a 5-second queue before rejecting with 429.
// Single-instance server — no distributed coordination needed.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Handle returned when a slot is acquired. Call release() when done. */
export interface GpuSlot {
  /** Endpoint this slot belongs to. */
  endpointId: string;
  /** Timestamp when the slot was acquired (for queue-wait telemetry). */
  acquiredAt: number;
  /** Release the slot. Safe to call multiple times (idempotent). */
  release: () => void;
}

/** Thrown when concurrency limit is hit and queue timeout expires. */
export class GpuConcurrencyError extends Error {
  status = 429;
  endpointId: string;
  limit: number;

  constructor(endpointId: string, limit: number) {
    super(
      `GPU function at capacity (${limit} concurrent). Try again in a few seconds.`,
    );
    this.name = 'GpuConcurrencyError';
    this.endpointId = endpointId;
    this.limit = limit;
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** How long to wait for a slot before rejecting (milliseconds). */
const QUEUE_TIMEOUT_MS = 5_000;

/** Polling interval while waiting for a slot (milliseconds). */
const POLL_INTERVAL_MS = 200;

// ---------------------------------------------------------------------------
// Internal State
// ---------------------------------------------------------------------------

/** Map<endpointId, currentActiveCount> */
const slots = new Map<string, number>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Acquire a GPU execution slot for an endpoint.
 *
 * If the endpoint is below its concurrency limit, increments the counter
 * and returns immediately. If at capacity, polls every 200ms for up to
 * 5 seconds. If still full, throws GpuConcurrencyError.
 *
 * The returned GpuSlot has a `release()` method that MUST be called in
 * a finally block after execution completes.
 */
export async function acquireGpuSlot(
  endpointId: string,
  limit: number,
): Promise<GpuSlot> {
  // Fast path: slot available
  const current = slots.get(endpointId) ?? 0;
  if (current < limit) {
    return createSlot(endpointId);
  }

  // Slow path: wait for a slot to free up
  const deadline = Date.now() + QUEUE_TIMEOUT_MS;

  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const now = slots.get(endpointId) ?? 0;
    if (now < limit) {
      return createSlot(endpointId);
    }
  }

  // Timed out — reject
  throw new GpuConcurrencyError(endpointId, limit);
}

/**
 * Release a GPU execution slot for an endpoint.
 *
 * Decrements the counter. Does not go below zero (safe against double-release).
 * Prefer using the `release()` method on the GpuSlot object instead of calling
 * this directly.
 */
export function releaseGpuSlot(endpointId: string): void {
  const current = slots.get(endpointId) ?? 0;
  if (current <= 1) {
    slots.delete(endpointId);
  } else {
    slots.set(endpointId, current - 1);
  }
}

/**
 * Get the current active count for an endpoint.
 * Useful for monitoring and diagnostics.
 */
export function getGpuConcurrency(endpointId: string): number {
  return slots.get(endpointId) ?? 0;
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

/** Create a slot, increment the counter, return the handle. */
function createSlot(endpointId: string): GpuSlot {
  const current = slots.get(endpointId) ?? 0;
  slots.set(endpointId, current + 1);

  let released = false;

  return {
    endpointId,
    acquiredAt: Date.now(),
    release: () => {
      if (released) return; // Idempotent
      released = true;
      releaseGpuSlot(endpointId);
    },
  };
}

/** Promise-based sleep. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
