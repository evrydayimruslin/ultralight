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
    .tagline {
      color: #666;
      font-size: 0.875rem;
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
    <div class="tagline">The deployment target for vibecoders</div>
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
    
    let files = [];
    
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
      
      log('info', 'Starting upload...');
      
      const formData = new FormData();
      files.forEach(f => formData.append('files', f));
      
      try {
        log('info', 'Uploading files...');
        const res = await fetch('/api/upload', {
          method: 'POST',
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
