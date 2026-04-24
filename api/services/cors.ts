type RuntimeEnvShape = {
  BASE_URL?: string;
  ENVIRONMENT?: string;
  CORS_ALLOWED_ORIGINS?: string;
};

export interface CorsConfigInput {
  baseUrl?: string | null;
  environment?: string | null;
  allowedOrigins?: string | readonly string[] | null;
}

const DEFAULT_ALLOW_METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';
const DEFAULT_ALLOW_HEADERS = 'Content-Type, Authorization, X-Requested-With';
const PREFLIGHT_MAX_AGE_SECONDS = '86400';
const TAURI_ALLOWED_ORIGINS = [
  'tauri://localhost',
  'https://tauri.localhost',
  'http://tauri.localhost',
] as const;
const LOCAL_DEV_ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:1420',
  'http://127.0.0.1:1420',
] as const;

function normalizeOrigin(origin: string | null | undefined): string | null {
  if (!origin) return null;
  const trimmed = origin.trim();
  if (!trimmed) return null;

  if (trimmed === 'tauri://localhost') return trimmed;

  try {
    return new URL(trimmed).origin;
  } catch {
    return null;
  }
}

function readRuntimeCorsConfig(): CorsConfigInput {
  const runtimeEnv = (globalThis as typeof globalThis & { __env?: RuntimeEnvShape }).__env;
  if (runtimeEnv) {
    return {
      baseUrl: runtimeEnv.BASE_URL ?? null,
      environment: runtimeEnv.ENVIRONMENT ?? null,
      allowedOrigins: runtimeEnv.CORS_ALLOWED_ORIGINS ?? null,
    };
  }

  const denoEnv = (globalThis as typeof globalThis & {
    Deno?: { env?: { get(key: string): string | undefined } };
  }).Deno?.env;
  if (!denoEnv?.get) return {};

  return {
    baseUrl: denoEnv.get('BASE_URL') ?? null,
    environment: denoEnv.get('ENVIRONMENT') ?? null,
    allowedOrigins: denoEnv.get('CORS_ALLOWED_ORIGINS') ?? null,
  };
}

function appendOrigin(set: Set<string>, origin: string | null | undefined): void {
  const normalized = normalizeOrigin(origin);
  if (normalized) {
    set.add(normalized);
  }
}

export function resolveAllowedCorsOrigins(
  config: CorsConfigInput = readRuntimeCorsConfig(),
): string[] {
  const allowed = new Set<string>();

  const configuredOrigins = Array.isArray(config.allowedOrigins)
    ? config.allowedOrigins
    : String(config.allowedOrigins || '').split(',');

  for (const origin of configuredOrigins) {
    appendOrigin(allowed, origin);
  }

  appendOrigin(allowed, config.baseUrl);

  for (const origin of TAURI_ALLOWED_ORIGINS) {
    allowed.add(origin);
  }

  const environment = (config.environment || '').trim().toLowerCase();
  if (environment !== 'production') {
    for (const origin of LOCAL_DEV_ALLOWED_ORIGINS) {
      allowed.add(origin);
    }
  }

  return Array.from(allowed);
}

function buildBaseCorsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Methods': DEFAULT_ALLOW_METHODS,
    'Access-Control-Allow-Headers': DEFAULT_ALLOW_HEADERS,
  };
}

function appendVaryHeader(headers: Headers, value: string): void {
  const existing = headers.get('Vary');
  if (!existing) {
    headers.set('Vary', value);
    return;
  }

  const parts = existing
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  if (!parts.includes(value)) {
    parts.push(value);
    headers.set('Vary', parts.join(', '));
  }
}

export function isCorsOriginAllowed(
  requestOrigin: string | null | undefined,
  config: CorsConfigInput = readRuntimeCorsConfig(),
): boolean {
  const normalized = normalizeOrigin(requestOrigin);
  if (!normalized) return true;
  return resolveAllowedCorsOrigins(config).includes(normalized);
}

export function buildCorsHeaders(
  request: Request,
  config: CorsConfigInput = readRuntimeCorsConfig(),
): Record<string, string> {
  const origin = normalizeOrigin(request.headers.get('Origin'));
  const headers = buildBaseCorsHeaders();

  if (!origin) {
    return headers;
  }

  if (!isCorsOriginAllowed(origin, config)) {
    return headers;
  }

  return {
    ...headers,
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
  };
}

export function applyCorsHeaders(
  headers: Headers,
  request: Request,
  config: CorsConfigInput = readRuntimeCorsConfig(),
): void {
  appendVaryHeader(headers, 'Origin');

  for (const [key, value] of Object.entries(buildCorsHeaders(request, config))) {
    headers.set(key, value);
  }
}

export function buildCorsPreflightResponse(
  request: Request,
  config: CorsConfigInput = readRuntimeCorsConfig(),
): Response {
  const headers = new Headers();
  applyCorsHeaders(headers, request, config);
  headers.set('Access-Control-Max-Age', PREFLIGHT_MAX_AGE_SECONDS);

  const origin = normalizeOrigin(request.headers.get('Origin'));
  if (origin && !isCorsOriginAllowed(origin, config)) {
    return new Response(null, { status: 403, headers });
  }

  return new Response(null, { status: 204, headers });
}
