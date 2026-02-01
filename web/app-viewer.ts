// App Viewer Page
// Displays deployed app with function execution UI

export function getAppViewerHTML(appId: string, appName: string, exports: string[]): string {
  const exportButtons = exports.length > 0
    ? exports.map(exp => `<button class="export-btn" data-export="${exp}">${exp}()</button>`).join('\n          ')
    : '<p class="no-exports">No exported functions found</p>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${appName} - Ultralight</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0a0a0a;
      color: #fff;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    header {
      padding: 1.5rem 2rem;
      border-bottom: 1px solid #222;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .logo {
      font-size: 1.5rem;
      font-weight: 700;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      text-decoration: none;
    }
    .app-name {
      font-size: 1.125rem;
      color: #888;
    }
    main {
      flex: 1;
      display: flex;
      flex-direction: column;
      padding: 2rem;
      max-width: 900px;
      margin: 0 auto;
      width: 100%;
    }
    h1 {
      font-size: 2rem;
      margin-bottom: 0.5rem;
    }
    .app-id {
      font-family: monospace;
      font-size: 0.875rem;
      color: #666;
      margin-bottom: 2rem;
    }
    .section {
      margin-bottom: 2rem;
    }
    .section-title {
      font-size: 0.875rem;
      text-transform: uppercase;
      color: #888;
      margin-bottom: 1rem;
      letter-spacing: 0.05em;
    }
    .exports-grid {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
    }
    .export-btn {
      padding: 0.75rem 1.25rem;
      background: #1a1a1a;
      color: #fff;
      border: 1px solid #333;
      border-radius: 8px;
      font-family: 'Monaco', 'Menlo', monospace;
      font-size: 0.9rem;
      cursor: pointer;
      transition: all 0.2s;
    }
    .export-btn:hover {
      background: #222;
      border-color: #667eea;
    }
    .export-btn.active {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      border-color: transparent;
    }
    .no-exports {
      color: #666;
      font-style: italic;
    }
    .args-section {
      margin-top: 1.5rem;
    }
    .args-input {
      width: 100%;
      padding: 1rem;
      background: #111;
      border: 1px solid #333;
      border-radius: 8px;
      color: #fff;
      font-family: 'Monaco', 'Menlo', monospace;
      font-size: 0.9rem;
      resize: vertical;
      min-height: 80px;
    }
    .args-input:focus {
      outline: none;
      border-color: #667eea;
    }
    .args-hint {
      font-size: 0.75rem;
      color: #666;
      margin-top: 0.5rem;
    }
    .run-btn {
      margin-top: 1rem;
      padding: 0.75rem 2rem;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.2s;
    }
    .run-btn:hover { opacity: 0.9; }
    .run-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .output-section {
      margin-top: 2rem;
    }
    .output {
      background: #111;
      border-radius: 8px;
      padding: 1.5rem;
      font-family: 'Monaco', 'Menlo', monospace;
      font-size: 0.875rem;
      white-space: pre-wrap;
      word-break: break-word;
      max-height: 400px;
      overflow-y: auto;
    }
    .output.success { border-left: 3px solid #4ade80; }
    .output.error { border-left: 3px solid #f87171; }
    .output-label {
      font-size: 0.75rem;
      color: #888;
      margin-bottom: 0.5rem;
    }
    .logs {
      margin-top: 1rem;
      padding: 1rem;
      background: #0d0d0d;
      border-radius: 6px;
      font-size: 0.8rem;
      color: #888;
    }
    .log-entry { margin-bottom: 0.25rem; }
    .duration {
      font-size: 0.75rem;
      color: #666;
      margin-top: 0.5rem;
    }
    footer {
      padding: 1.5rem;
      text-align: center;
      color: #555;
      font-size: 0.875rem;
      border-top: 1px solid #222;
    }
    .api-section {
      margin-top: 2rem;
      padding: 1.5rem;
      background: #111;
      border-radius: 8px;
    }
    .api-url {
      font-family: monospace;
      background: #1a1a1a;
      padding: 0.75rem;
      border-radius: 6px;
      word-break: break-all;
      font-size: 0.85rem;
      color: #4ade80;
    }
    .copy-btn {
      margin-left: 0.5rem;
      padding: 0.25rem 0.5rem;
      background: #333;
      border: none;
      border-radius: 4px;
      color: #fff;
      font-size: 0.75rem;
      cursor: pointer;
    }
    .copy-btn:hover { background: #444; }
  </style>
</head>
<body>
  <header>
    <a href="/upload" class="logo">⚡ Ultralight</a>
    <span class="app-name">${appName}</span>
  </header>

  <main>
    <h1>${appName}</h1>
    <div class="app-id">ID: ${appId}</div>

    <div class="section">
      <div class="section-title">Exported Functions</div>
      <div class="exports-grid" id="exportsGrid">
        ${exportButtons}
      </div>
    </div>

    <div class="args-section">
      <div class="section-title">Arguments (JSON array)</div>
      <textarea class="args-input" id="argsInput" placeholder='["arg1", "arg2"] or leave empty for no arguments'>[]</textarea>
      <div class="args-hint">Enter arguments as a JSON array, e.g. ["hello", 123, true]</div>
    </div>

    <button class="run-btn" id="runBtn" disabled>Select a function to run</button>

    <div class="output-section" id="outputSection" style="display: none;">
      <div class="section-title">Output</div>
      <div class="output-label" id="outputLabel"></div>
      <div class="output" id="output"></div>
      <div class="logs" id="logs" style="display: none;"></div>
      <div class="duration" id="duration"></div>
    </div>

    <div class="api-section">
      <div class="section-title">API Endpoint</div>
      <div class="api-url" id="apiUrl">POST ${getBaseUrl()}/api/run/${appId}</div>
      <div class="args-hint" style="margin-top: 1rem;">
        Example request body: <code>{"function": "myFunction", "args": ["arg1"]}</code>
      </div>
    </div>
  </main>

  <footer>
    Powered by Ultralight • Built for vibecoders
  </footer>

  <script>
    const appId = '${appId}';
    const exports = ${JSON.stringify(exports)};
    let selectedFunction = null;

    const exportsGrid = document.getElementById('exportsGrid');
    const argsInput = document.getElementById('argsInput');
    const runBtn = document.getElementById('runBtn');
    const outputSection = document.getElementById('outputSection');
    const outputLabel = document.getElementById('outputLabel');
    const output = document.getElementById('output');
    const logs = document.getElementById('logs');
    const duration = document.getElementById('duration');

    // Function selection
    exportsGrid.addEventListener('click', (e) => {
      if (e.target.classList.contains('export-btn')) {
        document.querySelectorAll('.export-btn').forEach(btn => btn.classList.remove('active'));
        e.target.classList.add('active');
        selectedFunction = e.target.dataset.export;
        runBtn.disabled = false;
        runBtn.textContent = \`Run \${selectedFunction}()\`;
      }
    });

    // Run function
    runBtn.addEventListener('click', async () => {
      if (!selectedFunction) return;

      runBtn.disabled = true;
      runBtn.textContent = 'Running...';
      outputSection.style.display = 'block';
      output.className = 'output';
      output.textContent = 'Executing...';
      logs.style.display = 'none';
      duration.textContent = '';

      let args = [];
      try {
        const argsText = argsInput.value.trim();
        if (argsText && argsText !== '[]') {
          args = JSON.parse(argsText);
          if (!Array.isArray(args)) {
            args = [args]; // Wrap single value in array
          }
        }
      } catch (parseErr) {
        output.className = 'output error';
        output.textContent = 'Invalid JSON in arguments: ' + parseErr.message;
        runBtn.disabled = false;
        runBtn.textContent = \`Run \${selectedFunction}()\`;
        return;
      }

      try {
        const res = await fetch(\`/api/run/\${appId}\`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ function: selectedFunction, args })
        });

        const data = await res.json();

        if (data.success) {
          output.className = 'output success';
          outputLabel.textContent = 'Result:';
          output.textContent = typeof data.result === 'string'
            ? data.result
            : JSON.stringify(data.result, null, 2);
        } else {
          output.className = 'output error';
          outputLabel.textContent = 'Error:';
          output.textContent = data.error || 'Execution failed';
        }

        if (data.logs && data.logs.length > 0) {
          logs.style.display = 'block';
          logs.innerHTML = '<strong>Logs:</strong><br>' +
            data.logs.map(l => \`<div class="log-entry">\${l}</div>\`).join('');
        }

        if (data.duration_ms) {
          duration.textContent = \`Completed in \${data.duration_ms}ms\`;
        }
      } catch (err) {
        output.className = 'output error';
        outputLabel.textContent = 'Error:';
        output.textContent = err.message;
      } finally {
        runBtn.disabled = false;
        runBtn.textContent = \`Run \${selectedFunction}()\`;
      }
    });
  </script>
</body>
</html>`;
}

function getBaseUrl(): string {
  return ''; // Will use relative URL in browser
}
