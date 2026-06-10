import { getEnv } from '../lib/env.ts';
import { decryptEnvVar } from './envvars.ts';

export interface UserSupabaseConfigSummary {
  id: string;
  name: string;
  supabase_url: string;
  has_service_key: boolean;
  created_at: string;
}

export interface DecryptedSupabaseConfig {
  url: string;
  anonKey: string;
  serviceKey?: string;
}

interface SupabaseConfigRow {
  supabase_url: string;
  anon_key_encrypted: string;
  service_key_encrypted: string | null;
}

interface SupabaseEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

interface SupabaseConfigDeps {
  fetchFn?: typeof fetch;
  decryptEnvVarFn?: typeof decryptEnvVar;
  env?: SupabaseEnv;
}

export function getSupabaseEnv(): SupabaseEnv {
  return {
    SUPABASE_URL: getEnv('SUPABASE_URL'),
    SUPABASE_SERVICE_ROLE_KEY: getEnv('SUPABASE_SERVICE_ROLE_KEY'),
  };
}

function getDeps(deps?: SupabaseConfigDeps): Required<SupabaseConfigDeps> {
  return {
    fetchFn: deps?.fetchFn ?? fetch,
    decryptEnvVarFn: deps?.decryptEnvVarFn ?? decryptEnvVar,
    env: deps?.env ?? getSupabaseEnv(),
  };
}

export async function listSupabaseConfigs(
  userId: string,
  deps?: SupabaseConfigDeps,
): Promise<UserSupabaseConfigSummary[]> {
  const { fetchFn, env } = getDeps(deps);
  const response = await fetchFn(
    `${env.SUPABASE_URL}/rest/v1/user_supabase_configs?user_id=eq.${userId}&select=id,name,supabase_url,service_key_encrypted,created_at&order=created_at.asc`,
    {
      headers: {
        'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    },
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

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    supabase_url: row.supabase_url,
    has_service_key: !!row.service_key_encrypted,
    created_at: row.created_at,
  }));
}

export async function getDecryptedSupabaseConfig(
  configId: string,
  deps?: SupabaseConfigDeps,
): Promise<DecryptedSupabaseConfig | null> {
  const { fetchFn, decryptEnvVarFn, env } = getDeps(deps);
  const response = await fetchFn(
    `${env.SUPABASE_URL}/rest/v1/user_supabase_configs?id=eq.${configId}&select=supabase_url,anon_key_encrypted,service_key_encrypted`,
    {
      headers: {
        'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    },
  );

  if (!response.ok) {
    return null;
  }

  const rows = await response.json() as SupabaseConfigRow[];
  const config = rows[0];
  if (!config) {
    return null;
  }

  try {
    const anonKey = await decryptEnvVarFn(config.anon_key_encrypted);
    const result: DecryptedSupabaseConfig = {
      url: config.supabase_url,
      anonKey,
    };
    if (config.service_key_encrypted) {
      result.serviceKey = await decryptEnvVarFn(config.service_key_encrypted);
    }
    return result;
  } catch (err) {
    console.error('Failed to decrypt Supabase config:', err);
    return null;
  }
}

export async function getDecryptedPlatformSupabase(
  userId: string,
  deps?: SupabaseConfigDeps,
): Promise<DecryptedSupabaseConfig | null> {
  const configs = await listSupabaseConfigs(userId, deps);
  if (configs.length === 0) {
    return null;
  }
  return await getDecryptedSupabaseConfig(configs[0].id, deps);
}
