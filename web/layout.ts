// Shared Layout Component
// ChatGPT-like UI with persistent sidebar

export function getLayoutHTML(options: {
  title?: string;
  activeAppId?: string;
  initialView: 'upload' | 'app' | 'settings';
  appCode?: string;
  appName?: string;
}): string {
  const { title = 'Ultralight', activeAppId, initialView, appCode, appName } = options;

  // Escape app code if provided
  const escapedCode = appCode
    ? appCode
        .replace(/\\/g, '\\\\')
        .replace(/`/g, '\\`')
        .replace(/\$/g, '\\$')
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - Ultralight</title>

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

    :root {
      --sidebar-width: 260px;
      --bg-primary: #0a0a0a;
      --bg-secondary: #111111;
      --bg-tertiary: #1a1a1a;
      --bg-hover: #222222;
      --border-color: #2a2a2a;
      --text-primary: #ffffff;
      --text-secondary: #888888;
      --text-muted: #555555;
      --accent-gradient: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      --accent-color: #667eea;
      --success-color: #4ade80;
      --error-color: #f87171;
      --warning-color: #fbbf24;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg-primary);
      color: var(--text-primary);
      min-height: 100vh;
      display: flex;
    }

    /* Sidebar */
    .sidebar {
      width: var(--sidebar-width);
      height: 100vh;
      background: var(--bg-secondary);
      border-right: 1px solid var(--border-color);
      display: flex;
      flex-direction: column;
      position: fixed;
      left: 0;
      top: 0;
      z-index: 100;
    }

    .sidebar-header {
      padding: 1rem;
      border-bottom: 1px solid var(--border-color);
    }

    .logo {
      font-size: 1.25rem;
      font-weight: 700;
      background: var(--accent-gradient);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .upload-btn {
      width: 100%;
      margin-top: 1rem;
      padding: 0.75rem 1rem;
      background: var(--bg-tertiary);
      color: var(--text-primary);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      font-size: 0.875rem;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
    }

    .upload-btn:hover {
      background: var(--bg-hover);
      border-color: var(--accent-color);
    }

    .upload-btn svg {
      width: 18px;
      height: 18px;
    }

    /* Apps List */
    .apps-section {
      flex: 1;
      overflow-y: auto;
      padding: 0.5rem;
    }

    .apps-section-title {
      font-size: 0.75rem;
      text-transform: uppercase;
      color: var(--text-muted);
      padding: 0.75rem 0.5rem 0.5rem;
      font-weight: 600;
      letter-spacing: 0.05em;
    }

    .app-list {
      list-style: none;
    }

    .app-item {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.625rem 0.75rem;
      border-radius: 8px;
      cursor: pointer;
      transition: background 0.15s;
      color: var(--text-secondary);
      text-decoration: none;
      position: relative;
    }

    .app-item:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
    }

    .app-item.active {
      background: var(--bg-tertiary);
      color: var(--text-primary);
    }

    .app-item:hover .app-settings-btn {
      opacity: 1;
    }

    .app-icon {
      width: 32px;
      height: 32px;
      border-radius: 6px;
      background: var(--bg-tertiary);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1rem;
      flex-shrink: 0;
    }

    .app-icon img {
      width: 100%;
      height: 100%;
      border-radius: 6px;
      object-fit: cover;
    }

    .app-info {
      flex: 1;
      min-width: 0;
    }

    .app-name {
      font-size: 0.875rem;
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .app-meta {
      font-size: 0.75rem;
      color: var(--text-muted);
    }

    .app-settings-btn {
      opacity: 0;
      background: transparent;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      padding: 0.25rem;
      border-radius: 4px;
      transition: all 0.15s;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .app-settings-btn:hover {
      color: var(--text-primary);
      background: var(--bg-tertiary);
    }

    .app-settings-btn svg {
      width: 16px;
      height: 16px;
    }

    .apps-empty {
      padding: 1.5rem 1rem;
      text-align: center;
      color: var(--text-muted);
      font-size: 0.875rem;
    }

    .apps-loading {
      padding: 1.5rem 1rem;
      text-align: center;
      color: var(--text-muted);
      font-size: 0.875rem;
    }

    /* User Section */
    .sidebar-footer {
      padding: 1rem;
      border-top: 1px solid var(--border-color);
    }

    .user-section {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .user-avatar {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: var(--bg-tertiary);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.875rem;
    }

    .user-info {
      flex: 1;
      min-width: 0;
    }

    .user-email {
      font-size: 0.875rem;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .user-tier {
      font-size: 0.75rem;
      color: var(--text-muted);
    }

    .auth-btn {
      padding: 0.5rem 0.75rem;
      background: var(--bg-tertiary);
      color: var(--text-primary);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      font-size: 0.8125rem;
      cursor: pointer;
      transition: all 0.2s;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      text-decoration: none;
    }

    .auth-btn:hover {
      background: var(--bg-hover);
    }

    .auth-btn.google {
      background: #fff;
      color: #333;
      border-color: #ddd;
      width: 100%;
      justify-content: center;
    }

    .auth-btn.google:hover {
      background: #f5f5f5;
    }

    .signout-btn {
      background: transparent;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      padding: 0.25rem;
      border-radius: 4px;
    }

    .signout-btn:hover {
      color: var(--error-color);
    }

    /* Main Content */
    .main-content {
      flex: 1;
      margin-left: var(--sidebar-width);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }

    /* Upload View */
    .upload-view {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 2rem;
      max-width: 700px;
      margin: 0 auto;
      width: 100%;
    }

    .upload-view h1 {
      font-size: 2rem;
      margin-bottom: 0.5rem;
      text-align: center;
    }

    .upload-view .subtitle {
      color: var(--text-secondary);
      margin-bottom: 2rem;
      text-align: center;
    }

    .name-input-container {
      width: 100%;
      margin-bottom: 1.5rem;
    }

    .name-input-container label {
      display: block;
      font-size: 0.875rem;
      color: var(--text-secondary);
      margin-bottom: 0.5rem;
    }

    .name-input {
      width: 100%;
      padding: 0.75rem 1rem;
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      color: var(--text-primary);
      font-size: 1rem;
      transition: border-color 0.2s;
    }

    .name-input:focus {
      outline: none;
      border-color: var(--accent-color);
    }

    .name-input::placeholder {
      color: var(--text-muted);
    }

    .drop-zone {
      width: 100%;
      min-height: 280px;
      border: 2px dashed var(--border-color);
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
      border-color: var(--accent-color);
      background: rgba(102, 126, 234, 0.05);
    }

    .drop-zone-icon {
      font-size: 3rem;
      margin-bottom: 1rem;
      opacity: 0.5;
    }

    .drop-zone-text {
      font-size: 1.125rem;
      color: var(--text-secondary);
      margin-bottom: 0.5rem;
    }

    .drop-zone-hint {
      font-size: 0.875rem;
      color: var(--text-muted);
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
      background: var(--bg-secondary);
      border-radius: 8px;
      margin-bottom: 0.5rem;
      font-size: 0.875rem;
    }

    .file-item span:last-child {
      color: var(--text-muted);
    }

    .deploy-btn {
      margin-top: 1.5rem;
      padding: 0.875rem 2.5rem;
      background: var(--accent-gradient);
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.2s, transform 0.1s;
    }

    .deploy-btn:hover {
      opacity: 0.9;
    }

    .deploy-btn:active {
      transform: scale(0.98);
    }

    .deploy-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      transform: none;
    }

    .build-logs {
      width: 100%;
      background: var(--bg-secondary);
      border-radius: 8px;
      padding: 1rem;
      margin-top: 1.5rem;
      font-family: 'Monaco', 'Menlo', 'Consolas', monospace;
      font-size: 0.8125rem;
      max-height: 250px;
      overflow-y: auto;
    }

    .log-entry {
      margin-bottom: 0.25rem;
      line-height: 1.5;
    }

    .log-info { color: var(--text-secondary); }
    .log-success { color: var(--success-color); }
    .log-error { color: var(--error-color); }
    .log-warn { color: var(--warning-color); }

    .result {
      width: 100%;
      margin-top: 1.5rem;
      padding: 1.25rem;
      background: var(--bg-secondary);
      border-radius: 12px;
      border: 1px solid var(--success-color);
    }

    .result-title {
      font-size: 0.875rem;
      color: var(--success-color);
      margin-bottom: 0.75rem;
      font-weight: 500;
    }

    .result-url-container {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .result-url {
      flex: 1;
      font-family: monospace;
      background: var(--bg-tertiary);
      padding: 0.75rem 1rem;
      border-radius: 6px;
      word-break: break-all;
      font-size: 0.875rem;
    }

    .copy-btn {
      padding: 0.75rem;
      background: var(--bg-tertiary);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      color: var(--text-secondary);
      cursor: pointer;
      transition: all 0.2s;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .copy-btn:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
    }

    .copy-btn.copied {
      background: var(--success-color);
      border-color: var(--success-color);
      color: white;
    }

    .copy-btn svg {
      width: 18px;
      height: 18px;
    }

    .result-actions {
      margin-top: 1rem;
      display: flex;
      gap: 0.75rem;
    }

    .result-actions button {
      padding: 0.625rem 1rem;
      background: var(--bg-tertiary);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      color: var(--text-primary);
      font-size: 0.875rem;
      cursor: pointer;
      transition: all 0.2s;
    }

    .result-actions button:hover {
      background: var(--bg-hover);
      border-color: var(--accent-color);
    }

    /* App View */
    .app-view {
      flex: 1;
      display: flex;
      flex-direction: column;
    }

    .app-view #app {
      flex: 1;
      min-height: 100vh;
    }

    /* Settings Modal */
    .modal-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.7);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      opacity: 0;
      visibility: hidden;
      transition: opacity 0.2s, visibility 0.2s;
    }

    .modal-overlay.open {
      opacity: 1;
      visibility: visible;
    }

    .modal {
      background: var(--bg-secondary);
      border-radius: 12px;
      border: 1px solid var(--border-color);
      width: 90%;
      max-width: 500px;
      max-height: 90vh;
      overflow-y: auto;
      transform: scale(0.95);
      transition: transform 0.2s;
    }

    .modal-overlay.open .modal {
      transform: scale(1);
    }

    .modal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 1.25rem 1.5rem;
      border-bottom: 1px solid var(--border-color);
    }

    .modal-title {
      font-size: 1.125rem;
      font-weight: 600;
    }

    .modal-close {
      background: transparent;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      padding: 0.25rem;
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .modal-close:hover {
      color: var(--text-primary);
      background: var(--bg-tertiary);
    }

    .modal-close svg {
      width: 20px;
      height: 20px;
    }

    .modal-body {
      padding: 1.5rem;
    }

    .settings-section {
      margin-bottom: 1.5rem;
    }

    .settings-section:last-child {
      margin-bottom: 0;
    }

    .settings-section-title {
      font-size: 0.75rem;
      text-transform: uppercase;
      color: var(--text-muted);
      margin-bottom: 0.75rem;
      font-weight: 600;
      letter-spacing: 0.05em;
    }

    .settings-field {
      margin-bottom: 1rem;
    }

    .settings-field:last-child {
      margin-bottom: 0;
    }

    .settings-field label {
      display: block;
      font-size: 0.875rem;
      color: var(--text-secondary);
      margin-bottom: 0.5rem;
    }

    .settings-input {
      width: 100%;
      padding: 0.625rem 0.875rem;
      background: var(--bg-tertiary);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      color: var(--text-primary);
      font-size: 0.875rem;
      transition: border-color 0.2s;
    }

    .settings-input:focus {
      outline: none;
      border-color: var(--accent-color);
    }

    .settings-select {
      width: 100%;
      padding: 0.625rem 0.875rem;
      background: var(--bg-tertiary);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      color: var(--text-primary);
      font-size: 0.875rem;
      cursor: pointer;
      appearance: none;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='%23888' viewBox='0 0 16 16'%3E%3Cpath d='M8 11L3 6h10l-5 5z'/%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 0.75rem center;
    }

    .settings-select:focus {
      outline: none;
      border-color: var(--accent-color);
    }

    /* Icon Upload */
    .icon-upload-container {
      display: flex;
      align-items: center;
      gap: 1rem;
    }

    .icon-preview {
      width: 64px;
      height: 64px;
      border-radius: 12px;
      background: var(--bg-tertiary);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.5rem;
      flex-shrink: 0;
      overflow: hidden;
    }

    .icon-preview img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .icon-upload-actions {
      flex: 1;
    }

    .icon-upload-btn {
      padding: 0.5rem 1rem;
      background: var(--bg-tertiary);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      color: var(--text-primary);
      font-size: 0.8125rem;
      cursor: pointer;
      transition: all 0.2s;
    }

    .icon-upload-btn:hover {
      background: var(--bg-hover);
      border-color: var(--accent-color);
    }

    .icon-upload-hint {
      font-size: 0.75rem;
      color: var(--text-muted);
      margin-top: 0.5rem;
    }

    /* Action Buttons */
    .settings-actions {
      display: flex;
      gap: 0.75rem;
      flex-wrap: wrap;
    }

    .settings-action-btn {
      flex: 1;
      min-width: 120px;
      padding: 0.625rem 1rem;
      background: var(--bg-tertiary);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      color: var(--text-primary);
      font-size: 0.875rem;
      cursor: pointer;
      transition: all 0.2s;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
    }

    .settings-action-btn:hover {
      background: var(--bg-hover);
      border-color: var(--accent-color);
    }

    .settings-action-btn.danger {
      border-color: var(--error-color);
      color: var(--error-color);
    }

    .settings-action-btn.danger:hover {
      background: var(--error-color);
      color: white;
    }

    .settings-action-btn svg {
      width: 16px;
      height: 16px;
    }

    .modal-footer {
      padding: 1rem 1.5rem;
      border-top: 1px solid var(--border-color);
      display: flex;
      justify-content: flex-end;
      gap: 0.75rem;
    }

    .modal-btn {
      padding: 0.625rem 1.25rem;
      border-radius: 6px;
      font-size: 0.875rem;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s;
    }

    .modal-btn.secondary {
      background: var(--bg-tertiary);
      border: 1px solid var(--border-color);
      color: var(--text-primary);
    }

    .modal-btn.secondary:hover {
      background: var(--bg-hover);
    }

    .modal-btn.primary {
      background: var(--accent-gradient);
      border: none;
      color: white;
    }

    .modal-btn.primary:hover {
      opacity: 0.9;
    }

    .modal-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    /* Toast Notifications */
    .toast {
      position: fixed;
      bottom: 20px;
      right: 20px;
      padding: 0.875rem 1.25rem;
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      color: var(--text-primary);
      font-size: 0.875rem;
      z-index: 2000;
      transform: translateY(100px);
      opacity: 0;
      transition: transform 0.3s, opacity 0.3s;
    }

    .toast.show {
      transform: translateY(0);
      opacity: 1;
    }

    .toast.success {
      border-color: var(--success-color);
    }

    .toast.error {
      border-color: var(--error-color);
    }

    /* Error display */
    .ultralight-error {
      position: fixed;
      bottom: 20px;
      right: 20px;
      max-width: 400px;
      padding: 1rem;
      background: var(--bg-secondary);
      border: 1px solid var(--error-color);
      border-radius: 8px;
      color: var(--text-primary);
      font-family: monospace;
      font-size: 0.875rem;
      z-index: 10000;
    }

    .ultralight-error-title {
      color: var(--error-color);
      font-weight: bold;
      margin-bottom: 0.5rem;
    }

    .ultralight-error-close {
      position: absolute;
      top: 8px;
      right: 8px;
      background: none;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      font-size: 1.25rem;
    }

    /* Confirm Dialog */
    .confirm-dialog {
      text-align: center;
      padding: 1rem 0;
    }

    .confirm-dialog-icon {
      font-size: 3rem;
      margin-bottom: 1rem;
    }

    .confirm-dialog-title {
      font-size: 1.125rem;
      font-weight: 600;
      margin-bottom: 0.5rem;
    }

    .confirm-dialog-message {
      color: var(--text-secondary);
      font-size: 0.875rem;
      margin-bottom: 1.5rem;
    }

    .confirm-dialog-actions {
      display: flex;
      gap: 0.75rem;
      justify-content: center;
    }

    /* Responsive */
    @media (max-width: 768px) {
      .sidebar {
        width: 100%;
        height: auto;
        position: relative;
        border-right: none;
        border-bottom: 1px solid var(--border-color);
      }

      .main-content {
        margin-left: 0;
      }

      .modal {
        width: 95%;
        margin: 1rem;
      }
    }

    /* Scrollbar styling */
    ::-webkit-scrollbar {
      width: 6px;
    }

    ::-webkit-scrollbar-track {
      background: transparent;
    }

    ::-webkit-scrollbar-thumb {
      background: var(--border-color);
      border-radius: 3px;
    }

    ::-webkit-scrollbar-thumb:hover {
      background: var(--text-muted);
    }
  </style>
</head>
<body>
  <!-- Sidebar -->
  <aside class="sidebar">
    <div class="sidebar-header">
      <div class="logo">
        <span>⚡</span>
        <span>Ultralight</span>
      </div>
      <button class="upload-btn" id="newAppBtn">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="12" y1="5" x2="12" y2="19"></line>
          <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
        New App
      </button>
    </div>

    <div class="apps-section">
      <div class="apps-section-title">Your Apps</div>
      <div id="appsList" class="apps-loading">Loading...</div>
    </div>

    <div class="sidebar-footer">
      <div id="authSection">
        <a href="/auth/login" class="auth-btn google">
          <svg width="18" height="18" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          Sign in with Google
        </a>
      </div>
    </div>
  </aside>

  <!-- Main Content -->
  <main class="main-content">
    <!-- Upload View -->
    <div class="upload-view" id="uploadView" style="display: ${initialView === 'upload' ? 'flex' : 'none'};">
      <h1>Upload your code</h1>
      <p class="subtitle">Deploy your app instantly with a simple drag and drop</p>

      <div class="name-input-container">
        <label for="appName">App Name</label>
        <input type="text" id="appName" class="name-input" placeholder="my-awesome-app" />
      </div>

      <div class="drop-zone" id="dropZone">
        <div class="drop-zone-icon">📁</div>
        <div class="drop-zone-text">Drop your code folder here</div>
        <div class="drop-zone-hint">or click to browse • Max 10MB • .ts .js .json .md</div>
        <input type="file" id="fileInput" webkitdirectory directory multiple>
      </div>

      <div class="file-list" id="fileList"></div>

      <button class="deploy-btn" id="deployBtn" disabled>Deploy App</button>

      <div class="build-logs" id="buildLogs" style="display: none;"></div>

      <div class="result" id="result" style="display: none;">
        <div class="result-title">✓ Your app is live!</div>
        <div class="result-url-container">
          <div class="result-url" id="resultUrl"></div>
          <button class="copy-btn" id="copyBtn" title="Copy URL">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
          </button>
        </div>
        <div class="result-actions">
          <button id="openAppBtn">Open App</button>
          <button id="newUploadBtn">Upload Another</button>
        </div>
      </div>
    </div>

    <!-- App View -->
    <div class="app-view" id="appView" style="display: ${initialView === 'app' ? 'flex' : 'none'};">
      <div id="app"></div>
    </div>
  </main>

  <!-- Settings Modal -->
  <div class="modal-overlay" id="settingsModal">
    <div class="modal">
      <div class="modal-header">
        <h2 class="modal-title">App Settings</h2>
        <button class="modal-close" onclick="closeSettingsModal()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
      <div class="modal-body">
        <!-- General Settings -->
        <div class="settings-section">
          <div class="settings-section-title">General</div>
          <div class="settings-field">
            <label for="settingsAppName">App Name</label>
            <input type="text" id="settingsAppName" class="settings-input" placeholder="My App" />
          </div>
          <div class="settings-field">
            <label>App Icon</label>
            <div class="icon-upload-container">
              <div class="icon-preview" id="iconPreview">🚀</div>
              <div class="icon-upload-actions">
                <button class="icon-upload-btn" id="iconUploadBtn">Upload Icon</button>
                <input type="file" id="iconFileInput" accept="image/png,image/jpeg,image/webp" style="display:none">
                <div class="icon-upload-hint">PNG, JPG or WebP. Max 1MB.</div>
              </div>
            </div>
          </div>
        </div>

        <!-- Visibility Settings -->
        <div class="settings-section">
          <div class="settings-section-title">Visibility</div>
          <div class="settings-field">
            <label for="settingsVisibility">App Visibility</label>
            <select id="settingsVisibility" class="settings-select">
              <option value="private">Private - Only you can access</option>
              <option value="unlisted">Unlisted - Anyone with link can access</option>
              <option value="public">Public - Listed in app directory</option>
            </select>
          </div>
          <div class="settings-field">
            <label for="settingsDownloadAccess">Code Download Access</label>
            <select id="settingsDownloadAccess" class="settings-select">
              <option value="owner">Owner Only - Only you can download</option>
              <option value="public">Public - Anyone can download code</option>
            </select>
          </div>
        </div>

        <!-- Actions -->
        <div class="settings-section">
          <div class="settings-section-title">Actions</div>
          <div class="settings-actions">
            <button class="settings-action-btn" id="downloadCodeBtn">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
              Download Code
            </button>
            <button class="settings-action-btn danger" id="deleteAppBtn">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
              Delete App
            </button>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="modal-btn secondary" onclick="closeSettingsModal()">Cancel</button>
        <button class="modal-btn primary" id="saveSettingsBtn">Save Changes</button>
      </div>
    </div>
  </div>

  <!-- Delete Confirmation Modal -->
  <div class="modal-overlay" id="deleteConfirmModal">
    <div class="modal" style="max-width: 400px;">
      <div class="modal-body">
        <div class="confirm-dialog">
          <div class="confirm-dialog-icon">🗑️</div>
          <div class="confirm-dialog-title">Delete App?</div>
          <div class="confirm-dialog-message">
            Are you sure you want to delete <strong id="deleteAppName"></strong>? This action cannot be undone.
          </div>
          <div class="confirm-dialog-actions">
            <button class="modal-btn secondary" onclick="closeDeleteConfirm()">Cancel</button>
            <button class="modal-btn primary" style="background: var(--error-color);" id="confirmDeleteBtn">Delete</button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Toast -->
  <div class="toast" id="toast"></div>

  <script type="module">
    // ============================================
    // State
    // ============================================
    let authToken = localStorage.getItem('ultralight_token');
    let currentUser = null;
    let apps = [];
    let files = [];
    let currentAppId = ${activeAppId ? `'${activeAppId}'` : 'null'};
    let currentView = '${initialView}';
    let settingsAppId = null;
    let settingsApp = null;

    // ============================================
    // DOM Elements
    // ============================================
    const authSection = document.getElementById('authSection');
    const appsList = document.getElementById('appsList');
    const newAppBtn = document.getElementById('newAppBtn');
    const uploadView = document.getElementById('uploadView');
    const appView = document.getElementById('appView');
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    const fileList = document.getElementById('fileList');
    const deployBtn = document.getElementById('deployBtn');
    const buildLogs = document.getElementById('buildLogs');
    const result = document.getElementById('result');
    const resultUrl = document.getElementById('resultUrl');
    const copyBtn = document.getElementById('copyBtn');
    const appNameInput = document.getElementById('appName');
    const settingsModal = document.getElementById('settingsModal');
    const deleteConfirmModal = document.getElementById('deleteConfirmModal');
    const toast = document.getElementById('toast');

    // ============================================
    // Toast Notifications
    // ============================================
    function showToast(message, type = 'success') {
      toast.textContent = message;
      toast.className = 'toast ' + type;
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 3000);
    }

    // ============================================
    // Auth
    // ============================================
    function decodeJWT(token) {
      try {
        const base64Url = token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        return JSON.parse(atob(base64));
      } catch {
        return null;
      }
    }

    function updateAuthUI() {
      if (authToken) {
        const payload = decodeJWT(authToken);
        if (payload && payload.exp * 1000 > Date.now()) {
          currentUser = payload;
          const email = payload.email || 'User';
          const initial = email.charAt(0).toUpperCase();
          authSection.innerHTML = \`
            <div class="user-section">
              <div class="user-avatar">\${initial}</div>
              <div class="user-info">
                <div class="user-email">\${email}</div>
                <div class="user-tier">Free tier</div>
              </div>
              <button class="signout-btn" onclick="signOut()" title="Sign out">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                  <polyline points="16 17 21 12 16 7"></polyline>
                  <line x1="21" y1="12" x2="9" y2="12"></line>
                </svg>
              </button>
            </div>
          \`;
          loadApps();
          return;
        }
      }
      localStorage.removeItem('ultralight_token');
      authToken = null;
      currentUser = null;
      appsList.innerHTML = '<div class="apps-empty">Sign in to see your apps</div>';
    }

    window.signOut = function() {
      localStorage.removeItem('ultralight_token');
      window.location.reload();
    };

    // ============================================
    // Apps List
    // ============================================
    async function loadApps() {
      if (!authToken) return;

      appsList.innerHTML = '<div class="apps-loading">Loading...</div>';

      try {
        const res = await fetch('/api/apps/me', {
          headers: { 'Authorization': \`Bearer \${authToken}\` }
        });

        if (!res.ok) throw new Error('Failed to load apps');

        apps = await res.json();
        renderAppsList();
      } catch (err) {
        console.error('Failed to load apps:', err);
        appsList.innerHTML = '<div class="apps-empty">Failed to load apps</div>';
      }
    }

    function renderAppsList() {
      if (apps.length === 0) {
        appsList.innerHTML = '<div class="apps-empty">No apps yet. Create your first app!</div>';
        return;
      }

      const listHTML = apps.map(app => {
        const isActive = app.id === currentAppId;
        const icon = app.icon_url
          ? \`<img src="\${app.icon_url}" alt="">\`
          : getAppEmoji(app.name);
        const date = new Date(app.created_at).toLocaleDateString();

        return \`
          <div class="app-item \${isActive ? 'active' : ''}" data-app-id="\${app.id}">
            <div class="app-icon" onclick="navigateToApp(event, '\${app.id}')">\${icon}</div>
            <div class="app-info" onclick="navigateToApp(event, '\${app.id}')">
              <div class="app-name">\${escapeHtml(app.name)}</div>
              <div class="app-meta">\${date}</div>
            </div>
            <button class="app-settings-btn" onclick="openSettings(event, '\${app.id}')" title="Settings">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"></path>
              </svg>
            </button>
          </div>
        \`;
      }).join('');

      appsList.innerHTML = \`<div class="app-list">\${listHTML}</div>\`;
    }

    function getAppEmoji(name) {
      const emojis = ['🚀', '⚡', '🎨', '🔧', '📊', '🎮', '📱', '💡', '🌟', '🔥'];
      const hash = name.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
      return emojis[hash % emojis.length];
    }

    function escapeHtml(str) {
      const div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    }

    // ============================================
    // Settings Modal
    // ============================================
    window.openSettings = async function(event, appId) {
      event.stopPropagation();
      settingsAppId = appId;
      settingsApp = apps.find(a => a.id === appId);

      if (!settingsApp) return;

      // Populate form
      document.getElementById('settingsAppName').value = settingsApp.name || '';
      document.getElementById('settingsVisibility').value = settingsApp.visibility || 'private';
      document.getElementById('settingsDownloadAccess').value = settingsApp.download_access || 'owner';

      // Update icon preview
      const iconPreview = document.getElementById('iconPreview');
      if (settingsApp.icon_url) {
        iconPreview.innerHTML = \`<img src="\${settingsApp.icon_url}" alt="">\`;
      } else {
        iconPreview.innerHTML = getAppEmoji(settingsApp.name);
      }

      settingsModal.classList.add('open');
    };

    window.closeSettingsModal = function() {
      settingsModal.classList.remove('open');
      settingsAppId = null;
      settingsApp = null;
    };

    // Close modal on overlay click
    settingsModal.addEventListener('click', (e) => {
      if (e.target === settingsModal) closeSettingsModal();
    });

    // Save settings
    document.getElementById('saveSettingsBtn').addEventListener('click', async () => {
      if (!settingsAppId || !authToken) return;

      const btn = document.getElementById('saveSettingsBtn');
      btn.disabled = true;
      btn.textContent = 'Saving...';

      try {
        const updates = {
          name: document.getElementById('settingsAppName').value.trim(),
          visibility: document.getElementById('settingsVisibility').value,
          download_access: document.getElementById('settingsDownloadAccess').value,
        };

        const res = await fetch(\`/api/apps/\${settingsAppId}\`, {
          method: 'PATCH',
          headers: {
            'Authorization': \`Bearer \${authToken}\`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(updates)
        });

        if (!res.ok) throw new Error('Failed to save settings');

        showToast('Settings saved successfully');
        closeSettingsModal();
        await loadApps();
      } catch (err) {
        showToast('Failed to save settings', 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Save Changes';
      }
    });

    // Icon upload
    document.getElementById('iconUploadBtn').addEventListener('click', () => {
      document.getElementById('iconFileInput').click();
    });

    document.getElementById('iconFileInput').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file || !settingsAppId) return;

      if (file.size > 1024 * 1024) {
        showToast('Icon must be less than 1MB', 'error');
        return;
      }

      const formData = new FormData();
      formData.append('icon', file);

      try {
        const res = await fetch(\`/api/apps/\${settingsAppId}/icon\`, {
          method: 'POST',
          headers: { 'Authorization': \`Bearer \${authToken}\` },
          body: formData
        });

        if (!res.ok) throw new Error('Failed to upload icon');

        const data = await res.json();
        const iconPreview = document.getElementById('iconPreview');
        iconPreview.innerHTML = \`<img src="\${data.icon_url}" alt="">\`;
        settingsApp.icon_url = data.icon_url;
        showToast('Icon uploaded successfully');
        await loadApps();
      } catch (err) {
        showToast('Failed to upload icon', 'error');
      }
    });

    // Download code
    document.getElementById('downloadCodeBtn').addEventListener('click', async () => {
      if (!settingsAppId) return;

      try {
        const res = await fetch(\`/api/apps/\${settingsAppId}/download\`, {
          headers: { 'Authorization': \`Bearer \${authToken}\` }
        });

        if (!res.ok) throw new Error('Failed to download');

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = \`\${settingsApp?.name || 'app'}.zip\`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('Download started');
      } catch (err) {
        showToast('Failed to download code', 'error');
      }
    });

    // Delete app
    document.getElementById('deleteAppBtn').addEventListener('click', () => {
      if (!settingsApp) return;
      document.getElementById('deleteAppName').textContent = settingsApp.name;
      deleteConfirmModal.classList.add('open');
    });

    window.closeDeleteConfirm = function() {
      deleteConfirmModal.classList.remove('open');
    };

    deleteConfirmModal.addEventListener('click', (e) => {
      if (e.target === deleteConfirmModal) closeDeleteConfirm();
    });

    document.getElementById('confirmDeleteBtn').addEventListener('click', async () => {
      if (!settingsAppId || !authToken) return;

      const btn = document.getElementById('confirmDeleteBtn');
      btn.disabled = true;
      btn.textContent = 'Deleting...';

      try {
        const res = await fetch(\`/api/apps/\${settingsAppId}\`, {
          method: 'DELETE',
          headers: { 'Authorization': \`Bearer \${authToken}\` }
        });

        if (!res.ok) throw new Error('Failed to delete app');

        showToast('App deleted successfully');
        closeDeleteConfirm();
        closeSettingsModal();

        // If viewing the deleted app, go to upload
        if (currentAppId === settingsAppId) {
          navigateToUpload();
        }

        await loadApps();
      } catch (err) {
        showToast('Failed to delete app', 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Delete';
      }
    });

    // ============================================
    // Navigation
    // ============================================
    window.navigateToApp = async function(event, appId) {
      event.preventDefault();
      event.stopPropagation();

      history.pushState({ appId }, '', \`/a/\${appId}\`);
      currentAppId = appId;
      currentView = 'app';
      renderAppsList();
      showView('app');
      await loadAndRunApp(appId);
    };

    function showView(view) {
      uploadView.style.display = view === 'upload' ? 'flex' : 'none';
      appView.style.display = view === 'app' ? 'flex' : 'none';
      currentView = view;
    }

    function navigateToUpload() {
      history.pushState({}, '', '/upload');
      currentAppId = null;
      showView('upload');
      renderAppsList();
      resetUploadForm();
    }

    window.addEventListener('popstate', async (event) => {
      const path = window.location.pathname;

      if (path === '/upload' || path === '/') {
        currentAppId = null;
        showView('upload');
        renderAppsList();
      } else if (path.startsWith('/a/')) {
        const appId = path.slice(3).split('/')[0];
        currentAppId = appId;
        showView('app');
        renderAppsList();
        await loadAndRunApp(appId);
      }
    });

    // ============================================
    // App Runner - Uses iframe to ensure identical rendering
    // ============================================
    function loadAndRunApp(appId) {
      const appElement = document.getElementById('app');

      // Use iframe to load the app at its dedicated URL
      // This ensures the app runs exactly the same way as when accessed directly
      appElement.innerHTML = \`
        <iframe
          src="/a/\${appId}?embed=1"
          style="width:100%;height:100%;border:none;background:#0a0a0a;"
          allow="clipboard-read; clipboard-write; camera; microphone; geolocation"
        ></iframe>
      \`;

      // Update page title based on the app
      const app = apps.find(a => a.id === appId);
      if (app) {
        document.title = \`\${app.name || app.slug} - Ultralight\`;
      }

      console.log('✨ App loaded in iframe');
    }

    function createRuntime(appId) {
      return {
        appId,
        memory: {
          async get(key) {
            try {
              const res = await fetch(\`/api/memory/\${appId}/\` + encodeURIComponent(key));
              if (!res.ok) return null;
              const data = await res.json();
              return data.value;
            } catch { return null; }
          },
          async set(key, value) {
            try {
              await fetch(\`/api/memory/\${appId}/\` + encodeURIComponent(key), {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ value })
              });
            } catch (e) { console.error('Memory set failed:', e); }
          },
          async delete(key) {
            try {
              await fetch(\`/api/memory/\${appId}/\` + encodeURIComponent(key), { method: 'DELETE' });
            } catch (e) { console.error('Memory delete failed:', e); }
          }
        },
        ai: {
          async chat(messages, options = {}) {
            const res = await fetch(\`/api/ai/\${appId}/chat\`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ messages, ...options })
            });
            if (!res.ok) throw new Error('AI call failed');
            return res.json();
          }
        },
        data: {
          async get(key) {
            try {
              const res = await fetch(\`/api/data/\${appId}/\` + encodeURIComponent(key));
              if (!res.ok) return null;
              const data = await res.json();
              return data.value;
            } catch { return null; }
          },
          async set(key, value) {
            await fetch(\`/api/data/\${appId}/\` + encodeURIComponent(key), {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ value })
            });
          },
          async list(prefix = '') {
            const res = await fetch(\`/api/data/\${appId}?prefix=\` + encodeURIComponent(prefix));
            if (!res.ok) return [];
            return res.json();
          }
        }
      };
    }

    // ============================================
    // Upload
    // ============================================
    newAppBtn.addEventListener('click', navigateToUpload);
    dropZone.addEventListener('click', () => fileInput.click());

    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));

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
      if (files.length === 0) {
        fileList.innerHTML = '';
        deployBtn.disabled = true;
        return;
      }
      fileList.innerHTML = files.map(f => \`
        <div class="file-item">
          <span>\${f.name}</span>
          <span>\${(f.size / 1024).toFixed(1)} KB</span>
        </div>
      \`).join('');
      deployBtn.disabled = false;
    }

    function resetUploadForm() {
      files = [];
      fileList.innerHTML = '';
      buildLogs.style.display = 'none';
      buildLogs.innerHTML = '';
      result.style.display = 'none';
      deployBtn.disabled = true;
      appNameInput.value = '';
    }

    function log(level, message) {
      const entry = document.createElement('div');
      entry.className = \`log-entry log-\${level}\`;
      entry.textContent = \`[\${new Date().toLocaleTimeString()}] \${message}\`;
      buildLogs.appendChild(entry);
      buildLogs.scrollTop = buildLogs.scrollHeight;
    }

    deployBtn.addEventListener('click', async () => {
      buildLogs.style.display = 'block';
      buildLogs.innerHTML = '';
      deployBtn.disabled = true;
      result.style.display = 'none';

      const currentToken = localStorage.getItem('ultralight_token');
      if (!currentToken) {
        log('error', 'Please sign in to upload');
        deployBtn.disabled = false;
        return;
      }

      log('info', 'Starting upload...');

      const formData = new FormData();
      files.forEach(f => formData.append('files', f));

      const appName = appNameInput.value.trim();
      if (appName) formData.append('name', appName);

      try {
        log('info', 'Uploading files...');
        const res = await fetch('/api/upload', {
          method: 'POST',
          headers: { 'Authorization': \`Bearer \${currentToken}\` },
          body: formData
        });

        const data = await res.json();
        if (data.build_logs) data.build_logs.forEach(l => log(l.level, l.message));

        if (data.app_id) {
          result.style.display = 'block';
          const fullUrl = window.location.origin + data.url;
          resultUrl.textContent = fullUrl;
          resultUrl.dataset.url = fullUrl;
          resultUrl.dataset.appId = data.app_id;
          log('success', 'Deploy complete!');
          await loadApps();
        } else {
          log('error', data.error || 'Upload failed');
          deployBtn.disabled = false;
        }
      } catch (err) {
        log('error', err.message);
        deployBtn.disabled = false;
      }
    });

    copyBtn.addEventListener('click', async () => {
      const url = resultUrl.dataset.url;
      try {
        await navigator.clipboard.writeText(url);
        copyBtn.classList.add('copied');
        copyBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>';
        setTimeout(() => {
          copyBtn.classList.remove('copied');
          copyBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
        }, 2000);
      } catch (err) {
        console.error('Failed to copy:', err);
      }
    });

    document.getElementById('openAppBtn')?.addEventListener('click', () => {
      const appId = resultUrl.dataset.appId;
      if (appId) navigateToApp({ preventDefault: () => {}, stopPropagation: () => {} }, appId);
    });

    document.getElementById('newUploadBtn')?.addEventListener('click', resetUploadForm);

    // ============================================
    // Error Handling
    // ============================================
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

    window.onerror = (msg, src, line) => showError('Runtime Error', \`\${msg} (line \${line})\`);
    window.onunhandledrejection = (e) => showError('Unhandled Promise Rejection', e.reason?.message || String(e.reason));

    // ============================================
    // Initial Load
    // ============================================
    updateAuthUI();

    ${initialView === 'app' && appCode ? `
    (async () => {
      const appElement = document.getElementById('app');
      const ultralightRuntime = createRuntime('${activeAppId}');
      window.ultralight = ultralightRuntime;

      try {
        const appCode = \`${escapedCode}\`;
        const blob = new Blob([appCode], { type: 'application/javascript' });
        const url = URL.createObjectURL(blob);
        const module = await import(url);
        URL.revokeObjectURL(url);

        if (typeof module.default === 'function') await module.default(appElement, ultralightRuntime);
        else if (typeof module.render === 'function') await module.render(appElement, ultralightRuntime);
        else if (typeof module.mount === 'function') await module.mount(appElement, ultralightRuntime);
        else if (typeof module.init === 'function') await module.init(appElement, ultralightRuntime);
        else if (typeof module.main === 'function') await module.main(appElement, ultralightRuntime);

        console.log('✨ App loaded successfully');
      } catch (err) {
        console.error('Failed to load app:', err);
        const isServerSideError = err.message.includes('Deno') ||
                                   err.message.includes('process') ||
                                   err.message.includes('require') ||
                                   err.message.includes('__dirname');
        if (isServerSideError) {
          showError('Server-Side App', 'This app uses server-side APIs and cannot run in the browser. It may work when accessed directly via its URL.');
        } else {
          showError('Failed to Load App', err.message);
        }
      }
    })();
    ` : ''}
  </script>
</body>
</html>`;
}
