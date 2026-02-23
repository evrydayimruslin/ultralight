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

export async function handleUser(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // ============================================
  // UNAUTHENTICATED ROUTES (webhooks)
  // ============================================

  // POST /api/webhooks/stripe — handle Stripe webhook events
  // Verified by webhook signature, no auth token needed.
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
        type: string;
        data: {
          object: {
            metadata?: { user_id?: string; amount_cents?: string; type?: string };
            payment_status?: string;
          };
        };
      };

      // Handle checkout.session.completed (manual deposits)
      if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const eventUserId = session.metadata?.user_id;
        const amountCents = parseInt(session.metadata?.amount_cents || '0', 10);
        const depositType = session.metadata?.type;

        if (eventUserId && amountCents > 0 && depositType === 'hosting_deposit' && session.payment_status === 'paid') {
          console.log(`[STRIPE] Crediting ${amountCents} cents to user ${eventUserId}`);
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
          console.log(`[STRIPE] Auto top-up succeeded: crediting ${amountCents} cents to user ${eventUserId}`);
          await creditHostingBalance(eventUserId, amountCents);
        }
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

  // POST /api/user/hosting/topup — add funds to hosting balance
  // Body: { amount_cents: number }
  // Used internally after Stripe confirms payment. Can also be admin-triggered.
  if (path === '/api/user/hosting/topup' && method === 'POST') {
    try {
      const user = await authenticate(request);
      const body = await request.json() as { amount_cents?: number };
      const amountCents = body.amount_cents;

      if (!amountCents || typeof amountCents !== 'number' || amountCents <= 0) {
        return error('amount_cents must be a positive number', 400);
      }

      const result = await creditHostingBalance(user.id, amountCents);
      return json(result);
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
      // Tax (if enabled in Stripe dashboard) is calculated on top of this by Stripe
      const grossCents = calcGrossWithStripeFee(amountCents);
      const feeCents = grossCents - amountCents;

      // Create Stripe Checkout Session with customer + setup_future_usage + automatic tax
      // - setup_future_usage saves the payment method for off-session auto top-ups
      // - automatic_tax calculates sales tax on the gross amount (including fee)
      // - line item is the gross (deposit + processing fee); tax added on top by Stripe
      // - metadata.amount_cents is the NET deposit credited to the user's balance
      const checkoutParams: Record<string, string> = {
        'mode': 'payment',
        'customer': stripeCustomerId,
        'payment_method_types[0]': 'card',
        'payment_intent_data[setup_future_usage]': 'off_session',
        'automatic_tax[enabled]': 'true',
        'line_items[0][price_data][currency]': 'usd',
        'line_items[0][price_data][product_data][name]': 'Ultralight Hosting Deposit',
        'line_items[0][price_data][product_data][description]':
          `$${(amountCents / 100).toFixed(2)} hosting credit + $${(feeCents / 100).toFixed(2)} processing fee`,
        'line_items[0][price_data][unit_amount]': String(grossCents),
        'line_items[0][price_data][tax_behavior]': 'exclusive',
        'line_items[0][quantity]': '1',
        'metadata[user_id]': user.id,
        'metadata[amount_cents]': String(amountCents),
        'metadata[type]': 'hosting_deposit',
        'success_url': `${BASE_URL}/settings?topup=success&amount=${amountCents}`,
        'cancel_url': `${BASE_URL}/settings?topup=cancelled`,
      };

      // customer_update allows Stripe to collect/update the customer's address for tax
      checkoutParams['customer_update[address]'] = 'auto';

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
        // If automatic_tax fails (not configured), fall back without it
        if (stripeErr.includes('tax') || stripeErr.includes('Tax')) {
          console.warn('[STRIPE] Automatic tax not configured, retrying without it');
          delete checkoutParams['automatic_tax[enabled]'];
          delete checkoutParams['line_items[0][price_data][tax_behavior]'];
          delete checkoutParams['customer_update[address]'];
          const retryRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams(checkoutParams).toString(),
          });
          if (!retryRes.ok) {
            console.error('[STRIPE] Retry also failed:', await retryRes.text());
            return error('Failed to create checkout session', 500);
          }
          const fallbackSession = await retryRes.json() as { url: string; id: string };
          return json({
            checkout_url: fallbackSession.url,
            session_id: fallbackSession.id,
            deposit_cents: amountCents,
            processing_fee_cents: feeCents,
            charge_cents: grossCents,
            tax_note: 'Tax calculation unavailable — configure Stripe Tax in dashboard',
          });
        }
        return error('Failed to create checkout session', 500);
      }

      const session = await checkoutRes.json() as { url: string; id: string };

      return json({
        checkout_url: session.url,
        session_id: session.id,
        deposit_cents: amountCents,
        processing_fee_cents: feeCents,
        charge_cents: grossCents,
        tax: 'calculated at checkout by Stripe',
      });
    } catch (err) {
      if (err instanceof SyntaxError) return error('Invalid JSON body', 400);
      return error(err instanceof Error ? err.message : 'Unauthorized', 401);
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
