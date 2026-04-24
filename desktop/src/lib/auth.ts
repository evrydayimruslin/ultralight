import { invoke } from '@tauri-apps/api/core';

export interface DesktopOAuthOptions {
  forceAccountSelection?: boolean;
}

export interface DesktopEmbedBridgeSession {
  bridgeToken: string;
  expiresIn: number;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function generateSessionSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function buildDesktopLoginUrl(
  base: string,
  sessionId: string,
  sessionSecretHash: string,
  options: DesktopOAuthOptions = {},
): string {
  const loginUrl = new URL('/auth/login', base);
  loginUrl.searchParams.set('desktop_session', sessionId);
  loginUrl.searchParams.set('desktop_poll_secret_hash', sessionSecretHash);

  if (options.forceAccountSelection) {
    loginUrl.searchParams.set('prompt', 'select_account');
  }

  return loginUrl.toString();
}

export function buildDesktopEmbedUrl(
  base: string,
  path: string,
  bridgeToken: string | null,
  cacheKey: string | number,
): string {
  const url = new URL(path, base);
  url.searchParams.set('embed', '1');
  url.searchParams.set('_v', String(cacheKey));

  if (bridgeToken) {
    url.hash = `bridge_token=${encodeURIComponent(bridgeToken)}`;
  }

  return url.toString();
}

export async function requestDesktopEmbedBridgeToken(
  base: string,
  accessToken: string,
): Promise<DesktopEmbedBridgeSession> {
  const response = await fetch(new URL('/auth/embed/bridge', base), {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to create embed session (${response.status})`);
  }

  const data = await response.json() as {
    bridge_token?: unknown;
    expires_in?: unknown;
  };

  if (typeof data.bridge_token !== 'string' || !data.bridge_token) {
    throw new Error('Embed session response was missing bridge_token');
  }

  if (typeof data.expires_in !== 'number' || !Number.isFinite(data.expires_in)) {
    throw new Error('Embed session response was missing expires_in');
  }

  return {
    bridgeToken: data.bridge_token,
    expiresIn: data.expires_in,
  };
}

export async function openAuthUrl(url: string): Promise<void> {
  await invoke('open_auth_url', { url });
}
