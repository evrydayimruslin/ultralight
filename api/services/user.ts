// User Service
// Handles user settings, BYOK configuration, and preferences

import type { BYOKProvider, BYOKConfig, User } from '../../shared/types/index.ts';

// @ts-ignore - Deno is available
const Deno = globalThis.Deno;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

// Simple encryption for API keys using Web Crypto API
// In production, consider using a dedicated secrets manager
const ENCRYPTION_KEY = Deno.env.get('BYOK_ENCRYPTION_KEY') || 'ultralight-default-key-change-in-production';

// ============================================
// ENCRYPTION HELPERS
// ============================================

async function getEncryptionKey(): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(ENCRYPTION_KEY),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: encoder.encode('ultralight-salt'),
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptApiKey(apiKey: string): Promise<string> {
  const key = await getEncryptionKey();
  const encoder = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(apiKey)
  );

  // Combine IV and encrypted data, then base64 encode
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);

  return btoa(String.fromCharCode(...combined));
}

async function decryptApiKey(encryptedKey: string): Promise<string> {
  const key = await getEncryptionKey();
  const combined = Uint8Array.from(atob(encryptedKey), c => c.charCodeAt(0));

  const iv = combined.slice(0, 12);
  const data = combined.slice(12);

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    data
  );

  return new TextDecoder().decode(decrypted);
}

// ============================================
// USER SERVICE
// ============================================

export interface UserService {
  // User profile
  getUser(userId: string): Promise<UserProfile | null>;
  updateUser(userId: string, updates: Partial<UserProfile>): Promise<UserProfile>;

  // BYOK management
  getBYOKConfigs(userId: string): Promise<BYOKConfig[]>;
  addBYOKProvider(userId: string, provider: BYOKProvider, apiKey: string, model?: string): Promise<BYOKConfig>;
  updateBYOKProvider(userId: string, provider: BYOKProvider, updates: { apiKey?: string; model?: string }): Promise<BYOKConfig>;
  removeBYOKProvider(userId: string, provider: BYOKProvider): Promise<void>;
  setPrimaryProvider(userId: string, provider: BYOKProvider): Promise<void>;
  getDecryptedApiKey(userId: string, provider: BYOKProvider): Promise<string | null>;
}

export interface UserProfile {
  id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  tier: string;
  byok_enabled: boolean;
  byok_provider: BYOKProvider | null;
  byok_configs: BYOKConfig[];
}

// Database row structure
interface UserRow {
  id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  tier: string;
  byok_enabled: boolean;
  byok_provider: string | null;
  byok_keys: Record<string, { encrypted_key: string; model?: string; added_at: string }> | null;
}

export function createUserService(): UserService {
  // Direct REST API calls to Supabase

  async function getUser(userId: string): Promise<UserProfile | null> {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/users?id=eq.${userId}&select=id,email,display_name,avatar_url,tier,byok_enabled,byok_provider,byok_keys`,
      {
        headers: {
          'apikey': SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to get user: ${await response.text()}`);
    }

    const users = await response.json() as UserRow[];
    if (users.length === 0) return null;

    const user = users[0];
    return {
      id: user.id,
      email: user.email,
      display_name: user.display_name,
      avatar_url: user.avatar_url,
      tier: user.tier || 'free',
      byok_enabled: user.byok_enabled || false,
      byok_provider: user.byok_provider as BYOKProvider | null,
      byok_configs: parseByokConfigs(user.byok_keys),
    };
  }

  async function updateUser(userId: string, updates: Partial<UserProfile>): Promise<UserProfile> {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/users?id=eq.${userId}`,
      {
        method: 'PATCH',
        headers: {
          'apikey': SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation',
        },
        body: JSON.stringify({
          ...updates,
          updated_at: new Date().toISOString(),
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to update user: ${await response.text()}`);
    }

    const user = await getUser(userId);
    if (!user) throw new Error('User not found after update');
    return user;
  }

  async function getBYOKConfigs(userId: string): Promise<BYOKConfig[]> {
    const user = await getUser(userId);
    return user?.byok_configs || [];
  }

  async function addBYOKProvider(
    userId: string,
    provider: BYOKProvider,
    apiKey: string,
    model?: string
  ): Promise<BYOKConfig> {
    // Encrypt the API key
    const encryptedKey = await encryptApiKey(apiKey);

    // Get current user to merge configs
    const user = await getUser(userId);
    const currentKeys = await getRawByokKeys(userId);

    // Add new provider config
    const newKeys = {
      ...currentKeys,
      [provider]: {
        encrypted_key: encryptedKey,
        model,
        added_at: new Date().toISOString(),
      },
    };

    // Update user with new config
    // If this is the first provider, set it as primary
    const isPrimaryUpdate = !user?.byok_provider;

    await fetch(
      `${SUPABASE_URL}/rest/v1/users?id=eq.${userId}`,
      {
        method: 'PATCH',
        headers: {
          'apikey': SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          byok_keys: newKeys,
          byok_enabled: true,
          ...(isPrimaryUpdate ? { byok_provider: provider } : {}),
          updated_at: new Date().toISOString(),
        }),
      }
    );

    return {
      provider,
      has_key: true,
      model,
      added_at: newKeys[provider].added_at,
    };
  }

  async function updateBYOKProvider(
    userId: string,
    provider: BYOKProvider,
    updates: { apiKey?: string; model?: string }
  ): Promise<BYOKConfig> {
    const currentKeys = await getRawByokKeys(userId);

    if (!currentKeys[provider]) {
      throw new Error(`Provider ${provider} not configured`);
    }

    const updatedConfig = {
      ...currentKeys[provider],
      ...(updates.apiKey ? { encrypted_key: await encryptApiKey(updates.apiKey) } : {}),
      ...(updates.model !== undefined ? { model: updates.model } : {}),
    };

    const newKeys = {
      ...currentKeys,
      [provider]: updatedConfig,
    };

    await fetch(
      `${SUPABASE_URL}/rest/v1/users?id=eq.${userId}`,
      {
        method: 'PATCH',
        headers: {
          'apikey': SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          byok_keys: newKeys,
          updated_at: new Date().toISOString(),
        }),
      }
    );

    return {
      provider,
      has_key: true,
      model: updatedConfig.model,
      added_at: updatedConfig.added_at,
    };
  }

  async function removeBYOKProvider(userId: string, provider: BYOKProvider): Promise<void> {
    const currentKeys = await getRawByokKeys(userId);
    const user = await getUser(userId);

    // Remove the provider
    delete currentKeys[provider];

    // If this was the primary provider, clear it or set a new one
    const remainingProviders = Object.keys(currentKeys) as BYOKProvider[];
    const newPrimary = remainingProviders[0] || null;
    const byokEnabled = remainingProviders.length > 0;

    await fetch(
      `${SUPABASE_URL}/rest/v1/users?id=eq.${userId}`,
      {
        method: 'PATCH',
        headers: {
          'apikey': SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          byok_keys: Object.keys(currentKeys).length > 0 ? currentKeys : null,
          byok_provider: user?.byok_provider === provider ? newPrimary : user?.byok_provider,
          byok_enabled: byokEnabled,
          updated_at: new Date().toISOString(),
        }),
      }
    );
  }

  async function setPrimaryProvider(userId: string, provider: BYOKProvider): Promise<void> {
    const currentKeys = await getRawByokKeys(userId);

    if (!currentKeys[provider]) {
      throw new Error(`Provider ${provider} not configured`);
    }

    await fetch(
      `${SUPABASE_URL}/rest/v1/users?id=eq.${userId}`,
      {
        method: 'PATCH',
        headers: {
          'apikey': SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          byok_provider: provider,
          updated_at: new Date().toISOString(),
        }),
      }
    );
  }

  async function getDecryptedApiKey(userId: string, provider: BYOKProvider): Promise<string | null> {
    const currentKeys = await getRawByokKeys(userId);
    const config = currentKeys[provider];

    if (!config?.encrypted_key) {
      return null;
    }

    try {
      return await decryptApiKey(config.encrypted_key);
    } catch (error) {
      console.error('Failed to decrypt API key:', error);
      return null;
    }
  }

  // Helper to get raw byok_keys from database
  async function getRawByokKeys(userId: string): Promise<Record<string, { encrypted_key: string; model?: string; added_at: string }>> {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/users?id=eq.${userId}&select=byok_keys`,
      {
        headers: {
          'apikey': SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to get user: ${await response.text()}`);
    }

    const users = await response.json() as { byok_keys: Record<string, { encrypted_key: string; model?: string; added_at: string }> | null }[];
    return users[0]?.byok_keys || {};
  }

  // Helper to parse byok_keys into BYOKConfig array
  function parseByokConfigs(byokKeys: Record<string, { encrypted_key: string; model?: string; added_at: string }> | null): BYOKConfig[] {
    if (!byokKeys) return [];

    return Object.entries(byokKeys).map(([provider, config]) => ({
      provider: provider as BYOKProvider,
      has_key: !!config.encrypted_key,
      model: config.model,
      added_at: config.added_at,
    }));
  }

  return {
    getUser,
    updateUser,
    getBYOKConfigs,
    addBYOKProvider,
    updateBYOKProvider,
    removeBYOKProvider,
    setPrimaryProvider,
    getDecryptedApiKey,
  };
}
