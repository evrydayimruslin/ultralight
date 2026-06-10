import { getEnv } from '../lib/env.ts';

export type SupabaseSignOutScope = 'global' | 'local' | 'others';

const SIGN_OUT_IGNORE_STATUSES = new Set([401, 403, 404]);

function getSupabaseAuthHeaders(accessToken: string): Record<string, string> {
  return {
    'apikey': (getEnv('SUPABASE_ANON_KEY') || getEnv('SUPABASE_SERVICE_ROLE_KEY')),
    'Authorization': `Bearer ${accessToken}`,
  };
}

export async function revokeSupabaseSession(
  accessToken: string | null | undefined,
  scope: SupabaseSignOutScope = 'local',
): Promise<{ revoked: boolean; ignored: boolean; status: number | null }> {
  const token = typeof accessToken === 'string' ? accessToken.trim() : '';
  if (!token) {
    return { revoked: false, ignored: true, status: null };
  }

  const response = await fetch(
    `${getEnv('SUPABASE_URL')}/auth/v1/logout?scope=${encodeURIComponent(scope)}`,
    {
      method: 'POST',
      headers: getSupabaseAuthHeaders(token),
    },
  );

  if (response.ok) {
    return { revoked: true, ignored: false, status: response.status };
  }

  if (SIGN_OUT_IGNORE_STATUSES.has(response.status)) {
    return { revoked: false, ignored: true, status: response.status };
  }

  throw new Error(`Supabase sign-out failed (${response.status})`);
}
