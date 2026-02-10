// Weekly Call Tracking Service
// Tracks MCP call usage per user per week using Supabase RPCs.
// Enforces weekly call limits based on tier.

import { TIER_LIMITS, type Tier } from '../../shared/types/index.ts';

// @ts-ignore - Deno is available in Deno Deploy
const Deno = globalThis.Deno;

export interface WeeklyCallResult {
  allowed: boolean;
  count: number;
  limit: number;
  isOverage: boolean;
}

/**
 * Get the start of the current week (Sunday 00:00 UTC).
 */
export function getWeekStart(): Date {
  const now = new Date();
  const day = now.getUTCDay(); // 0=Sun, 1=Mon, ...
  const sunday = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - day,
    0, 0, 0, 0
  ));
  return sunday;
}

/**
 * Increment weekly call count and check against tier limit.
 * Returns whether the call is allowed.
 *
 * - free/fun: hard cap (returns allowed=false when over limit)
 * - pro/scale/enterprise: allows overage (returns allowed=true, isOverage=true)
 */
export async function checkAndIncrementWeeklyCalls(
  userId: string,
  tier: Tier
): Promise<WeeklyCallResult> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  const tierLimits = TIER_LIMITS[tier];
  const weekStart = getWeekStart();

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/increment_weekly_calls`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseKey}`,
        'apikey': supabaseKey!,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_user_id: userId,
        p_week_start: weekStart.toISOString(),
      }),
    });

    if (!response.ok) {
      console.warn('increment_weekly_calls RPC failed, allowing request:', await response.text());
      return { allowed: true, count: 0, limit: tierLimits.weekly_call_limit, isOverage: false };
    }

    const results = await response.json();
    const currentCount = Array.isArray(results) && results.length > 0
      ? Number(results[0].current_count)
      : typeof results === 'object' && 'current_count' in results
        ? Number(results.current_count)
        : 0;

    const limit = tierLimits.weekly_call_limit;
    const isOverage = currentCount > limit;

    // Hard cap for free and fun tiers
    if (isOverage && tierLimits.overage_cost_per_100k_cents === 0) {
      return { allowed: false, count: currentCount, limit, isOverage: true };
    }

    // Paid tiers with overage: allow but flag
    return { allowed: true, count: currentCount, limit, isOverage };
  } catch (err) {
    console.error('Weekly call check error:', err);
    // Fail open
    return { allowed: true, count: 0, limit: tierLimits.weekly_call_limit, isOverage: false };
  }
}

/**
 * Get current weekly usage for a user (read-only, no increment).
 */
export async function getWeeklyUsage(
  userId: string,
  tier: Tier
): Promise<{ count: number; limit: number; weekStart: string }> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  const weekStart = getWeekStart();
  const limit = TIER_LIMITS[tier].weekly_call_limit;

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/get_weekly_usage`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseKey}`,
        'apikey': supabaseKey!,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_user_id: userId,
        p_week_start: weekStart.toISOString(),
      }),
    });

    if (!response.ok) {
      return { count: 0, limit, weekStart: weekStart.toISOString() };
    }

    const results = await response.json();
    const count = Array.isArray(results) && results.length > 0
      ? Number(results[0].call_count)
      : 0;

    return { count, limit, weekStart: weekStart.toISOString() };
  } catch {
    return { count: 0, limit, weekStart: weekStart.toISOString() };
  }
}
