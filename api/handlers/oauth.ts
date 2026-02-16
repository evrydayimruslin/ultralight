// OAuth 2.1 Handler for MCP Spec Compliance
// Implements RFC 9728 (Protected Resource Metadata), OAuth Authorization Server Metadata,
// Dynamic Client Registration (RFC 7591), Authorization Code + PKCE flow.
//
// This wraps Ultralight's existing Supabase Google OAuth + ul_ token system
// into the standard OAuth 2.1 shape that MCP clients (Claude Desktop, etc.) expect.

import { json, error } from './app.ts';
import { createToken } from '../services/tokens.ts';

// @ts-ignore - Deno is available
const Deno = globalThis.Deno;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || SUPABASE_SERVICE_ROLE_KEY;

// ============================================
// IN-MEMORY STORES (short TTL, no DB needed)
// ============================================

interface OAuthClient {
  client_id: string;
  client_name?: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: string;
  created_at: number;
}

interface AuthorizationCode {
  code: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  supabase_access_token: string;
  supabase_refresh_token?: string;
  user_id: string;
  user_email: string;
  scope: string;
  created_at: number;
}

// In-memory stores with TTL cleanup
const oauthClients = new Map<string, OAuthClient>();
const authorizationCodes = new Map<string, AuthorizationCode>();

// TTLs
const CLIENT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const CODE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Lazy cleanup
function cleanupExpired() {
  const now = Date.now();
  for (const [k, v] of authorizationCodes) {
    if (now - v.created_at > CODE_TTL_MS) authorizationCodes.delete(k);
  }
  for (const [k, v] of oauthClients) {
    if (now - v.created_at > CLIENT_TTL_MS) oauthClients.delete(k);
  }
}

// ============================================
// HELPERS
// ============================================

function getBaseUrl(request: Request): string {
  const url = new URL(request.url);
  // Behind a reverse proxy (DigitalOcean, Cloudflare), use forwarded headers
  const proto = request.headers.get('x-forwarded-proto') || url.protocol.replace(':', '');
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || url.host;
  return `${proto}://${host}`;
}

async function sha256(plain: string): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  return crypto.subtle.digest('SHA-256', encoder.encode(plain));
}

function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function verifyPKCE(codeVerifier: string, codeChallenge: string, method: string): Promise<boolean> {
  if (method === 'S256') {
    const hashed = await sha256(codeVerifier);
    const computed = base64UrlEncode(hashed);
    return computed === codeChallenge;
  }
  // plain method (not recommended but spec-legal)
  return codeVerifier === codeChallenge;
}

// Verify a Supabase JWT and get user info
async function verifySupabaseToken(accessToken: string): Promise<{ id: string; email: string } | null> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'apikey': SUPABASE_ANON_KEY,
    },
  });
  if (!res.ok) return null;
  const user = await res.json();
  if (!user.id || !user.email) return null;
  return { id: user.id, email: user.email };
}

// ============================================
// MAIN ROUTER
// ============================================

export async function handleOAuth(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // Protected Resource Metadata (RFC 9728)
  if (path === '/.well-known/oauth-protected-resource' && method === 'GET') {
    return handleProtectedResourceMetadata(request);
  }

  // Authorization Server Metadata
  if (path === '/.well-known/oauth-authorization-server' && method === 'GET') {
    return handleAuthorizationServerMetadata(request);
  }

  // Dynamic Client Registration (RFC 7591)
  if (path === '/oauth/register' && method === 'POST') {
    return handleClientRegistration(request);
  }

  // Authorization endpoint
  if (path === '/oauth/authorize' && method === 'GET') {
    return handleAuthorize(request);
  }

  // OAuth callback — internal, handles Supabase redirect back
  if (path === '/oauth/callback') {
    return handleOAuthCallback(request);
  }

  // Token endpoint
  if (path === '/oauth/token' && method === 'POST') {
    return handleTokenExchange(request);
  }

  // Implicit flow completion (called from browser JS in the callback HTML)
  if (path === '/oauth/callback/complete' && method === 'POST') {
    return handleOAuthCallbackComplete(request);
  }

  return error('OAuth endpoint not found', 404);
}

// ============================================
// P2A: PROTECTED RESOURCE METADATA
// ============================================

function handleProtectedResourceMetadata(request: Request): Response {
  const baseUrl = getBaseUrl(request);

  return json({
    resource: baseUrl,
    authorization_servers: [baseUrl],
    scopes_supported: ['mcp:read', 'mcp:write'],
    bearer_methods_supported: ['header'],
  });
}

// ============================================
// P2B: AUTHORIZATION SERVER METADATA
// ============================================

function handleAuthorizationServerMetadata(request: Request): Response {
  const baseUrl = getBaseUrl(request);

  return json({
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/oauth/authorize`,
    token_endpoint: `${baseUrl}/oauth/token`,
    registration_endpoint: `${baseUrl}/oauth/register`,
    scopes_supported: ['mcp:read', 'mcp:write'],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    service_documentation: 'https://ultralight.dev/docs/mcp',
  });
}

// ============================================
// P2C: DYNAMIC CLIENT REGISTRATION
// ============================================

async function handleClientRegistration(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return error('Invalid JSON', 400);
  }

  const redirectUris = body.redirect_uris as string[] | undefined;
  if (!redirectUris || !Array.isArray(redirectUris) || redirectUris.length === 0) {
    return error('redirect_uris is required', 400);
  }

  // Validate redirect URIs
  for (const uri of redirectUris) {
    try {
      new URL(uri);
    } catch {
      return error(`Invalid redirect_uri: ${uri}`, 400);
    }
  }

  const clientId = crypto.randomUUID();

  const client: OAuthClient = {
    client_id: clientId,
    client_name: (body.client_name as string) || undefined,
    redirect_uris: redirectUris,
    grant_types: (body.grant_types as string[]) || ['authorization_code'],
    response_types: (body.response_types as string[]) || ['code'],
    token_endpoint_auth_method: (body.token_endpoint_auth_method as string) || 'none',
    created_at: Date.now(),
  };

  oauthClients.set(clientId, client);

  // Lazy cleanup
  if (oauthClients.size > 100) cleanupExpired();

  return json({
    client_id: clientId,
    client_name: client.client_name,
    redirect_uris: client.redirect_uris,
    grant_types: client.grant_types,
    response_types: client.response_types,
    token_endpoint_auth_method: client.token_endpoint_auth_method,
  }, 201);
}

// ============================================
// P2D: AUTHORIZATION ENDPOINT
// ============================================

function handleAuthorize(request: Request): Response {
  const url = new URL(request.url);
  const baseUrl = getBaseUrl(request);

  const clientId = url.searchParams.get('client_id');
  const redirectUri = url.searchParams.get('redirect_uri');
  const codeChallenge = url.searchParams.get('code_challenge');
  const codeChallengeMethod = url.searchParams.get('code_challenge_method') || 'S256';
  const state = url.searchParams.get('state');
  const scope = url.searchParams.get('scope') || 'mcp:read mcp:write';

  // Validate required params
  if (!clientId) {
    return error('Missing client_id', 400);
  }
  if (!redirectUri) {
    return error('Missing redirect_uri', 400);
  }
  if (!codeChallenge) {
    return error('Missing code_challenge (PKCE required)', 400);
  }

  // Validate client exists and redirect_uri is registered
  const client = oauthClients.get(clientId);
  if (client && !client.redirect_uris.includes(redirectUri)) {
    return error('redirect_uri not registered for this client', 400);
  }

  // Store the OAuth state in a secure cookie-like param through the Supabase redirect.
  // We encode the OAuth params into our callback URL so we can reconstruct the flow.
  const oauthState = JSON.stringify({
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: codeChallenge,
    code_challenge_method: codeChallengeMethod,
    state: state || '',
    scope,
  });
  const encodedState = btoa(oauthState);

  // Redirect to Supabase Google OAuth, with our /oauth/callback as the redirect
  const callbackUrl = `${baseUrl}/oauth/callback?oauth_state=${encodeURIComponent(encodedState)}`;
  const authUrl = `${SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(callbackUrl)}`;

  return new Response(null, {
    status: 302,
    headers: { 'Location': authUrl },
  });
}

// ============================================
// OAUTH CALLBACK (internal — handles Supabase return)
// ============================================

async function handleOAuthCallback(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const encodedState = url.searchParams.get('oauth_state') || '';

  // Supabase may return with a code (PKCE flow) or hash-based tokens
  const code = url.searchParams.get('code');

  // Try to decode the OAuth state
  let oauthState: {
    client_id: string;
    redirect_uri: string;
    code_challenge: string;
    code_challenge_method: string;
    state: string;
    scope: string;
  };

  try {
    oauthState = JSON.parse(atob(encodedState));
  } catch {
    return error('Invalid OAuth state', 400);
  }

  if (code) {
    // Supabase code exchange — exchange Supabase auth code for tokens
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
      return generateAuthCodeAndRedirect(tokens.access_token, tokens.refresh_token, oauthState);
    }
  }

  // Supabase implicit flow — tokens come in URL hash (client-side only).
  // Return HTML that extracts the hash token and POSTs it to complete the flow.
  return new Response(getOAuthCallbackHTML(encodedState), {
    headers: { 'Content-Type': 'text/html' },
  });
}

/**
 * Generate an authorization code and redirect back to the MCP client
 */
async function generateAuthCodeAndRedirect(
  supabaseAccessToken: string,
  supabaseRefreshToken: string | undefined,
  oauthState: {
    client_id: string;
    redirect_uri: string;
    code_challenge: string;
    code_challenge_method: string;
    state: string;
    scope: string;
  }
): Promise<Response> {
  // Verify the Supabase token to get user info
  const user = await verifySupabaseToken(supabaseAccessToken);
  if (!user) {
    return error('Failed to verify user identity', 500);
  }

  // Generate authorization code
  const authCode = crypto.randomUUID();

  const codeEntry: AuthorizationCode = {
    code: authCode,
    client_id: oauthState.client_id,
    redirect_uri: oauthState.redirect_uri,
    code_challenge: oauthState.code_challenge,
    code_challenge_method: oauthState.code_challenge_method,
    supabase_access_token: supabaseAccessToken,
    supabase_refresh_token: supabaseRefreshToken,
    user_id: user.id,
    user_email: user.email,
    scope: oauthState.scope,
    created_at: Date.now(),
  };

  authorizationCodes.set(authCode, codeEntry);

  // Lazy cleanup
  if (authorizationCodes.size > 50) cleanupExpired();

  // Redirect back to the MCP client with the authorization code
  const redirectUrl = new URL(oauthState.redirect_uri);
  redirectUrl.searchParams.set('code', authCode);
  if (oauthState.state) {
    redirectUrl.searchParams.set('state', oauthState.state);
  }

  return new Response(null, {
    status: 302,
    headers: { 'Location': redirectUrl.toString() },
  });
}

// ============================================
// P2E: TOKEN EXCHANGE ENDPOINT
// ============================================

async function handleTokenExchange(request: Request): Promise<Response> {
  let body: Record<string, string>;
  try {
    // Token endpoint can receive application/x-www-form-urlencoded or JSON
    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('application/x-www-form-urlencoded')) {
      const text = await request.text();
      const params = new URLSearchParams(text);
      body = Object.fromEntries(params.entries());
    } else {
      body = await request.json();
    }
  } catch {
    return oauthError('invalid_request', 'Could not parse request body', 400);
  }

  const grantType = body.grant_type;

  if (grantType !== 'authorization_code') {
    return oauthError('unsupported_grant_type', 'Only authorization_code grant is supported', 400);
  }

  const code = body.code;
  const codeVerifier = body.code_verifier;
  const redirectUri = body.redirect_uri;

  if (!code) {
    return oauthError('invalid_request', 'Missing code', 400);
  }
  if (!codeVerifier) {
    return oauthError('invalid_request', 'Missing code_verifier (PKCE required)', 400);
  }

  // Look up authorization code
  const codeEntry = authorizationCodes.get(code);
  if (!codeEntry) {
    return oauthError('invalid_grant', 'Invalid or expired authorization code', 400);
  }

  // Delete the code immediately (one-time use)
  authorizationCodes.delete(code);

  // Check expiry (5 min)
  if (Date.now() - codeEntry.created_at > CODE_TTL_MS) {
    return oauthError('invalid_grant', 'Authorization code expired', 400);
  }

  // Verify redirect_uri matches
  if (redirectUri && redirectUri !== codeEntry.redirect_uri) {
    return oauthError('invalid_grant', 'redirect_uri mismatch', 400);
  }

  // Verify PKCE
  const pkceValid = await verifyPKCE(codeVerifier, codeEntry.code_challenge, codeEntry.code_challenge_method);
  if (!pkceValid) {
    return oauthError('invalid_grant', 'PKCE verification failed', 400);
  }

  // Mint an Ultralight API token for this user
  try {
    const tokenName = `mcp-oauth-${codeEntry.client_id.slice(0, 8)}-${Date.now()}`;
    const result = await createToken(codeEntry.user_id, tokenName, {
      scopes: ['*'],
    });

    return json({
      access_token: result.plaintext_token,
      token_type: 'bearer',
      scope: codeEntry.scope,
    });
  } catch (err) {
    console.error('OAuth token creation failed:', err);
    return oauthError('server_error', 'Failed to create access token', 500);
  }
}

// ============================================
// IMPLICIT FLOW COMPLETION
// ============================================

/**
 * Called from the browser-side JS when Supabase returns tokens in the URL hash.
 * Receives the Supabase access token, generates an auth code, and returns a redirect URL.
 */
async function handleOAuthCallbackComplete(request: Request): Promise<Response> {
  let body: Record<string, string>;
  try {
    body = await request.json();
  } catch {
    return error('Invalid JSON', 400);
  }

  const accessToken = body.access_token;
  const refreshToken = body.refresh_token;
  const encodedState = body.oauth_state;

  if (!accessToken || !encodedState) {
    return error('Missing access_token or oauth_state', 400);
  }

  let oauthState: {
    client_id: string;
    redirect_uri: string;
    code_challenge: string;
    code_challenge_method: string;
    state: string;
    scope: string;
  };

  try {
    oauthState = JSON.parse(atob(encodedState));
  } catch {
    return error('Invalid OAuth state', 400);
  }

  // Verify the Supabase token
  const user = await verifySupabaseToken(accessToken);
  if (!user) {
    return error('Invalid Supabase token', 401);
  }

  // Generate authorization code
  const authCode = crypto.randomUUID();

  const codeEntry: AuthorizationCode = {
    code: authCode,
    client_id: oauthState.client_id,
    redirect_uri: oauthState.redirect_uri,
    code_challenge: oauthState.code_challenge,
    code_challenge_method: oauthState.code_challenge_method,
    supabase_access_token: accessToken,
    supabase_refresh_token: refreshToken,
    user_id: user.id,
    user_email: user.email,
    scope: oauthState.scope,
    created_at: Date.now(),
  };

  authorizationCodes.set(authCode, codeEntry);
  if (authorizationCodes.size > 50) cleanupExpired();

  // Build redirect URL back to the MCP client
  const redirectUrl = new URL(oauthState.redirect_uri);
  redirectUrl.searchParams.set('code', authCode);
  if (oauthState.state) {
    redirectUrl.searchParams.set('state', oauthState.state);
  }

  return json({ redirect: redirectUrl.toString() });
}

// ============================================
// HELPERS
// ============================================

function oauthError(errorCode: string, description: string, status: number): Response {
  return new Response(JSON.stringify({
    error: errorCode,
    error_description: description,
  }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * HTML page for handling Supabase implicit flow (hash-based tokens).
 * Extracts #access_token from URL hash and completes the OAuth flow.
 */
function getOAuthCallbackHTML(encodedState: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <title>Authorizing...</title>
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
    <p>Completing authorization...</p>
  </div>
  <script>
    (async function() {
      // Supabase implicit flow returns tokens in URL hash
      const hash = window.location.hash.substring(1);
      const params = new URLSearchParams(hash);
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');

      if (!accessToken) {
        document.querySelector('p').textContent = 'Authorization failed. No token received.';
        return;
      }

      // POST the token to our server-side handler to complete the flow
      try {
        const res = await fetch('/oauth/callback/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            access_token: accessToken,
            refresh_token: refreshToken || '',
            oauth_state: '${encodedState}',
          }),
        });

        if (res.ok) {
          const data = await res.json();
          if (data.redirect) {
            window.location.href = data.redirect;
          } else {
            document.querySelector('p').textContent = 'Authorization complete!';
          }
        } else {
          document.querySelector('p').textContent = 'Authorization failed. Please try again.';
        }
      } catch (e) {
        document.querySelector('p').textContent = 'Authorization failed: ' + e.message;
      }
    })();
  </script>
</body>
</html>`;
}
