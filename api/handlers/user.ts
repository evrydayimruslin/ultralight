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

  return error('User endpoint not found', 404);
}
