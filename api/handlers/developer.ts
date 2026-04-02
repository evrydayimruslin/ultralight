// Developer Portal
// Serves the OAuth app management UI and CRUD API endpoints.
// Accessed via dev.ultralight-api.rgn4jz429m.workers.dev subdomain
// or /developer path on main domain.

import { json, error } from './app.ts';
import { authenticate } from './auth.ts';
import { generateClientSecret, generateSecretSalt, hashClientSecret } from './oauth.ts';
import { createClient } from '@supabase/supabase-js';
import { getEnv } from '../lib/env.ts';

// Lazy Supabase client — CF Workers env not available at module init
let _supabase: ReturnType<typeof createClient>;
function getSupabase() {
  if (!_supabase) _supabase = createClient(getEnv('SUPABASE_URL'), getEnv('SUPABASE_SERVICE_ROLE_KEY'));
  return _supabase;
}

// ============================================
// MAIN ROUTER
// ============================================

export async function handleDeveloper(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // Serve portal HTML at root or /developer
  if ((path === '/' || path === '/developer') && method === 'GET') {
    return new Response(getDeveloperPortalHTML(request), {
      headers: { 'Content-Type': 'text/html' },
    });
  }

  // API routes
  if (path === '/api/developer/apps' && method === 'GET') {
    return handleListApps(request);
  }
  if (path === '/api/developer/apps' && method === 'POST') {
    return handleCreateApp(request);
  }

  // Routes with :clientId
  const appMatch = path.match(/^\/api\/developer\/apps\/([^/]+)$/);
  if (appMatch) {
    const clientId = appMatch[1];
    if (method === 'GET') return handleGetApp(request, clientId);
    if (method === 'PATCH') return handleUpdateApp(request, clientId);
    if (method === 'DELETE') return handleDeleteApp(request, clientId);
  }

  const rotateMatch = path.match(/^\/api\/developer\/apps\/([^/]+)\/rotate-secret$/);
  if (rotateMatch && method === 'POST') {
    return handleRotateSecret(request, rotateMatch[1]);
  }

  return error('Not found', 404);
}

// ============================================
// API HANDLERS
// ============================================

async function handleListApps(request: Request): Promise<Response> {
  const user = await authenticate(request);

  const { data, error: err } = await getSupabase()
    .from('oauth_clients')
    .select('client_id, client_name, redirect_uris, logo_url, description, created_at')
    .eq('owner_user_id', user.id)
    .eq('is_developer_app', true)
    .order('created_at', { ascending: false });

  if (err) return error('Failed to list apps', 500);

  return json(data || []);
}

async function handleCreateApp(request: Request): Promise<Response> {
  const user = await authenticate(request);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return error('Invalid JSON', 400);
  }

  const name = body.name as string;
  const description = (body.description as string) || '';
  const redirectUris = body.redirect_uris as string[];
  const logoUrl = (body.logo_url as string) || null;

  if (!name || !name.trim()) {
    return error('name is required', 400);
  }
  if (!redirectUris || !Array.isArray(redirectUris) || redirectUris.length === 0) {
    return error('redirect_uris is required (at least one)', 400);
  }

  // Validate redirect URIs
  for (const uri of redirectUris) {
    try {
      new URL(uri);
    } catch {
      return error(`Invalid redirect_uri: ${uri}`, 400);
    }
  }

  // Generate client credentials
  const clientId = crypto.randomUUID();
  const clientSecret = generateClientSecret();
  const secretSalt = generateSecretSalt();
  const secretHash = await hashClientSecret(clientSecret, secretSalt);

  const { error: insertErr } = await getSupabase()
    .from('oauth_clients')
    .insert({
      client_id: clientId,
      client_name: name.trim(),
      redirect_uris: redirectUris,
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'client_secret_post',
      owner_user_id: user.id,
      client_secret_hash: secretHash,
      client_secret_salt: secretSalt,
      logo_url: logoUrl,
      description: description,
      is_developer_app: true,
    });

  if (insertErr) {
    console.error('Failed to create developer app:', insertErr);
    return error('Failed to create app', 500);
  }

  return json({
    client_id: clientId,
    client_secret: clientSecret, // Only shown once!
    client_name: name.trim(),
    redirect_uris: redirectUris,
    logo_url: logoUrl,
    description,
  }, 201);
}

async function handleGetApp(request: Request, clientId: string): Promise<Response> {
  const user = await authenticate(request);

  const { data, error: err } = await getSupabase()
    .from('oauth_clients')
    .select('client_id, client_name, redirect_uris, logo_url, description, created_at')
    .eq('client_id', clientId)
    .eq('owner_user_id', user.id)
    .eq('is_developer_app', true)
    .single();

  if (err || !data) return error('App not found', 404);

  return json(data);
}

async function handleUpdateApp(request: Request, clientId: string): Promise<Response> {
  const user = await authenticate(request);

  // Verify ownership
  const { data: existing } = await getSupabase()
    .from('oauth_clients')
    .select('client_id')
    .eq('client_id', clientId)
    .eq('owner_user_id', user.id)
    .eq('is_developer_app', true)
    .single();

  if (!existing) return error('App not found', 404);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return error('Invalid JSON', 400);
  }

  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates.client_name = (body.name as string).trim();
  if (body.description !== undefined) updates.description = body.description;
  if (body.logo_url !== undefined) updates.logo_url = body.logo_url;
  if (body.redirect_uris !== undefined) {
    const uris = body.redirect_uris as string[];
    if (!Array.isArray(uris) || uris.length === 0) {
      return error('redirect_uris must have at least one URI', 400);
    }
    for (const uri of uris) {
      try { new URL(uri); } catch { return error(`Invalid redirect_uri: ${uri}`, 400); }
    }
    updates.redirect_uris = uris;
  }

  if (Object.keys(updates).length === 0) {
    return error('No fields to update', 400);
  }

  const { error: updateErr } = await getSupabase()
    .from('oauth_clients')
    .update(updates)
    .eq('client_id', clientId)
    .eq('owner_user_id', user.id);

  if (updateErr) return error('Failed to update app', 500);

  return json({ ok: true });
}

async function handleDeleteApp(request: Request, clientId: string): Promise<Response> {
  const user = await authenticate(request);

  const { error: deleteErr } = await getSupabase()
    .from('oauth_clients')
    .delete()
    .eq('client_id', clientId)
    .eq('owner_user_id', user.id)
    .eq('is_developer_app', true);

  if (deleteErr) return error('Failed to delete app', 500);

  // Also revoke all tokens created via this client
  await getSupabase()
    .from('user_api_tokens')
    .delete()
    .like('name', `oauth-${clientId.slice(0, 8)}%`);

  // Clean up consent records
  await getSupabase()
    .from('oauth_consents')
    .delete()
    .eq('client_id', clientId);

  return json({ ok: true });
}

async function handleRotateSecret(request: Request, clientId: string): Promise<Response> {
  const user = await authenticate(request);

  // Verify ownership
  const { data: existing } = await getSupabase()
    .from('oauth_clients')
    .select('client_id')
    .eq('client_id', clientId)
    .eq('owner_user_id', user.id)
    .eq('is_developer_app', true)
    .single();

  if (!existing) return error('App not found', 404);

  // Generate new secret
  const clientSecret = generateClientSecret();
  const secretSalt = generateSecretSalt();
  const secretHash = await hashClientSecret(clientSecret, secretSalt);

  const { error: updateErr } = await getSupabase()
    .from('oauth_clients')
    .update({
      client_secret_hash: secretHash,
      client_secret_salt: secretSalt,
    })
    .eq('client_id', clientId)
    .eq('owner_user_id', user.id);

  if (updateErr) return error('Failed to rotate secret', 500);

  return json({
    client_secret: clientSecret, // Only shown once!
  });
}

// ============================================
// DEVELOPER PORTAL HTML
// ============================================

function getDeveloperPortalHTML(request: Request): string {
  const baseUrl = new URL(request.url);
  const apiOrigin = baseUrl.origin.replace('http://', 'https://').replace('dev.', '');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Ultralight Developer Portal</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #0a0a0a; color: #e5e5e5; min-height: 100vh; }
    a { color: #e5e5e5; }

    .nav { border-bottom: 1px solid #1a1a1a; padding: 1rem 2rem; display: flex; align-items: center; justify-content: space-between; }
    .nav-brand { font-weight: 700; font-size: 1rem; letter-spacing: -0.02em; }
    .nav-brand span { color: #888; font-weight: 400; margin-left: 0.5rem; }
    .nav-right { display: flex; align-items: center; gap: 1rem; }
    #nav-email { color: #888; font-size: 0.8rem; }

    .container { max-width: 800px; margin: 0 auto; padding: 2rem; }
    h1 { font-size: 1.5rem; font-weight: 600; margin-bottom: 0.5rem; }
    .subtitle { color: #888; font-size: 0.875rem; margin-bottom: 2rem; }

    .card { background: #141414; border: 1px solid #222; border-radius: 12px; padding: 1.5rem; margin-bottom: 1rem; }
    .card h2 { font-size: 1rem; font-weight: 600; margin-bottom: 1rem; }

    .app-row { display: flex; align-items: center; justify-content: space-between; padding: 0.75rem 0; border-bottom: 1px solid #1a1a1a; cursor: pointer; }
    .app-row:last-child { border-bottom: none; }
    .app-row:hover { opacity: 0.8; }
    .app-name { font-weight: 500; }
    .app-id { color: #666; font-size: 0.75rem; font-family: monospace; }
    .app-date { color: #666; font-size: 0.75rem; }

    .empty { text-align: center; padding: 2rem; color: #666; }

    input, textarea { width: 100%; padding: 0.625rem 0.75rem; background: #0a0a0a; border: 1px solid #333; border-radius: 8px; color: #e5e5e5; font-size: 0.875rem; font-family: inherit; }
    input:focus, textarea:focus { outline: none; border-color: #555; }
    textarea { resize: vertical; min-height: 80px; }
    label { display: block; font-size: 0.8rem; color: #888; margin-bottom: 0.375rem; margin-top: 1rem; }
    label:first-child { margin-top: 0; }

    .btn { padding: 0.625rem 1.25rem; border-radius: 8px; font-size: 0.875rem; font-weight: 500; cursor: pointer; border: none; transition: background 0.15s; }
    .btn-primary { background: #fff; color: #000; }
    .btn-primary:hover { background: #e5e5e5; }
    .btn-secondary { background: #222; color: #888; }
    .btn-secondary:hover { background: #333; color: #e5e5e5; }
    .btn-danger { background: #331111; color: #ff4444; }
    .btn-danger:hover { background: #441111; }
    .btn-sm { padding: 0.375rem 0.75rem; font-size: 0.8rem; }

    .actions { display: flex; gap: 0.75rem; margin-top: 1.5rem; }

    .secret-display { background: #0a0a0a; border: 1px solid #333; border-radius: 8px; padding: 0.75rem; font-family: monospace; font-size: 0.8rem; word-break: break-all; margin: 0.75rem 0; }
    .secret-warning { background: #332200; border: 1px solid #554400; border-radius: 8px; padding: 0.75rem; font-size: 0.8rem; color: #ffaa00; margin-bottom: 1rem; }

    .copy-btn { background: none; border: 1px solid #333; color: #888; padding: 0.25rem 0.5rem; border-radius: 4px; cursor: pointer; font-size: 0.75rem; margin-left: 0.5rem; }
    .copy-btn:hover { border-color: #555; color: #e5e5e5; }

    .detail-row { padding: 0.75rem 0; border-bottom: 1px solid #1a1a1a; }
    .detail-row:last-child { border-bottom: none; }
    .detail-label { font-size: 0.75rem; color: #666; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.25rem; }
    .detail-value { font-family: monospace; font-size: 0.85rem; word-break: break-all; }

    .docs { line-height: 1.7; font-size: 0.875rem; }
    .docs h3 { font-size: 0.9rem; font-weight: 600; margin-top: 1.5rem; margin-bottom: 0.5rem; }
    .docs h3:first-child { margin-top: 0; }
    .docs code { background: #1a1a1a; padding: 0.125rem 0.375rem; border-radius: 4px; font-size: 0.8rem; }
    .docs pre { background: #1a1a1a; border: 1px solid #222; border-radius: 8px; padding: 1rem; overflow-x: auto; margin: 0.75rem 0; font-size: 0.8rem; line-height: 1.5; }
    .docs pre code { background: none; padding: 0; }
    .docs table { width: 100%; border-collapse: collapse; margin: 0.75rem 0; font-size: 0.8rem; }
    .docs th, .docs td { padding: 0.5rem; text-align: left; border-bottom: 1px solid #222; }
    .docs th { color: #888; font-weight: 500; }

    .hidden { display: none; }

    .login-prompt { text-align: center; padding: 3rem; }
    .login-prompt a { color: #fff; text-decoration: underline; }

    @media (max-width: 640px) {
      .container { padding: 1rem; }
      .nav { padding: 1rem; }
    }
  </style>
</head>
<body>
  <div class="nav">
    <div class="nav-brand">ultralight <span>developers</span></div>
    <div class="nav-right">
      <span id="nav-email"></span>
    </div>
  </div>
  <div class="container">
    <!-- LIST VIEW -->
    <div id="view-list">
      <h1>OAuth Applications</h1>
      <p class="subtitle">Register apps that use "Login with Ultralight" to authenticate users.</p>
      <div style="display:flex;justify-content:flex-end;margin-bottom:1rem;">
        <button class="btn btn-primary btn-sm" onclick="showView('create')">New Application</button>
      </div>
      <div class="card">
        <div id="apps-list"><div class="empty">Loading...</div></div>
      </div>
      <div class="card docs" id="quickstart-docs">
        <h2>Quick Start</h2>
        <h3>Endpoints</h3>
        <table>
          <tr><th>Endpoint</th><th>URL</th></tr>
          <tr><td>Authorization</td><td><code>${apiOrigin}/oauth/authorize</code></td></tr>
          <tr><td>Token</td><td><code>${apiOrigin}/oauth/token</code></td></tr>
          <tr><td>User Info</td><td><code>${apiOrigin}/oauth/userinfo</code></td></tr>
          <tr><td>Revocation</td><td><code>${apiOrigin}/oauth/revoke</code></td></tr>
          <tr><td>Server Metadata</td><td><code>${apiOrigin}/.well-known/oauth-authorization-server</code></td></tr>
        </table>
        <h3>Scopes</h3>
        <table>
          <tr><th>Scope</th><th>Description</th></tr>
          <tr><td><code>user:read</code></td><td>View profile (name, avatar)</td></tr>
          <tr><td><code>user:email</code></td><td>View email address</td></tr>
          <tr><td><code>apps:read</code></td><td>List user apps</td></tr>
          <tr><td><code>apps:call</code></td><td>Call MCP tool functions</td></tr>
        </table>
        <h3>NextAuth / Auth.js Example</h3>
<pre><code>// auth.ts
import NextAuth from "next-auth"

export const { handlers, auth } = NextAuth({
  providers: [{
    id: "ultralight",
    name: "Ultralight",
    type: "oauth",
    authorization: {
      url: "${apiOrigin}/oauth/authorize",
      params: { scope: "user:read user:email" }
    },
    token: "${apiOrigin}/oauth/token",
    userinfo: "${apiOrigin}/oauth/userinfo",
    clientId: "YOUR_CLIENT_ID",
    clientSecret: "YOUR_CLIENT_SECRET",
    profile(profile) {
      return {
        id: profile.sub,
        name: profile.name,
        email: profile.email,
        image: profile.picture,
      }
    },
  }],
})</code></pre>
      </div>
    </div>

    <!-- CREATE VIEW -->
    <div id="view-create" class="hidden">
      <h1>Create Application</h1>
      <p class="subtitle">Register a new OAuth application.</p>
      <div class="card">
        <label>Application Name</label>
        <input id="create-name" placeholder="My App">
        <label>Description</label>
        <textarea id="create-description" placeholder="What does your app do?"></textarea>
        <label>Redirect URIs (one per line)</label>
        <textarea id="create-redirects" placeholder="https://myapp.com/api/auth/callback/ultralight"></textarea>
        <label>Logo URL (optional)</label>
        <input id="create-logo" placeholder="https://myapp.com/logo.png">
        <div class="actions">
          <button class="btn btn-primary" onclick="createApp()">Create Application</button>
          <button class="btn btn-secondary" onclick="showView('list')">Cancel</button>
        </div>
      </div>
    </div>

    <!-- SECRET VIEW (shown after create) -->
    <div id="view-secret" class="hidden">
      <h1>Application Created</h1>
      <p class="subtitle">Save your client secret now. It will not be shown again.</p>
      <div class="card">
        <div class="secret-warning">Copy your client secret now. You will not be able to see it again.</div>
        <div class="detail-row">
          <div class="detail-label">Client ID</div>
          <div class="detail-value" id="secret-client-id"></div>
        </div>
        <div class="detail-row">
          <div class="detail-label">Client Secret</div>
          <div class="secret-display" id="secret-value"></div>
        </div>
        <div class="actions">
          <button class="btn btn-primary" onclick="copySecret()">Copy Secret</button>
          <button class="btn btn-secondary" onclick="loadApps(); showView('list');">Done</button>
        </div>
      </div>
    </div>

    <!-- DETAIL VIEW -->
    <div id="view-detail" class="hidden">
      <h1 id="detail-name"></h1>
      <p class="subtitle" id="detail-description"></p>
      <div class="card">
        <div class="detail-row">
          <div class="detail-label">Client ID</div>
          <div class="detail-value" id="detail-client-id"></div>
        </div>
        <div class="detail-row">
          <div class="detail-label">Redirect URIs</div>
          <div class="detail-value" id="detail-redirects"></div>
        </div>
        <div class="detail-row">
          <div class="detail-label">Created</div>
          <div class="detail-value" id="detail-created"></div>
        </div>
        <div class="actions">
          <button class="btn btn-secondary btn-sm" onclick="rotateSecret()">Rotate Secret</button>
          <button class="btn btn-danger btn-sm" onclick="deleteApp()">Delete</button>
          <button class="btn btn-secondary btn-sm" onclick="loadApps(); showView('list');">Back</button>
        </div>
      </div>
    </div>

    <!-- LOGIN PROMPT -->
    <div id="view-login" class="hidden">
      <div class="login-prompt">
        <h1>Developer Portal</h1>
        <p class="subtitle" style="margin-bottom:1rem;">Sign in to manage your OAuth applications.</p>
        <a href="${apiOrigin}/auth/login?redirect=${encodeURIComponent(baseUrl.origin.replace('http://', 'https://') + '/')}">Sign in with Google</a>
      </div>
    </div>
  </div>

  <script>
    const API_BASE = '${apiOrigin}';
    let currentApps = [];
    let currentAppId = null;

    // Get token from cookie or localStorage
    function getToken() {
      // Check for ul_ token in cookie
      const cookies = document.cookie.split(';').map(c => c.trim());
      for (const c of cookies) {
        if (c.startsWith('ul_token=')) return c.slice(9);
      }
      // Check localStorage
      return localStorage.getItem('ul_token');
    }

    async function apiFetch(path, options = {}) {
      const token = getToken();
      if (!token) { showView('login'); throw new Error('Not authenticated'); }
      const res = await fetch(API_BASE + path, {
        ...options,
        headers: {
          'Authorization': 'Bearer ' + token,
          'Content-Type': 'application/json',
          ...(options.headers || {}),
        },
      });
      if (res.status === 401 || res.status === 403) {
        showView('login');
        throw new Error('Not authenticated');
      }
      return res;
    }

    function showView(name) {
      ['list', 'create', 'secret', 'detail', 'login'].forEach(v => {
        document.getElementById('view-' + v).classList.toggle('hidden', v !== name);
      });
    }

    async function loadApps() {
      try {
        const res = await apiFetch('/api/developer/apps');
        currentApps = await res.json();
        renderApps();
      } catch (e) {
        console.error('Failed to load apps:', e);
      }
    }

    function renderApps() {
      const el = document.getElementById('apps-list');
      if (currentApps.length === 0) {
        el.innerHTML = '<div class="empty">No OAuth applications yet. Create one to get started.</div>';
        return;
      }
      el.innerHTML = currentApps.map(app => {
        const date = new Date(app.created_at).toLocaleDateString();
        return '<div class="app-row" onclick="showAppDetail(\\'' + app.client_id + '\\')">' +
          '<div><div class="app-name">' + esc(app.client_name || 'Unnamed') + '</div>' +
          '<div class="app-id">' + app.client_id + '</div></div>' +
          '<div class="app-date">' + date + '</div></div>';
      }).join('');
    }

    async function createApp() {
      const name = document.getElementById('create-name').value.trim();
      const description = document.getElementById('create-description').value.trim();
      const redirects = document.getElementById('create-redirects').value.trim().split('\\n').filter(Boolean);
      const logo = document.getElementById('create-logo').value.trim() || null;

      if (!name) return alert('Name is required');
      if (redirects.length === 0) return alert('At least one redirect URI is required');

      try {
        const res = await apiFetch('/api/developer/apps', {
          method: 'POST',
          body: JSON.stringify({ name, description, redirect_uris: redirects, logo_url: logo }),
        });
        if (!res.ok) { const e = await res.json(); alert(e.error || 'Failed'); return; }
        const data = await res.json();
        document.getElementById('secret-client-id').textContent = data.client_id;
        document.getElementById('secret-value').textContent = data.client_secret;
        showView('secret');
        // Clear form
        document.getElementById('create-name').value = '';
        document.getElementById('create-description').value = '';
        document.getElementById('create-redirects').value = '';
        document.getElementById('create-logo').value = '';
      } catch (e) { alert('Error: ' + e.message); }
    }

    function copySecret() {
      const secret = document.getElementById('secret-value').textContent;
      navigator.clipboard.writeText(secret).then(() => {
        const btn = document.querySelector('#view-secret .btn-primary');
        btn.textContent = 'Copied!';
        setTimeout(() => btn.textContent = 'Copy Secret', 2000);
      });
    }

    async function showAppDetail(clientId) {
      currentAppId = clientId;
      try {
        const res = await apiFetch('/api/developer/apps/' + clientId);
        const app = await res.json();
        document.getElementById('detail-name').textContent = app.client_name || 'Unnamed';
        document.getElementById('detail-description').textContent = app.description || '';
        document.getElementById('detail-client-id').textContent = app.client_id;
        document.getElementById('detail-redirects').textContent = (app.redirect_uris || []).join(', ');
        document.getElementById('detail-created').textContent = new Date(app.created_at).toLocaleString();
        showView('detail');
      } catch (e) { alert('Error: ' + e.message); }
    }

    async function rotateSecret() {
      if (!confirm('Are you sure? This will invalidate the current secret.')) return;
      try {
        const res = await apiFetch('/api/developer/apps/' + currentAppId + '/rotate-secret', { method: 'POST' });
        const data = await res.json();
        document.getElementById('secret-client-id').textContent = currentAppId;
        document.getElementById('secret-value').textContent = data.client_secret;
        showView('secret');
      } catch (e) { alert('Error: ' + e.message); }
    }

    async function deleteApp() {
      if (!confirm('Delete this application? All associated tokens will be revoked.')) return;
      try {
        await apiFetch('/api/developer/apps/' + currentAppId, { method: 'DELETE' });
        loadApps();
        showView('list');
      } catch (e) { alert('Error: ' + e.message); }
    }

    function esc(s) {
      const d = document.createElement('div');
      d.textContent = s;
      return d.innerHTML;
    }

    // Check auth on load — try to get user info
    async function init() {
      const token = getToken();
      if (!token) {
        // Check URL hash for token from auth redirect
        const hash = window.location.hash.substring(1);
        const params = new URLSearchParams(hash);
        const t = params.get('access_token');
        if (t && t.startsWith('ul_')) {
          localStorage.setItem('ul_token', t);
          window.location.hash = '';
        } else {
          showView('login');
          return;
        }
      }
      try {
        const res = await apiFetch('/api/developer/apps');
        if (res.ok) {
          currentApps = await res.json();
          renderApps();
          // Show email if available
          try {
            const uiRes = await fetch(API_BASE + '/oauth/userinfo', {
              headers: { 'Authorization': 'Bearer ' + getToken() },
            });
            if (uiRes.ok) {
              const ui = await uiRes.json();
              document.getElementById('nav-email').textContent = ui.email || ui.name || '';
            }
          } catch {}
        } else {
          showView('login');
        }
      } catch {
        showView('login');
      }
    }

    init();
  </script>
</body>
</html>`;
}
