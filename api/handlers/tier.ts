// Tier Change Handler
// Handles tier upgrades/downgrades and enforces limits on downgrade.
// Endpoint: POST /api/tier/change
//
// In production this would be triggered by a Stripe webhook
// (customer.subscription.updated / customer.subscription.deleted).
// For now, accepts manual tier changes with a service-role secret.

import { json, error } from './app.ts';
import { TIER_LIMITS, type Tier } from '../../shared/types/index.ts';
import { getEnv } from '../lib/env.ts';


const VALID_TIERS: Tier[] = ['free', 'pro'];

// Map legacy tier names to the simplified two-tier system
const TIER_ALIASES: Record<string, Tier> = {
  fun: 'free',
  scale: 'pro',
  enterprise: 'pro',
};

function readJsonArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

/**
 * Handle tier change requests.
 * POST /api/tier/change
 *
 * Body: { user_id: string, new_tier: Tier, reason?: string }
 * Auth: Bearer token must match (getEnv('TIER_CHANGE_SECRET') || getEnv('SUPABASE_SERVICE_ROLE_KEY')) (service-to-service)
 */
export async function handleTierChange(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return error('Method not allowed', 405);
  }

  // Authenticate with service secret
  const authHeader = request.headers.get('Authorization');
  const token = authHeader?.replace('Bearer ', '');

  if (!token || token !== (getEnv('TIER_CHANGE_SECRET') || getEnv('SUPABASE_SERVICE_ROLE_KEY'))) {
    return error('Unauthorized: invalid service secret', 401);
  }

  let body: { user_id: string; new_tier: string; reason?: string };
  try {
    body = await request.json();
  } catch {
    return error('Invalid JSON body', 400);
  }

  const { user_id, reason } = body;
  // Resolve legacy tier names to the simplified two-tier system
  const new_tier = TIER_ALIASES[body.new_tier] || body.new_tier;

  if (!user_id || typeof user_id !== 'string') {
    return error('user_id is required', 400);
  }

  if (!VALID_TIERS.includes(new_tier as Tier)) {
    return error(`new_tier must be one of: ${VALID_TIERS.join(', ')}`, 400);
  }

  // Fetch current user
  const userResponse = await fetch(
    `${getEnv('SUPABASE_URL')}/rest/v1/users?id=eq.${user_id}&select=id,tier,email`,
    {
      headers: {
        'apikey': getEnv('SUPABASE_SERVICE_ROLE_KEY'),
        'Authorization': `Bearer ${getEnv('SUPABASE_SERVICE_ROLE_KEY')}`,
      },
    }
  );

  if (!userResponse.ok) {
    return error('Failed to fetch user', 500);
  }

  const users = readJsonArray<{ id: string; tier: Tier | null; email: string | null }>(await userResponse.json());
  if (!users || users.length === 0) {
    return error('User not found', 404);
  }

  const currentTier = users[0].tier || 'free';

  if (currentTier === new_tier) {
    return json({
      success: true,
      message: `User is already on ${new_tier} tier`,
      changes: [],
    });
  }

  const changes: string[] = [];
  const enforcementResults: Record<string, unknown> = {};

  const newTierLimits = TIER_LIMITS[new_tier as Tier];

  // ============================================
  // DOWNGRADE ENFORCEMENT — Graceful freeze
  // Public apps → unlisted (shared links survive, directory listing gone)
  // Unlisted apps → unchanged (team keeps working)
  // Permissions/logs degrade automatically via isProTier() runtime checks
  // ============================================
  if (!newTierLimits.can_publish) {
    const appsResponse = await fetch(
      `${getEnv('SUPABASE_URL')}/rest/v1/apps?owner_id=eq.${user_id}&deleted_at=is.null&visibility=eq.public&select=id,name,visibility`,
      {
        headers: {
          'apikey': getEnv('SUPABASE_SERVICE_ROLE_KEY'),
          'Authorization': `Bearer ${getEnv('SUPABASE_SERVICE_ROLE_KEY')}`,
        },
      }
    );

    if (appsResponse.ok) {
      const publicApps = readJsonArray<{ id: string; name: string; visibility: string }>(await appsResponse.json());

      if (publicApps.length > 0) {
        // Soft degradation: public → unlisted (NOT private)
        const updateResponse = await fetch(
          `${getEnv('SUPABASE_URL')}/rest/v1/apps?owner_id=eq.${user_id}&deleted_at=is.null&visibility=eq.public`,
          {
            method: 'PATCH',
            headers: {
              'apikey': getEnv('SUPABASE_SERVICE_ROLE_KEY'),
              'Authorization': `Bearer ${getEnv('SUPABASE_SERVICE_ROLE_KEY')}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              visibility: 'unlisted',
              updated_at: new Date().toISOString(),
            }),
          }
        );

        if (updateResponse.ok) {
          const appNames = publicApps.map((a: { name: string }) => a.name);
          changes.push(
            `Unlisted ${publicApps.length} public app(s): ${appNames.join(', ')}`
          );
          enforcementResults.visibility = {
            apps_changed: publicApps.length,
            app_names: appNames,
            action: 'public_to_unlisted',
          };
        }
      }
    }
  }

  // ============================================
  // UPGRADE BENEFITS
  // ============================================
  if (newTierLimits.can_publish) {
    changes.push('Unlocked: public/unlisted visibility, publish access');
  }
  changes.push(
    `Weekly call limit: ${newTierLimits.weekly_call_limit.toLocaleString()} calls/week`
  );

  // ============================================
  // UPDATE USER TIER
  // ============================================
  const updateResponse = await fetch(
    `${getEnv('SUPABASE_URL')}/rest/v1/users?id=eq.${user_id}`,
    {
      method: 'PATCH',
      headers: {
        'apikey': getEnv('SUPABASE_SERVICE_ROLE_KEY'),
        'Authorization': `Bearer ${getEnv('SUPABASE_SERVICE_ROLE_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        tier: new_tier,
        tier_expires_at: null, // Set by Stripe in production
        updated_at: new Date().toISOString(),
      }),
    }
  );

  if (!updateResponse.ok) {
    const err = await updateResponse.text();
    console.error('Failed to update user tier:', err);
    return error('Failed to update user tier', 500);
  }

  console.log(
    `[TIER_CHANGE] User ${user_id}: ${currentTier} → ${new_tier}. ` +
    `Changes: ${changes.length > 0 ? changes.join('; ') : 'none'}. ` +
    `Reason: ${reason || 'manual'}`
  );

  return json({
    success: true,
    user_id,
    previous_tier: currentTier,
    new_tier,
    reason: reason || 'manual',
    changes,
    enforcement: enforcementResults,
  });
}
