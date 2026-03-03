// Provisional User Service
// Handles creation, validation, merge, and cleanup of provisional (pre-auth) users.
// Provisional users get working API tokens without OAuth, enabling zero-friction onboarding.

import { createToken } from './tokens.ts';
import { checkRateLimit } from './ratelimit.ts';

// @ts-ignore - Deno is available
const Deno = globalThis.Deno;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

// ============================================
// CONSTANTS
// ============================================

const MAX_PROVISIONALS_PER_IP = 3;        // 3 provisional tokens per IP per day
const PROVISIONAL_DAILY_CALL_LIMIT = 50;  // 50 MCP calls/day hard limit
const PROVISIONAL_STORAGE_LIMIT = 5 * 1024 * 1024; // 5MB
const INACTIVITY_EXPIRY_MS = 24 * 60 * 60 * 1000;  // 24 hours

// ============================================
// TYPES
// ============================================

export interface ProvisionalCreateResult {
  id: string;
  token: string;     // Plaintext token (ul_xxx), shown once
  tokenId: string;
}

export interface MergeResult {
  apps_moved: number;
  tokens_moved: number;
  storage_transferred_bytes: number;
}

// ============================================
// PUBLIC API
// ============================================

/**
 * Create a new provisional user with a working API token.
 * Rate limited to 3 per IP per 24 hours.
 */
export async function createProvisionalUser(clientIp: string): Promise<ProvisionalCreateResult> {
  // Check IP rate limit
  const ipCount = await countProvisionalsByIp(clientIp);
  if (ipCount >= MAX_PROVISIONALS_PER_IP) {
    const err = new Error(`Rate limit: ${MAX_PROVISIONALS_PER_IP} provisional accounts per IP per day`);
    (err as any).status = 429;
    throw err;
  }

  // Generate a stable UUID for the provisional user
  const userId = crypto.randomUUID();
  const email = `provisional-${userId}@ultralight.local`;

  // 1. Create auth.users entry via Supabase Admin API (satisfies FK constraint)
  const randomPassword = Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map(b => b.toString(16).padStart(2, '0')).join('');

  const authResponse = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      id: userId,
      email: email,
      password: randomPassword,
      email_confirm: true,
    }),
  });

  if (!authResponse.ok) {
    const errText = await authResponse.text();
    console.error('[PROVISIONAL] Failed to create auth.users entry:', errText);
    throw new Error('Failed to create provisional user');
  }

  // 2. Create public.users entry
  const userInsertResponse = await fetch(`${SUPABASE_URL}/rest/v1/users`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify({
      id: userId,
      email: email,
      provisional: true,
      provisional_created_ip: clientIp,
      provisional_created_at: new Date().toISOString(),
      last_active_at: new Date().toISOString(),
      storage_limit_bytes: PROVISIONAL_STORAGE_LIMIT,
    }),
  });

  if (!userInsertResponse.ok) {
    const errText = await userInsertResponse.text();
    console.error('[PROVISIONAL] Failed to create public.users entry:', errText);
    // Rollback: delete auth.users entry
    await deleteAuthUser(userId);
    throw new Error('Failed to create provisional user record');
  }

  // 3. Create API token
  const tokenResult = await createToken(userId, 'Provisional Token', {
    expiresInDays: 30,
  });

  console.log(`[PROVISIONAL] Created provisional user ${userId} from IP ${clientIp}`);

  return {
    id: userId,
    token: tokenResult.plaintext_token,
    tokenId: tokenResult.token.id,
  };
}

/**
 * Check if a user is provisional.
 */
export async function isProvisionalUser(userId: string): Promise<boolean> {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/users?id=eq.${userId}&select=provisional`,
    {
      headers: {
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
      },
    }
  );

  if (!response.ok) return false;

  const data = await response.json();
  return data?.[0]?.provisional === true;
}

/**
 * Check provisional daily call limit using the existing rate limit system.
 * Uses a custom bucket "provisional_daily:{userId}" with 50 calls/day window.
 */
export async function checkProvisionalDailyLimit(userId: string) {
  return checkRateLimit(userId, `provisional_daily:${userId}`, PROVISIONAL_DAILY_CALL_LIMIT, 1440);
}

/**
 * Update last_active_at for a provisional user.
 * Fire-and-forget — does not await, does not throw.
 */
export function updateLastActive(userId: string): void {
  fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${userId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify({
      last_active_at: new Date().toISOString(),
    }),
  }).catch(err => {
    console.warn('[PROVISIONAL] Failed to update last_active_at:', err.message);
  });
}

/**
 * Check if a provisional user has expired (no activity in 24 hours).
 */
export function isProvisionalExpired(lastActiveAt: string | null): boolean {
  if (!lastActiveAt) return true;
  const lastActive = new Date(lastActiveAt).getTime();
  return (Date.now() - lastActive) > INACTIVITY_EXPIRY_MS;
}

/**
 * Merge a provisional user into a real (authenticated) user.
 * Transfers all apps, tokens, and storage. Deletes the provisional user.
 */
export async function mergeProvisionalUser(provisionalUserId: string, realUserId: string): Promise<MergeResult> {
  // Verify provisional user exists
  if (!await isProvisionalUser(provisionalUserId)) {
    throw new Error('Source user is not provisional');
  }

  // Prevent self-merge
  if (provisionalUserId === realUserId) {
    throw new Error('Cannot merge user into themselves');
  }

  // Call the merge RPC (atomic transfer)
  const rpcResponse = await fetch(`${SUPABASE_URL}/rest/v1/rpc/merge_provisional_user`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      p_provisional_id: provisionalUserId,
      p_real_id: realUserId,
    }),
  });

  if (!rpcResponse.ok) {
    const errText = await rpcResponse.text();
    console.error('[PROVISIONAL] Merge RPC failed:', errText);
    throw new Error('Failed to merge provisional user');
  }

  const result = await rpcResponse.json();

  // Check for RPC-level error
  if (result?.error) {
    throw new Error(result.error);
  }

  // Delete the provisional auth.users entry (cleanup)
  await deleteAuthUser(provisionalUserId);

  console.log(`[PROVISIONAL] Merged provisional ${provisionalUserId} → real ${realUserId}:`, result);

  return {
    apps_moved: result.apps_moved || 0,
    tokens_moved: result.tokens_moved || 0,
    storage_transferred_bytes: result.storage_transferred_bytes || 0,
  };
}

/**
 * Get the provisional storage limit in bytes.
 */
export function getProvisionalStorageLimit(): number {
  return PROVISIONAL_STORAGE_LIMIT;
}

/**
 * Get the provisional daily call limit.
 */
export function getProvisionalDailyCallLimit(): number {
  return PROVISIONAL_DAILY_CALL_LIMIT;
}

// ============================================
// INTERNAL HELPERS
// ============================================

/**
 * Count how many provisional users were created from this IP in the last 24 hours.
 */
async function countProvisionalsByIp(ip: string): Promise<number> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/count_provisional_by_ip`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_ip: ip }),
  });

  if (!response.ok) {
    console.warn('[PROVISIONAL] IP count RPC failed, defaulting to 0');
    return 0; // Fail-open: allow creation if RPC fails
  }

  const count = await response.json();
  return typeof count === 'number' ? count : 0;
}

/**
 * Delete an auth.users entry via Supabase Admin API.
 * Used for cleanup on creation failure and after merge.
 */
async function deleteAuthUser(userId: string): Promise<void> {
  try {
    await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
      },
    });
  } catch (err) {
    console.warn(`[PROVISIONAL] Failed to delete auth.users entry for ${userId}:`, err);
  }
}
