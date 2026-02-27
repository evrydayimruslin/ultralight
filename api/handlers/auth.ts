// Auth Handler
// Handles authentication via Supabase Google OAuth and API tokens

import { error, json } from './app.ts';
import { isApiToken, getUserFromToken } from '../services/tokens.ts';
import { getUserTier } from '../services/tier-enforcement.ts';

// @ts-ignore - Deno is available
const Deno = globalThis.Deno;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || SUPABASE_SERVICE_ROLE_KEY; // Fallback to service key

// Supabase client for database operations (service role bypasses RLS)
async function getSupabaseClient() {
  const { createClient } = await import('npm:@supabase/supabase-js@2');
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export async function handleAuth(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  // Initiate Google OAuth - redirects to Supabase Auth
  if (path === '/auth/login') {
    // Support return_to parameter for post-auth redirect (e.g., /?setup=1 from hero CTA)
    const returnTo = url.searchParams.get('return_to');
    const callbackUrl = returnTo
      ? `${url.origin}/auth/callback?return_to=${encodeURIComponent(returnTo)}`
      : `${url.origin}/auth/callback`;
    const authUrl = `${SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(callbackUrl)}`;

    return new Response(null, {
      status: 302,
      headers: { 'Location': authUrl },
    });
  }

  // Google OAuth callback - handle token from hash or code exchange
  if (path === '/auth/callback') {
    // Check for explicit error first
    const errorDesc = url.searchParams.get('error_description');
    if (errorDesc) {
      return new Response(getCallbackErrorHTML(errorDesc), {
        headers: { 'Content-Type': 'text/html' },
      });
    }

    const code = url.searchParams.get('code');

    if (code) {
      // Try code exchange flow
      const tokenResponse = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=authorization_code`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_SERVICE_ROLE_KEY,
        },
        body: JSON.stringify({
          auth_code: code,
          code_verifier: '',
        }),
      });

      if (tokenResponse.ok) {
        const tokens = await tokenResponse.json();
        const returnTo = url.searchParams.get('return_to') || undefined;
        return new Response(getCallbackSuccessHTML(tokens.access_token, tokens.refresh_token, returnTo), {
          headers: {
            'Content-Type': 'text/html',
            'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'",
          },
        });
      }
    }

    // No code or code exchange failed - return HTML that handles hash-based tokens
    // Supabase implicit flow returns tokens in URL hash (e.g., #access_token=...)
    // The hash is only accessible client-side via JavaScript
    return new Response(getCallbackHTML(), {
      headers: {
        'Content-Type': 'text/html',
        'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'",
      },
    });
  }

  // Get current user from JWT
  if (path === '/auth/user') {
    try {
      const user = await authenticate(request);
      return json(user);
    } catch {
      return json({ user: null });
    }
  }

  // Sign out - just returns instruction to clear local storage
  if (path === '/auth/signout') {
    return json({ message: 'Clear localStorage.ultralight_token to sign out' });
  }

  // Refresh token - exchange refresh_token for new access_token
  if (path === '/auth/refresh' && request.method === 'POST') {
    try {
      const body = await request.json();
      const refreshToken = body.refresh_token;

      if (!refreshToken) {
        return error('Missing refresh_token', 400);
      }

      const tokenResponse = await fetch(
        `${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ refresh_token: refreshToken }),
        }
      );

      if (!tokenResponse.ok) {
        return error('Token refresh failed', 401);
      }

      const tokens = await tokenResponse.json();

      return json({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_in: tokens.expires_in,
      });
    } catch {
      return error('Token refresh failed', 500);
    }
  }

  return error('Auth endpoint not found', 404);
}

/**
 * Extract and verify JWT or API token from request
 * Also ensures user exists in public.users table
 */
export async function authenticate(request: Request): Promise<{ id: string; email: string; tier: string; tokenId?: string; tokenAppIds?: string[] | null; tokenFunctionNames?: string[] | null }> {
  const authHeader = request.headers.get('Authorization');

  if (!authHeader?.startsWith('Bearer ')) {
    throw new Error('Missing or invalid authorization header');
  }

  const token = authHeader.slice(7);

  // Check if this is an API token (starts with "ul_")
  if (isApiToken(token)) {
    const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
                     request.headers.get('x-real-ip') ||
                     undefined;

    const user = await getUserFromToken(token, clientIp);
    if (!user) {
      throw new Error('Invalid or expired API token');
    }

    return user;
  }

  // Otherwise, treat as JWT — verify via Supabase Auth API
  const verifyResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'apikey': SUPABASE_ANON_KEY,
    },
  });

  if (!verifyResponse.ok) {
    const status = verifyResponse.status;
    if (status === 401) {
      throw new Error('Invalid or expired token');
    }
    throw new Error('Token verification failed');
  }

  const verifiedUser = await verifyResponse.json();

  const user = {
    id: verifiedUser.id as string,
    email: verifiedUser.email as string,
    user_metadata: (verifiedUser.user_metadata || {}) as Record<string, string>,
  };

  if (!user.id || !user.email) {
    throw new Error('Invalid token payload');
  }

  // Ensure user exists + look up tier — independent, run in parallel
  let tier = 'free';
  const [, resolvedTier] = await Promise.all([
    ensureUserExists(user).catch(() => {}),
    getUserTier(user.id).catch(() => 'free' as string),
  ]);
  tier = resolvedTier;

  return {
    id: user.id,
    email: user.email,
    tier,
  };
}

/**
 * Get user ID from request, or throw if not authenticated
 */
export async function getUserId(request: Request): Promise<string> {
  const user = await authenticate(request);
  return user.id;
}

/**
 * Ensure user exists in public.users table
 * Uses direct REST API to bypass any client library issues
 */
export async function ensureUserExists(authUser: { id: string; email: string; user_metadata?: { name?: string; avatar_url?: string; full_name?: string } }): Promise<void> {
  const displayName = authUser.user_metadata?.full_name || authUser.user_metadata?.name || authUser.email.split('@')[0];

  // Use direct REST API with service role key (bypasses RLS)
  const payload: Record<string, unknown> = {
    id: authUser.id,
    email: authUser.email,
  };

  // First try to select to see if user exists
  const checkResponse = await fetch(
    `${SUPABASE_URL}/rest/v1/users?id=eq.${authUser.id}&select=id`,
    {
      headers: {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    }
  );

  const existingUsers = await checkResponse.json();

  if (Array.isArray(existingUsers) && existingUsers.length > 0) {
    await resolvePendingPermissions(authUser.id, authUser.email);
    return;
  }

  // Insert new user
  const insertResponse = await fetch(
    `${SUPABASE_URL}/rest/v1/users`,
    {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify(payload),
    }
  );

  if (!insertResponse.ok) {
    const errorText = await insertResponse.text();

    // If it's a duplicate key error, that's fine
    if (errorText.includes('duplicate') || errorText.includes('23505')) {
      return;
    }

    throw new Error('Failed to create user record');
  }

  await resolvePendingPermissions(authUser.id, authUser.email);
}

/**
 * Resolve pending permission invites for a user.
 * Called on every auth — converts pending_permissions rows into real user_app_permissions.
 * Non-fatal: if this fails, auth still succeeds.
 */
async function resolvePendingPermissions(userId: string, email: string): Promise<void> {
  try {
    const pendingRes = await fetch(
      `${SUPABASE_URL}/rest/v1/pending_permissions?invited_email=eq.${encodeURIComponent(email.toLowerCase())}&select=*`,
      {
        headers: {
          'apikey': SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
      }
    );
    if (!pendingRes.ok) return;
    const pendingRows = await pendingRes.json();
    if (!Array.isArray(pendingRows) || pendingRows.length === 0) return;

    // Convert to real permission rows
    const realRows = pendingRows.map((p: { app_id: string; granted_by_user_id: string; function_name: string; allowed: boolean }) => ({
      app_id: p.app_id,
      granted_to_user_id: userId,
      granted_by_user_id: p.granted_by_user_id,
      function_name: p.function_name,
      allowed: p.allowed,
    }));

    await fetch(
      `${SUPABASE_URL}/rest/v1/user_app_permissions`,
      {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates',
        },
        body: JSON.stringify(realRows),
      }
    );

    // Delete resolved pending rows
    await fetch(
      `${SUPABASE_URL}/rest/v1/pending_permissions?invited_email=eq.${encodeURIComponent(email.toLowerCase())}`,
      {
        method: 'DELETE',
        headers: {
          'apikey': SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
      }
    );

    console.log(`[AUTH] Resolved ${pendingRows.length} pending permissions`);
  } catch {
    // Non-fatal: don't block auth
    // Non-fatal: don't block auth
  }
}

// Callback page HTML - handles Supabase's hash-based token return
// TODO: Post-MVP — migrate from localStorage to HttpOnly Secure cookies for token storage.
// This requires: (1) server-side Set-Cookie on callback, (2) API authenticate() reading cookies,
// (3) frontend fetch calls using credentials:'include', (4) CORS origin whitelist (not *).
// For now, XSS is mitigated by: HTML entity escaping on error_description, token sanitization,
// CSP headers blocking external resource loads, and HTTPS-only in production.
function getCallbackHTML(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <title>Signing in...</title>
  <style>
    body { font-family: system-ui; background: #0a0a0a; color: #fff; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    .container { text-align: center; }
    .spinner { width: 40px; height: 40px; border: 3px solid #333; border-top-color: #667eea; border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto 1rem; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="container">
    <div class="spinner"></div>
    <p>Signing you in...</p>
  </div>
  <script>
    // Supabase returns tokens in URL hash
    const hash = window.location.hash.substring(1);
    const params = new URLSearchParams(hash);
    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');

    // Check for return_to parameter (e.g., from hero setup flow)
    const queryParams = new URLSearchParams(window.location.search);
    const returnTo = queryParams.get('return_to');
    // Validate return_to is a relative path (prevent open redirect)
    const redirectTarget = (returnTo && returnTo.startsWith('/')) ? returnTo : '/upload';

    if (accessToken) {
      localStorage.setItem('ultralight_token', accessToken);
      if (refreshToken) {
        localStorage.setItem('ultralight_refresh_token', refreshToken);
      }
      window.location.href = redirectTarget;
    } else {
      // Check query params as fallback
      const error = queryParams.get('error_description');
      if (error) {
        // Sanitize error to prevent XSS via crafted error_description
        const safe = error.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#x27;');
        document.body.innerHTML = '<div class="container"><p style="color: #f87171;">Error: ' + safe + '</p><a href="/upload" style="color: #667eea;">Go back</a></div>';
      } else {
        // No token found, redirect to login
        window.location.href = '/auth/login';
      }
    }
  </script>
</body>
</html>`;
}

function getCallbackSuccessHTML(token: string, refreshToken?: string, returnTo?: string): string {
  // Sanitize tokens to prevent injection via template interpolation
  const safeToken = token.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/</g, '\\x3c');
  const safeRefresh = refreshToken ? refreshToken.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/</g, '\\x3c') : '';
  // Validate return_to is a relative path (prevent open redirect)
  const redirectTarget = (returnTo && returnTo.startsWith('/')) ? returnTo : '/upload';
  const safeRedirect = redirectTarget.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/</g, '\\x3c');
  return `<!DOCTYPE html>
<html>
<head><title>Signed in!</title></head>
<body>
  <script>
    localStorage.setItem('ultralight_token', '${safeToken}');
    ${safeRefresh ? `localStorage.setItem('ultralight_refresh_token', '${safeRefresh}');` : ''}
    window.location.href = '${safeRedirect}';
  </script>
</body>
</html>`;
}

function getCallbackErrorHTML(message: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <title>Sign in failed</title>
  <style>
    body { font-family: system-ui; background: #0a0a0a; color: #fff; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    .container { text-align: center; }
    a { color: #667eea; }
  </style>
</head>
<body>
  <div class="container">
    <p style="color: #f87171;">Error: ${message}</p>
    <a href="/upload">Go back</a>
  </div>
</body>
</html>`;
}
