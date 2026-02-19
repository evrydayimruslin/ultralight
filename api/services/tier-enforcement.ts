// Tier Enforcement Service
// Shared utility for checking tier-based restrictions.
// Monetization layer deprecated — all features unlocked for all users.

import { type Tier } from '../../shared/types/index.ts';

type Visibility = 'private' | 'unlisted' | 'public';

/**
 * Check whether a visibility value is allowed for the given tier.
 * @deprecated All visibilities are now allowed for all tiers.
 * Returns null (always allowed).
 */
export function checkVisibilityAllowed(
  _tier: Tier,
  _visibility: Visibility
): string | null {
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
      return 'free';
    }

    const users = await response.json();
    return (users[0]?.tier || 'free') as Tier;
  } catch (err) {
    console.error('getUserTier: error:', err);
    return 'free';
  }
}
