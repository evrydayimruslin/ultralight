const ACCESS_COOKIE_NAME = '__Host-ul_session';
const REFRESH_COOKIE_NAME = '__Host-ul_refresh';
const REFRESH_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export interface CookieOptions {
  maxAge?: number;
  httpOnly?: boolean;
  path?: string;
}

function parseCookieHeader(cookieHeader: string | null): Record<string, string> {
  if (!cookieHeader) return {};

  return cookieHeader
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, part) => {
      const separatorIndex = part.indexOf('=');
      if (separatorIndex === -1) return acc;
      const key = part.slice(0, separatorIndex).trim();
      const value = part.slice(separatorIndex + 1).trim();
      if (!key) return acc;
      acc[key] = decodeURIComponent(value);
      return acc;
    }, {});
}

function buildCookie(name: string, value: string, options: CookieOptions = {}): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${options.path || '/'}`,
    'Secure',
    'SameSite=Lax',
  ];

  if (options.httpOnly !== false) {
    parts.push('HttpOnly');
  }
  if (typeof options.maxAge === 'number') {
    parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
  }

  return parts.join('; ');
}

export function getCookieValueFromRequest(request: Request, name: string): string | null {
  const cookies = parseCookieHeader(request.headers.get('cookie'));
  return cookies[name] || null;
}

export function appendCookie(headers: Headers, name: string, value: string, options: CookieOptions = {}): void {
  headers.append('Set-Cookie', buildCookie(name, value, options));
}

export function clearCookie(headers: Headers, name: string, options: CookieOptions = {}): void {
  headers.append('Set-Cookie', buildCookie(name, '', {
    ...options,
    maxAge: 0,
  }));
}

export function getAuthAccessTokenFromRequest(request: Request): string | null {
  return getCookieValueFromRequest(request, ACCESS_COOKIE_NAME);
}

export function getAuthRefreshTokenFromRequest(request: Request): string | null {
  return getCookieValueFromRequest(request, REFRESH_COOKIE_NAME);
}

export function appendAuthSessionCookies(
  headers: Headers,
  session: {
    accessToken: string;
    refreshToken?: string | null;
    accessTokenTtlSeconds?: number | null;
  },
): void {
  appendCookie(headers, ACCESS_COOKIE_NAME, session.accessToken, {
    maxAge: session.accessTokenTtlSeconds ?? undefined,
    httpOnly: true,
  });

  if (session.refreshToken) {
    appendCookie(headers, REFRESH_COOKIE_NAME, session.refreshToken, {
      maxAge: REFRESH_COOKIE_MAX_AGE_SECONDS,
      httpOnly: true,
    });
  }
}

export function clearAuthSessionCookies(headers: Headers): void {
  clearCookie(headers, ACCESS_COOKIE_NAME, { httpOnly: true });
  clearCookie(headers, REFRESH_COOKIE_NAME, { httpOnly: true });
}
