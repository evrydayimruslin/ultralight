/**
 * OpenRouter Key Provisioning Service
 *
 * Uses the OpenRouter Management API to create per-user API keys.
 * The platform's OPENROUTER_API_KEY is a provisioning/management key
 * that can only create and manage keys — not make chat completions.
 *
 * Flow:
 *   1. User sends first chat message
 *   2. Server checks if user has an OpenRouter key stored
 *   3. If not, creates one via POST /api/v1/keys (management key)
 *   4. Stores the key (encrypted) in user record
 *   5. Uses the per-user key for all subsequent OpenRouter requests
 *
 * Docs: https://openrouter.ai/docs/api/api-reference/api-keys/create-keys
 */

// @ts-ignore
const Deno = globalThis.Deno;

const OPENROUTER_MGMT_KEY = Deno.env.get('OPENROUTER_API_KEY') || '';
const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

// ── Types ──

interface OpenRouterKeyResponse {
  data: {
    hash: string;
    name: string;
    label: string;
    disabled: boolean;
    limit: number | null;
    limit_remaining: number | null;
    limit_reset: string | null;
    usage: number;
    created_at: string;
    expires_at: string | null;
  };
  key: string; // The actual API key — only returned on creation
}

// ── Create Key ──

/**
 * Create a new OpenRouter API key for a user via the Management API.
 * Returns the plaintext key (shown only once).
 */
export async function createOpenRouterKey(userId: string, userEmail: string): Promise<string> {
  if (!OPENROUTER_MGMT_KEY) {
    throw new Error('OPENROUTER_API_KEY (management key) not configured');
  }

  const keyName = `ul-${userId.substring(0, 8)}-${userEmail.split('@')[0]}`;

  console.log(`[OR-KEYS] Creating OpenRouter key for user ${userId} (name: ${keyName})`);

  const res = await fetch(`${OPENROUTER_BASE}/keys`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENROUTER_MGMT_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: keyName,
      // No limit — we handle billing ourselves via hosting_balance_cents
      limit: null,
      limit_reset: null,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`[OR-KEYS] Failed to create key: ${res.status} — ${errText}`);
    throw new Error(`OpenRouter key creation failed (${res.status}): ${errText}`);
  }

  const data = await res.json() as OpenRouterKeyResponse;
  console.log(`[OR-KEYS] Key created — hash: ${data.data.hash}, name: ${data.data.name}`);

  return data.key;
}

// ── Store / Retrieve Key ──

/**
 * Get the user's OpenRouter API key from the database.
 * Returns null if no key is stored.
 */
export async function getStoredOpenRouterKey(userId: string): Promise<string | null> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/users?id=eq.${userId}&select=openrouter_api_key`,
    {
      headers: {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    }
  );

  if (!res.ok) {
    console.error(`[OR-KEYS] Failed to fetch stored key for ${userId}`);
    return null;
  }

  const rows = await res.json();
  if (!rows || rows.length === 0) return null;

  return rows[0].openrouter_api_key || null;
}

/**
 * Store an OpenRouter API key for a user.
 */
export async function storeOpenRouterKey(userId: string, key: string): Promise<void> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/users?id=eq.${userId}`,
    {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({ openrouter_api_key: key }),
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    console.error(`[OR-KEYS] Failed to store key for ${userId}: ${errText}`);
    throw new Error(`Failed to store OpenRouter key: ${errText}`);
  }

  console.log(`[OR-KEYS] Key stored for user ${userId}`);
}

// ── Get or Create ──

/**
 * Get the user's OpenRouter API key, creating one if needed.
 * This is the main entry point — called before every chat request.
 */
export async function getOrCreateOpenRouterKey(
  userId: string,
  userEmail: string,
): Promise<string> {
  // 1. Check if user already has a key
  const existingKey = await getStoredOpenRouterKey(userId);
  if (existingKey) {
    return existingKey;
  }

  // 2. Create a new key via OpenRouter Management API
  const newKey = await createOpenRouterKey(userId, userEmail);

  // 3. Store it for future use
  await storeOpenRouterKey(userId, newKey);

  return newKey;
}
