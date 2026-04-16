import { getEnv } from '../lib/env.ts';
import { decryptApiKey, encryptApiKey } from './api-key-crypto.ts';

const DESKTOP_OAUTH_SESSION_TTL_MS = 5 * 60 * 1000;

interface DesktopOAuthSessionRow {
  access_token_encrypted: string;
}

function getSupabaseHeaders(contentType = false): Record<string, string> {
  const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');
  return {
    'apikey': serviceKey,
    'Authorization': `Bearer ${serviceKey}`,
    ...(contentType ? { 'Content-Type': 'application/json' } : {}),
  };
}

function getDesktopSessionsUrl(params?: URLSearchParams): string {
  const baseUrl = `${getEnv('SUPABASE_URL')}/rest/v1/desktop_oauth_sessions`;
  if (!params) return baseUrl;
  const query = params.toString();
  return query ? `${baseUrl}?${query}` : baseUrl;
}

async function hashDesktopPollSecret(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(secret),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function createDesktopOAuthSession(
  sessionId: string,
  pollSecretHash?: string | null,
): Promise<void> {
  cleanupExpiredDesktopOAuthSessions().catch(() => {});

  const response = await fetch(
    `${getDesktopSessionsUrl()}?on_conflict=session_id`,
    {
      method: 'POST',
      headers: {
        ...getSupabaseHeaders(true),
        'Prefer': 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({
        session_id: sessionId,
        poll_secret_hash: pollSecretHash || null,
        access_token_encrypted: null,
        completed_at: null,
        expires_at: new Date(Date.now() + DESKTOP_OAUTH_SESSION_TTL_MS).toISOString(),
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Failed to create desktop OAuth session (${response.status})`);
  }
}

export async function storeDesktopOAuthSessionToken(
  sessionId: string,
  accessToken: string,
): Promise<boolean> {
  const params = new URLSearchParams();
  params.set('session_id', `eq.${sessionId}`);
  params.set('expires_at', `gt.${new Date().toISOString()}`);
  params.set('select', 'session_id');

  const response = await fetch(
    getDesktopSessionsUrl(params),
    {
      method: 'PATCH',
      headers: {
        ...getSupabaseHeaders(true),
        'Prefer': 'return=representation',
      },
      body: JSON.stringify({
        access_token_encrypted: await encryptApiKey(accessToken),
        completed_at: new Date().toISOString(),
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Failed to store desktop OAuth session token (${response.status})`);
  }

  const rows = await response.json();
  return Array.isArray(rows) && rows.length > 0;
}

export async function consumeDesktopOAuthSession(
  sessionId: string,
  pollSecret?: string | null,
): Promise<string | null> {
  const params = new URLSearchParams();
  params.set('session_id', `eq.${sessionId}`);
  params.set('expires_at', `gt.${new Date().toISOString()}`);
  params.set('access_token_encrypted', 'not.is.null');
  params.set('poll_secret_hash', pollSecret
    ? `eq.${await hashDesktopPollSecret(pollSecret)}`
    : 'is.null');
  params.set('select', 'access_token_encrypted');

  const response = await fetch(
    getDesktopSessionsUrl(params),
    {
      method: 'DELETE',
      headers: {
        ...getSupabaseHeaders(),
        'Prefer': 'return=representation',
      },
    },
  );

  if (!response.ok) {
    throw new Error(`Failed to consume desktop OAuth session (${response.status})`);
  }

  const rows = await response.json() as DesktopOAuthSessionRow[];
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row?.access_token_encrypted) return null;

  return await decryptApiKey(row.access_token_encrypted);
}

async function cleanupExpiredDesktopOAuthSessions(): Promise<void> {
  const params = new URLSearchParams();
  params.set('expires_at', `lte.${new Date().toISOString()}`);

  await fetch(getDesktopSessionsUrl(params), {
    method: 'DELETE',
    headers: getSupabaseHeaders(),
  });
}
