// Weekly Call Tracking Service
// Tracks MCP call usage per user per week using Supabase RPCs.
// Enforces weekly call limits based on tier.

import { TIER_LIMITS, type Tier } from '../../shared/types/index.ts';
import { getEnv } from '../lib/env.ts';
import { resolveEnforcementOptions, type EnforcementOptions } from './enforcement.ts';

export interface WeeklyCallResult {
  allowed: boolean;
  count: number;
  limit: number;
  isOverage: boolean;
  reason?: 'limit_exceeded' | 'service_unavailable';
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
  tier: Tier,
  options?: EnforcementOptions,
): Promise<WeeklyCallResult> {
  const supabaseUrl = getEnv('SUPABASE_URL');
  const supabaseKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');

  const tierLimits = TIER_LIMITS[tier];
  const weekStart = getWeekStart();
  const enforcement = resolveEnforcementOptions(options, 'weekly call limit');

  const unavailableResult = (detail: unknown): WeeklyCallResult => {
    const suffix = enforcement.mode === 'fail_closed'
      ? 'blocking request (fail-closed)'
      : 'allowing request (fail-open)';
    console.error(`[WEEKLY-CALLS] Backend unavailable for ${enforcement.resource}, ${suffix}:`, detail);
    return {
      allowed: enforcement.mode !== 'fail_closed',
      count: 0,
      limit: tierLimits.weekly_call_limit,
      isOverage: false,
      reason: 'service_unavailable',
    };
  };

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/increment_weekly_calls`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseKey}`,
        'apikey': supabaseKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_user_id: userId,
        p_week_start: weekStart.toISOString(),
      }),
    });

    if (!response.ok) {
      return unavailableResult(await response.text());
    }

    const results = await response.json() as Array<{ current_count: number | string | null }> | { current_count: number | string | null } | null;
    const currentCount = Array.isArray(results) && results.length > 0
      ? Number(results[0].current_count)
      : results !== null && typeof results === 'object' && 'current_count' in results
        ? Number(results.current_count)
        : 0;

    const limit = tierLimits.weekly_call_limit;
    const isOverage = currentCount > limit;

    // Hard cap for free and fun tiers
    if (isOverage && tierLimits.overage_cost_per_100k_light === 0) {
      return { allowed: false, count: currentCount, limit, isOverage: true, reason: 'limit_exceeded' };
    }

    // Paid tiers with overage: allow but flag
    return { allowed: true, count: currentCount, limit, isOverage };
  } catch (err) {
    return unavailableResult(err);
  }
}

/**
 * Get current weekly usage for a user (read-only, no increment).
 */
export async function getWeeklyUsage(
  userId: string,
  tier: Tier
): Promise<{ count: number; limit: number; weekStart: string }> {
  const supabaseUrl = getEnv('SUPABASE_URL');
  const supabaseKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');

  const weekStart = getWeekStart();
  const limit = TIER_LIMITS[tier].weekly_call_limit;

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/get_weekly_usage`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseKey}`,
        'apikey': supabaseKey,
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
