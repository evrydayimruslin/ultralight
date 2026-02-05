// App Runner Page
// Renders deployed apps with full UI - actual deployment, not just function execution

export function getAppRunnerHTML(appId: string, appName: string, code: string): string {
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
  </style>
</head>
<body>
  <div id="app"></div>

  <script type="module">
    // Ultralight Runtime - provides APIs to the running app
    const ultralightRuntime = {
      appId: '${appId}',

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

      // MCP API - call app's own functions
      async call(functionName, args = {}) {
        const token = localStorage.getItem('ultralight_token');
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = 'Bearer ' + token;

        const res = await fetch('/mcp/${appId}', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: Date.now(),
            method: 'tools/call',
            params: { name: functionName, arguments: args }
          })
        });

        const data = await res.json();
        if (data.error) throw new Error(data.error.message);
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
