/**
 * API Token Service
 *
 * Handles creation, validation, and management of personal access tokens.
 * Tokens are generated with a secure random value, hashed for storage,
 * and the plaintext is shown only once during creation.
 *
 * Token format: ul_[32 random hex chars] = 36 chars total
 * Example: ul_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Token prefix for easy identification
const TOKEN_PREFIX = 'ul_';

export interface ApiToken {
  id: string;
  user_id: string;
  name: string;
  token_prefix: string;
  scopes: string[];
  /** App IDs this token is scoped to. null or ['*'] = all apps. */
  app_ids: string[] | null;
  /** Function names this token can call. null or ['*'] = all functions. */
  function_names: string[] | null;
  last_used_at: string | null;
  last_used_ip: string | null;
  expires_at: string | null;
  created_at: string;
}

export interface CreateTokenResult {
  token: ApiToken;
  plaintext_token: string; // Only returned on creation!
}

export interface ValidatedToken {
  user_id: string;
  token_id: string;
  scopes: string[];
  /** App IDs this token is restricted to. null = unrestricted. */
  app_ids: string[] | null;
  /** Function names this token can call. null = unrestricted. */
  function_names: string[] | null;
}

/**
 * Generate a cryptographically secure random token
 */
function generateToken(): string {
  const bytes = new Uint8Array(16); // 16 bytes = 32 hex chars
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `${TOKEN_PREFIX}${hex}`;
}

/**
 * Hash a token using SHA-256
 */
async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Create a new API token for a user.
 * All tiers have unlimited API tokens.
 */
export async function createToken(
  userId: string,
  name: string,
  options?: {
    expiresInDays?: number;
    scopes?: string[];
    app_ids?: string[];
    function_names?: string[];
  }
): Promise<CreateTokenResult> {
  // Check if token with this name already exists
  const { data: existing } = await supabase
    .from('user_api_tokens')
    .select('id')
    .eq('user_id', userId)
    .eq('name', name)
    .single();

  if (existing) {
    throw new Error(`Token with name "${name}" already exists`);
  }

  // Generate token
  const plaintextToken = generateToken();
  const tokenHash = await hashToken(plaintextToken);
  const tokenPrefix = plaintextToken.substring(0, 8); // "ul_xxxxx"

  // Calculate expiry if specified
  let expiresAt: string | null = null;
  if (options?.expiresInDays) {
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + options.expiresInDays);
    expiresAt = expiry.toISOString();
  }

  // Insert token
  const { data, error } = await supabase
    .from('user_api_tokens')
    .insert({
      user_id: userId,
      name,
      token_prefix: tokenPrefix,
      token_hash: tokenHash,
      scopes: options?.scopes || ['*'],
      app_ids: options?.app_ids || null,
      function_names: options?.function_names || null,
      expires_at: expiresAt,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create token: ${error.message}`);
  }

  return {
    token: data,
    plaintext_token: plaintextToken,
  };
}

/**
 * List all tokens for a user (without exposing hashes)
 */
export async function listTokens(userId: string): Promise<ApiToken[]> {
  const { data, error } = await supabase
    .from('user_api_tokens')
    .select('id, user_id, name, token_prefix, scopes, app_ids, function_names, last_used_at, last_used_ip, expires_at, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to list tokens: ${error.message}`);
  }

  return data || [];
}

/**
 * Revoke (delete) a token
 */
export async function revokeToken(userId: string, tokenId: string): Promise<void> {
  const { error } = await supabase
    .from('user_api_tokens')
    .delete()
    .eq('id', tokenId)
    .eq('user_id', userId); // Ensure user owns the token

  if (error) {
    throw new Error(`Failed to revoke token: ${error.message}`);
  }
}

/**
 * Revoke all tokens for a user
 */
export async function revokeAllTokens(userId: string): Promise<number> {
  const { data, error } = await supabase
    .from('user_api_tokens')
    .delete()
    .eq('user_id', userId)
    .select('id');

  if (error) {
    throw new Error(`Failed to revoke tokens: ${error.message}`);
  }

  return data?.length || 0;
}

/**
 * Revoke excess tokens when a user downgrades tier.
 * Keeps the most recently created tokens up to maxTokens,
 * revokes the rest. Returns the number of tokens revoked.
 */
export async function revokeExcessTokens(
  userId: string,
  maxTokens: number
): Promise<{ revoked_count: number; kept_count: number; revoked_names: string[] }> {
  // Get all tokens ordered by created_at descending (newest first)
  const { data: tokens, error: listErr } = await supabase
    .from('user_api_tokens')
    .select('id, name, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (listErr || !tokens) {
    console.error('revokeExcessTokens: failed to list tokens:', listErr);
    return { revoked_count: 0, kept_count: 0, revoked_names: [] };
  }

  if (tokens.length <= maxTokens) {
    return { revoked_count: 0, kept_count: tokens.length, revoked_names: [] };
  }

  // Keep the newest maxTokens, revoke the rest
  const tokensToRevoke = tokens.slice(maxTokens);
  const revokedNames: string[] = [];

  for (const token of tokensToRevoke) {
    const { error: revokeErr } = await supabase
      .from('user_api_tokens')
      .delete()
      .eq('id', token.id)
      .eq('user_id', userId);

    if (!revokeErr) {
      revokedNames.push(token.name);
    } else {
      console.error(`revokeExcessTokens: failed to revoke token ${token.id}:`, revokeErr);
    }
  }

  return {
    revoked_count: revokedNames.length,
    kept_count: maxTokens,
    revoked_names: revokedNames,
  };
}

/**
 * Validate a token and return user info if valid
 * This is called on every authenticated request
 */
export async function validateToken(
  token: string,
  clientIp?: string
): Promise<ValidatedToken | null> {
  // Quick format check
  if (!token.startsWith(TOKEN_PREFIX) || token.length !== 35) {
    return null;
  }

  const tokenPrefix = token.substring(0, 8);
  const tokenHash = await hashToken(token);

  // Look up token by prefix first (indexed), then verify hash
  const { data, error } = await supabase
    .from('user_api_tokens')
    .select('id, user_id, token_hash, scopes, app_ids, function_names, expires_at')
    .eq('token_prefix', tokenPrefix)
    .single();

  if (error || !data) {
    return null;
  }

  // Verify hash matches
  if (data.token_hash !== tokenHash) {
    return null;
  }

  // Check expiry
  if (data.expires_at && new Date(data.expires_at) < new Date()) {
    return null;
  }

  // Update last used (fire and forget - don't wait)
  supabase
    .from('user_api_tokens')
    .update({
      last_used_at: new Date().toISOString(),
      last_used_ip: clientIp || null,
    })
    .eq('id', data.id)
    .then(() => {}); // Ignore result

  return {
    user_id: data.user_id,
    token_id: data.id,
    scopes: data.scopes || ['*'],
    app_ids: data.app_ids || null,
    function_names: data.function_names || null,
  };
}

/**
 * Get user info from a validated token
 * Used by auth middleware to get full user context
 */
export async function getUserFromToken(token: string, clientIp?: string): Promise<{
  id: string;
  email: string;
  tier: string;
  tokenId: string;
  tokenAppIds?: string[] | null;
  tokenFunctionNames?: string[] | null;
} | null> {
  const validated = await validateToken(token, clientIp);
  if (!validated) {
    return null;
  }

  // Get user from database
  const { data: user, error } = await supabase
    .from('users')
    .select('id, email, tier')
    .eq('id', validated.user_id)
    .single();

  if (error || !user) {
    return null;
  }

  return {
    id: user.id,
    email: user.email,
    tier: user.tier || 'free',
    tokenId: validated.token_id,
    tokenAppIds: validated.app_ids,
    tokenFunctionNames: validated.function_names,
  };
}

/**
 * Check if a string looks like an API token (vs JWT)
 */
export function isApiToken(authValue: string): boolean {
  return authValue.startsWith(TOKEN_PREFIX);
}
