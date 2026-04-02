/**
 * API Token Service
 *
 * Handles creation, validation, and management of personal access tokens.
 * Tokens are generated with a secure random value, hashed for storage,
 * and the plaintext is shown only once during creation.
 *
 * Token format: ul_[32 random hex chars] = 35 chars total
 * Example: ul_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6
 */

import { createClient } from '@supabase/supabase-js';
import { getEnv } from '../lib/env.ts';

// Lazy Supabase client — CF Workers env not available at module init
let _supabase: ReturnType<typeof createClient>;
function getSupabase() {
  if (!_supabase) _supabase = createClient(getEnv('SUPABASE_URL'), getEnv('SUPABASE_SERVICE_ROLE_KEY'));
  return _supabase;
}

// Token prefix for easy identification
const TOKEN_PREFIX = 'ul_';

export interface ApiToken {
  id: string;
  user_id: string;
  name: string;
  token_prefix: string;
  plaintext_token: string | null;
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
 * Constant-time string comparison to prevent timing attacks on token hashes.
 * Uses XOR accumulation so execution time is independent of where strings differ.
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Hash a token using SHA-256 (legacy, unsalted — used for backward compat with old tokens)
 */
async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Hash a token with a per-token salt using HMAC-SHA256.
 * The salt acts as key material, making each token's hash unique even if tokens collide.
 */
async function hashTokenWithSalt(token: string, salt: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(salt),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(token));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Generate a random hex salt for token hashing (16 bytes = 32 hex chars).
 */
function generateTokenSalt(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
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
  const { data: existing } = await getSupabase()
    .from('user_api_tokens')
    .select('id')
    .eq('user_id', userId)
    .eq('name', name)
    .single();

  if (existing) {
    throw new Error(`Token with name "${name}" already exists`);
  }

  // Generate token with per-token salt
  const plaintextToken = generateToken();
  const tokenSalt = generateTokenSalt();
  const tokenHash = await hashTokenWithSalt(plaintextToken, tokenSalt);
  const tokenPrefix = plaintextToken.substring(0, 8); // "ul_xxxxx"

  // Calculate expiry if specified
  let expiresAt: string | null = null;
  if (options?.expiresInDays) {
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + options.expiresInDays);
    expiresAt = expiry.toISOString();
  }

  // Insert token (token_salt column enables per-token salted hashing)
  const insertPayload: Record<string, unknown> = {
    user_id: userId,
    name,
    token_prefix: tokenPrefix,
    token_hash: tokenHash,
    token_salt: tokenSalt,
    plaintext_token: plaintextToken,
    scopes: options?.scopes || ['*'],
    app_ids: options?.app_ids || null,
    function_names: options?.function_names || null,
    expires_at: expiresAt,
  };

  let { data, error } = await getSupabase()
    .from('user_api_tokens')
    .insert(insertPayload)
    .select()
    .single();

  // Fallback: if plaintext_token column doesn't exist yet, retry without it
  if (error && error.message?.includes('plaintext_token')) {
    delete insertPayload.plaintext_token;
    ({ data, error } = await getSupabase()
      .from('user_api_tokens')
      .insert(insertPayload)
      .select()
      .single());
  }

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
  let { data, error } = await getSupabase()
    .from('user_api_tokens')
    .select('id, user_id, name, token_prefix, plaintext_token, scopes, app_ids, function_names, last_used_at, last_used_ip, expires_at, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  // Fallback: if plaintext_token column doesn't exist yet, query without it
  if (error && error.message?.includes('plaintext_token')) {
    ({ data, error } = await getSupabase()
      .from('user_api_tokens')
      .select('id, user_id, name, token_prefix, scopes, app_ids, function_names, last_used_at, last_used_ip, expires_at, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false }));
  }

  if (error) {
    throw new Error(`Failed to list tokens: ${error.message}`);
  }

  return data || [];
}

/**
 * Revoke (delete) a token
 */
export async function revokeToken(userId: string, tokenId: string): Promise<void> {
  const { error } = await getSupabase()
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
  const { data, error } = await getSupabase()
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
 * Revoke a token by its plaintext value (used by OAuth revocation endpoint).
 * Looks up the token by prefix + hash verification, then deletes it.
 * Returns true if the token was found and revoked, false if not found.
 * Per RFC 7009, callers should return 200 OK regardless.
 */
export async function revokeByToken(token: string): Promise<boolean> {
  // Quick format check
  if (!token.startsWith(TOKEN_PREFIX) || token.length !== 35) {
    return false;
  }

  const tokenPrefix = token.substring(0, 8);

  // Look up by prefix (indexed), then verify hash with appropriate method
  const { data, error: lookupErr } = await getSupabase()
    .from('user_api_tokens')
    .select('id, token_hash, token_salt')
    .eq('token_prefix', tokenPrefix)
    .single();

  if (lookupErr || !data) {
    return false;
  }

  // Use salted hash if token has a salt, otherwise fall back to legacy unsalted SHA-256
  const tokenHash = data.token_salt
    ? await hashTokenWithSalt(token, data.token_salt)
    : await hashToken(token);

  if (!constantTimeEqual(data.token_hash, tokenHash)) {
    return false;
  }

  // Delete the token
  const { error: deleteErr } = await getSupabase()
    .from('user_api_tokens')
    .delete()
    .eq('id', data.id);

  if (deleteErr) {
    console.error('Failed to revoke token by value:', deleteErr);
    return false;
  }

  return true;
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
  const { data: tokens, error: listErr } = await getSupabase()
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
    const { error: revokeErr } = await getSupabase()
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
  if (!token.startsWith(TOKEN_PREFIX)) {
    console.log(`[TOKEN] Rejected: missing prefix "ul_" — got "${token.substring(0, 6)}..."`);
    return null;
  }
  if (token.length !== 35) {
    console.log(`[TOKEN] Rejected: wrong length — expected 35, got ${token.length} (prefix: ${token.substring(0, 8)})`);
    return null;
  }

  const tokenPrefix = token.substring(0, 8);
  console.log(`[TOKEN] Validating token with prefix: ${tokenPrefix}`);

  // Look up token by prefix first (indexed), then verify hash
  const { data, error } = await getSupabase()
    .from('user_api_tokens')
    .select('id, user_id, token_hash, token_salt, scopes, app_ids, function_names, expires_at')
    .eq('token_prefix', tokenPrefix)
    .single();

  if (error || !data) {
    console.log(`[TOKEN] Prefix lookup FAILED for "${tokenPrefix}" — error: ${error?.message || 'no rows'}, code: ${error?.code || 'n/a'}`);
    return null;
  }
  console.log(`[TOKEN] Prefix lookup OK — token_id: ${data.id}, user_id: ${data.user_id}, has_salt: ${!!data.token_salt}`);

  // Use salted hash if token has a salt, otherwise fall back to legacy unsalted SHA-256
  const tokenHash = data.token_salt
    ? await hashTokenWithSalt(token, data.token_salt)
    : await hashToken(token);

  // Verify hash matches (constant-time comparison)
  if (!constantTimeEqual(data.token_hash, tokenHash)) {
    console.log(`[TOKEN] Hash MISMATCH for token_id: ${data.id} (method: ${data.token_salt ? 'HMAC-SHA256' : 'SHA-256'})`);
    return null;
  }
  console.log(`[TOKEN] Hash verified OK for token_id: ${data.id}`);

  // Check expiry
  if (data.expires_at && new Date(data.expires_at) < new Date()) {
    console.log(`[TOKEN] EXPIRED — token_id: ${data.id}, expired_at: ${data.expires_at}`);
    return null;
  }

  // Update last used (fire and forget - don't wait)
  getSupabase()
    .from('user_api_tokens')
    .update({
      last_used_at: new Date().toISOString(),
      last_used_ip: clientIp || null,
    })
    .eq('id', data.id)
    .then(() => {}); // Ignore result

  console.log(`[TOKEN] Validation SUCCESS — token_id: ${data.id}, user_id: ${data.user_id}`);
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
  provisional?: boolean;
  tokenId: string;
  tokenAppIds?: string[] | null;
  tokenFunctionNames?: string[] | null;
  scopes?: string[];
} | null> {
  console.log(`[TOKEN] getUserFromToken called — token length: ${token.length}, prefix: ${token.substring(0, 8)}`);

  const validated = await validateToken(token, clientIp);
  if (!validated) {
    console.log(`[TOKEN] getUserFromToken: validateToken returned null`);
    return null;
  }

  // Get user from database (include provisional + last_active_at for expiry check)
  const { data: user, error } = await getSupabase()
    .from('users')
    .select('id, email, tier, provisional, last_active_at')
    .eq('id', validated.user_id)
    .single();

  if (error || !user) {
    console.log(`[TOKEN] getUserFromToken: user lookup FAILED for user_id: ${validated.user_id} — error: ${error?.message || 'no user found'}`);
    return null;
  }
  console.log(`[TOKEN] getUserFromToken: user found — email: ${user.email}, tier: ${user.tier}, provisional: ${user.provisional}`);

  // Reject expired provisional users (no MCP call in 24 hours)
  if (user.provisional && user.last_active_at) {
    const lastActive = new Date(user.last_active_at).getTime();
    const twentyFourHoursAgo = Date.now() - (24 * 60 * 60 * 1000);
    if (lastActive < twentyFourHoursAgo) {
      console.log(`[TOKEN] getUserFromToken: provisional user EXPIRED — last_active: ${user.last_active_at}`);
      return null; // Expired provisional — treat as invalid token
    }
  }

  console.log(`[TOKEN] getUserFromToken SUCCESS — user: ${user.id}, tier: ${user.tier}`);
  return {
    id: user.id,
    email: user.email,
    tier: user.tier || 'free',
    provisional: user.provisional || false,
    tokenId: validated.token_id,
    tokenAppIds: validated.app_ids,
    tokenFunctionNames: validated.function_names,
    scopes: validated.scopes,
  };
}

/**
 * Check if a string looks like an API token (vs JWT)
 */
export function isApiToken(authValue: string): boolean {
  return authValue.startsWith(TOKEN_PREFIX);
}
