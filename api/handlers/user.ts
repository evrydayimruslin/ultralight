// User Settings Handler
// Handles user profile, BYOK configuration, and API token management

import { json, error } from './app.ts';
import { authenticate } from './auth.ts';
import { createUserService } from '../services/user.ts';
import { validateAPIKey } from '../services/ai.ts';
import { BYOK_PROVIDERS, type BYOKProvider } from '../../shared/types/index.ts';
import {
  createToken,
  listTokens,
  revokeToken,
  revokeAllTokens,
} from '../services/tokens.ts';
import { createAppsService } from '../services/apps.ts';
import { encryptEnvVar, decryptEnvVar } from '../services/envvars.ts';

export async function handleUser(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // All user endpoints require authentication
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
      const { name, expires_in_days } = body;

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

      const result = await createToken(userId, name.trim(), {
        expiresInDays: expires_in_days,
      });

      return json({
        success: true,
        token: {
          id: result.token.id,
          name: result.token.name,
          token_prefix: result.token.token_prefix,
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
        limit: usage.limit,
        tier,
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
      const logs = await getRecentCalls(userId, { limit: Math.min(limit, 200), since });
      return json({ logs });
    } catch (err) {
      console.error('Get call log error:', err);
      return error('Failed to get call logs', 500);
    }
  }

  return error('User endpoint not found', 404);
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
