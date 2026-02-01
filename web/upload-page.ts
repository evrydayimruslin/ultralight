// Simple HTML Upload Page
// Can be served statically or embedded in the API

export function getUploadPageHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ultralight - Deploy Your Vibe</title>
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
    }
    .header-right {
      display: flex;
      align-items: center;
      gap: 1rem;
    }
    .tagline {
      color: #666;
      font-size: 0.875rem;
    }
    .user-info {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      color: #888;
      font-size: 0.875rem;
    }
    .user-email {
      color: #fff;
    }
    .auth-btn {
      padding: 0.5rem 1rem;
      background: #1a1a1a;
      color: #fff;
      border: 1px solid #333;
      border-radius: 6px;
      font-size: 0.875rem;
      cursor: pointer;
      transition: all 0.2s;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      text-decoration: none;
    }
    .auth-btn:hover {
      background: #222;
      border-color: #444;
    }
    .auth-btn.google {
      background: #fff;
      color: #333;
      border-color: #ddd;
    }
    .auth-btn.google:hover {
      background: #f5f5f5;
    }
    .auth-btn.signout {
      background: transparent;
      border-color: #666;
      color: #ccc;
    }
    .auth-btn.signout:hover {
      border-color: #f87171;
      color: #f87171;
    }
    .google-icon {
      width: 18px;
      height: 18px;
    }
    main {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 2rem;
      max-width: 800px;
      margin: 0 auto;
      width: 100%;
    }
    h1 {
      font-size: 2.5rem;
      margin-bottom: 0.5rem;
      text-align: center;
    }
    .subtitle {
      color: #888;
      margin-bottom: 2rem;
      text-align: center;
    }
    .drop-zone {
      width: 100%;
      min-height: 300px;
      border: 2px dashed #333;
      border-radius: 16px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 2rem;
      transition: all 0.2s;
      cursor: pointer;
    }
    .drop-zone:hover, .drop-zone.dragover {
      border-color: #667eea;
      background: rgba(102, 126, 234, 0.05);
    }
    .drop-zone-icon {
      font-size: 3rem;
      margin-bottom: 1rem;
      opacity: 0.5;
    }
    .drop-zone-text {
      font-size: 1.125rem;
      color: #888;
      margin-bottom: 0.5rem;
    }
    .drop-zone-hint {
      font-size: 0.875rem;
      color: #555;
    }
    input[type="file"] {
      display: none;
    }
    .file-list {
      width: 100%;
      margin-top: 1rem;
    }
    .file-item {
      display: flex;
      justify-content: space-between;
      padding: 0.75rem;
      background: #111;
      border-radius: 8px;
      margin-bottom: 0.5rem;
    }
    .build-logs {
      width: 100%;
      background: #111;
      border-radius: 8px;
      padding: 1rem;
      margin-top: 1rem;
      font-family: 'Monaco', 'Menlo', monospace;
      font-size: 0.875rem;
      max-height: 300px;
      overflow-y: auto;
    }
    .log-entry {
      margin-bottom: 0.25rem;
    }
    .log-info { color: #888; }
    .log-success { color: #4ade80; }
    .log-error { color: #f87171; }
    .log-warn { color: #fbbf24; }
    .upload-btn {
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
    .upload-btn:hover { opacity: 0.9; }
    .upload-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .result {
      width: 100%;
      margin-top: 2rem;
      padding: 1.5rem;
      background: #111;
      border-radius: 12px;
    }
    .result-title {
      font-size: 0.875rem;
      text-transform: uppercase;
      color: #888;
      margin-bottom: 0.5rem;
    }
    .result-url {
      font-family: monospace;
      background: #1a1a1a;
      padding: 0.75rem;
      border-radius: 6px;
      word-break: break-all;
    }
    footer {
      padding: 1.5rem;
      text-align: center;
      color: #555;
      font-size: 0.875rem;
      border-top: 1px solid #222;
    }
  </style>
</head>
<body>
  <header>
    <div class="logo">⚡ Ultralight</div>
    <div class="header-right">
      <div class="tagline">The deployment target for vibecoders</div>
      <div id="authSection">
        <a href="/auth/login" class="auth-btn google">
          <svg class="google-icon" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          Sign in with Google
        </a>
      </div>
    </div>
  </header>

  <main>
    <h1>Upload your code</h1>
    <p class="subtitle">Drag your folder or select files to deploy instantly</p>

    <div class="drop-zone" id="dropZone">
      <div class="drop-zone-icon">📁</div>
      <div class="drop-zone-text">Drop your code folder here</div>
      <div class="drop-zone-hint">or click to browse • Max 10MB • .ts .js .json .md</div>
      <input type="file" id="fileInput" webkitdirectory directory multiple>
    </div>

    <div class="file-list" id="fileList"></div>

    <button class="upload-btn" id="uploadBtn" disabled>Deploy App</button>

    <div class="build-logs" id="buildLogs" style="display: none;"></div>

    <div class="result" id="result" style="display: none;">
      <div class="result-title">Your app is live</div>
      <div class="result-url" id="resultUrl"></div>
    </div>
  </main>

  <footer>
    Built for vibecoders • Powered by Deno • Stored on Cloudflare
  </footer>

  <script>
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    const fileList = document.getElementById('fileList');
    const uploadBtn = document.getElementById('uploadBtn');
    const buildLogs = document.getElementById('buildLogs');
    const result = document.getElementById('result');
    const resultUrl = document.getElementById('resultUrl');
    const authSection = document.getElementById('authSection');

    let files = [];
    let authToken = localStorage.getItem('ultralight_token');

    // Check auth state and update UI
    function updateAuthUI() {
      if (authToken) {
        // Decode JWT to get email (basic decode, not verification)
        try {
          const payload = JSON.parse(atob(authToken.split('.')[1]));
          const email = payload.email || 'User';
          authSection.innerHTML = \`
            <div class="user-info">
              <span class="user-email">\${email}</span>
              <button class="auth-btn signout" onclick="signOut()">Sign out</button>
            </div>
          \`;
        } catch {
          // Invalid token, clear it
          localStorage.removeItem('ultralight_token');
          authToken = null;
        }
      }
    }

    function signOut() {
      localStorage.removeItem('ultralight_token');
      authToken = null;
      window.location.reload();
    }

    // Initialize auth UI
    updateAuthUI();

    dropZone.addEventListener('click', () => fileInput.click());

    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      files = Array.from(e.dataTransfer.files);
      updateFileList();
    });

    fileInput.addEventListener('change', () => {
      files = Array.from(fileInput.files);
      updateFileList();
    });

    function updateFileList() {
      fileList.innerHTML = files.map(f => \`
        <div class="file-item">
          <span>\${f.name}</span>
          <span>\${(f.size / 1024).toFixed(1)} KB</span>
        </div>
      \`).join('');
      uploadBtn.disabled = files.length === 0;
    }

    function log(level, message) {
      const entry = document.createElement('div');
      entry.className = \`log-entry log-\${level}\`;
      entry.textContent = \`[\${new Date().toLocaleTimeString()}] \${message}\`;
      buildLogs.appendChild(entry);
      buildLogs.scrollTop = buildLogs.scrollHeight;
    }

    uploadBtn.addEventListener('click', async () => {
      buildLogs.style.display = 'block';
      buildLogs.innerHTML = '';
      uploadBtn.disabled = true;
      result.style.display = 'none';

      // Re-read token in case user just signed in
      const currentToken = localStorage.getItem('ultralight_token');

      if (!currentToken) {
        log('error', 'Please sign in to upload');
        uploadBtn.disabled = false;
        return;
      }

      log('info', 'Starting upload...');
      console.log('Token being sent:', currentToken.substring(0, 50) + '...');

      const formData = new FormData();
      files.forEach(f => formData.append('files', f));

      try {
        log('info', 'Uploading files...');

        const headers = {
          'Authorization': \`Bearer \${currentToken}\`
        };
        console.log('Authorization header:', headers.Authorization.substring(0, 60) + '...');

        const res = await fetch('/api/upload', {
          method: 'POST',
          headers,
          body: formData
        });

        const data = await res.json();

        if (data.build_logs) {
          data.build_logs.forEach(l => log(l.level, l.message));
        }

        if (data.app_id) {
          result.style.display = 'block';
          resultUrl.textContent = window.location.origin + data.url;
          log('success', 'Deploy complete!');
        } else {
          log('error', data.error || 'Upload failed');
        }
      } catch (err) {
        log('error', err.message);
      } finally {
        uploadBtn.disabled = false;
      }
    });
  </script>
</body>
</html>`;
}
