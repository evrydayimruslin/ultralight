// GPU Compute Runtime — Reliability Service
// Queries the gpu_reliability_7d materialized view for app-level reliability
// stats and refreshes the view hourly via the billing job.

// @ts-ignore - Deno is available
const Deno = globalThis.Deno;

const SUPABASE_URL = Deno?.env?.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno?.env?.get('SUPABASE_SERVICE_ROLE_KEY') || '';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** GPU reliability stats for a single app (7-day rolling window). */
export interface GpuReliabilityStats {
  /** Total GPU calls in the last 7 days. */
  total_calls: number;
  /** Successful GPU calls in the last 7 days. */
  successful_calls: number;
  /** Success rate as 0.0–1.0. */
  success_rate: number;
  /** Average GPU execution duration in ms (null if no duration data). */
  avg_duration_ms: number | null;
  /** Total compute cost in cents over 7 days. */
  total_compute_cents: number | null;
  /** Color indicator: green (≥99%), yellow (≥95%), red (<95%). */
  color: 'green' | 'yellow' | 'red';
  /** Human-readable display, e.g. "99.2% reliable (847 calls, 7d)". */
  display: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get GPU reliability stats for an app.
 *
 * Queries the `gpu_reliability_7d` materialized view. Returns null if the
 * app has no GPU calls in the view (new app or no recent calls).
 */
export async function getGpuReliability(
  appId: string,
): Promise<GpuReliabilityStats | null> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }

  try {
    const url =
      `${SUPABASE_URL}/rest/v1/gpu_reliability_7d` +
      `?app_id=eq.${appId}` +
      `&select=total_calls,successful_calls,success_rate,avg_duration_ms,total_compute_cents` +
      `&limit=1`;

    const res = await fetch(url, {
      headers: {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    });

    if (!res.ok) {
      console.error('[GPU-RELIABILITY] Query failed:', await res.text());
      return null;
    }

    const rows = (await res.json()) as Array<{
      total_calls: number;
      successful_calls: number;
      success_rate: number;
      avg_duration_ms: number | null;
      total_compute_cents: number | null;
    }>;

    if (!rows || rows.length === 0) {
      return null;
    }

    const row = rows[0];
    const successRate = Number(row.success_rate) || 0;
    const color = reliabilityColor(successRate);
    const display = formatReliabilityDisplay(
      successRate,
      row.total_calls,
    );

    return {
      total_calls: row.total_calls,
      successful_calls: row.successful_calls,
      success_rate: successRate,
      avg_duration_ms: row.avg_duration_ms,
      total_compute_cents: row.total_compute_cents,
      color,
      display,
    };
  } catch (err) {
    console.error('[GPU-RELIABILITY] Error fetching reliability:', err);
    return null;
  }
}

/**
 * Refresh the gpu_reliability_7d materialized view.
 *
 * Called hourly by the hosting billing job. Uses CONCURRENTLY so reads
 * are not blocked during refresh. Fire-and-forget safe — logs errors
 * but does not throw.
 */
export async function refreshGpuReliabilityView(): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return;
  }

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/rpc/refresh_gpu_reliability`,
      {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
      },
    );

    if (!res.ok) {
      console.error(
        '[GPU-RELIABILITY] View refresh failed:',
        await res.text(),
      );
    } else {
      console.log('[GPU-RELIABILITY] Materialized view refreshed');
    }
  } catch (err) {
    console.error('[GPU-RELIABILITY] View refresh error:', err);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Map success rate to a color tier. */
function reliabilityColor(
  rate: number,
): 'green' | 'yellow' | 'red' {
  if (rate >= 0.99) return 'green';
  if (rate >= 0.95) return 'yellow';
  return 'red';
}

/** Format a human-readable reliability string. */
function formatReliabilityDisplay(
  rate: number,
  totalCalls: number,
): string {
  const pct = (rate * 100).toFixed(1);
  return `${pct}% reliable (${totalCalls} calls, 7d)`;
}
