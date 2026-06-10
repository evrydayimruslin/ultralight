import { getEnv } from '../../lib/env.ts';

interface SupabaseRestClientOptions {
  fetchFn?: typeof fetch;
}

function getBaseUrl(): string {
  const url = getEnv('SUPABASE_URL');
  if (!url) {
    throw new Error('SUPABASE_URL not configured');
  }
  return url;
}

function getServiceKey(): string {
  const key = getEnv('SUPABASE_SERVICE_ROLE_KEY');
  if (!key) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY not configured');
  }
  return key;
}

export function getSupabaseAdminHeaders(extra?: HeadersInit): HeadersInit {
  return {
    'apikey': getServiceKey(),
    'Authorization': `Bearer ${getServiceKey()}`,
    ...(extra || {}),
  };
}

export function createSupabaseRestClient(options?: SupabaseRestClientOptions) {
  const fetchFn = options?.fetchFn ?? fetch;
  const baseUrl = getBaseUrl();

  const request = (path: string, init?: RequestInit) => {
    return fetchFn(`${baseUrl}${path}`, {
      ...init,
      headers: {
        ...getSupabaseAdminHeaders(),
        ...(init?.headers || {}),
      },
    });
  };

  return {
    request,
    rpc(name: string, body: unknown) {
      return request(`/rest/v1/rpc/${name}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    },
    patch(path: string, body: unknown, prefer = 'return=minimal') {
      return request(path, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Prefer': prefer,
        },
        body: JSON.stringify(body),
      });
    },
    insert(path: string, body: unknown, prefer = 'return=minimal') {
      return request(path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Prefer': prefer,
        },
        body: JSON.stringify(body),
      });
    },
  };
}
