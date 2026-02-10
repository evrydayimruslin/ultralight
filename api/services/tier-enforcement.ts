// Tier Enforcement Service
// Shared utility for checking tier-based restrictions.
// Used by apps handler, platform MCP handler, and upload handler.

import { TIER_LIMITS, type Tier } from '../../shared/types/index.ts';

type Visibility = 'private' | 'unlisted' | 'public';

/**
 * Check whether a visibility value is allowed for the given tier.
 * Returns null if allowed, or an error message string if not.
 */
export function checkVisibilityAllowed(
  tier: Tier,
  visibility: Visibility
): string | null {
  const allowedVisibility = TIER_LIMITS[tier].allowed_visibility as readonly string[];

  if (!allowedVisibility.includes(visibility)) {
    const allowed = allowedVisibility.join(', ');
    if (!TIER_LIMITS[tier].can_publish) {
      return (
        `${tier} tier apps are restricted to private visibility. ` +
        `You requested "${visibility}". Upgrade to Pro or higher to unlock unlisted and public visibility.`
      );
    }
    return `Visibility "${visibility}" is not allowed for your ${tier} tier. Allowed: ${allowed}`;
  }

  return null;
}

/**
 * Get the user's tier from the database.
 * Lightweight helper — avoids importing the full user service.
 */
export async function getUserTier(userId: string): Promise<Tier> {
  // @ts-ignore - Deno is available
  const Deno = globalThis.Deno;
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

  try {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/users?id=eq.${userId}&select=tier`,
      {
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
        },
      }
    );

    if (!response.ok) {
      console.error('getUserTier: fetch failed:', await response.text());
      return 'free'; // Default to free on error (conservative)
    }

    const users = await response.json();
    return (users[0]?.tier || 'free') as Tier;
  } catch (err) {
    console.error('getUserTier: error:', err);
    return 'free';
  }
}
