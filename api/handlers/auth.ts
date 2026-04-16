// Auth Handler
// Handles authentication via Supabase Google OAuth and API tokens

import { error, json } from './app.ts';
import { isApiToken, getUserFromToken } from '../services/tokens.ts';
import { getUserTier } from '../services/tier-enforcement.ts';
import { createProvisionalUser, isProvisionalUser, mergeProvisionalUser, markOnboardingProvisionalCreated, type MergeMethod } from '../services/provisional.ts';
import {
  consumeDesktopOAuthSession,
  createDesktopOAuthSession,
  storeDesktopOAuthSessionToken,
} from '../services/desktop-oauth-sessions.ts';
import {
  appendAuthSessionCookies,
  clearAuthSessionCookies,
  getAuthAccessTokenFromRequest,
  getAuthRefreshTokenFromRequest,
} from '../services/auth-cookies.ts';
// Base64 URL encoding for PKCE (replaces Deno std encodeBase64Url)
function encodeBase64Url(data: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...data));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
import { getEnv } from '../lib/env.ts';


// PKCE helpers
function generateCodeVerifier(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return encodeBase64Url(array);
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return encodeBase64Url(new Uint8Array(digest));
}

function getSupabaseAuthHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'apikey': (getEnv('SUPABASE_ANON_KEY') || getEnv('SUPABASE_SERVICE_ROLE_KEY')),
  };
}

async function exchangeRefreshToken(refreshToken: string): Promise<{
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}> {
  const tokenResponse = await fetch(
    `${getEnv('SUPABASE_URL')}/auth/v1/token?grant_type=refresh_token`,
    {
      method: 'POST',
      headers: getSupabaseAuthHeaders(),
      body: JSON.stringify({ refresh_token: refreshToken }),
    },
  );

  if (!tokenResponse.ok) {
    throw new Error('Token refresh failed');
  }

  return await tokenResponse.json();
}

async function verifySupabaseAccessToken(token: string): Promise<{
  id: string;
  email: string;
  user_metadata?: Record<string, string>;
} | null> {
  const verifyResponse = await fetch(`${getEnv('SUPABASE_URL')}/auth/v1/user`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'apikey': (getEnv('SUPABASE_ANON_KEY') || getEnv('SUPABASE_SERVICE_ROLE_KEY')),
    },
  });

  if (!verifyResponse.ok) {
    return null;
  }

  const verifiedUser = await verifyResponse.json() as {
    id?: string;
    email?: string;
    user_metadata?: Record<string, string>;
  };
  if (!verifiedUser?.id || !verifiedUser?.email) {
    return null;
  }

  return {
    id: verifiedUser.id as string,
    email: verifiedUser.email as string,
    user_metadata: (verifiedUser.user_metadata || {}) as Record<string, string>,
  };
}

function extractBearerToken(request: Request): string | null {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.slice(7).trim();
  if (!token || token === 'null' || token === 'undefined') {
    return null;
  }

  return token;
}

function appendBrowserSession(
  response: Response,
  session: {
    accessToken: string;
    refreshToken?: string | null;
    accessTokenTtlSeconds?: number | null;
  },
): Response {
  appendAuthSessionCookies(response.headers, session);
  return response;
}

export async function handleAuth(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  // Initiate Google OAuth - redirects to Supabase Auth with PKCE
  if (path === '/auth/login') {
    // Force HTTPS — DigitalOcean terminates TLS at load balancer so request.url is HTTP internally
    const origin = url.origin.replace('http://', 'https://');
    const returnTo = url.searchParams.get('return_to');
    const desktopSession = url.searchParams.get('desktop_session');
    const desktopPollSecretHash = url.searchParams.get('desktop_poll_secret_hash');

    if (desktopSession) {
      try {
        await createDesktopOAuthSession(desktopSession, desktopPollSecretHash);
      } catch (err) {
        console.error('[auth] Failed to create desktop OAuth session:', err);
        return new Response(getCallbackErrorHTML('Unable to start desktop sign-in. Please try again.'), {
          headers: { 'Content-Type': 'text/html' },
        });
      }
    }

    // Generate PKCE code verifier and challenge (S256)
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = await generateCodeChallenge(codeVerifier);

    // Embed verifier in callback URL so it survives the redirect chain
    const callbackParams = new URLSearchParams();
    callbackParams.set('v', codeVerifier);
    if (returnTo) callbackParams.set('return_to', returnTo);
    if (desktopSession) callbackParams.set('desktop_session', desktopSession);
    const callbackUrl = `${origin}/auth/callback?${callbackParams.toString()}`;

    const authUrl = `${getEnv('SUPABASE_URL')}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(callbackUrl)}&code_challenge=${encodeURIComponent(codeChallenge)}&code_challenge_method=S256`;

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
      // Read PKCE code_verifier from query param (embedded in redirect_to URL)
      const codeVerifier = url.searchParams.get('v') || '';

      // Exchange code + verifier for tokens (Supabase PKCE grant)
      const tokenResponse = await fetch(`${getEnv('SUPABASE_URL')}/auth/v1/token?grant_type=pkce`, {
        method: 'POST',
        headers: getSupabaseAuthHeaders(),
        body: JSON.stringify({
          auth_code: code,
          code_verifier: codeVerifier,
        }),
      });

      if (tokenResponse.ok) {
        const tokens = await tokenResponse.json() as {
          access_token: string;
          refresh_token?: string;
          expires_in?: number;
        };
        const desktopSession = url.searchParams.get('desktop_session');

        // Desktop OAuth flow: store token for polling, show "close this tab" page
        if (desktopSession) {
          const stored = await storeDesktopOAuthSessionToken(desktopSession, tokens.access_token);
          if (!stored) {
            return new Response(getCallbackErrorHTML('Desktop sign-in expired. Please return to the app and try again.'), {
              headers: { 'Content-Type': 'text/html' },
            });
          }
          return new Response(getDesktopCallbackHTML(), {
            headers: { 'Content-Type': 'text/html' },
          });
        }

        const returnTo = url.searchParams.get('return_to') || undefined;
        return appendBrowserSession(new Response(getCallbackSuccessHTML(returnTo), {
          headers: { 'Content-Type': 'text/html' },
        }), {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          accessTokenTtlSeconds: tokens.expires_in,
        });
      }

      // Code exchange failed — show error with full details for debugging
      let errBody = '';
      try { errBody = await tokenResponse.text(); } catch {}
      console.error('[auth] Code exchange failed:', tokenResponse.status, errBody);
      const hasVerifier = codeVerifier ? 'yes (' + codeVerifier.length + ' chars)' : 'MISSING';
      let supabaseError = '';
      try { const parsed = JSON.parse(errBody); supabaseError = parsed.error_description || parsed.msg || parsed.error || ''; } catch { supabaseError = errBody.substring(0, 200); }
      return new Response(getCallbackErrorHTML('Code exchange failed (status ' + tokenResponse.status + ', verifier: ' + hasVerifier + '). Supabase says: ' + supabaseError), {
        headers: { 'Content-Type': 'text/html' },
      });
    }

    // No code param — return HTML that handles hash-based implicit tokens (fallback)
    return new Response(getCallbackHTML(), {
      headers: {
        'Content-Type': 'text/html',
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

  // Establish or migrate a browser session into HttpOnly cookies.
  if (path === '/auth/session' && request.method === 'POST') {
    try {
      const body = await request.json().catch(() => ({})) as {
        access_token?: string;
        refresh_token?: string;
      };
      let accessToken = typeof body.access_token === 'string' ? body.access_token.trim() : '';
      let refreshToken = typeof body.refresh_token === 'string' ? body.refresh_token.trim() : '';
      let expiresIn: number | undefined;

      let verifiedUser = accessToken ? await verifySupabaseAccessToken(accessToken) : null;
      if (!verifiedUser && refreshToken) {
        const refreshed = await exchangeRefreshToken(refreshToken);
        accessToken = refreshed.access_token;
        refreshToken = refreshed.refresh_token || refreshToken;
        expiresIn = refreshed.expires_in;
        verifiedUser = await verifySupabaseAccessToken(accessToken);
      }

      if (!verifiedUser || !accessToken) {
        return error('Invalid or expired session tokens', 401);
      }

      await ensureUserExists(verifiedUser).catch(() => {});

      return appendBrowserSession(json({ ok: true }), {
        accessToken,
        refreshToken,
        accessTokenTtlSeconds: expiresIn,
      });
    } catch (err) {
      console.error('[auth] Session establishment failed:', err);
      return error('Failed to establish session', 500);
    }
  }

  // Sign out - clears browser cookies and legacy browser storage.
  if (path === '/auth/signout') {
    const response = json({ ok: true });
    clearAuthSessionCookies(response.headers);
    return response;
  }

  // Refresh token - exchange refresh_token for a new access_token.
  // Body-based refresh remains for non-cookie clients; cookie refresh powers browser sessions.
  if (path === '/auth/refresh' && request.method === 'POST') {
    try {
      const body = await request.json().catch(() => ({})) as { refresh_token?: string };
      const refreshToken = (typeof body.refresh_token === 'string' && body.refresh_token.trim())
        ? body.refresh_token.trim()
        : getAuthRefreshTokenFromRequest(request);

      if (!refreshToken) {
        return error('Missing refresh_token', 400);
      }

      const tokens = await exchangeRefreshToken(refreshToken);
      const response = json({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_in: tokens.expires_in,
      });
      appendAuthSessionCookies(response.headers, {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || refreshToken,
        accessTokenTtlSeconds: tokens.expires_in,
      });
      return response;
    } catch {
      return error('Token refresh failed', 500);
    }
  }

  // Create provisional user (no auth required) — pre-auth onboarding
  if (path === '/auth/provisional' && request.method === 'POST') {
    try {
      const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
        || request.headers.get('x-real-ip')
        || '0.0.0.0';

      console.log(`[AUTH] Provisional request from IP: ${clientIp}`);
      const result = await createProvisionalUser(clientIp);
      console.log(`[AUTH] Provisional user created: ${result.id}, token_id: ${result.tokenId}`);

      // Correlate with onboarding template request (fire-and-forget)
      markOnboardingProvisionalCreated(clientIp);

      return json({
        user_id: result.id,
        token: result.token,
        token_id: result.tokenId,
        provisional: true,
        limits: {
          daily_calls: 50,
          storage_mb: 5,
          memory: false,
          inactivity_expiry_hours: 24,
        },
      });
    } catch (err: any) {
      console.error(`[AUTH] Provisional creation failed:`, err.message, err.status);
      if (err.status === 429) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 429,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (err.status === 503) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      console.error('[AUTH] Provisional creation failed:', err);
      return error('Failed to create provisional account', 500);
    }
  }

  // Merge provisional user into authenticated account (JWT auth required)
  if (path === '/auth/merge' && request.method === 'POST') {
    try {
      const user = await authenticate(request);
      const body = await request.json() as {
        provisional_user_id?: string;
        merge_method?: string;
      };
      const provisionalUserId = body.provisional_user_id;
      const mergeMethod = (body.merge_method || 'api_merge') as MergeMethod;

      if (!provisionalUserId) {
        return error('Missing provisional_user_id', 400);
      }

      // Verify provisional user exists and is actually provisional
      if (!await isProvisionalUser(provisionalUserId)) {
        return error('Not a provisional user', 400);
      }

      // Prevent self-merge
      if (provisionalUserId === user.id) {
        return error('Cannot merge into self', 400);
      }

      const result = await mergeProvisionalUser(provisionalUserId, user.id, mergeMethod);
      return json({ success: true, merged: result });
    } catch (err: any) {
      console.error('[AUTH] Merge failed:', err);
      return error(err.message || 'Merge failed', 500);
    }
  }

  // Desktop OAuth polling — desktop app polls this after opening browser for Google OAuth
  if (path === '/auth/desktop-poll' && request.method === 'GET') {
    const sessionId = url.searchParams.get('session_id');
    if (!sessionId) {
      return error('Missing session_id', 400);
    }

    const pollSecret = url.searchParams.get('session_secret');
    const token = await consumeDesktopOAuthSession(sessionId, pollSecret);
    if (token) {
      return json({ status: 'complete', token });
    }
    return json({ status: 'pending' });
  }

  return error('Auth endpoint not found', 404);
}

/**
 * Extract and verify JWT or API token from request
 * Also ensures user exists in public.users table
 */
/**
 * Check if a set of scopes includes the required scope.
 * Wildcard '*' matches everything (backward compat for existing tokens).
 */
export function hasScope(scopes: string[] | undefined, required: string): boolean {
  if (!scopes) return true; // No scopes = full access (JWT sessions)
  return scopes.includes('*') || scopes.includes(required);
}

export async function authenticate(request: Request): Promise<{ id: string; email: string; tier: string; provisional?: boolean; tokenId?: string; tokenAppIds?: string[] | null; tokenFunctionNames?: string[] | null; scopes?: string[] }> {
  const token = extractBearerToken(request) || getAuthAccessTokenFromRequest(request);
  if (!token) {
    throw new Error('Missing or invalid authorization header');
  }

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
  const user = await verifySupabaseAccessToken(token);
  if (!user) {
    throw new Error('Invalid or expired token');
  }

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
    `${getEnv('SUPABASE_URL')}/rest/v1/users?id=eq.${authUser.id}&select=id`,
    {
      headers: {
        'apikey': getEnv('SUPABASE_SERVICE_ROLE_KEY'),
        'Authorization': `Bearer ${getEnv('SUPABASE_SERVICE_ROLE_KEY')}`,
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
    `${getEnv('SUPABASE_URL')}/rest/v1/users`,
    {
      method: 'POST',
      headers: {
        'apikey': getEnv('SUPABASE_SERVICE_ROLE_KEY'),
        'Authorization': `Bearer ${getEnv('SUPABASE_SERVICE_ROLE_KEY')}`,
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

  // Provision default system apps for new users (fire-and-forget)
  provisionDefaultApps(authUser.id).catch(err =>
    console.error('[AUTH] Failed to provision default apps:', err)
  );
}

/**
 * Default system apps — auto-installed for every new user.
 * Looked up by name since IDs are assigned at publish time.
 */
const DEFAULT_APP_NAMES = ['Memory Wiki', 'email-ops', 'Private Tutor', 'Smart Budget', 'Recipe Box', 'Reading List'];

async function provisionDefaultApps(userId: string): Promise<void> {
  const supabaseUrl = getEnv('SUPABASE_URL');
  const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');
  const headers = {
    'apikey': serviceKey,
    'Authorization': `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
  };

  // Look up default apps by name
  const namesFilter = DEFAULT_APP_NAMES.map(n => `"${n}"`).join(',');
  const appsRes = await fetch(
    `${supabaseUrl}/rest/v1/apps?name=in.(${namesFilter})&deleted_at=is.null&select=id,name`,
    { headers }
  );
  if (!appsRes.ok) return;
  const apps = await appsRes.json() as Array<{ id: string; name: string }>;
  if (apps.length === 0) return;

  // Insert into app_likes (makes them appear in function index) and user_app_library
  for (const app of apps) {
    await fetch(`${supabaseUrl}/rest/v1/app_likes`, {
      method: 'POST',
      headers: { ...headers, 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify({ user_id: userId, app_id: app.id, positive: true }),
    });
    await fetch(`${supabaseUrl}/rest/v1/user_app_library`, {
      method: 'POST',
      headers: { ...headers, 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify({ user_id: userId, app_id: app.id, source: 'default' }),
    });
  }
}

/**
 * Resolve pending permission invites for a user.
 * Called on every auth — converts pending_permissions rows into real user_app_permissions.
 * Non-fatal: if this fails, auth still succeeds.
 */
async function resolvePendingPermissions(userId: string, email: string): Promise<void> {
  try {
    const pendingRes = await fetch(
      `${getEnv('SUPABASE_URL')}/rest/v1/pending_permissions?invited_email=eq.${encodeURIComponent(email.toLowerCase())}&select=*`,
      {
        headers: {
          'apikey': getEnv('SUPABASE_SERVICE_ROLE_KEY'),
          'Authorization': `Bearer ${getEnv('SUPABASE_SERVICE_ROLE_KEY')}`,
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
      `${getEnv('SUPABASE_URL')}/rest/v1/user_app_permissions`,
      {
        method: 'POST',
        headers: {
          'apikey': getEnv('SUPABASE_SERVICE_ROLE_KEY'),
          'Authorization': `Bearer ${getEnv('SUPABASE_SERVICE_ROLE_KEY')}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates',
        },
        body: JSON.stringify(realRows),
      }
    );

    // Delete resolved pending rows
    await fetch(
      `${getEnv('SUPABASE_URL')}/rest/v1/pending_permissions?invited_email=eq.${encodeURIComponent(email.toLowerCase())}`,
      {
        method: 'DELETE',
        headers: {
          'apikey': getEnv('SUPABASE_SERVICE_ROLE_KEY'),
          'Authorization': `Bearer ${getEnv('SUPABASE_SERVICE_ROLE_KEY')}`,
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
// and stores it in HttpOnly cookies via POST /auth/session.
function getCallbackHTML(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <title>Signing in...</title>
  <style>
    body { font-family: system-ui; background: #fff; color: #0a0a0a; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    .container { text-align: center; max-width: 500px; padding: 20px; }
    .spinner { width: 40px; height: 40px; border: 3px solid #e5e5e5; border-top-color: #0a0a0a; border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto 1rem; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .debug { font-size: 11px; color: #999; margin-top: 20px; word-break: break-all; text-align: left; }
  </style>
</head>
<body>
  <div class="container">
    <div class="spinner"></div>
    <p id="status">Signing you in...</p>
    <div id="debug" class="debug"></div>
  </div>
  <script>
    var debugEl = document.getElementById('debug');
    var statusEl = document.getElementById('status');

    // Supabase implicit flow returns tokens in URL hash
    var hash = window.location.hash.substring(1);
    var params = new URLSearchParams(hash);
    var accessToken = params.get('access_token');
    var refreshToken = params.get('refresh_token');

    var queryParams = new URLSearchParams(window.location.search);
    var returnTo = queryParams.get('return_to');
    var redirectTarget = (returnTo && returnTo.startsWith('/')) ? returnTo : '/';

    if (accessToken) {
      statusEl.textContent = 'Finalizing sign-in...';
      fetch('/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          access_token: accessToken,
          refresh_token: refreshToken
        })
      }).then(function(res) {
        if (!res.ok) throw new Error('session_failed');
        localStorage.removeItem('ultralight_token');
        localStorage.removeItem('ultralight_refresh_token');
        window.location.href = redirectTarget;
      }).catch(function() {
        statusEl.textContent = 'Authentication failed. Please try again.';
        debugEl.textContent = 'We could not establish a browser session.';
      });
    } else {
      var error = queryParams.get('error_description');
      if (error) {
        var safe = error.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#x27;');
        document.body.innerHTML = '<div class="container"><p style="color: #ef4444;">Error: ' + safe + '</p><a href="/" style="color: #0a0a0a;">Go back</a></div>';
      } else {
        statusEl.textContent = 'No token received. Waiting 3s then retrying...';
        // Wait a moment — sometimes the hash is set after page load
        setTimeout(function() {
          var retryHash = window.location.hash.substring(1);
          var retryParams = new URLSearchParams(retryHash);
          var retryToken = retryParams.get('access_token');
          if (retryToken) {
            var retryRefresh = retryParams.get('refresh_token');
            fetch('/auth/session', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'same-origin',
              body: JSON.stringify({
                access_token: retryToken,
                refresh_token: retryRefresh
              })
            }).then(function(res) {
              if (!res.ok) throw new Error('session_failed');
              localStorage.removeItem('ultralight_token');
              localStorage.removeItem('ultralight_refresh_token');
              window.location.href = redirectTarget;
            }).catch(function() {
              statusEl.textContent = 'Authentication failed. Please try again.';
              debugEl.textContent = 'We could not establish a browser session.';
            });
          } else {
            statusEl.textContent = 'Authentication failed. No tokens found.';
            document.body.innerHTML += '<div style="text-align:center;margin-top:20px;"><a href="/" style="color:#0a0a0a;">Go back</a> &nbsp; <a href="/auth/login" style="color:#0a0a0a;">Try again</a></div>';
          }
        }, 3000);
      }
    }
  </script>
</body>
</html>`;
}

function getCallbackSuccessHTML(returnTo?: string): string {
  // Validate return_to is a relative path (prevent open redirect)
  const redirectTarget = (returnTo && returnTo.startsWith('/')) ? returnTo : '/';
  const safeRedirect = redirectTarget.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/</g, '\\x3c');
  return `<!DOCTYPE html>
<html>
<head><title>Signed in!</title></head>
<body>
  <script>
    // Check for provisional user to merge (same-device path)
    var provUserId = localStorage.getItem('ultralight_provisional_user_id');
    if (provUserId) {
      fetch('/auth/merge', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'same-origin',
        body: JSON.stringify({ provisional_user_id: provUserId, merge_method: 'oauth_callback' })
      }).then(function() {
        localStorage.removeItem('ultralight_provisional_token_id');
        localStorage.removeItem('ultralight_provisional_user_id');
        localStorage.removeItem('ultralight_setup_v3');
        window.location.href = '${safeRedirect}';
      }).catch(function() {
        // Merge failed — proceed anyway (user still gets authenticated)
        localStorage.removeItem('ultralight_provisional_token_id');
        localStorage.removeItem('ultralight_provisional_user_id');
        localStorage.removeItem('ultralight_token');
        localStorage.removeItem('ultralight_refresh_token');
        window.location.href = '${safeRedirect}';
      });
    } else {
      localStorage.removeItem('ultralight_token');
      localStorage.removeItem('ultralight_refresh_token');
      window.location.href = '${safeRedirect}';
    }
  </script>
</body>
</html>`;
}

function getDesktopCallbackHTML(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <title>Signed in!</title>
  <style>
    body { font-family: system-ui; background: #fff; color: #0a0a0a; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    .container { text-align: center; max-width: 400px; padding: 20px; }
    .checkmark { font-size: 48px; margin-bottom: 16px; }
    p { color: #666; margin-top: 8px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="checkmark">&#10003;</div>
    <h2>Signed in to Ultralight</h2>
    <p>You can close this tab and return to the desktop app.</p>
  </div>
</body>
</html>`;
}

function getCallbackErrorHTML(message: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <title>Sign in failed</title>
  <style>
    body { font-family: system-ui; background: #fff; color: #0a0a0a; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    .container { text-align: center; }
    a { color: #0a0a0a; text-decoration: underline; }
  </style>
</head>
<body>
  <div class="container">
    <p style="color: #ef4444;">Error: ${message}</p>
    <a href="/">Go back</a>
  </div>
</body>
</html>`;
}
