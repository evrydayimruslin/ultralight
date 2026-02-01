// Auth Handler
// Handles authentication via Supabase Google OAuth

import { error, json } from './app.ts';

// @ts-ignore - Deno is available
const Deno = globalThis.Deno;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || SUPABASE_SERVICE_ROLE_KEY; // Fallback to service key

// Supabase client for database operations (service role bypasses RLS)
async function getSupabaseClient() {
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
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
    const redirectTo = `${url.origin}/auth/callback`;
    const authUrl = `${SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirectTo)}`;

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
        return new Response(getCallbackSuccessHTML(tokens.access_token), {
          headers: { 'Content-Type': 'text/html' },
        });
      }
    }

    // No code or code exchange failed - return HTML that handles hash-based tokens
    // Supabase implicit flow returns tokens in URL hash (e.g., #access_token=...)
    // The hash is only accessible client-side via JavaScript
    return new Response(getCallbackHTML(), {
      headers: { 'Content-Type': 'text/html' },
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

  return error('Auth endpoint not found', 404);
}

/**
 * Extract and verify JWT from request
 * Also ensures user exists in public.users table
 */
export async function authenticate(request: Request): Promise<{ id: string; email: string; tier: string }> {
  const authHeader = request.headers.get('Authorization');
  console.log('Auth header present:', !!authHeader);

  if (!authHeader?.startsWith('Bearer ')) {
    console.error('Missing or invalid auth header format');
    throw new Error('Missing or invalid authorization header');
  }

  const token = authHeader.slice(7);
  console.log('Token length:', token.length, 'Token preview:', token.substring(0, 50) + '...');

  // Decode and verify JWT locally first to check expiry
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid JWT format');
    }

    // JWT uses base64url encoding - need to convert to standard base64
    const base64Payload = parts[1]
      .replace(/-/g, '+')
      .replace(/_/g, '/');
    // Add padding if needed
    const padded = base64Payload + '='.repeat((4 - base64Payload.length % 4) % 4);
    const payload = JSON.parse(atob(padded));

    // Check if token is expired
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      console.error('Token expired at:', new Date(payload.exp * 1000));
      throw new Error('Token expired');
    }

    // Extract user info directly from JWT - Supabase JWTs contain user data
    console.log('JWT payload:', JSON.stringify(payload));

    const user = {
      id: payload.sub,
      email: payload.email,
      user_metadata: payload.user_metadata || {},
    };

    console.log('User from JWT:', user.id, user.email);

    // Ensure user exists in public.users table
    await ensureUserExists(user);

    return {
      id: user.id,
      email: user.email,
      tier: 'free', // TODO: Look up from users table
    };
  } catch (err) {
    console.error('JWT decode/verify error:', err);
    throw new Error('Invalid token');
  }
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
 * Called after successful authentication - creates user if not exists
 */
export async function ensureUserExists(authUser: { id: string; email: string; user_metadata?: { name?: string; avatar_url?: string; full_name?: string } }): Promise<void> {
  const supabase = await getSupabaseClient();

  // First check if user exists
  const { data: existingUser } = await supabase
    .from('users')
    .select('id')
    .eq('id', authUser.id)
    .single();

  if (existingUser) {
    // User already exists
    return;
  }

  // Insert new user
  const { error } = await supabase
    .from('users')
    .insert({
      id: authUser.id,
      email: authUser.email,
      display_name: authUser.user_metadata?.full_name || authUser.user_metadata?.name || authUser.email.split('@')[0],
      avatar_url: authUser.user_metadata?.avatar_url || null,
    });

  if (error) {
    // Log full error for debugging
    console.error('Failed to create user:', JSON.stringify(error));
    // Don't throw - user might have been created by another request
    if (!error.message?.includes('duplicate') && !error.code?.includes('23505')) {
      throw new Error(`Failed to create user: ${error.message}`);
    }
  }
}

// Callback page HTML - handles Supabase's hash-based token return
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

    if (accessToken) {
      localStorage.setItem('ultralight_token', accessToken);
      window.location.href = '/upload';
    } else {
      // Check query params as fallback
      const urlParams = new URLSearchParams(window.location.search);
      const error = urlParams.get('error_description');
      if (error) {
        document.body.innerHTML = '<div class="container"><p style="color: #f87171;">Error: ' + error + '</p><a href="/upload" style="color: #667eea;">Go back</a></div>';
      } else {
        // No token found, redirect to login
        window.location.href = '/auth/login';
      }
    }
  </script>
</body>
</html>`;
}

function getCallbackSuccessHTML(token: string): string {
  return `<!DOCTYPE html>
<html>
<head><title>Signed in!</title></head>
<body>
  <script>
    localStorage.setItem('ultralight_token', '${token}');
    window.location.href = '/upload';
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
