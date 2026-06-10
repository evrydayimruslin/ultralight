import { getEnv } from '../lib/env.ts';
import { appendCookie, clearCookie, getCookieValueFromRequest } from './auth-cookies.ts';

const PAGE_SHARE_SESSION_PREFIX = 'ul_pss_';
const PAGE_SHARE_COOKIE_NAME = '__Secure-ul_page_share';
const PAGE_SHARE_SALT_LENGTH = 16;
const PAGE_SHARE_IV_LENGTH = 12;
const DEFAULT_PAGE_SHARE_TTL_SECONDS = 60 * 60 * 24 * 30;
const MAX_PAGE_SHARE_TTL_SECONDS = 60 * 60 * 24 * 30;

export interface PageShareSessionPayload {
  v: 1;
  aud: 'shared_page';
  content_id: string;
  owner_id: string;
  slug: string;
  access_token_hash: string;
  issued_at: number;
  expires_at: number;
  jti: string;
}

function encodeBase64Url(data: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...data));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const remainder = padded.length % 4;
  const normalized = remainder === 0 ? padded : `${padded}${'='.repeat(4 - remainder)}`;
  return Uint8Array.from(atob(normalized), (char) => char.charCodeAt(0));
}

async function derivePageShareKey(salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const normalizedSalt = Uint8Array.from(salt);
  const keyData = encoder.encode(`page-share-session:${getEnv('SUPABASE_SERVICE_ROLE_KEY')}`);
  const keyMaterial = await crypto.subtle.importKey('raw', keyData, 'PBKDF2', false, ['deriveKey']);
  return await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: normalizedSalt as BufferSource,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function clampTtlSeconds(ttlSeconds?: number | null): number {
  if (typeof ttlSeconds !== 'number' || !Number.isFinite(ttlSeconds)) {
    return DEFAULT_PAGE_SHARE_TTL_SECONDS;
  }
  return Math.max(60, Math.min(MAX_PAGE_SHARE_TTL_SECONDS, Math.floor(ttlSeconds)));
}

function parsePayload(value: unknown): PageShareSessionPayload | null {
  if (!value || typeof value !== 'object') return null;
  const payload = value as Record<string, unknown>;
  if (payload.v !== 1) return null;
  if (payload.aud !== 'shared_page') return null;
  if (typeof payload.content_id !== 'string' || !payload.content_id) return null;
  if (typeof payload.owner_id !== 'string' || !payload.owner_id) return null;
  if (typeof payload.slug !== 'string' || !payload.slug) return null;
  if (typeof payload.access_token_hash !== 'string' || !payload.access_token_hash) return null;
  if (typeof payload.issued_at !== 'number' || !Number.isFinite(payload.issued_at)) return null;
  if (typeof payload.expires_at !== 'number' || !Number.isFinite(payload.expires_at)) return null;
  if (typeof payload.jti !== 'string' || !payload.jti) return null;
  return payload as unknown as PageShareSessionPayload;
}

async function hashAccessToken(accessToken: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(accessToken),
  );
  return encodeBase64Url(new Uint8Array(digest));
}

export function getPageShareCookiePath(ownerId: string): string {
  return `/p/${ownerId}`;
}

export function buildSharedPageEntryUrl(input: {
  ownerUserId: string;
  slug: string;
  accessToken: string;
}): string {
  return `/share/p/${input.ownerUserId}/${input.slug}#share_token=${encodeURIComponent(input.accessToken)}`;
}

export async function issuePageShareSession(input: {
  contentId: string;
  ownerId: string;
  slug: string;
  accessToken: string;
  ttlSeconds?: number | null;
  nowMs?: number;
}): Promise<{ cookieValue: string; expiresIn: number }> {
  const nowMs = typeof input.nowMs === 'number' ? input.nowMs : Date.now();
  const effectiveTtl = clampTtlSeconds(input.ttlSeconds);
  const payload: PageShareSessionPayload = {
    v: 1,
    aud: 'shared_page',
    content_id: input.contentId,
    owner_id: input.ownerId,
    slug: input.slug,
    access_token_hash: await hashAccessToken(input.accessToken),
    issued_at: Math.floor(nowMs / 1000),
    expires_at: Math.floor(nowMs / 1000) + effectiveTtl,
    jti: crypto.randomUUID(),
  };

  const salt = crypto.getRandomValues(new Uint8Array(PAGE_SHARE_SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(PAGE_SHARE_IV_LENGTH));
  const key = await derivePageShareKey(salt);
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);

  const combined = new Uint8Array(PAGE_SHARE_SALT_LENGTH + PAGE_SHARE_IV_LENGTH + encrypted.byteLength);
  combined.set(salt);
  combined.set(iv, PAGE_SHARE_SALT_LENGTH);
  combined.set(new Uint8Array(encrypted), PAGE_SHARE_SALT_LENGTH + PAGE_SHARE_IV_LENGTH);

  return {
    cookieValue: `${PAGE_SHARE_SESSION_PREFIX}${encodeBase64Url(combined)}`,
    expiresIn: effectiveTtl,
  };
}

export async function appendPageShareSessionCookie(
  headers: Headers,
  input: {
    contentId: string;
    ownerId: string;
    slug: string;
    accessToken: string;
    ttlSeconds?: number | null;
    nowMs?: number;
  },
): Promise<{ expiresIn: number }> {
  const issued = await issuePageShareSession(input);
  appendCookie(headers, PAGE_SHARE_COOKIE_NAME, issued.cookieValue, {
    maxAge: issued.expiresIn,
    httpOnly: true,
    path: getPageShareCookiePath(input.ownerId),
  });
  return { expiresIn: issued.expiresIn };
}

export function clearPageShareSessionCookie(headers: Headers, ownerId: string): void {
  clearCookie(headers, PAGE_SHARE_COOKIE_NAME, {
    httpOnly: true,
    path: getPageShareCookiePath(ownerId),
  });
}

export async function readPageShareSessionFromRequest(
  request: Request,
  nowMs = Date.now(),
): Promise<PageShareSessionPayload | null> {
  const cookieValue = getCookieValueFromRequest(request, PAGE_SHARE_COOKIE_NAME);
  if (!cookieValue || !cookieValue.startsWith(PAGE_SHARE_SESSION_PREFIX)) {
    return null;
  }

  try {
    const encoded = cookieValue.slice(PAGE_SHARE_SESSION_PREFIX.length);
    const combined = decodeBase64Url(encoded);
    const salt = combined.slice(0, PAGE_SHARE_SALT_LENGTH);
    const iv = combined.slice(PAGE_SHARE_SALT_LENGTH, PAGE_SHARE_SALT_LENGTH + PAGE_SHARE_IV_LENGTH);
    const ciphertext = combined.slice(PAGE_SHARE_SALT_LENGTH + PAGE_SHARE_IV_LENGTH);
    const key = await derivePageShareKey(salt);
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    const payload = parsePayload(JSON.parse(new TextDecoder().decode(decrypted)));
    if (!payload) return null;
    if (payload.expires_at <= Math.floor(nowMs / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function hasValidPageShareSession(
  request: Request,
  expected: {
    contentId: string;
    ownerId: string;
    slug: string;
    accessToken: string | null;
  },
  nowMs = Date.now(),
): Promise<boolean> {
  if (!expected.accessToken) {
    return false;
  }

  const payload = await readPageShareSessionFromRequest(request, nowMs);
  if (!payload) {
    return false;
  }

  if (
    payload.content_id !== expected.contentId ||
    payload.owner_id !== expected.ownerId ||
    payload.slug !== expected.slug
  ) {
    return false;
  }

  return payload.access_token_hash === await hashAccessToken(expected.accessToken);
}
