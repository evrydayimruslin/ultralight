// Per-tenant proof for data-worker (R2) access.
//
// The data worker (worker/src/index.ts) historically authorized /data/* on the
// shared X-Worker-Secret ALONE and then derived the R2 path from a
// caller-supplied appId/userId. That means anyone who could REPLAY WORKER_SECRET
// against the data worker's HTTP endpoint could read/write/delete ANY tenant's
// data. WORKER_SECRET has been (and structurally can be) exposed to sandboxes,
// so "holds the secret" is not a safe proxy for "is this tenant".
//
// Scope note: this binds the data-worker HTTP path (createWorkerAppDataService,
// used by the http/mcp/run handlers). The IN-SANDBOX data path is a SEPARATE
// surface, already defended differently: sandboxes never get WORKER_SECRET as a
// usable data key — they go through AppDataBinding (api/src/bindings/appdata-
// binding.ts), a host-side RPC whose appId/userId are host-set props, not
// sandbox input. This token closes the HTTP-replay surface.
//
// This binds each data-worker call to a short-lived HMAC token asserting the
// exact {appId, userId} the caller is authorized for. It is signed with
// DATA_TENANT_SECRET — deliberately NOT WORKER_SECRET and NEVER injected into a
// sandbox (same separation-of-secrets pattern as AGENT_CALLER_SECRET for caller
// context). So a WORKER_SECRET leak alone no longer grants cross-tenant access:
// an attacker would also need the tenant secret, whose only exposure is
// host-side mint here + verify in the data worker.
//
// The verify counterpart MUST stay algorithm-identical to the data worker's
// inline verifier (worker/src/index.ts). Keep this format (gxd1.<b64url>.<hex>)
// and the claims shape in lockstep across both.

import { getEnv } from "../lib/env.ts";

const TOKEN_PREFIX = "gxd1.";
const DEFAULT_TTL_SECONDS = 600; // 10 min — covers a long execution's data ops
const encoder = new TextEncoder();

export interface DataTenantClaims {
  v: 1;
  appId: string;
  userId: string | null;
  iat: number;
  exp: number;
}

// Both the API worker and the data worker MUST resolve the same secret. Keep the
// resolution identical (DATA_TENANT_SECRET, with a dev-only default). Production
// MUST set DATA_TENANT_SECRET in BOTH workers; the default is insecure-by-design
// for local dev only.
export const DATA_TENANT_DEV_SECRET = "galactic-dev-data-tenant-secret";

function getSecret(): string {
  return getEnv("DATA_TENANT_SECRET") || DATA_TENANT_DEV_SECRET;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const pad = value.length % 4 === 0 ? "" : "=".repeat(4 - (value.length % 4));
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacHex(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

export async function mintDataTenantToken(input: {
  appId: string;
  userId?: string | null;
  ttlSeconds?: number;
  nowMs?: number;
}): Promise<string> {
  const nowSec = Math.floor((input.nowMs ?? Date.now()) / 1000);
  const claims: DataTenantClaims = {
    v: 1,
    appId: input.appId,
    userId: input.userId ?? null,
    iat: nowSec,
    exp: nowSec + Math.max(1, Math.floor(input.ttlSeconds ?? DEFAULT_TTL_SECONDS)),
  };
  const encoded = bytesToBase64Url(encoder.encode(JSON.stringify(claims)));
  const signature = await hmacHex(encoded, getSecret());
  return `${TOKEN_PREFIX}${encoded}.${signature}`;
}

export interface VerifyDataTenantResult {
  valid: boolean;
  claims?: DataTenantClaims;
  reason?: "absent" | "malformed" | "bad_signature" | "expired";
}

export async function verifyDataTenantToken(
  token: string | null | undefined,
  nowMs = Date.now(),
): Promise<VerifyDataTenantResult> {
  if (!token || !token.startsWith(TOKEN_PREFIX)) return { valid: false, reason: "absent" };
  const body = token.slice(TOKEN_PREFIX.length);
  const dot = body.indexOf(".");
  if (dot <= 0) return { valid: false, reason: "malformed" };
  const encoded = body.slice(0, dot);
  const signature = body.slice(dot + 1);
  const expected = await hmacHex(encoded, getSecret());
  if (!timingSafeEqual(signature, expected)) return { valid: false, reason: "bad_signature" };
  let claims: DataTenantClaims;
  try {
    claims = JSON.parse(new TextDecoder().decode(base64UrlToBytes(encoded)));
  } catch {
    return { valid: false, reason: "malformed" };
  }
  if (claims.v !== 1 || typeof claims.appId !== "string") {
    return { valid: false, reason: "malformed" };
  }
  if (typeof claims.exp !== "number" || Math.floor(nowMs / 1000) > claims.exp) {
    return { valid: false, reason: "expired" };
  }
  if (claims.userId !== null && typeof claims.userId !== "string") {
    return { valid: false, reason: "malformed" };
  }
  return { valid: true, claims };
}
