// Tier Change Handler
// Handles tier upgrades/downgrades and enforces limits on downgrade.
// Endpoint: POST /api/tier/change
//
// In production this would be triggered by a Stripe webhook
// (customer.subscription.updated / customer.subscription.deleted).
// For now, accepts manual tier changes with a service-role secret.

import { json, error } from './app.ts';
import { revokeExcessTokens } from '../services/tokens.ts';
import { TIER_LIMITS } from '../../shared/types/index.ts';

// @ts-ignore - Deno is available
const Deno = globalThis.Deno;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const TIER_CHANGE_SECRET = Deno.env.get('TIER_CHANGE_SECRET') || SUPABASE_SERVICE_ROLE_KEY;

/**
 * Handle tier change requests.
 * POST /api/tier/change
 *
 * Body: { user_id: string, new_tier: 'free' | 'pro', reason?: string }
 * Auth: Bearer token must match TIER_CHANGE_SECRET (service-to-service)
 */
export async function handleTierChange(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return error('Method not allowed', 405);
  }

  // Authenticate with service secret
  const authHeader = request.headers.get('Authorization');
  const token = authHeader?.replace('Bearer ', '');

  if (!token || token !== TIER_CHANGE_SECRET) {
    return error('Unauthorized: invalid service secret', 401);
  }

  let body: { user_id: string; new_tier: string; reason?: string };
  try {
    body = await request.json();
  } catch {
    return error('Invalid JSON body', 400);
  }

  const { user_id, new_tier, reason } = body;

  if (!user_id || typeof user_id !== 'string') {
    return error('user_id is required', 400);
  }

  if (new_tier !== 'free' && new_tier !== 'pro') {
    return error('new_tier must be "free" or "pro"', 400);
  }

  // Fetch current user
  const userResponse = await fetch(
    `${SUPABASE_URL}/rest/v1/users?id=eq.${user_id}&select=id,tier,email`,
    {
      headers: {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    }
  );

  if (!userResponse.ok) {
    return error('Failed to fetch user', 500);
  }

  const users = await userResponse.json();
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

  // ============================================
  // DOWNGRADE ENFORCEMENT (Pro → Free)
  // ============================================
  if (new_tier === 'free') {
    const freeLimits = TIER_LIMITS.free;

    // 1. Revoke excess API tokens (keep only most recent up to limit)
    const tokenResult = await revokeExcessTokens(user_id, freeLimits.max_api_tokens);
    enforcementResults.tokens = tokenResult;

    if (tokenResult.revoked_count > 0) {
      changes.push(
        `Revoked ${tokenResult.revoked_count} excess API token(s): ${tokenResult.revoked_names.join(', ')}`
      );
    }

    // 2. Force all apps to private visibility
    const appsResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/apps?owner_id=eq.${user_id}&deleted_at=is.null&visibility=neq.private&select=id,name,visibility`,
      {
        headers: {
          'apikey': SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
      }
    );

    if (appsResponse.ok) {
      const publicApps = await appsResponse.json();

      if (publicApps.length > 0) {
        // Batch update all non-private apps to private
        const updateResponse = await fetch(
          `${SUPABASE_URL}/rest/v1/apps?owner_id=eq.${user_id}&deleted_at=is.null&visibility=neq.private`,
          {
            method: 'PATCH',
            headers: {
              'apikey': SUPABASE_SERVICE_ROLE_KEY,
              'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              visibility: 'private',
              updated_at: new Date().toISOString(),
            }),
          }
        );

        if (updateResponse.ok) {
          const appNames = publicApps.map((a: { name: string; visibility: string }) =>
            `${a.name} (was ${a.visibility})`
          );
          changes.push(
            `Set ${publicApps.length} app(s) to private: ${appNames.join(', ')}`
          );
          enforcementResults.visibility = {
            apps_changed: publicApps.length,
            app_names: appNames,
          };
        }
      }
    }

    // 3. Update storage limit to free tier
    changes.push(
      `Storage limit updated to ${formatBytes(freeLimits.storage_limit_bytes)}`
    );
  }

  // ============================================
  // UPGRADE (Free → Pro)
  // ============================================
  if (new_tier === 'pro') {
    const proLimits = TIER_LIMITS.pro;
    changes.push(`Storage limit updated to ${formatBytes(proLimits.storage_limit_bytes)}`);
    changes.push('Unlocked: unlimited API tokens, public/unlisted visibility, unlimited MCP users');
  }

  // ============================================
  // UPDATE USER TIER
  // ============================================
  const tierLimits = TIER_LIMITS[new_tier as keyof typeof TIER_LIMITS];

  const updateResponse = await fetch(
    `${SUPABASE_URL}/rest/v1/users?id=eq.${user_id}`,
    {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        tier: new_tier,
        storage_limit_bytes: tierLimits.storage_limit_bytes,
        tier_expires_at: new_tier === 'pro' ? null : null, // Set by Stripe in production
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

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}
