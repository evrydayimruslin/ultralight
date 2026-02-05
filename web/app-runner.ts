// App Runner Page
// Renders deployed apps with full UI - actual deployment, not just function execution

export function getAppRunnerHTML(appId: string, appSlug: string, appName: string, code: string): string {
  // Escape the code for embedding in a script tag
  const escapedCode = code
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$/g, '\\$');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${appName} - Ultralight</title>

  <!-- React Runtime (for JSX apps) -->
  <script type="importmap">
  {
    "imports": {
      "react": "https://esm.sh/react@18",
      "react/": "https://esm.sh/react@18/",
      "react-dom": "https://esm.sh/react-dom@18",
      "react-dom/": "https://esm.sh/react-dom@18/",
      "react/jsx-runtime": "https://esm.sh/react@18/jsx-runtime",
      "react/jsx-dev-runtime": "https://esm.sh/react@18/jsx-dev-runtime"
    }
  }
  </script>

  <!-- Tailwind CSS (for utility classes) -->
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          colors: {
            'ultralight': {
              50: '#f5f3ff',
              100: '#ede9fe',
              200: '#ddd6fe',
              300: '#c4b5fd',
              400: '#a78bfa',
              500: '#8b5cf6',
              600: '#7c3aed',
              700: '#6d28d9',
              800: '#5b21b6',
              900: '#4c1d95',
            }
          }
        }
      }
    }
  </script>

  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      min-height: 100vh;
    }
    #app {
      min-height: 100vh;
    }
    /* Error display */
    .ultralight-error {
      position: fixed;
      bottom: 20px;
      right: 20px;
      max-width: 400px;
      padding: 1rem;
      background: #1a1a1a;
      border: 1px solid #f87171;
      border-radius: 8px;
      color: #fff;
      font-family: monospace;
      font-size: 0.875rem;
      z-index: 10000;
    }
    .ultralight-error-title {
      color: #f87171;
      font-weight: bold;
      margin-bottom: 0.5rem;
    }
    .ultralight-error-close {
      position: absolute;
      top: 8px;
      right: 8px;
      background: none;
      border: none;
      color: #888;
      cursor: pointer;
      font-size: 1.25rem;
    }
    /* Auth overlay */
    .ultralight-auth-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.85);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10001;
    }
    .ultralight-auth-box {
      background: #1a1a1a;
      border: 1px solid #333;
      border-radius: 12px;
      padding: 2rem;
      max-width: 400px;
      text-align: center;
      color: #fff;
    }
    .ultralight-auth-box h2 {
      margin-bottom: 0.5rem;
      font-size: 1.25rem;
    }
    .ultralight-auth-box p {
      color: #888;
      margin-bottom: 1.5rem;
      font-size: 0.875rem;
    }
    .ultralight-auth-btn {
      display: inline-block;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 0.75rem 2rem;
      border-radius: 8px;
      text-decoration: none;
      font-weight: 600;
      border: none;
      cursor: pointer;
      font-size: 0.9rem;
    }
    .ultralight-auth-btn:hover {
      opacity: 0.9;
    }
  </style>
</head>
<body>
  <div id="app"></div>

  <script type="module">
    // ============================================
    // Token Manager - handles JWT lifecycle
    // ============================================
    const tokenManager = {
      _refreshPromise: null,
      _retried: false,

      getToken() {
        return localStorage.getItem('ultralight_token');
      },

      isExpired(token) {
        if (!token) return true;
        try {
          const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
          const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
          const payload = JSON.parse(atob(padded));
          // Treat as expired if less than 60 seconds remaining
          return !payload.exp || (payload.exp * 1000) < (Date.now() + 60000);
        } catch {
          return true;
        }
      },

      getExpiry(token) {
        if (!token) return null;
        try {
          const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
          const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
          const payload = JSON.parse(atob(padded));
          return payload.exp ? new Date(payload.exp * 1000).toISOString() : 'no-exp';
        } catch { return 'decode-error'; }
      },

      async ensureValidToken() {
        const token = this.getToken();
        if (token && !this.isExpired(token)) {
          return token;
        }

        // Token missing or expired — try refresh
        console.log('[ultralight] Token expired or missing, attempting refresh...');
        if (!this._refreshPromise) {
          this._refreshPromise = this._doRefresh().finally(() => {
            this._refreshPromise = null;
          });
        }
        return this._refreshPromise;
      },

      async _doRefresh() {
        const refreshToken = localStorage.getItem('ultralight_refresh_token');
        if (!refreshToken) {
          console.warn('[ultralight] No refresh_token available');
          this.showLoginPrompt('Please sign in to use this app.');
          throw new Error('AUTH_NO_REFRESH_TOKEN');
        }

        try {
          const res = await fetch('/auth/refresh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh_token: refreshToken }),
          });

          if (!res.ok) {
            console.error('[ultralight] Token refresh failed:', res.status);
            localStorage.removeItem('ultralight_token');
            localStorage.removeItem('ultralight_refresh_token');
            this.showLoginPrompt('Your session has expired. Please sign in again.');
            throw new Error('AUTH_REFRESH_FAILED');
          }

          const data = await res.json();
          localStorage.setItem('ultralight_token', data.access_token);
          if (data.refresh_token) {
            localStorage.setItem('ultralight_refresh_token', data.refresh_token);
          }
          console.log('[ultralight] Token refreshed, new expiry:', this.getExpiry(data.access_token));
          return data.access_token;
        } catch (err) {
          if (err.message !== 'AUTH_REFRESH_FAILED' && err.message !== 'AUTH_NO_REFRESH_TOKEN') {
            console.error('[ultralight] Token refresh error:', err);
            this.showLoginPrompt('Session error. Please sign in again.');
          }
          throw err;
        }
      },

      showLoginPrompt(message) {
        if (document.querySelector('.ultralight-auth-overlay')) return;
        const overlay = document.createElement('div');
        overlay.className = 'ultralight-auth-overlay';
        overlay.innerHTML = \`
          <div class="ultralight-auth-box">
            <h2>Sign In Required</h2>
            <p>\${message || 'Please sign in to continue.'}</p>
            <a href="/auth/login" class="ultralight-auth-btn">Sign In with Google</a>
          </div>
        \`;
        document.body.appendChild(overlay);
      },

      dismissLoginPrompt() {
        const overlay = document.querySelector('.ultralight-auth-overlay');
        if (overlay) overlay.remove();
      }
    };

    // ============================================
    // Ultralight Runtime - provides APIs to the running app
    // ============================================
    const ultralightRuntime = {
      appId: '${appId}',
      appSlug: '${appSlug}',

      // Memory API - persisted key-value storage
      memory: {
        async get(key) {
          try {
            const res = await fetch('/api/memory/${appId}/' + encodeURIComponent(key));
            if (!res.ok) return null;
            const data = await res.json();
            return data.value;
          } catch { return null; }
        },
        async set(key, value) {
          try {
            await fetch('/api/memory/${appId}/' + encodeURIComponent(key), {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ value })
            });
          } catch (e) { console.error('Memory set failed:', e); }
        },
        async delete(key) {
          try {
            await fetch('/api/memory/${appId}/' + encodeURIComponent(key), {
              method: 'DELETE'
            });
          } catch (e) { console.error('Memory delete failed:', e); }
        }
      },

      // AI API - call LLMs
      ai: {
        async chat(messages, options = {}) {
          const res = await fetch('/api/ai/${appId}/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages, ...options })
          });
          if (!res.ok) throw new Error('AI call failed');
          return res.json();
        }
      },

      // Data API - app-specific storage
      data: {
        async get(key) {
          try {
            const res = await fetch('/api/data/${appId}/' + encodeURIComponent(key));
            if (!res.ok) return null;
            const data = await res.json();
            return data.value;
          } catch { return null; }
        },
        async set(key, value) {
          await fetch('/api/data/${appId}/' + encodeURIComponent(key), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ value })
          });
        },
        async list(prefix = '') {
          const res = await fetch('/api/data/${appId}?prefix=' + encodeURIComponent(prefix));
          if (!res.ok) return [];
          return res.json();
        }
      },

      // MCP API - call app's own functions (with auth + token refresh)
      async call(functionName, args = {}) {
        const callId = Date.now();
        console.log('[ultralight.call] #' + callId, functionName, JSON.stringify(args).substring(0, 200));

        // Ensure we have a valid token (refreshes automatically if expired)
        let token;
        try {
          token = await tokenManager.ensureValidToken();
        } catch (authErr) {
          console.error('[ultralight.call] #' + callId, 'Auth failed before call:', authErr.message);
          throw authErr;
        }

        const headers = { 'Content-Type': 'application/json' };
        if (token) {
          headers['Authorization'] = 'Bearer ' + token;
          console.log('[ultralight.call] #' + callId, 'token present, expires:', tokenManager.getExpiry(token));
        } else {
          console.warn('[ultralight.call] #' + callId, 'No token available');
        }

        // Auto-prefix function name with app slug for MCP protocol
        const prefixedName = functionName.includes('_') ? functionName : '${appSlug}_' + functionName;

        const res = await fetch('/mcp/${appId}', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: callId,
            method: 'tools/call',
            params: { name: prefixedName, arguments: args }
          })
        });

        console.log('[ultralight.call] #' + callId, 'response status:', res.status);

        const data = await res.json();

        if (data.error) {
          const errorType = data.error.data?.type;
          console.error('[ultralight.call] #' + callId, 'error:', errorType, data.error.message);

          // If token expired on server side, try one refresh+retry cycle
          if (errorType === 'AUTH_TOKEN_EXPIRED' && !tokenManager._retried) {
            console.log('[ultralight.call] #' + callId, 'Token expired on server, attempting refresh+retry...');
            tokenManager._retried = true;
            try {
              await tokenManager._doRefresh();
              const result = await this.call(functionName, args);
              tokenManager._retried = false;
              return result;
            } catch (retryErr) {
              tokenManager._retried = false;
              throw retryErr;
            }
          }

          if (errorType?.startsWith('AUTH_')) {
            tokenManager.showLoginPrompt(data.error.message);
          }

          throw new Error(data.error.message);
        }

        console.log('[ultralight.call] #' + callId, 'success');
        return data.result?.structuredContent || data.result || {};
      }
    };

    // Make runtime available globally
    window.ultralight = ultralightRuntime;

    // Error handler
    function showError(title, message) {
      const existing = document.querySelector('.ultralight-error');
      if (existing) existing.remove();

      const errorDiv = document.createElement('div');
      errorDiv.className = 'ultralight-error';
      errorDiv.innerHTML = \`
        <button class="ultralight-error-close" onclick="this.parentElement.remove()">×</button>
        <div class="ultralight-error-title">\${title}</div>
        <div>\${message}</div>
      \`;
      document.body.appendChild(errorDiv);
    }

    window.onerror = (msg, src, line, col, err) => {
      showError('Runtime Error', \`\${msg} (line \${line})\`);
    };

    window.onunhandledrejection = (e) => {
      showError('Unhandled Promise Rejection', e.reason?.message || String(e.reason));
    };

    // Check auth state before running app — attempt refresh if expired
    try {
      await tokenManager.ensureValidToken();
      console.log('[ultralight] Auth ready, token valid');
    } catch (authErr) {
      // Login prompt is already shown by tokenManager if needed
      console.warn('[ultralight] No valid auth token at startup:', authErr.message);
      // Don't block app loading — the app may show public content or handle auth errors in call()
    }

    // Execute the app code
    try {
      const appCode = \`${escapedCode}\`;

      // Create a module from the code
      const blob = new Blob([appCode], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);

      // Import and run the module
      const module = await import(url);
      URL.revokeObjectURL(url);

      // If module exports a default function or render/mount/init, call it
      const app = document.getElementById('app');

      if (typeof module.default === 'function') {
        const result = module.default(app, ultralightRuntime);
        if (result instanceof Promise) await result;
      } else if (typeof module.render === 'function') {
        const result = module.render(app, ultralightRuntime);
        if (result instanceof Promise) await result;
      } else if (typeof module.mount === 'function') {
        const result = module.mount(app, ultralightRuntime);
        if (result instanceof Promise) await result;
      } else if (typeof module.init === 'function') {
        const result = module.init(app, ultralightRuntime);
        if (result instanceof Promise) await result;
      } else if (typeof module.main === 'function') {
        const result = module.main(app, ultralightRuntime);
        if (result instanceof Promise) await result;
      }

      console.log('✨ App loaded successfully');
    } catch (err) {
      console.error('Failed to load app:', err);
      showError('Failed to Load App', err.message);
    }
  </script>
</body>
</html>`;
}
