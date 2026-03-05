// User Settings Handler
// Handles user profile, BYOK configuration, and API token management

import { json, error } from './app.ts';
import { authenticate } from './auth.ts';
import { createUserService } from '../services/user.ts';
import { validateAPIKey } from '../services/ai.ts';
import { BYOK_PROVIDERS, type BYOKProvider, calcGrossWithStripeFee } from '../../shared/types/index.ts';
import {
  createToken,
  listTokens,
  revokeToken,
  revokeAllTokens,
} from '../services/tokens.ts';
import { createAppsService } from '../services/apps.ts';
import { encryptEnvVar, decryptEnvVar } from '../services/envvars.ts';
import { unsuspendContent } from '../services/hosting-billing.ts';

// Stripe webhook idempotency: track processed event IDs in memory (1hr TTL).
// Prevents double-crediting from Stripe's automatic webhook retries.
const processedStripeEvents = new Map<string, number>();

// Cleanup old entries every 10 minutes (events older than 1 hour are removed)
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [id, ts] of processedStripeEvents) {
    if (ts < cutoff) processedStripeEvents.delete(id);
  }
}, 10 * 60 * 1000);

export async function handleUser(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // ============================================
  // UNAUTHENTICATED ROUTES (webhooks)
  // ============================================

  // POST /api/webhooks/stripe — handle Stripe webhook events
  // Verified by webhook signature, no auth token needed.
  // Idempotent: deduplicates by Stripe event ID (in-memory cache, 1hr TTL).
  if (path === '/api/webhooks/stripe' && method === 'POST') {
    try {
      // @ts-ignore
      const Deno = globalThis.Deno;
      const STRIPE_WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET') || '';

      if (!STRIPE_WEBHOOK_SECRET) {
        return error('Stripe webhooks not configured', 503);
      }

      const rawBody = await request.text();
      const signature = request.headers.get('stripe-signature') || '';

      // Verify webhook signature
      const verified = await verifyStripeSignature(rawBody, signature, STRIPE_WEBHOOK_SECRET);
      if (!verified) {
        return error('Invalid webhook signature', 400);
      }

      const event = JSON.parse(rawBody) as {
        id: string;
        type: string;
        data: {
          object: {
            metadata?: { user_id?: string; amount_cents?: string; type?: string };
            payment_status?: string;
          };
        };
      };

      // Idempotency: skip if we've already processed this event
      if (processedStripeEvents.has(event.id)) {
        console.log(`[STRIPE] Skipping duplicate event ${event.id}`);
        return json({ received: true, duplicate: true });
      }
      processedStripeEvents.set(event.id, Date.now());

      // Handle checkout.session.completed (manual deposits)
      if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const eventUserId = session.metadata?.user_id;
        const amountCents = parseInt(session.metadata?.amount_cents || '0', 10);
        const depositType = session.metadata?.type;

        if (eventUserId && amountCents > 0 && depositType === 'hosting_deposit' && session.payment_status === 'paid') {
          console.log(`[STRIPE] Crediting ${amountCents} cents to user ${eventUserId} (event: ${event.id})`);
          await creditHostingBalance(eventUserId, amountCents);
        }
      }

      // Handle payment_intent.succeeded (auto top-up charges)
      if (event.type === 'payment_intent.succeeded') {
        const intent = event.data.object;
        const eventUserId = intent.metadata?.user_id;
        const amountCents = parseInt(intent.metadata?.amount_cents || '0', 10);
        const intentType = intent.metadata?.type;

        if (eventUserId && amountCents > 0 && intentType === 'auto_topup') {
          console.log(`[STRIPE] Auto top-up succeeded: crediting ${amountCents} cents to user ${eventUserId} (event: ${event.id})`);
          await creditHostingBalance(eventUserId, amountCents);
        }
      }

      // Handle account.updated (Connect onboarding status changes)
      if (event.type === 'account.updated') {
        const account = event.data.object as {
          id: string;
          details_submitted?: boolean;
          payouts_enabled?: boolean;
        };

        if (account.id) {
          const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = getSupabaseEnv();
          await fetch(
            `${SUPABASE_URL}/rest/v1/users?stripe_connect_account_id=eq.${account.id}`,
            {
              method: 'PATCH',
              headers: {
                'apikey': SUPABASE_SERVICE_ROLE_KEY,
                'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal',
              },
              body: JSON.stringify({
                stripe_connect_onboarded: account.details_submitted || false,
                stripe_connect_payouts_enabled: account.payouts_enabled || false,
              }),
            }
          );
          console.log(`[STRIPE] Connect account updated: ${account.id} (payouts: ${account.payouts_enabled})`);
        }
      }

      // Handle payout.paid (money arrived in developer's bank)
      if (event.type === 'payout.paid') {
        const payout = event.data.object as { id: string };
        const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = getSupabaseEnv();
        await fetch(
          `${SUPABASE_URL}/rest/v1/payouts?stripe_payout_id=eq.${payout.id}`,
          {
            method: 'PATCH',
            headers: {
              'apikey': SUPABASE_SERVICE_ROLE_KEY,
              'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
              'Content-Type': 'application/json',
              'Prefer': 'return=minimal',
            },
            body: JSON.stringify({ status: 'paid', completed_at: new Date().toISOString() }),
          }
        );
        console.log(`[STRIPE] Payout paid: ${payout.id}`);
      }

      // Handle payout.failed (payout to bank failed — refund balance)
      if (event.type === 'payout.failed') {
        const payout = event.data.object as { id: string; failure_message?: string };
        const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = getSupabaseEnv();
        const sbHeaders = {
          'apikey': SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        };

        // Find the payout record by stripe_payout_id
        const payoutRes = await fetch(
          `${SUPABASE_URL}/rest/v1/payouts?stripe_payout_id=eq.${payout.id}&status=eq.processing&select=id`,
          { headers: sbHeaders }
        );
        if (payoutRes.ok) {
          const payoutRows = await payoutRes.json() as Array<{ id: string }>;
          for (const p of payoutRows) {
            await fetch(`${SUPABASE_URL}/rest/v1/rpc/fail_payout_refund`, {
              method: 'POST',
              headers: { ...sbHeaders, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                p_payout_id: p.id,
                p_failure_reason: payout.failure_message || 'payout_failed',
              }),
            });
          }
        }
        console.log(`[STRIPE] Payout failed: ${payout.id} — ${payout.failure_message || 'unknown reason'}`);
      }

      // Handle transfer.reversed (transfer from platform to connected account reversed)
      if (event.type === 'transfer.reversed') {
        const transfer = event.data.object as { id: string };
        const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = getSupabaseEnv();
        const sbHeaders = {
          'apikey': SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        };

        // Find payout record by transfer ID and refund
        const payoutRes = await fetch(
          `${SUPABASE_URL}/rest/v1/payouts?stripe_transfer_id=eq.${transfer.id}&status=in.(pending,processing)&select=id`,
          { headers: sbHeaders }
        );
        if (payoutRes.ok) {
          const payoutRows = await payoutRes.json() as Array<{ id: string }>;
          for (const p of payoutRows) {
            await fetch(`${SUPABASE_URL}/rest/v1/rpc/fail_payout_refund`, {
              method: 'POST',
              headers: { ...sbHeaders, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                p_payout_id: p.id,
                p_failure_reason: 'transfer_reversed',
              }),
            });
          }
        }
        console.log(`[STRIPE] Transfer reversed: ${transfer.id}`);
      }

      return json({ received: true });
    } catch (err) {
      console.error('[STRIPE] Webhook error:', err);
      return error('Webhook processing failed', 500);
    }
  }

  // ============================================
  // AUTHENTICATED ROUTES
  // ============================================

  // All remaining user endpoints require authentication
  let userId: string;
  try {
    const auth = await authenticate(request);
    userId = auth.id;
  } catch (err) {
    return error('Authentication required', 401);
  }

  const userService = createUserService();

  // ============================================
  // GET /api/user - Get user profile
  // ============================================
  if (path === '/api/user' && method === 'GET') {
    try {
      const user = await userService.getUser(userId);
      if (!user) {
        return error('User not found', 404);
      }
      return json(user);
    } catch (err) {
      console.error('Get user error:', err);
      return error('Failed to get user profile', 500);
    }
  }

  // ============================================
  // PATCH /api/user - Update user profile
  // ============================================
  if (path === '/api/user' && method === 'PATCH') {
    try {
      const body = await request.json();
      const { display_name } = body;

      const user = await userService.updateUser(userId, { display_name });
      return json(user);
    } catch (err) {
      console.error('Update user error:', err);
      return error('Failed to update user profile', 500);
    }
  }

  // ============================================
  // GET /api/user/byok - Get BYOK configs
  // ============================================
  if (path === '/api/user/byok' && method === 'GET') {
    try {
      const user = await userService.getUser(userId);
      if (!user) {
        return error('User not found', 404);
      }

      return json({
        enabled: user.byok_enabled,
        primary_provider: user.byok_provider,
        configs: user.byok_configs,
        available_providers: Object.values(BYOK_PROVIDERS).map(p => ({
          id: p.id,
          name: p.name,
          description: p.description,
          defaultModel: p.defaultModel,
          models: p.models,
          docsUrl: p.docsUrl,
          apiKeyUrl: p.apiKeyUrl,
        })),
      });
    } catch (err) {
      console.error('Get BYOK error:', err);
      return error('Failed to get BYOK configuration', 500);
    }
  }

  // ============================================
  // POST /api/user/byok - Add BYOK provider
  // ============================================
  if (path === '/api/user/byok' && method === 'POST') {
    try {
      const body = await request.json();
      const { provider, api_key, model, validate = true } = body;

      // Validate provider
      if (!provider || !BYOK_PROVIDERS[provider as BYOKProvider]) {
        return error('Invalid provider. Must be one of: ' + Object.keys(BYOK_PROVIDERS).join(', '), 400);
      }

      // Validate API key is provided
      if (!api_key || typeof api_key !== 'string' || api_key.trim().length === 0) {
        return error('API key is required', 400);
      }

      // Optionally validate the API key works
      if (validate) {
        try {
          await validateAPIKey(provider as BYOKProvider, api_key.trim());
        } catch (validationErr) {
          return error(`API key validation failed: ${validationErr instanceof Error ? validationErr.message : 'Invalid key'}`, 400);
        }
      }

      // Add the provider
      const config = await userService.addBYOKProvider(
        userId,
        provider as BYOKProvider,
        api_key.trim(),
        model
      );

      return json({
        success: true,
        config,
        message: `${BYOK_PROVIDERS[provider as BYOKProvider].name} configured successfully`,
      });
    } catch (err) {
      console.error('Add BYOK error:', err);
      return error('Failed to add BYOK provider', 500);
    }
  }

  // ============================================
  // PATCH /api/user/byok/:provider - Update BYOK provider
  // ============================================
  const byokMatch = path.match(/^\/api\/user\/byok\/([a-z]+)$/);
  if (byokMatch && method === 'PATCH') {
    const provider = byokMatch[1] as BYOKProvider;

    if (!BYOK_PROVIDERS[provider]) {
      return error('Invalid provider', 400);
    }

    try {
      const body = await request.json();
      const { api_key, model, validate = true } = body;

      // If updating API key, validate it
      if (api_key && validate) {
        try {
          await validateAPIKey(provider, api_key.trim());
        } catch (validationErr) {
          return error(`API key validation failed: ${validationErr instanceof Error ? validationErr.message : 'Invalid key'}`, 400);
        }
      }

      const config = await userService.updateBYOKProvider(userId, provider, {
        apiKey: api_key?.trim(),
        model,
      });

      return json({
        success: true,
        config,
        message: `${BYOK_PROVIDERS[provider].name} updated successfully`,
      });
    } catch (err) {
      console.error('Update BYOK error:', err);
      return error('Failed to update BYOK provider', 500);
    }
  }

  // ============================================
  // DELETE /api/user/byok/:provider - Remove BYOK provider
  // ============================================
  if (byokMatch && method === 'DELETE') {
    const provider = byokMatch[1] as BYOKProvider;

    if (!BYOK_PROVIDERS[provider]) {
      return error('Invalid provider', 400);
    }

    try {
      await userService.removeBYOKProvider(userId, provider);

      return json({
        success: true,
        message: `${BYOK_PROVIDERS[provider].name} removed`,
      });
    } catch (err) {
      console.error('Remove BYOK error:', err);
      return error('Failed to remove BYOK provider', 500);
    }
  }

  // ============================================
  // POST /api/user/byok/primary - Set primary provider
  // ============================================
  if (path === '/api/user/byok/primary' && method === 'POST') {
    try {
      const body = await request.json();
      const { provider } = body;

      if (!provider || !BYOK_PROVIDERS[provider as BYOKProvider]) {
        return error('Invalid provider', 400);
      }

      await userService.setPrimaryProvider(userId, provider as BYOKProvider);

      return json({
        success: true,
        message: `${BYOK_PROVIDERS[provider as BYOKProvider].name} set as primary provider`,
      });
    } catch (err) {
      console.error('Set primary provider error:', err);
      return error('Failed to set primary provider', 500);
    }
  }

  // ============================================
  // API TOKENS
  // ============================================

  // GET /api/user/tokens - List all tokens
  if (path === '/api/user/tokens' && method === 'GET') {
    try {
      const tokens = await listTokens(userId);
      return json({
        tokens: tokens.map((t) => ({
          id: t.id,
          name: t.name,
          token_prefix: t.token_prefix,
          scopes: t.scopes,
          app_ids: t.app_ids,
          function_names: t.function_names,
          last_used_at: t.last_used_at,
          expires_at: t.expires_at,
          created_at: t.created_at,
        })),
      });
    } catch (err) {
      console.error('List tokens error:', err);
      return error('Failed to list tokens', 500);
    }
  }

  // POST /api/user/tokens - Create a new token
  if (path === '/api/user/tokens' && method === 'POST') {
    try {
      const body = await request.json();
      const { name, expires_in_days, app_ids, function_names } = body;

      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return error('Token name is required', 400);
      }

      if (name.length > 50) {
        return error('Token name must be 50 characters or less', 400);
      }

      // Validate expires_in_days if provided
      if (expires_in_days !== undefined) {
        if (typeof expires_in_days !== 'number' || expires_in_days < 1 || expires_in_days > 365) {
          return error('expires_in_days must be between 1 and 365', 400);
        }
      }

      // Validate token scoping (Pro feature — accepts but stores for all tiers)
      if (app_ids !== undefined && (!Array.isArray(app_ids) || app_ids.some((id: unknown) => typeof id !== 'string'))) {
        return error('app_ids must be an array of strings', 400);
      }
      if (function_names !== undefined && (!Array.isArray(function_names) || function_names.some((n: unknown) => typeof n !== 'string'))) {
        return error('function_names must be an array of strings', 400);
      }

      const result = await createToken(userId, name.trim(), {
        expiresInDays: expires_in_days,
        app_ids: app_ids || undefined,
        function_names: function_names || undefined,
      });

      return json({
        success: true,
        token: {
          id: result.token.id,
          name: result.token.name,
          token_prefix: result.token.token_prefix,
          app_ids: result.token.app_ids,
          function_names: result.token.function_names,
          expires_at: result.token.expires_at,
          created_at: result.token.created_at,
        },
        // IMPORTANT: This is the only time the full token is returned!
        plaintext_token: result.plaintext_token,
        message: 'Token created. Copy it now - you won\'t be able to see it again!',
      });
    } catch (err) {
      console.error('Create token error:', err);
      if (err instanceof Error && err.message.includes('already exists')) {
        return error(err.message, 409);
      }
      if (err instanceof Error && err.message.includes('Token limit reached')) {
        return error(err.message, 403);
      }
      return error('Failed to create token', 500);
    }
  }

  // DELETE /api/user/tokens/:id - Revoke a specific token
  const tokenMatch = path.match(/^\/api\/user\/tokens\/([a-f0-9-]+)$/);
  if (tokenMatch && method === 'DELETE') {
    const tokenId = tokenMatch[1];

    try {
      await revokeToken(userId, tokenId);
      return json({
        success: true,
        message: 'Token revoked',
      });
    } catch (err) {
      console.error('Revoke token error:', err);
      return error('Failed to revoke token', 500);
    }
  }

  // DELETE /api/user/tokens - Revoke all tokens
  if (path === '/api/user/tokens' && method === 'DELETE') {
    try {
      const count = await revokeAllTokens(userId);
      return json({
        success: true,
        revoked_count: count,
        message: `Revoked ${count} token(s)`,
      });
    } catch (err) {
      console.error('Revoke all tokens error:', err);
      return error('Failed to revoke tokens', 500);
    }
  }

  // ============================================
  // PLATFORM SUPABASE CONFIG
  // ============================================

  // GET /api/user/supabase - List all saved Supabase servers
  if (path === '/api/user/supabase' && method === 'GET') {
    try {
      const configs = await listSupabaseConfigs(userId);
      return json({ configs });
    } catch (err) {
      console.error('List Supabase configs error:', err);
      return error('Failed to list Supabase configurations', 500);
    }
  }

  // POST /api/user/supabase - Create a new saved Supabase server
  if (path === '/api/user/supabase' && method === 'POST') {
    try {
      const body = await request.json();
      const { name, url: supabaseUrl, anon_key, service_key } = body;

      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return error('Server name is required', 400);
      }
      if (name.length > 100) {
        return error('Server name must be 100 characters or less', 400);
      }
      if (!supabaseUrl || typeof supabaseUrl !== 'string') {
        return error('Supabase URL is required', 400);
      }
      try { new URL(supabaseUrl); } catch { return error('Invalid Supabase URL', 400); }
      if (!anon_key || typeof anon_key !== 'string') {
        return error('Anon key is required', 400);
      }

      const encryptedAnonKey = await encryptEnvVar(anon_key.trim());
      const encryptedServiceKey = service_key ? await encryptEnvVar(service_key.trim()) : null;

      const { SUPABASE_URL: SB_URL, SUPABASE_SERVICE_ROLE_KEY: SB_KEY } = getSupabaseEnv();

      const response = await fetch(
        `${SB_URL}/rest/v1/user_supabase_configs`,
        {
          method: 'POST',
          headers: {
            'apikey': SB_KEY,
            'Authorization': `Bearer ${SB_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation',
          },
          body: JSON.stringify({
            user_id: userId,
            name: name.trim(),
            supabase_url: supabaseUrl.trim(),
            anon_key_encrypted: encryptedAnonKey,
            service_key_encrypted: encryptedServiceKey,
          }),
        }
      );

      if (!response.ok) {
        const text = await response.text();
        if (text.includes('unique') || text.includes('duplicate')) {
          return error(`A server named "${name.trim()}" already exists`, 409);
        }
        throw new Error(`Failed to create: ${text}`);
      }

      const created = await response.json();
      const config = Array.isArray(created) ? created[0] : created;

      return json({
        success: true,
        config: {
          id: config.id,
          name: config.name,
          supabase_url: config.supabase_url,
          has_service_key: !!config.service_key_encrypted,
          created_at: config.created_at,
        },
      });
    } catch (err) {
      console.error('Create Supabase config error:', err);
      if (err instanceof Error && err.message.includes('already exists')) {
        return error(err.message, 409);
      }
      return error('Failed to save Supabase configuration', 500);
    }
  }

  // DELETE /api/user/supabase/:id - Delete a saved Supabase server
  const supabaseDeleteMatch = path.match(/^\/api\/user\/supabase\/([a-f0-9-]+)$/);
  if (supabaseDeleteMatch && method === 'DELETE') {
    try {
      const configId = supabaseDeleteMatch[1];
      const { SUPABASE_URL: SB_URL, SUPABASE_SERVICE_ROLE_KEY: SB_KEY } = getSupabaseEnv();

      // Verify ownership
      const checkRes = await fetch(
        `${SB_URL}/rest/v1/user_supabase_configs?id=eq.${configId}&user_id=eq.${userId}&select=id`,
        { headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}` } }
      );
      const checkData = await checkRes.json();
      if (!Array.isArray(checkData) || checkData.length === 0) {
        return error('Configuration not found', 404);
      }

      // Delete (cascade will SET NULL on apps.supabase_config_id)
      const response = await fetch(
        `${SB_URL}/rest/v1/user_supabase_configs?id=eq.${configId}&user_id=eq.${userId}`,
        {
          method: 'DELETE',
          headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}` },
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to delete: ${await response.text()}`);
      }

      return json({ success: true, message: 'Supabase server removed' });
    } catch (err) {
      console.error('Delete Supabase config error:', err);
      return error('Failed to delete Supabase configuration', 500);
    }
  }

  // ============================================
  // GET /api/user/usage - Get weekly usage stats
  // ============================================
  if (path === '/api/user/usage' && method === 'GET') {
    try {
      const { getWeeklyUsage } = await import('../services/weekly-calls.ts');
      const user = await userService.getUser(userId);
      const tier = user?.tier || 'free';
      const usage = await getWeeklyUsage(userId, tier);
      return json({
        count: usage.count,
      });
    } catch (err) {
      console.error('Get usage error:', err);
      return error('Failed to get usage stats', 500);
    }
  }

  // ============================================
  // GET /api/user/call-log - Get recent MCP call logs
  // ============================================
  if (path === '/api/user/call-log' && method === 'GET') {
    try {
      const { getRecentCalls } = await import('../services/call-logger.ts');
      const limit = parseInt(url.searchParams.get('limit') || '50', 10);
      const since = url.searchParams.get('since') || undefined;
      const appId = url.searchParams.get('app_id') || undefined;
      const logs = await getRecentCalls(userId, { limit: Math.min(limit, 200), since, appId });
      return json({ logs });
    } catch (err) {
      console.error('Get call log error:', err);
      return error('Failed to get call logs', 500);
    }
  }

  // ============================================
  // PERMISSIONS: Per-User App Permissions (Model B)
  // ============================================

  const permsMatch = path.match(/^\/api\/user\/permissions\/([a-f0-9-]+)$/);

  // GET /api/user/permissions/:appId - Get granted users + their permissions for an app
  if (permsMatch && method === 'GET') {
    try {
      const appId = permsMatch[1];
      const targetUserId = url.searchParams.get('user_id');
      const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = getSupabaseEnv();

      // Verify caller owns this app
      const appsService = createAppsService();
      const app = await appsService.findById(appId);
      if (!app || app.owner_id !== userId) {
        return error('App not found', 404);
      }

      if (targetUserId) {
        // Get permissions for a specific user on this app
        const response = await fetch(
          `${SUPABASE_URL}/rest/v1/user_app_permissions?app_id=eq.${appId}&granted_to_user_id=eq.${targetUserId}&select=id,function_name,allowed,allowed_args`,
          {
            headers: {
              'apikey': SUPABASE_SERVICE_ROLE_KEY,
              'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            },
          }
        );
        if (!response.ok) throw new Error(await response.text());
        const permissions = await response.json();
        return json({ permissions });
      } else {
        // Get all granted users for this app using the RPC
        const rpcRes = await fetch(
          `${SUPABASE_URL}/rest/v1/rpc/get_app_granted_users`,
          {
            method: 'POST',
            headers: {
              'apikey': SUPABASE_SERVICE_ROLE_KEY,
              'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ p_app_id: appId }),
          }
        );
        if (!rpcRes.ok) throw new Error(await rpcRes.text());
        const users = await rpcRes.json();

        // Also fetch pending invites
        const pendingRes = await fetch(
          `${SUPABASE_URL}/rest/v1/pending_permissions?app_id=eq.${appId}&allowed=eq.true&select=invited_email,function_name`,
          {
            headers: {
              'apikey': SUPABASE_SERVICE_ROLE_KEY,
              'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            },
          }
        );
        let pendingUsers: Array<{ email: string; display_name: null; function_count: number; status: string }> = [];
        if (pendingRes.ok) {
          const pendingRows = await pendingRes.json() as Array<{ invited_email: string; function_name: string }>;
          const pendingMap = new Map<string, { email: string; display_name: null; function_count: number; status: string }>();
          for (const row of pendingRows) {
            if (!pendingMap.has(row.invited_email)) {
              pendingMap.set(row.invited_email, { email: row.invited_email, display_name: null, function_count: 0, status: 'pending' });
            }
            pendingMap.get(row.invited_email)!.function_count++;
          }
          pendingUsers = Array.from(pendingMap.values());
        }

        return json({ users: [...users, ...pendingUsers] });
      }
    } catch (err) {
      console.error('Get permissions error:', err);
      return error('Failed to get permissions', 500);
    }
  }

  // PUT /api/user/permissions/:appId - Set permissions for a user on an app
  if (permsMatch && method === 'PUT') {
    try {
      const appId = permsMatch[1];
      const body = await request.json();
      const { email, user_id: targetUserId, permissions: permsList } = body;

      if (!Array.isArray(permsList)) {
        return error('permissions array required', 400);
      }

      const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = getSupabaseEnv();

      // Verify caller owns this app
      const appsService = createAppsService();
      const app = await appsService.findById(appId);
      if (!app || app.owner_id !== userId) {
        return error('App not found', 404);
      }

      // Resolve target user: either by user_id or email
      let resolvedUserId = targetUserId;
      if (!resolvedUserId && email) {
        const userRes = await fetch(
          `${SUPABASE_URL}/rest/v1/users?email=eq.${encodeURIComponent(email)}&select=id,tier`,
          {
            headers: {
              'apikey': SUPABASE_SERVICE_ROLE_KEY,
              'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            },
          }
        );
        if (!userRes.ok) throw new Error(await userRes.text());
        const userRows = await userRes.json();
        if (userRows.length === 0) {
          // User doesn't exist — create pending invite
          const pendingRows = permsList.map((p: { function_name: string; allowed: boolean }) => ({
            app_id: appId,
            invited_email: email.toLowerCase(),
            granted_by_user_id: userId,
            function_name: p.function_name,
            allowed: !!p.allowed,
          }));
          // Delete existing pending for this email+app
          await fetch(
            `${SUPABASE_URL}/rest/v1/pending_permissions?invited_email=eq.${encodeURIComponent(email.toLowerCase())}&app_id=eq.${appId}`,
            {
              method: 'DELETE',
              headers: { 'apikey': SUPABASE_SERVICE_ROLE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
            }
          );
          // Insert pending rows
          const hasAnyAllowed = pendingRows.some((p: { allowed: boolean }) => p.allowed);
          if (hasAnyAllowed) {
            await fetch(
              `${SUPABASE_URL}/rest/v1/pending_permissions`,
              {
                method: 'POST',
                headers: {
                  'apikey': SUPABASE_SERVICE_ROLE_KEY,
                  'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                  'Content-Type': 'application/json',
                  'Prefer': 'resolution=merge-duplicates',
                },
                body: JSON.stringify(pendingRows.filter((p: { allowed: boolean }) => p.allowed)),
              }
            );
          }
          return json({
            success: true,
            message: 'Invite created (user has not signed up yet)',
            status: 'pending',
            email,
          });
        }
        resolvedUserId = userRows[0].id;
      }

      if (!resolvedUserId) {
        return error('email or user_id is required', 400);
      }

      // Can't grant permissions to yourself (owner already has full access)
      if (resolvedUserId === userId) {
        return error('Cannot set permissions for the app owner', 400);
      }

      // Granular per-function permissions — available to all users
      const effectivePermsList = permsList;

      // Delete existing permissions for this user+app
      await fetch(
        `${SUPABASE_URL}/rest/v1/user_app_permissions?granted_to_user_id=eq.${resolvedUserId}&app_id=eq.${appId}`,
        {
          method: 'DELETE',
          headers: {
            'apikey': SUPABASE_SERVICE_ROLE_KEY,
            'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
        }
      );

      // Insert new permissions
      if (effectivePermsList.length > 0) {
        const rows = effectivePermsList.map((p: { function_name: string; allowed: boolean; allowed_args?: Record<string, unknown> | null }) => ({
          app_id: appId,
          granted_to_user_id: resolvedUserId,
          granted_by_user_id: userId,
          function_name: p.function_name,
          allowed: !!p.allowed,
          ...(p.allowed_args ? { allowed_args: p.allowed_args } : {}),
        }));

        const insertRes = await fetch(
          `${SUPABASE_URL}/rest/v1/user_app_permissions`,
          {
            method: 'POST',
            headers: {
              'apikey': SUPABASE_SERVICE_ROLE_KEY,
              'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(rows),
          }
        );

        if (!insertRes.ok) throw new Error(await insertRes.text());
      }

      // Invalidate permission cache for this user+app
      getPermissionCache().invalidateByUserAndApp(resolvedUserId, appId);

      return json({
        success: true,
        message: 'Permissions saved',
        user_id: resolvedUserId,
        granular: true,
      });
    } catch (err) {
      console.error('Set permissions error:', err);
      if (err instanceof Error && err.message.includes('No user found')) {
        return error(err.message, 404);
      }
      return error('Failed to save permissions', 500);
    }
  }

  // DELETE /api/user/permissions/:appId - Revoke all permissions for a user on an app
  if (permsMatch && method === 'DELETE') {
    try {
      const appId = permsMatch[1];
      const targetUserId = url.searchParams.get('user_id');
      const pendingEmail = url.searchParams.get('email');
      const isPending = url.searchParams.get('pending') === 'true';

      const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = getSupabaseEnv();

      // Verify caller owns this app
      const appsService = createAppsService();
      const app = await appsService.findById(appId);
      if (!app || app.owner_id !== userId) {
        return error('App not found', 404);
      }

      // Revoke pending invite by email
      if (isPending && pendingEmail) {
        await fetch(
          `${SUPABASE_URL}/rest/v1/pending_permissions?invited_email=eq.${encodeURIComponent(pendingEmail.toLowerCase())}&app_id=eq.${appId}`,
          {
            method: 'DELETE',
            headers: {
              'apikey': SUPABASE_SERVICE_ROLE_KEY,
              'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            },
          }
        );
        return json({ success: true, message: 'Pending invite revoked' });
      }

      if (!targetUserId) {
        return error('user_id query parameter required', 400);
      }

      // Delete all permissions for this user+app
      await fetch(
        `${SUPABASE_URL}/rest/v1/user_app_permissions?granted_to_user_id=eq.${targetUserId}&app_id=eq.${appId}`,
        {
          method: 'DELETE',
          headers: {
            'apikey': SUPABASE_SERVICE_ROLE_KEY,
            'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
        }
      );

      // Invalidate permission cache for this user+app
      getPermissionCache().invalidateByUserAndApp(targetUserId, appId);

      return json({ success: true, message: 'User access revoked' });
    } catch (err) {
      console.error('Revoke permissions error:', err);
      return error('Failed to revoke permissions', 500);
    }
  }

  // ============================================
  // HOSTING BALANCE
  // ============================================

  // GET /api/user/hosting — get hosting balance, usage, and auto-topup settings
  if (path === '/api/user/hosting' && method === 'GET') {
    try {
      const user = await authenticate(request);
      const { SUPABASE_URL: sbUrl, SUPABASE_SERVICE_ROLE_KEY: sbKey } = getSupabaseEnv();
      const userRes = await fetch(
        `${sbUrl}/rest/v1/users?id=eq.${user.id}&select=hosting_balance_cents,hosting_last_billed_at,auto_topup_enabled,auto_topup_threshold_cents,auto_topup_amount_cents,auto_topup_last_failed_at,stripe_customer_id`,
        {
          headers: {
            'apikey': sbKey,
            'Authorization': `Bearer ${sbKey}`,
          },
        }
      );
      if (!userRes.ok) throw new Error('Failed to read user');
      const rows = await userRes.json();
      if (rows.length === 0) return error('User not found', 404);
      const ud = rows[0];

      return json({
        hosting_balance_cents: ud.hosting_balance_cents ?? 0,
        hosting_last_billed_at: ud.hosting_last_billed_at ?? null,
        auto_topup: {
          enabled: ud.auto_topup_enabled ?? false,
          threshold_cents: ud.auto_topup_threshold_cents ?? 100,
          amount_cents: ud.auto_topup_amount_cents ?? 1000,
          last_failed_at: ud.auto_topup_last_failed_at ?? null,
        },
        has_payment_method: !!ud.stripe_customer_id,
      });
    } catch (err) {
      return error(err instanceof Error ? err.message : 'Unauthorized', 401);
    }
  }

  // PATCH /api/user/hosting/auto-topup — configure auto top-up settings
  // Body: { enabled?: boolean, threshold_cents?: number, amount_cents?: number }
  if (path === '/api/user/hosting/auto-topup' && method === 'PATCH') {
    try {
      const user = await authenticate(request);
      const body = await request.json() as {
        enabled?: boolean;
        threshold_cents?: number;
        amount_cents?: number;
      };

      const { SUPABASE_URL: sbUrl, SUPABASE_SERVICE_ROLE_KEY: sbKey } = getSupabaseEnv();

      // If enabling, verify user has a saved payment method (stripe_customer_id)
      if (body.enabled === true) {
        const custRes = await fetch(
          `${sbUrl}/rest/v1/users?id=eq.${user.id}&select=stripe_customer_id`,
          {
            headers: {
              'apikey': sbKey,
              'Authorization': `Bearer ${sbKey}`,
            },
          }
        );
        const custRows = await custRes.json();
        if (!custRows[0]?.stripe_customer_id) {
          return error(
            'No saved payment method. Make a deposit first to save your card, then enable auto top-up.',
            400
          );
        }
      }

      // Validate thresholds
      if (body.threshold_cents !== undefined) {
        if (typeof body.threshold_cents !== 'number' || body.threshold_cents < 0 || body.threshold_cents > 100_000) {
          return error('threshold_cents must be between 0 and 100000', 400);
        }
      }
      if (body.amount_cents !== undefined) {
        if (typeof body.amount_cents !== 'number' || body.amount_cents < 500 || body.amount_cents > 100_000) {
          return error('amount_cents must be between 500 ($5.00) and 100000 ($1000.00)', 400);
        }
      }

      // Build update payload
      const update: Record<string, unknown> = {};
      if (body.enabled !== undefined) update.auto_topup_enabled = body.enabled;
      if (body.threshold_cents !== undefined) update.auto_topup_threshold_cents = body.threshold_cents;
      if (body.amount_cents !== undefined) update.auto_topup_amount_cents = body.amount_cents;
      // If re-enabling, clear the last failure timestamp
      if (body.enabled === true) update.auto_topup_last_failed_at = null;

      if (Object.keys(update).length === 0) {
        return error('No fields to update. Provide enabled, threshold_cents, or amount_cents.', 400);
      }

      const updateRes = await fetch(
        `${sbUrl}/rest/v1/users?id=eq.${user.id}`,
        {
          method: 'PATCH',
          headers: {
            'apikey': sbKey,
            'Authorization': `Bearer ${sbKey}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal',
          },
          body: JSON.stringify(update),
        }
      );

      if (!updateRes.ok) throw new Error('Failed to update auto top-up settings');

      return json({ success: true, updated: update });
    } catch (err) {
      if (err instanceof SyntaxError) return error('Invalid JSON body', 400);
      return error(err instanceof Error ? err.message : 'Unauthorized', 401);
    }
  }

  // POST /api/user/hosting/checkout — create a Stripe Checkout session for hosting deposit
  // Body: { amount_cents: number } (minimum 500 = $5.00)
  // Returns: { checkout_url: string } or error if Stripe not configured
  if (path === '/api/user/hosting/checkout' && method === 'POST') {
    try {
      const user = await authenticate(request);
      const body = await request.json() as { amount_cents?: number };
      const amountCents = body.amount_cents;

      if (!amountCents || typeof amountCents !== 'number' || amountCents < 500) {
        return error('amount_cents must be at least 500 ($5.00 minimum deposit)', 400);
      }

      // @ts-ignore
      const Deno = globalThis.Deno;
      const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') || '';
      const BASE_URL = Deno.env.get('BASE_URL') || '';

      if (!STRIPE_SECRET_KEY) {
        return error(
          'Stripe is not yet configured. Hosting deposits will be available soon. ' +
          'In the meantime, contact support to add funds manually.',
          503
        );
      }

      // Ensure user has a Stripe Customer (create if needed) so payment method is saved
      const { SUPABASE_URL: sbUrl, SUPABASE_SERVICE_ROLE_KEY: sbKey } = getSupabaseEnv();
      const userDataRes = await fetch(
        `${sbUrl}/rest/v1/users?id=eq.${user.id}&select=stripe_customer_id,email`,
        {
          headers: {
            'apikey': sbKey,
            'Authorization': `Bearer ${sbKey}`,
          },
        }
      );
      if (!userDataRes.ok) throw new Error('Failed to read user');
      const userData = (await userDataRes.json())[0] as { stripe_customer_id: string | null; email: string };
      let stripeCustomerId = userData?.stripe_customer_id;

      if (!stripeCustomerId) {
        // Create Stripe Customer
        const custRes = await fetch('https://api.stripe.com/v1/customers', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            'email': userData.email || '',
            'metadata[user_id]': user.id,
            'metadata[platform]': 'ultralight',
          }).toString(),
        });

        if (!custRes.ok) {
          console.error('[STRIPE] Customer creation failed:', await custRes.text());
          return error('Failed to create payment profile', 500);
        }

        const customer = await custRes.json() as { id: string };
        stripeCustomerId = customer.id;

        // Save Stripe Customer ID to DB
        await fetch(
          `${sbUrl}/rest/v1/users?id=eq.${user.id}`,
          {
            method: 'PATCH',
            headers: {
              'apikey': sbKey,
              'Authorization': `Bearer ${sbKey}`,
              'Content-Type': 'application/json',
              'Prefer': 'return=minimal',
            },
            body: JSON.stringify({ stripe_customer_id: stripeCustomerId }),
          }
        );
      }

      // Calculate gross charge: deposit + Stripe fee pass-through
      const grossCents = calcGrossWithStripeFee(amountCents);
      const feeCents = grossCents - amountCents;

      // Create Stripe Checkout Session with card + ACH + Link
      // - Cards: setup_future_usage saves for off-session auto top-ups
      // - ACH (us_bank_account): lower fees (0.8% capped $5), Plaid bank-linking handled by Stripe
      // - Link: one-click checkout, remembers payment methods across Stripe merchants
      // - No tax at deposit — tax applies at service consumption (hosting/calls)
      // - metadata.amount_cents is the NET deposit credited to the user's balance
      const checkoutParams: Record<string, string> = {
        'mode': 'payment',
        'customer': stripeCustomerId,
        'payment_method_types[0]': 'card',
        'payment_method_types[1]': 'us_bank_account',
        'payment_method_types[2]': 'link',
        // Save card for future off-session charges (auto top-up)
        'payment_method_options[card][setup_future_usage]': 'off_session',
        // ACH: verification handled by Stripe/Plaid, mandate auto-created
        'payment_method_options[us_bank_account][financial_connections][permissions][0]': 'payment_method',
        'line_items[0][price_data][currency]': 'usd',
        'line_items[0][price_data][product_data][name]': 'Ultralight Hosting Deposit',
        'line_items[0][price_data][product_data][description]':
          `$${(amountCents / 100).toFixed(2)} hosting credit + $${(feeCents / 100).toFixed(2)} processing fee`,
        'line_items[0][price_data][unit_amount]': String(grossCents),
        'line_items[0][quantity]': '1',
        'metadata[user_id]': user.id,
        'metadata[amount_cents]': String(amountCents),
        'metadata[type]': 'hosting_deposit',
        'success_url': `${BASE_URL}/dash?topup=success&amount=${amountCents}`,
        'cancel_url': `${BASE_URL}/dash?topup=cancelled`,
      };

      const checkoutRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(checkoutParams).toString(),
      });

      if (!checkoutRes.ok) {
        const stripeErr = await checkoutRes.text();
        console.error('[STRIPE] Checkout session creation failed:', stripeErr);
        return error('Failed to create checkout session', 500);
      }

      const session = await checkoutRes.json() as { url: string; id: string };

      return json({
        checkout_url: session.url,
        session_id: session.id,
        deposit_cents: amountCents,
        processing_fee_cents: feeCents,
        charge_cents: grossCents,
      });
    } catch (err) {
      if (err instanceof SyntaxError) return error('Invalid JSON body', 400);
      return error(err instanceof Error ? err.message : 'Unauthorized', 401);
    }
  }

  // GET /api/user/earnings — aggregate earnings across all owned apps
  // Returns: { total_earned_cents, period_earned_cents, total_withdrawn_cents, withdrawable_cents, by_app: [...], recent: [...] }
  if (path === '/api/user/earnings' && method === 'GET') {
    try {
      const user = await authenticate(request);
      const { SUPABASE_URL: sbUrl, SUPABASE_SERVICE_ROLE_KEY: sbKey } = getSupabaseEnv();
      const headers = {
        'apikey': sbKey,
        'Authorization': `Bearer ${sbKey}`,
      };

      const url = new URL(request.url);
      const period = url.searchParams.get('period') || '30d';
      let periodDays = 30;
      if (period === '7d') periodDays = 7;
      else if (period === '90d') periodDays = 90;
      else if (period === 'all') periodDays = 3650;

      const cutoff = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000).toISOString();

      const [periodRes, lifetimeRes, recentRes, payoutsRes] = await Promise.all([
        fetch(
          `${sbUrl}/rest/v1/transfers?to_user_id=eq.${user.id}&created_at=gte.${cutoff}&select=amount_cents,app_id,function_name,reason,created_at&order=created_at.asc&limit=10000`,
          { headers }
        ),
        fetch(
          `${sbUrl}/rest/v1/transfers?to_user_id=eq.${user.id}&select=amount_cents`,
          { headers: { ...headers, 'Prefer': 'count=exact' } }
        ),
        fetch(
          `${sbUrl}/rest/v1/transfers?to_user_id=eq.${user.id}&select=amount_cents,app_id,function_name,reason,created_at&order=created_at.desc&limit=10`,
          { headers }
        ),
        // Total withdrawals including held (for withdrawable calculation)
        fetch(
          `${sbUrl}/rest/v1/payouts?user_id=eq.${user.id}&status=in.(held,pending,processing,paid)&select=amount_cents`,
          { headers }
        ),
      ]);

      if (!periodRes.ok || !lifetimeRes.ok || !recentRes.ok) {
        throw new Error('Failed to query transfers');
      }

      const periodTransfers = await periodRes.json() as Array<{
        amount_cents: number; app_id: string | null; function_name: string | null; reason: string; created_at: string;
      }>;
      const lifetimeTransfers = await lifetimeRes.json() as Array<{ amount_cents: number }>;
      const recentTransfers = await recentRes.json() as Array<{
        amount_cents: number; app_id: string | null; function_name: string | null; reason: string; created_at: string;
      }>;

      const totalEarnedCents = lifetimeTransfers.reduce((sum, t) => sum + t.amount_cents, 0);
      const periodEarnedCents = periodTransfers.reduce((sum, t) => sum + t.amount_cents, 0);

      // Calculate total withdrawn and withdrawable
      let totalWithdrawnCents = 0;
      if (payoutsRes.ok) {
        const payouts = await payoutsRes.json() as Array<{ amount_cents: number }>;
        totalWithdrawnCents = payouts.reduce((sum, p) => sum + p.amount_cents, 0);
      }
      const withdrawableCents = Math.max(0, totalEarnedCents - totalWithdrawnCents);

      // By-app breakdown
      const appMap = new Map<string, { earned_cents: number; call_count: number }>();
      for (const t of periodTransfers) {
        const key = t.app_id || 'unknown';
        const entry = appMap.get(key) || { earned_cents: 0, call_count: 0 };
        entry.earned_cents += t.amount_cents;
        entry.call_count += 1;
        appMap.set(key, entry);
      }
      const byApp = Array.from(appMap.entries())
        .map(([app_id, data]) => ({ app_id, ...data }))
        .sort((a, b) => b.earned_cents - a.earned_cents);

      return json({
        total_earned_cents: totalEarnedCents,
        total_withdrawn_cents: totalWithdrawnCents,
        withdrawable_cents: withdrawableCents,
        period,
        period_earned_cents: periodEarnedCents,
        period_transfers: periodTransfers.length,
        by_app: byApp,
        recent: recentTransfers.map(t => ({
          amount_cents: t.amount_cents,
          app_id: t.app_id,
          function_name: t.function_name,
          reason: t.reason,
          created_at: t.created_at,
        })),
      });
    } catch (err) {
      return error(err instanceof Error ? err.message : 'Unauthorized', 401);
    }
  }

  // ============================================
  // STRIPE CONNECT ENDPOINTS
  // ============================================

  // POST /api/user/connect/onboard — create or resume Stripe Connect onboarding
  // Returns: { onboarding_url: string, account_id: string }
  if (path === '/api/user/connect/onboard' && method === 'POST') {
    try {
      const user = await authenticate(request);
      const { SUPABASE_URL: sbUrl, SUPABASE_SERVICE_ROLE_KEY: sbKey } = getSupabaseEnv();

      // Get user's current connect state + email
      const userRes = await fetch(
        `${sbUrl}/rest/v1/users?id=eq.${user.id}&select=stripe_connect_account_id,email`,
        { headers: { 'apikey': sbKey, 'Authorization': `Bearer ${sbKey}` } }
      );
      if (!userRes.ok) throw new Error('Failed to read user');
      const userData = (await userRes.json())[0] as {
        stripe_connect_account_id: string | null;
        email: string;
      };

      const {
        createConnectedAccount, createOnboardingLink
      } = await import('../services/stripe-connect.ts');

      let accountId = userData?.stripe_connect_account_id;

      // Create a new connected account if none exists
      if (!accountId) {
        // Accept optional country for international developers (defaults to US)
        let country = 'US';
        try {
          const body = await request.json() as { country?: string };
          if (body.country && /^[A-Z]{2}$/.test(body.country)) {
            country = body.country;
          }
        } catch { /* no body or invalid JSON — use default */ }

        const result = await createConnectedAccount(userData.email, user.id, country);
        accountId = result.account_id;

        // Save the account ID to DB
        await fetch(`${sbUrl}/rest/v1/users?id=eq.${user.id}`, {
          method: 'PATCH',
          headers: {
            'apikey': sbKey,
            'Authorization': `Bearer ${sbKey}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal',
          },
          body: JSON.stringify({ stripe_connect_account_id: accountId }),
        });
      }

      // @ts-ignore
      const Deno = globalThis.Deno;
      const BASE_URL = Deno.env.get('BASE_URL') || '';

      const link = await createOnboardingLink(
        accountId,
        `${BASE_URL}/settings/billing?connect=complete`,
        `${BASE_URL}/settings/billing?connect=refresh`
      );

      return json({
        onboarding_url: link.url,
        account_id: accountId,
      });
    } catch (err) {
      const status = (err as Error & { status?: number }).status || 500;
      return error(err instanceof Error ? err.message : 'Failed to start onboarding', status);
    }
  }

  // GET /api/user/connect/status — check Stripe Connect onboarding status
  // Returns: { connected, onboarded, payouts_enabled, account_id, country, default_currency, withdrawable_earnings_cents }
  if (path === '/api/user/connect/status' && method === 'GET') {
    try {
      const user = await authenticate(request);
      const { SUPABASE_URL: sbUrl, SUPABASE_SERVICE_ROLE_KEY: sbKey } = getSupabaseEnv();
      const sbHeaders = { 'apikey': sbKey, 'Authorization': `Bearer ${sbKey}` };

      const userRes = await fetch(
        `${sbUrl}/rest/v1/users?id=eq.${user.id}&select=stripe_connect_account_id,stripe_connect_onboarded,stripe_connect_payouts_enabled,total_earned_cents`,
        { headers: sbHeaders }
      );
      if (!userRes.ok) throw new Error('Failed to read user');
      const userData = (await userRes.json())[0] as {
        stripe_connect_account_id: string | null;
        stripe_connect_onboarded: boolean;
        stripe_connect_payouts_enabled: boolean;
        total_earned_cents: number;
      };

      if (!userData?.stripe_connect_account_id) {
        return json({
          connected: false,
          onboarded: false,
          payouts_enabled: false,
          account_id: null,
          country: null,
          default_currency: null,
          withdrawable_earnings_cents: 0,
        });
      }

      // Calculate withdrawable earnings = total earned - total withdrawn (incl. held)
      const payoutsRes = await fetch(
        `${sbUrl}/rest/v1/payouts?user_id=eq.${user.id}&status=in.(held,pending,processing,paid)&select=amount_cents`,
        { headers: sbHeaders }
      );
      let totalWithdrawn = 0;
      if (payoutsRes.ok) {
        const payouts = await payoutsRes.json() as Array<{ amount_cents: number }>;
        totalWithdrawn = payouts.reduce((sum, p) => sum + p.amount_cents, 0);
      }
      const withdrawableEarnings = Math.max(0, (userData.total_earned_cents || 0) - totalWithdrawn);

      // If already fully set up, return cached values + earnings
      if (userData.stripe_connect_onboarded && userData.stripe_connect_payouts_enabled) {
        // Still fetch account status for country/currency info
        let country: string | null = null;
        let defaultCurrency: string | null = null;
        try {
          const { getAccountStatus } = await import('../services/stripe-connect.ts');
          const connectStatus = await getAccountStatus(userData.stripe_connect_account_id);
          country = connectStatus.country || null;
          defaultCurrency = connectStatus.default_currency || null;
        } catch { /* Stripe unavailable */ }

        return json({
          connected: true,
          onboarded: true,
          payouts_enabled: true,
          account_id: userData.stripe_connect_account_id,
          country: country,
          default_currency: defaultCurrency,
          is_cross_border: country !== null && country !== 'US',
          withdrawable_earnings_cents: withdrawableEarnings,
        });
      }

      // Otherwise refresh from Stripe API
      try {
        const { getAccountStatus } = await import('../services/stripe-connect.ts');
        const connectStatus = await getAccountStatus(userData.stripe_connect_account_id);

        // Update cached status in DB if changed
        if (
          connectStatus.onboarded !== userData.stripe_connect_onboarded ||
          connectStatus.payouts_enabled !== userData.stripe_connect_payouts_enabled
        ) {
          await fetch(`${sbUrl}/rest/v1/users?id=eq.${user.id}`, {
            method: 'PATCH',
            headers: {
              ...sbHeaders,
              'Content-Type': 'application/json',
              'Prefer': 'return=minimal',
            },
            body: JSON.stringify({
              stripe_connect_onboarded: connectStatus.onboarded,
              stripe_connect_payouts_enabled: connectStatus.payouts_enabled,
            }),
          });
        }

        return json({
          connected: true,
          onboarded: connectStatus.onboarded,
          payouts_enabled: connectStatus.payouts_enabled,
          details_submitted: connectStatus.details_submitted,
          account_id: userData.stripe_connect_account_id,
          country: connectStatus.country || null,
          default_currency: connectStatus.default_currency || null,
          is_cross_border: connectStatus.country !== undefined && connectStatus.country !== 'US',
          withdrawable_earnings_cents: withdrawableEarnings,
        });
      } catch (stripeErr) {
        // Stripe unavailable — return cached values
        return json({
          connected: true,
          onboarded: userData.stripe_connect_onboarded,
          payouts_enabled: userData.stripe_connect_payouts_enabled,
          account_id: userData.stripe_connect_account_id,
          country: null,
          default_currency: null,
          withdrawable_earnings_cents: withdrawableEarnings,
        });
      }
    } catch (err) {
      const status = (err as Error & { status?: number }).status || 500;
      return error(err instanceof Error ? err.message : 'Failed to check connect status', status);
    }
  }

  // POST /api/user/connect/withdraw — request a withdrawal to connected bank
  // Body: { amount_cents: number } (minimum 1000 = $10.00)
  // Only earned funds (tool_call, page_view, marketplace_sale) can be withdrawn — deposits cannot.
  // Withdrawals are held for 14 days before Stripe transfer is executed.
  // A 5% platform fee is deducted from the withdrawal amount.
  if (path === '/api/user/connect/withdraw' && method === 'POST') {
    try {
      const user = await authenticate(request);
      const body = await request.json() as { amount_cents?: number };
      const amountCents = body.amount_cents;

      const {
        MIN_WITHDRAWAL_CENTS, estimatePayoutFee, getAccountStatus,
        PLATFORM_FEE_PERCENT, PAYOUT_HOLD_DAYS,
      } = await import('../services/stripe-connect.ts');

      if (!amountCents || typeof amountCents !== 'number' || amountCents < MIN_WITHDRAWAL_CENTS) {
        return error(
          `amount_cents must be at least ${MIN_WITHDRAWAL_CENTS} ($${(MIN_WITHDRAWAL_CENTS / 100).toFixed(2)} minimum withdrawal)`,
          400
        );
      }

      const { SUPABASE_URL: sbUrl, SUPABASE_SERVICE_ROLE_KEY: sbKey } = getSupabaseEnv();
      const sbHeaders = { 'apikey': sbKey, 'Authorization': `Bearer ${sbKey}` };

      // Verify user has a connected, onboarded account with payouts enabled
      const userRes = await fetch(
        `${sbUrl}/rest/v1/users?id=eq.${user.id}&select=stripe_connect_account_id,stripe_connect_onboarded,stripe_connect_payouts_enabled,hosting_balance_cents,escrow_held_cents,total_earned_cents`,
        { headers: sbHeaders }
      );
      if (!userRes.ok) throw new Error('Failed to read user');
      const userData = (await userRes.json())[0] as {
        stripe_connect_account_id: string | null;
        stripe_connect_onboarded: boolean;
        stripe_connect_payouts_enabled: boolean;
        hosting_balance_cents: number;
        escrow_held_cents: number;
        total_earned_cents: number;
      };

      if (!userData?.stripe_connect_account_id || !userData?.stripe_connect_payouts_enabled) {
        return error(
          'Connect your bank account first. Use the Wallet page to complete Stripe onboarding.',
          400
        );
      }

      // Check available balance (balance minus escrowed)
      const available = (userData.hosting_balance_cents || 0) - (userData.escrow_held_cents || 0);
      if (available < amountCents) {
        return error(
          `Insufficient available balance. You have $${(available / 100).toFixed(2)} available (after escrow holds).`,
          400
        );
      }

      // Earnings-only withdrawal check (defense-in-depth — RPC also validates)
      const payoutsRes = await fetch(
        `${sbUrl}/rest/v1/payouts?user_id=eq.${user.id}&status=in.(held,pending,processing,paid)&select=amount_cents`,
        { headers: sbHeaders }
      );
      let totalWithdrawn = 0;
      if (payoutsRes.ok) {
        const payouts = await payoutsRes.json() as Array<{ amount_cents: number }>;
        totalWithdrawn = payouts.reduce((sum, p) => sum + p.amount_cents, 0);
      }
      const withdrawableEarnings = Math.max(0, (userData.total_earned_cents || 0) - totalWithdrawn);

      if (withdrawableEarnings < amountCents) {
        return error(
          `Only earned funds can be withdrawn (deposits cannot be cashed out). ` +
          `You have $${(withdrawableEarnings / 100).toFixed(2)} in withdrawable earnings.`,
          400
        );
      }

      // Calculate platform fee (5% of withdrawal)
      const platformFeeCents = Math.ceil(amountCents * PLATFORM_FEE_PERCENT);
      const amountAfterPlatformFee = amountCents - platformFeeCents;

      // Detect cross-border for Stripe fee estimation
      let isCrossBorder = false;
      try {
        const connectStatus = await getAccountStatus(userData.stripe_connect_account_id);
        isCrossBorder = connectStatus.country !== undefined && connectStatus.country !== 'US';
      } catch { /* Stripe unavailable — assume domestic */ }

      // Calculate Stripe fee estimate on the amount after platform fee
      const estimate = estimatePayoutFee(amountAfterPlatformFee, isCrossBorder);

      // Atomic debit + held payout record creation + earnings validation
      // Balance is debited immediately; Stripe transfer happens after 14-day hold
      const rpcRes = await fetch(`${sbUrl}/rest/v1/rpc/create_payout_record`, {
        method: 'POST',
        headers: {
          ...sbHeaders,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          p_user_id: user.id,
          p_amount_cents: amountCents,
          p_stripe_fee_cents: estimate.stripe_fee_cents,
          p_net_cents: estimate.net_cents,
          p_platform_fee_cents: platformFeeCents,
        }),
      });

      if (!rpcRes.ok) {
        const rpcErr = await rpcRes.text();
        console.error('[CONNECT] create_payout_record RPC failed:', rpcErr);
        if (rpcErr.includes('Insufficient')) return error('Insufficient balance for withdrawal', 400);
        if (rpcErr.includes('exceeds earnings')) return error('Withdrawal exceeds earned funds. Only earnings can be withdrawn — deposits cannot be cashed out.', 400);
        return error('Failed to create payout record', 500);
      }

      const payoutId = await rpcRes.json();

      // Calculate release date for user messaging
      const releaseDate = new Date(Date.now() + PAYOUT_HOLD_DAYS * 24 * 60 * 60 * 1000);
      const releaseDateStr = releaseDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

      const feeBreakdown = isCrossBorder
        ? `Platform fee: $${(platformFeeCents / 100).toFixed(2)} (5%) + Stripe fee: $${(estimate.stripe_fee_cents / 100).toFixed(2)} (incl. 2% FX)`
        : `Platform fee: $${(platformFeeCents / 100).toFixed(2)} (5%) + Stripe fee: $${(estimate.stripe_fee_cents / 100).toFixed(2)}`;

      return json({
        success: true,
        payout_id: payoutId,
        amount_cents: amountCents,
        platform_fee_cents: platformFeeCents,
        amount_after_platform_fee_cents: amountAfterPlatformFee,
        estimated_stripe_fee_cents: estimate.stripe_fee_cents,
        estimated_net_cents: estimate.net_cents,
        is_cross_border: isCrossBorder,
        status: 'held',
        release_at: releaseDate.toISOString(),
        hold_days: PAYOUT_HOLD_DAYS,
        message: `Withdrawal of $${(amountCents / 100).toFixed(2)} submitted. ` +
          `${feeBreakdown}. ` +
          `Estimated bank deposit: ~$${(estimate.net_cents / 100).toFixed(2)}. ` +
          `Payout will be released on ${releaseDateStr}.`,
      });
    } catch (err) {
      if (err instanceof SyntaxError) return error('Invalid JSON body', 400);
      const status = (err as Error & { status?: number }).status || 500;
      return error(err instanceof Error ? err.message : 'Withdrawal failed', status);
    }
  }

  // GET /api/user/connect/liability — platform liability summary (admin use)
  // Returns: total unpaid earnings, held payouts, processing payouts, sweepable amount
  if (path === '/api/user/connect/liability' && method === 'GET') {
    try {
      const user = await authenticate(request);
      const { SUPABASE_URL: sbUrl, SUPABASE_SERVICE_ROLE_KEY: sbKey } = getSupabaseEnv();
      const sbHeaders = { 'apikey': sbKey, 'Authorization': `Bearer ${sbKey}` };

      // Parallel queries for liability calculation
      const [earningsRes, paidRes, heldRes, processingRes, pendingRes] = await Promise.all([
        // Total earned across ALL users
        fetch(
          `${sbUrl}/rest/v1/users?total_earned_cents=gt.0&select=total_earned_cents`,
          { headers: sbHeaders }
        ),
        // Total successfully paid out
        fetch(
          `${sbUrl}/rest/v1/payouts?status=eq.paid&select=amount_cents`,
          { headers: sbHeaders }
        ),
        // Currently held (14-day wait)
        fetch(
          `${sbUrl}/rest/v1/payouts?status=eq.held&select=amount_cents,platform_fee_cents,release_at`,
          { headers: sbHeaders }
        ),
        // Currently processing (Stripe transfer in flight)
        fetch(
          `${sbUrl}/rest/v1/payouts?status=eq.processing&select=amount_cents,platform_fee_cents`,
          { headers: sbHeaders }
        ),
        // Pending (marked for release, not yet transferred)
        fetch(
          `${sbUrl}/rest/v1/payouts?status=eq.pending&select=amount_cents,platform_fee_cents`,
          { headers: sbHeaders }
        ),
      ]);

      const totalEarned = earningsRes.ok
        ? (await earningsRes.json() as Array<{ total_earned_cents: number }>)
            .reduce((sum, u) => sum + (u.total_earned_cents || 0), 0)
        : 0;

      const totalPaid = paidRes.ok
        ? (await paidRes.json() as Array<{ amount_cents: number }>)
            .reduce((sum, p) => sum + p.amount_cents, 0)
        : 0;

      const heldPayouts = heldRes.ok
        ? (await heldRes.json() as Array<{ amount_cents: number; platform_fee_cents: number; release_at: string }>)
        : [];
      const heldTotal = heldPayouts.reduce((sum, p) => sum + p.amount_cents, 0);
      const heldPlatformFees = heldPayouts.reduce((sum, p) => sum + (p.platform_fee_cents || 0), 0);

      // Next payout release date
      const nextRelease = heldPayouts.length > 0
        ? heldPayouts.reduce((earliest, p) => p.release_at < earliest ? p.release_at : earliest, heldPayouts[0].release_at)
        : null;

      const processingTotal = processingRes.ok
        ? (await processingRes.json() as Array<{ amount_cents: number }>)
            .reduce((sum, p) => sum + p.amount_cents, 0)
        : 0;

      const pendingTotal = pendingRes.ok
        ? (await pendingRes.json() as Array<{ amount_cents: number }>)
            .reduce((sum, p) => sum + p.amount_cents, 0)
        : 0;

      // Liability = total earned - total paid out = unpaid developer earnings
      const totalLiability = totalEarned - totalPaid;
      // Sweepable = everything NOT currently in-flight to Stripe
      // (held payouts are still in our accounts, not yet transferred)
      const inFlight = processingTotal + pendingTotal;
      const sweepable = totalLiability - inFlight;

      return json({
        total_earned_cents: totalEarned,
        total_paid_cents: totalPaid,
        total_liability_cents: totalLiability,
        held_payouts_cents: heldTotal,
        held_payouts_count: heldPayouts.length,
        held_platform_fees_cents: heldPlatformFees,
        next_release_at: nextRelease,
        processing_cents: processingTotal,
        pending_cents: pendingTotal,
        in_flight_cents: inFlight,
        sweepable_cents: sweepable,
        liability_dollars: '$' + (totalLiability / 100).toFixed(2),
        sweepable_dollars: '$' + (sweepable / 100).toFixed(2),
      });
    } catch (err) {
      return error(err instanceof Error ? err.message : 'Failed to calculate liability', 500);
    }
  }

  // GET /api/user/connect/payouts — payout history
  if (path === '/api/user/connect/payouts' && method === 'GET') {
    try {
      const user = await authenticate(request);
      const { SUPABASE_URL: sbUrl, SUPABASE_SERVICE_ROLE_KEY: sbKey } = getSupabaseEnv();
      const limit = parseInt(url.searchParams.get('limit') || '20', 10);

      const payoutsRes = await fetch(
        `${sbUrl}/rest/v1/payouts?user_id=eq.${user.id}&select=*&order=created_at.desc&limit=${Math.min(limit, 100)}`,
        { headers: { 'apikey': sbKey, 'Authorization': `Bearer ${sbKey}` } }
      );

      if (!payoutsRes.ok) throw new Error('Failed to query payouts');
      const payouts = await payoutsRes.json();

      return json({ payouts });
    } catch (err) {
      return error(err instanceof Error ? err.message : 'Failed to get payouts', 500);
    }
  }

  // ============================================
  // MARKETPLACE ENDPOINTS
  // ============================================

  // GET /api/marketplace/listing/:appId — listing + active bids for an app
  if (path.startsWith('/api/marketplace/listing/') && method === 'GET') {
    try {
      const appId = path.replace('/api/marketplace/listing/', '');
      if (!appId) return error('Missing app ID', 400);
      const { getListing } = await import('../services/marketplace.ts');
      const listing = await getListing(appId);
      return json(listing);
    } catch (err) {
      const status = (err as Error & { status?: number }).status || 500;
      return error(err instanceof Error ? err.message : 'Failed to get listing', status);
    }
  }

  // POST /api/marketplace/bid — place a bid
  if (path === '/api/marketplace/bid' && method === 'POST') {
    try {
      const body = await request.json();
      const { app_id, amount_cents, message, expires_in_hours } = body;
      if (!app_id || !amount_cents) return error('Missing app_id or amount_cents', 400);
      const { placeBid } = await import('../services/marketplace.ts');
      const result = await placeBid(userId, app_id, amount_cents, message, expires_in_hours);
      return json(result);
    } catch (err) {
      const status = (err as Error & { status?: number }).status || 500;
      return error(err instanceof Error ? err.message : 'Failed to place bid', status);
    }
  }

  // POST /api/marketplace/ask — set ask price
  if (path === '/api/marketplace/ask' && method === 'POST') {
    try {
      const body = await request.json();
      const { app_id, price_cents, floor_cents, instant_buy, note } = body;
      if (!app_id) return error('Missing app_id', 400);
      const { setAskPrice } = await import('../services/marketplace.ts');
      const result = await setAskPrice(userId, app_id, price_cents ?? null, floor_cents, instant_buy, note);
      return json(result);
    } catch (err) {
      const status = (err as Error & { status?: number }).status || 500;
      return error(err instanceof Error ? err.message : 'Failed to set ask price', status);
    }
  }

  // POST /api/marketplace/accept — accept a bid
  if (path === '/api/marketplace/accept' && method === 'POST') {
    try {
      const body = await request.json();
      const { bid_id } = body;
      if (!bid_id) return error('Missing bid_id', 400);
      const { acceptBid } = await import('../services/marketplace.ts');
      const result = await acceptBid(userId, bid_id);
      return json(result);
    } catch (err) {
      const status = (err as Error & { status?: number }).status || 500;
      return error(err instanceof Error ? err.message : 'Failed to accept bid', status);
    }
  }

  // POST /api/marketplace/reject — reject a bid
  if (path === '/api/marketplace/reject' && method === 'POST') {
    try {
      const body = await request.json();
      const { bid_id } = body;
      if (!bid_id) return error('Missing bid_id', 400);
      const { rejectBid } = await import('../services/marketplace.ts');
      await rejectBid(userId, bid_id);
      return json({ success: true, message: 'Bid rejected. Escrow refunded to bidder.' });
    } catch (err) {
      const status = (err as Error & { status?: number }).status || 500;
      return error(err instanceof Error ? err.message : 'Failed to reject bid', status);
    }
  }

  // POST /api/marketplace/cancel — cancel own bid
  if (path === '/api/marketplace/cancel' && method === 'POST') {
    try {
      const body = await request.json();
      const { bid_id } = body;
      if (!bid_id) return error('Missing bid_id', 400);
      const { cancelBid } = await import('../services/marketplace.ts');
      await cancelBid(userId, bid_id);
      return json({ success: true, message: 'Bid cancelled. Escrow refunded.' });
    } catch (err) {
      const status = (err as Error & { status?: number }).status || 500;
      return error(err instanceof Error ? err.message : 'Failed to cancel bid', status);
    }
  }

  // POST /api/marketplace/buy — instant buy
  if (path === '/api/marketplace/buy' && method === 'POST') {
    try {
      const body = await request.json();
      const { app_id } = body;
      if (!app_id) return error('Missing app_id', 400);
      const { buyNow } = await import('../services/marketplace.ts');
      const result = await buyNow(userId, app_id);
      return json(result);
    } catch (err) {
      const status = (err as Error & { status?: number }).status || 500;
      return error(err instanceof Error ? err.message : 'Failed to buy app', status);
    }
  }

  // GET /api/marketplace/offers — incoming + outgoing offers
  if (path === '/api/marketplace/offers' && method === 'GET') {
    try {
      const appId = url.searchParams.get('app_id') || undefined;
      const { getOffers } = await import('../services/marketplace.ts');
      const offers = await getOffers(userId, appId);
      return json(offers);
    } catch (err) {
      const status = (err as Error & { status?: number }).status || 500;
      return error(err instanceof Error ? err.message : 'Failed to get offers', status);
    }
  }

  // GET /api/marketplace/history — sale history
  if (path === '/api/marketplace/history' && method === 'GET') {
    try {
      const appId = url.searchParams.get('app_id') || undefined;
      const { getHistory } = await import('../services/marketplace.ts');
      const history = await getHistory(appId, userId);
      return json(history);
    } catch (err) {
      const status = (err as Error & { status?: number }).status || 500;
      return error(err instanceof Error ? err.message : 'Failed to get history', status);
    }
  }

  // PATCH /api/marketplace/metrics-visibility — toggle show_metrics on a listing (owner only)
  if (path === '/api/marketplace/metrics-visibility' && method === 'PATCH') {
    try {
      const body = await request.json();
      const appId = body.app_id;
      const showMetrics = body.show_metrics;

      if (!appId) return error('app_id required', 400);
      if (typeof showMetrics !== 'boolean') return error('show_metrics must be a boolean', 400);

      const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = getSupabaseEnv();
      const headers: Record<string, string> = {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      };

      // Verify ownership
      const appCheck = await fetch(
        `${SUPABASE_URL}/rest/v1/apps?id=eq.${appId}&owner_id=eq.${userId}&select=id`,
        { headers }
      );
      const appRows = appCheck.ok ? await appCheck.json() : [];
      if (appRows.length === 0) return error('App not found or not owned by you', 403);

      // Update listing
      const updateRes = await fetch(
        `${SUPABASE_URL}/rest/v1/app_listings?app_id=eq.${appId}`,
        {
          method: 'PATCH',
          headers: { ...headers, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
          body: JSON.stringify({ show_metrics: showMetrics }),
        }
      );

      if (!updateRes.ok) {
        // Listing may not exist yet — create it
        const createRes = await fetch(
          `${SUPABASE_URL}/rest/v1/app_listings`,
          {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
            body: JSON.stringify({ app_id: appId, owner_id: userId, show_metrics: showMetrics }),
          }
        );
        if (!createRes.ok) return error('Failed to update metrics visibility', 500);
      }

      return json({ app_id: appId, show_metrics: showMetrics });
    } catch (err) {
      return error(err instanceof Error ? err.message : 'Failed to update metrics visibility', 500);
    }
  }

  // GET /api/marketplace/metrics/:appId — get app metrics (if show_metrics enabled or owner)
  if (path.startsWith('/api/marketplace/metrics/') && method === 'GET') {
    try {
      const appId = path.replace('/api/marketplace/metrics/', '');
      if (!appId) return error('Missing app ID', 400);

      const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = getSupabaseEnv();
      const headers: Record<string, string> = {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      };

      // Check if metrics are enabled or caller is owner
      const [listingRes, appRes] = await Promise.all([
        fetch(
          `${SUPABASE_URL}/rest/v1/app_listings?app_id=eq.${appId}&select=show_metrics`,
          { headers }
        ),
        fetch(
          `${SUPABASE_URL}/rest/v1/apps?id=eq.${appId}&select=owner_id`,
          { headers }
        ),
      ]);

      const listings = listingRes.ok ? await listingRes.json() : [];
      const apps = appRes.ok ? await appRes.json() : [];
      const isOwner = apps[0]?.owner_id === userId;
      const metricsEnabled = listings[0]?.show_metrics === true;

      if (!isOwner && !metricsEnabled) {
        return error('Metrics are not enabled for this app', 403);
      }

      const { getAppMetrics } = await import('../services/marketplace.ts');
      const metrics = await getAppMetrics(appId);
      return json(metrics);
    } catch (err) {
      return error(err instanceof Error ? err.message : 'Failed to get metrics', 500);
    }
  }

  return error('User endpoint not found', 404);
}

// ============================================
// Hosting balance helper
// ============================================

/**
 * Credit a user's hosting balance and unsuspend content if needed.
 * Uses atomic Postgres RPC to prevent race conditions between
 * concurrent webhook calls and the billing loop.
 */
async function creditHostingBalance(
  userId: string,
  amountCents: number
): Promise<{
  previous_balance_cents: number;
  added_cents: number;
  new_balance_cents: number;
  unsuspended_apps: number;
  unsuspended_pages: number;
}> {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = getSupabaseEnv();

  // Atomic balance credit via Postgres function (no read-modify-write race)
  const rpcRes = await fetch(
    `${SUPABASE_URL}/rest/v1/rpc/credit_hosting_balance`,
    {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_user_id: userId,
        p_amount_cents: amountCents,
      }),
    }
  );

  if (!rpcRes.ok) {
    const err = await rpcRes.text();
    throw new Error(`Failed to credit balance: ${err}`);
  }

  const rows = await rpcRes.json() as Array<{ old_balance: number; new_balance: number }>;
  if (!rows || rows.length === 0) throw new Error('User not found');

  const { old_balance, new_balance } = rows[0];

  // If user had suspended content (balance was zero or negative), unsuspend it
  let unsuspended = { apps: 0, pages: 0 };
  if (old_balance <= 0) {
    unsuspended = await unsuspendContent(userId);
  }

  console.log(
    `[HOSTING] Credited ${amountCents}¢ to user ${userId}: ` +
    `${old_balance}¢ → ${new_balance}¢` +
    (unsuspended.apps + unsuspended.pages > 0
      ? `, unsuspended ${unsuspended.apps} app(s) + ${unsuspended.pages} page(s)`
      : '')
  );

  return {
    previous_balance_cents: old_balance,
    added_cents: amountCents,
    new_balance_cents: new_balance,
    unsuspended_apps: unsuspended.apps,
    unsuspended_pages: unsuspended.pages,
  };
}

// ============================================
// Stripe webhook signature verification
// ============================================

/**
 * Verify a Stripe webhook signature using HMAC-SHA256.
 * This avoids needing the Stripe SDK — just raw crypto.
 */
async function verifyStripeSignature(
  payload: string,
  signatureHeader: string,
  secret: string
): Promise<boolean> {
  try {
    // Parse the signature header: t=timestamp,v1=signature
    const parts = signatureHeader.split(',').reduce((acc, part) => {
      const [key, value] = part.split('=');
      acc[key] = value;
      return acc;
    }, {} as Record<string, string>);

    const timestamp = parts['t'];
    const expectedSig = parts['v1'];

    if (!timestamp || !expectedSig) return false;

    // Check timestamp tolerance (5 minutes)
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - parseInt(timestamp, 10)) > 300) return false;

    // Compute expected signature
    const signedPayload = `${timestamp}.${payload}`;
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedPayload));
    const computedSig = Array.from(new Uint8Array(sig))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    return computedSig === expectedSig;
  } catch (err) {
    console.error('[STRIPE] Signature verification failed:', err);
    return false;
  }
}

// ============================================
// Supabase env helper
// ============================================
function getSupabaseEnv(): { SUPABASE_URL: string; SUPABASE_SERVICE_ROLE_KEY: string } {
  // @ts-ignore - Deno is available
  const Deno = globalThis.Deno;
  return {
    SUPABASE_URL: Deno.env.get('SUPABASE_URL') || '',
    SUPABASE_SERVICE_ROLE_KEY: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
  };
}

// ============================================
// Helper: List user's saved Supabase servers
// ============================================
export async function listSupabaseConfigs(userId: string): Promise<Array<{
  id: string;
  name: string;
  supabase_url: string;
  has_service_key: boolean;
  created_at: string;
}>> {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = getSupabaseEnv();

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/user_supabase_configs?user_id=eq.${userId}&select=id,name,supabase_url,service_key_encrypted,created_at&order=created_at.asc`,
    {
      headers: {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to list configs: ${await response.text()}`);
  }

  const rows = await response.json() as Array<{
    id: string;
    name: string;
    supabase_url: string;
    service_key_encrypted: string | null;
    created_at: string;
  }>;

  return rows.map(r => ({
    id: r.id,
    name: r.name,
    supabase_url: r.supabase_url,
    has_service_key: !!r.service_key_encrypted,
    created_at: r.created_at,
  }));
}

// ============================================
// Helper: Get decrypted Supabase config by config ID
// Used by MCP/HTTP handlers at runtime
// ============================================
export async function getDecryptedSupabaseConfig(configId: string): Promise<{
  url: string;
  anonKey: string;
  serviceKey?: string;
} | null> {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = getSupabaseEnv();

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/user_supabase_configs?id=eq.${configId}&select=supabase_url,anon_key_encrypted,service_key_encrypted`,
    {
      headers: {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    }
  );

  if (!response.ok) return null;

  const rows = await response.json() as Array<{
    supabase_url: string;
    anon_key_encrypted: string;
    service_key_encrypted: string | null;
  }>;

  const config = rows[0];
  if (!config) return null;

  try {
    const anonKey = await decryptEnvVar(config.anon_key_encrypted);
    const result: { url: string; anonKey: string; serviceKey?: string } = {
      url: config.supabase_url,
      anonKey,
    };
    if (config.service_key_encrypted) {
      result.serviceKey = await decryptEnvVar(config.service_key_encrypted);
    }
    return result;
  } catch (err) {
    console.error('Failed to decrypt Supabase config:', err);
    return null;
  }
}

// Legacy aliases for backward compatibility during migration
export async function getUserPlatformSupabase(userId: string) {
  const configs = await listSupabaseConfigs(userId);
  const first = configs[0];
  return {
    configured: !!first,
    url: first?.supabase_url || null,
    has_anon_key: !!first,
    has_service_key: first?.has_service_key || false,
  };
}

export async function getDecryptedPlatformSupabase(userId: string) {
  const configs = await listSupabaseConfigs(userId);
  if (configs.length === 0) return null;
  return getDecryptedSupabaseConfig(configs[0].id);
}

// ============================================
// Helper: Check if user has access to a private app
// Used by MCP handlers for runtime permission enforcement
//
// Logic:
// - Owner always has full access (returns null = no restrictions)
// - For non-owners on private apps: returns Set of allowed function names
// - Empty set means user has no granted permissions (denied by default)
// - null means no restrictions (owner, or non-private app)
// ============================================

import type { PermissionRow } from '../../shared/types/index.ts';
import { getPermissionCache } from '../services/permission-cache.ts';

/** Result of getPermissionsForUser — includes constraint rows for runtime enforcement */
export interface PermissionsResult {
  allowed: Set<string>;
  /** Raw permission rows with constraint data (for IP/time/budget/expiry checks) */
  rows: PermissionRow[];
}

export async function getPermissionsForUser(
  callerUserId: string,
  appId: string,
  appOwnerId: string,
  appVisibility: string
): Promise<PermissionsResult | null> {
  // Owner always has full access
  if (callerUserId === appOwnerId) {
    return null; // No restrictions
  }

  // Published and unlisted apps: open to all authenticated users
  if (appVisibility === 'public' || appVisibility === 'unlisted') {
    return null; // No restrictions
  }

  // Check permission cache first
  const cache = getPermissionCache();
  const cached = cache.get(callerUserId, appId);
  if (cached) {
    return { allowed: cached.allowed, rows: cached.rows };
  }

  // Cache miss: fetch from Supabase
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = getSupabaseEnv();

  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/user_app_permissions?granted_to_user_id=eq.${callerUserId}&app_id=eq.${appId}&select=function_name,allowed,allowed_ips,time_window,budget_limit,budget_used,budget_period,expires_at,allowed_args,created_at,updated_at,granted_by_user_id,app_id,granted_to_user_id`,
    {
      headers: {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    }
  );

  if (!response.ok) {
    console.error('Failed to fetch user permissions:', await response.text());
    return { allowed: new Set<string>(), rows: [] }; // On error, deny access for safety
  }

  const rows = await response.json() as PermissionRow[];

  // If no permission rows exist, this user has no access to this private app
  if (rows.length === 0) {
    // Cache the empty result too — prevents repeated DB calls for unauthorized users
    cache.set(callerUserId, appId, new Set<string>(), []);
    return { allowed: new Set<string>(), rows: [] };
  }

  // Build set of allowed function names
  const allowed = new Set<string>();
  for (const row of rows) {
    if (row.allowed) {
      allowed.add(row.function_name);
    }
  }

  // Store in cache
  cache.set(callerUserId, appId, allowed, rows);

  return { allowed, rows };
}
