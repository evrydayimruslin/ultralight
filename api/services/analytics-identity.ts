import { getEnv } from '../lib/env.ts';

const encoder = new TextEncoder();

export interface AnalyticsIdentity {
  anonUserId: string;
  pepperVersion: string;
}

export function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

export async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', toArrayBuffer(bytes));
  return bytesToHex(new Uint8Array(digest));
}

export function sha256Text(text: string): Promise<string> {
  return sha256Bytes(encoder.encode(text));
}

export function utf8ByteLength(text: string): number {
  return encoder.encode(text).byteLength;
}

function getAnalyticsPepper(
  explicitPepper?: string,
): { pepper: string; version: string } {
  const pepper = explicitPepper ||
    getEnv('ANALYTICS_PEPPER_V1') ||
    getEnv('CHAT_CAPTURE_PEPPER');

  if (!pepper) {
    throw new Error('Analytics identity pepper is not configured');
  }

  return {
    pepper,
    version: getEnv('ANALYTICS_PEPPER_VERSION') || 'v1',
  };
}

export async function getAnalyticsIdentity(
  userId: string,
  opts: { pepper?: string } = {},
): Promise<AnalyticsIdentity> {
  const { pepper, version } = getAnalyticsPepper(opts.pepper);
  const key = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(encoder.encode(pepper)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    toArrayBuffer(encoder.encode(userId)),
  );
  return {
    anonUserId: `anon_${bytesToHex(new Uint8Array(signature))}`,
    pepperVersion: version,
  };
}

export function isExplicitlyDisabled(value: string | undefined): boolean {
  if (!value) return false;
  return ['0', 'false', 'off', 'disabled', 'no'].includes(
    value.trim().toLowerCase(),
  );
}
