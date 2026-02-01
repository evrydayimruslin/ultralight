// Auth Handler
// Handles authentication via Supabase Google OAuth

import { error, json } from './app.ts';

// @ts-ignore - Deno is available
const Deno = globalThis.Deno;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

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

  // Google OAuth callback - exchange code for session
  if (path === '/auth/callback') {
    const code = url.searchParams.get('code');

    if (!code) {
      // User may have cancelled or there's an error
      const errorDesc = url.searchParams.get('error_description') || 'Authentication failed';
      return new Response(getCallbackErrorHTML(errorDesc), {
        headers: { 'Content-Type': 'text/html' },
      });
    }

    // Exchange code for session via Supabase
    const tokenResponse = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=authorization_code`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
      },
      body: JSON.stringify({
        auth_code: code,
        code_verifier: '', // Not using PKCE for simplicity
      }),
    });

    if (!tokenResponse.ok) {
      // Fallback: Try the hash-based flow by redirecting to frontend
      // Supabase often returns tokens in URL hash
      return new Response(getCallbackHTML(), {
        headers: { 'Content-Type': 'text/html' },
      });
    }

    const tokens = await tokenResponse.json();

    // Return HTML that stores the token and redirects
    return new Response(getCallbackSuccessHTML(tokens.access_token), {
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
 */
export async function authenticate(request: Request): Promise<{ id: string; email: string; tier: string }> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    throw new Error('Missing or invalid authorization header');
  }

  const token = authHeader.slice(7);

  // Verify JWT with Supabase
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
    },
  });

  if (!response.ok) {
    throw new Error('Invalid token');
  }

  const user = await response.json();

  return {
    id: user.id,
    email: user.email,
    tier: 'free', // TODO: Look up from users table
  };
}

/**
 * Get user ID from request, or return placeholder if not authenticated
 */
export async function getUserId(request: Request): Promise<string> {
  try {
    const user = await authenticate(request);
    return user.id;
  } catch {
    // Fallback for unauthenticated requests (temporary)
    return '00000000-0000-0000-0000-000000000001';
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
