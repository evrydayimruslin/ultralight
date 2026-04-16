// User Service
// Handles user settings, BYOK configuration, and preferences

import type { BYOKProvider, BYOKConfig, User } from '../../shared/types/index.ts';
import { BYOK_PROVIDERS } from '../../shared/types/index.ts';
import { getEnv } from '../lib/env.ts';
import { decryptApiKey, encryptApiKey } from './api-key-crypto.ts';

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
  country: string | null;
  featured_app_id: string | null;
  profile_slug: string | null;
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
  country: string | null;
  featured_app_id: string | null;
  profile_slug: string | null;
  byok_enabled: boolean;
  byok_provider: string | null;
  byok_keys: Record<string, { encrypted_key?: string; model?: string; added_at?: string; [key: string]: unknown }> | null;
}

function isKnownByokProvider(provider: string): provider is BYOKProvider {
  return provider in BYOK_PROVIDERS;
}

export function createUserService(): UserService {
  // Direct REST API calls to Supabase

  async function getUser(userId: string): Promise<UserProfile | null> {
    const response = await fetch(
      `${getEnv('SUPABASE_URL')}/rest/v1/users?id=eq.${userId}&select=id,email,display_name,avatar_url,tier,country,featured_app_id,profile_slug,byok_enabled,byok_provider,byok_keys`,
      {
        headers: {
          'apikey': getEnv('SUPABASE_SERVICE_ROLE_KEY'),
          'Authorization': `Bearer ${getEnv('SUPABASE_SERVICE_ROLE_KEY')}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to get user: ${await response.text()}`);
    }

    const users = await response.json() as UserRow[];
    if (users.length === 0) return null;

    const user = users[0];
    const byokConfigs = parseByokConfigs(user.byok_keys);
    const configProviders = new Set(byokConfigs.map(config => config.provider));
    const primaryProvider = user.byok_provider && configProviders.has(user.byok_provider as BYOKProvider)
      ? user.byok_provider as BYOKProvider
      : byokConfigs[0]?.provider || null;

    return {
      id: user.id,
      email: user.email,
      display_name: user.display_name,
      avatar_url: user.avatar_url,
      tier: user.tier || 'free',
      country: user.country || null,
      featured_app_id: user.featured_app_id || null,
      profile_slug: user.profile_slug || null,
      byok_enabled: (user.byok_enabled || false) && byokConfigs.length > 0,
      byok_provider: primaryProvider,
      byok_configs: byokConfigs,
    };
  }

  async function updateUser(userId: string, updates: Partial<UserProfile>): Promise<UserProfile> {
    const response = await fetch(
      `${getEnv('SUPABASE_URL')}/rest/v1/users?id=eq.${userId}`,
      {
        method: 'PATCH',
        headers: {
          'apikey': getEnv('SUPABASE_SERVICE_ROLE_KEY'),
          'Authorization': `Bearer ${getEnv('SUPABASE_SERVICE_ROLE_KEY')}`,
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
    const addedAt = new Date().toISOString();

    // Get current user to merge configs
    const user = await getUser(userId);
    const currentKeys = await getRawByokKeys(userId);

    // Add new provider config
    const newKeys = {
      ...currentKeys,
      [provider]: {
        encrypted_key: encryptedKey,
        model,
        added_at: addedAt,
      },
    };

    // Update user with new config
    // If this is the first provider, set it as primary
    const isPrimaryUpdate = !user?.byok_provider || !isKnownByokProvider(user.byok_provider);

    await fetch(
      `${getEnv('SUPABASE_URL')}/rest/v1/users?id=eq.${userId}`,
      {
        method: 'PATCH',
        headers: {
          'apikey': getEnv('SUPABASE_SERVICE_ROLE_KEY'),
          'Authorization': `Bearer ${getEnv('SUPABASE_SERVICE_ROLE_KEY')}`,
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
      added_at: addedAt,
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
      `${getEnv('SUPABASE_URL')}/rest/v1/users?id=eq.${userId}`,
      {
        method: 'PATCH',
        headers: {
          'apikey': getEnv('SUPABASE_SERVICE_ROLE_KEY'),
          'Authorization': `Bearer ${getEnv('SUPABASE_SERVICE_ROLE_KEY')}`,
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
      added_at: updatedConfig.added_at || new Date(0).toISOString(),
    };
  }

  async function removeBYOKProvider(userId: string, provider: BYOKProvider): Promise<void> {
    const currentKeys = await getRawByokKeys(userId);
    const user = await getUser(userId);

    // Remove the provider
    delete currentKeys[provider];

    // If this was the primary provider, clear it or set a new one
    const remainingProviders = Object.entries(currentKeys)
      .filter(([provider, config]) => isKnownByokProvider(provider) && !!config.encrypted_key)
      .map(([provider]) => provider as BYOKProvider);
    const newPrimary = remainingProviders[0] || null;
    const byokEnabled = remainingProviders.length > 0;

    await fetch(
      `${getEnv('SUPABASE_URL')}/rest/v1/users?id=eq.${userId}`,
      {
        method: 'PATCH',
        headers: {
          'apikey': getEnv('SUPABASE_SERVICE_ROLE_KEY'),
          'Authorization': `Bearer ${getEnv('SUPABASE_SERVICE_ROLE_KEY')}`,
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
      `${getEnv('SUPABASE_URL')}/rest/v1/users?id=eq.${userId}`,
      {
        method: 'PATCH',
        headers: {
          'apikey': getEnv('SUPABASE_SERVICE_ROLE_KEY'),
          'Authorization': `Bearer ${getEnv('SUPABASE_SERVICE_ROLE_KEY')}`,
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
  async function getRawByokKeys(userId: string): Promise<Record<string, { encrypted_key?: string; model?: string; added_at?: string; [key: string]: unknown }>> {
    const response = await fetch(
      `${getEnv('SUPABASE_URL')}/rest/v1/users?id=eq.${userId}&select=byok_keys`,
      {
        headers: {
          'apikey': getEnv('SUPABASE_SERVICE_ROLE_KEY'),
          'Authorization': `Bearer ${getEnv('SUPABASE_SERVICE_ROLE_KEY')}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to get user: ${await response.text()}`);
    }

    const users = await response.json() as { byok_keys: Record<string, { encrypted_key?: string; model?: string; added_at?: string; [key: string]: unknown }> | null }[];
    return users[0]?.byok_keys || {};
  }

  // Helper to parse byok_keys into BYOKConfig array
  function parseByokConfigs(byokKeys: Record<string, { encrypted_key?: string; model?: string; added_at?: string; [key: string]: unknown }> | null): BYOKConfig[] {
    if (!byokKeys) return [];

    return Object.entries(byokKeys)
      .filter(([provider]) => isKnownByokProvider(provider))
      .map(([provider, config]) => ({
        provider: provider as BYOKProvider,
        has_key: !!config.encrypted_key,
        model: config.model,
        added_at: config.added_at || new Date(0).toISOString(),
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
