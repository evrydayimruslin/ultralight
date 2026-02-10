// Shared Layout Component
// ChatGPT-like UI with persistent sidebar

export function getLayoutHTML(options: {
  title?: string;
  activeAppId?: string;
  initialView: 'dashboard' | 'app' | 'settings';
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
  <meta name="description" content="The fastest way to deploy AI-powered apps. Drop your code, get a live URL instantly.">

  <!-- Google Fonts -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">


  <!-- Tailwind CSS (for utility classes) -->
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          colors: {
            'ultralight': {
              50: '#eff6ff',
              100: '#dbeafe',
              200: '#bfdbfe',
              300: '#93c5fd',
              400: '#60a5fa',
              500: '#3b82f6',
              600: '#2563eb',
              700: '#1d4ed8',
              800: '#1e40af',
              900: '#1e3a8a',
            }
          }
        }
      }
    }
  </script>

  <!-- Theme: apply dark class before paint to prevent flash -->
  <script>
    (function(){
      var t = localStorage.getItem('ultralight_theme');
      if (t === 'dark' || (!t && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        document.documentElement.classList.add('dark');
      }
    })();
  </script>

  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }

    /* ===== Liquid Metal Animation ===== */
    @property --border-angle {
      syntax: "<angle>";
      initial-value: 0deg;
      inherits: false;
    }

    @keyframes spin-border {
      to { --border-angle: 360deg; }
    }

    /* ===== Light mode (default) ===== */
    :root {
      --sidebar-width: 260px;
      --bg-primary: #fafafa;
      --bg-secondary: #ffffff;
      --bg-tertiary: #f4f4f5;
      --bg-hover: #e4e4e7;
      --border-color: #e4e4e7;
      --text-primary: #18181b;
      --text-secondary: #71717a;
      --text-muted: #a1a1aa;
      --accent-gradient: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
      --accent-color: #3b82f6;
      --success-color: #22c55e;
      --error-color: #ef4444;
      --warning-color: #f59e0b;
    }

    /* ===== Dark mode ===== */
    html.dark {
      --bg-primary: #0a0a0a;
      --bg-secondary: #111111;
      --bg-tertiary: #1a1a1a;
      --bg-hover: #222222;
      --border-color: #2a2a2a;
      --text-primary: #ffffff;
      --text-secondary: #888888;
      --text-muted: #555555;
      --accent-gradient: linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%);
      --accent-color: #60a5fa;
      --success-color: #4ade80;
      --error-color: #f87171;
      --warning-color: #fbbf24;
    }

    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg-primary);
      color: var(--text-primary);
      min-height: 100vh;
      display: flex;
      transition: background-color 0.3s ease, color 0.3s ease;
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
      transition: width 0.3s ease;
      overflow: hidden;
    }

    .sidebar.collapsed {
      width: 56px;
    }

    /* Sidebar header: logo on left, toolbar buttons on right */
    .sidebar-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.875rem 0.625rem 0.875rem 1rem;
      flex-shrink: 0;
    }

    /* Hide expanded header when collapsed */
    .sidebar.collapsed .sidebar-header {
      display: none;
    }

    .sidebar-toolbar {
      display: flex;
      align-items: center;
      gap: 2px;
      flex-shrink: 0;
    }

    .sidebar-toolbar-btn {
      width: 30px;
      height: 30px;
      background: transparent;
      border: none;
      border-radius: 6px;
      color: var(--text-muted);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.2s, color 0.2s;
      flex-shrink: 0;
    }

    .sidebar-toolbar-btn:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
    }

    .sidebar-toolbar-btn svg {
      width: 16px;
      height: 16px;
    }

    .main-content.sidebar-collapsed {
      margin-left: 56px;
    }

    .logo {
      font-size: 1.2rem;
      font-weight: 700;
      background: var(--accent-gradient);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      white-space: nowrap;
      letter-spacing: -0.01em;
    }

    /* New App button (expanded) */
    .new-app-section {
      padding: 0 0.75rem 0.75rem;
      flex-shrink: 0;
    }

    .upload-btn {
      width: 100%;
      padding: 0.5rem 0.75rem;
      background: transparent;
      color: var(--text-primary);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      font-size: 0.875rem;
      font-weight: 500;
      cursor: pointer;
      transition: color 0.2s, border-color 0.2s;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
    }

    .upload-btn:hover {
      background: transparent;
      border-color: var(--text-muted);
      color: var(--text-primary);
    }

    .upload-btn svg {
      width: 16px;
      height: 16px;
    }

    .sidebar.collapsed .new-app-section {
      display: none;
    }

    /* Collapsed rail: action icons */
    .sidebar-rail {
      display: none;
      flex-direction: column;
      align-items: center;
      padding: 8px 0;
      gap: 6px;
      flex-shrink: 0;
    }

    .sidebar.collapsed .sidebar-rail {
      display: flex;
    }

    .sidebar-rail-btn {
      width: 36px;
      height: 36px;
      background: var(--bg-tertiary);
      border: none;
      border-radius: 10px;
      color: var(--text-secondary);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s, color 0.15s;
      flex-shrink: 0;
    }

    .sidebar-rail-btn:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
    }

    .sidebar-rail-btn svg {
      width: 16px;
      height: 16px;
    }

    /* Collapsed rail: divider */
    .sidebar-rail-divider {
      width: 24px;
      height: 1px;
      background: var(--border-color);
      margin: 2px 0;
    }

    /* Collapsed rail apps list */
    .sidebar-rail-apps {
      display: none;
      flex-direction: column;
      align-items: center;
      padding: 4px 0;
      gap: 6px;
      flex: 1;
      overflow-y: auto;
    }

    .sidebar.collapsed .sidebar-rail-apps {
      display: flex;
    }

    .sidebar-rail-app {
      width: 36px;
      height: 36px;
      border-radius: 10px;
      background: var(--bg-tertiary);
      border: none;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.9rem;
      cursor: pointer;
      transition: background 0.15s;
      flex-shrink: 0;
      color: var(--text-primary);
    }

    .sidebar-rail-app:hover {
      background: var(--bg-hover);
    }

    .sidebar-rail-app.active {
      background: var(--accent-color);
      color: #fff;
    }

    .sidebar-rail-app img {
      width: 100%;
      height: 100%;
      border-radius: 10px;
      object-fit: cover;
    }

    /* Apps List */
    .apps-section {
      flex: 1;
      overflow-y: auto;
      padding: 0.5rem;
    }

    /* Hide expanded apps section when collapsed */
    .sidebar.collapsed .apps-section {
      display: none;
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
      gap: 0.625rem;
      padding: 0.5rem 0.5rem;
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

    /* User Section — exact height matches .site-footer */
    .sidebar-footer {
      padding: 0 0.5rem;
      border-top: 1px solid var(--border-color);
      display: flex;
      flex-direction: column;
      justify-content: center;
      height: 64px;
      flex-shrink: 0;
      position: relative;
      overflow: visible;
    }

    .sidebar.collapsed .sidebar-footer {
      display: none;
    }

    .user-section {
      display: flex;
      align-items: center;
      gap: 0.625rem;
      cursor: pointer;
      padding: 0.375rem 0.5rem;
      position: relative;
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
      flex-shrink: 0;
    }

    .user-info {
      flex: 1;
      min-width: 0;
    }

    .user-name {
      font-size: 0.875rem;
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      line-height: 1.3;
    }

    .user-tier-text {
      font-size: 0.75rem;
      color: var(--text-muted);
      line-height: 1.3;
      margin-top: 1px;
    }

    .user-chevron {
      flex-shrink: 0;
      color: var(--text-muted);
      transition: transform 0.2s;
    }

    .user-section.menu-open .user-chevron {
      transform: rotate(180deg);
    }

    /* Profile Dropdown Menu */
    .profile-dropdown {
      position: absolute;
      bottom: calc(100% + 6px);
      left: 0;
      right: 0;
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 10px;
      box-shadow: 0 4px 24px rgba(0, 0, 0, 0.12);
      opacity: 0;
      visibility: hidden;
      transform: translateY(4px);
      transition: opacity 0.15s, visibility 0.15s, transform 0.15s;
      z-index: 100;
      overflow: hidden;
    }

    html.dark .profile-dropdown {
      box-shadow: 0 4px 24px rgba(0, 0, 0, 0.4);
    }

    .profile-dropdown.open {
      opacity: 1;
      visibility: visible;
      transform: translateY(0);
    }

    .profile-dropdown-email {
      padding: 0.75rem 1rem 0.5rem;
      font-size: 0.75rem;
      color: var(--text-muted);
      border-bottom: 1px solid var(--border-color);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .profile-dropdown-items {
      padding: 0.375rem;
    }

    .profile-dropdown-item {
      display: flex;
      align-items: center;
      gap: 0.625rem;
      padding: 0.5rem 0.625rem;
      font-size: 0.8125rem;
      color: var(--text-primary);
      border-radius: 6px;
      cursor: pointer;
      transition: background 0.12s;
      border: none;
      background: none;
      width: 100%;
      text-align: left;
    }

    .profile-dropdown-item:hover {
      background: var(--bg-hover);
    }

    .profile-dropdown-item svg {
      width: 16px;
      height: 16px;
      flex-shrink: 0;
      color: var(--text-secondary);
    }

    .profile-dropdown-divider {
      height: 1px;
      background: var(--border-color);
      margin: 0.25rem 0.375rem;
    }

    .profile-dropdown-item.logout {
      color: var(--text-primary);
    }


    /* Version history (app settings) */
    .version-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.5rem 0.75rem;
      border: 1px solid var(--border-color);
      border-radius: 6px;
      margin-bottom: 0.375rem;
      font-size: 0.8125rem;
    }
    .version-item:hover { background: var(--bg-tertiary); }
    .version-info {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }
    .version-label {
      font-weight: 600;
      font-family: monospace;
      color: var(--text-primary);
    }
    .version-meta {
      color: var(--text-muted);
      font-size: 0.75rem;
    }
    .version-current-badge {
      font-size: 0.6875rem;
      color: var(--success-color);
      font-weight: 600;
    }
    .version-delete-btn {
      background: none;
      border: 1px solid transparent;
      color: var(--text-muted);
      cursor: pointer;
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      font-size: 0.75rem;
      transition: all 0.15s;
    }
    .version-delete-btn:hover {
      color: var(--error-color);
      border-color: var(--error-color);
      background: rgba(239, 68, 68, 0.08);
    }

    /* Upgrade CTA */
    .upgrade-cta {
      padding: 0.75rem 1rem;
      background: rgba(59, 130, 246, 0.08);
      border: 1px solid rgba(59, 130, 246, 0.25);
      border-radius: 6px;
      font-size: 0.8125rem;
      color: var(--text-secondary);
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-top: 0.5rem;
    }
    .upgrade-cta a {
      color: var(--accent-color);
      font-weight: 600;
      text-decoration: none;
    }
    .upgrade-cta a:hover { text-decoration: underline; }

    /* Token limit info */
    .token-limit-info {
      font-size: 0.8125rem;
      color: var(--text-secondary);
      padding: 0.5rem 0;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .token-limit-count {
      font-weight: 600;
      font-family: monospace;
    }

    .auth-btn {
      padding: 0.375rem 0.75rem;
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

    /* (signout-btn removed — now in profile dropdown) */

    /* Main Content */
    .main-content {
      flex: 1;
      margin-left: var(--sidebar-width);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }

    /* Dashboard View */
    .dashboard-view {
      flex-direction: column;
      align-items: center;
      padding: 2rem 1.5rem;
      min-height: 100vh;
      width: 100%;
    }

    .dashboard-card {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      padding: 1.25rem;
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

    .modal.wide {
      max-width: 700px;
    }

    /* Tabs */
    .settings-tabs {
      display: flex;
      border-bottom: 1px solid var(--border-color);
      padding: 0 1rem;
    }

    .settings-tab {
      padding: 0.875rem 1rem;
      background: transparent;
      border: none;
      color: var(--text-muted);
      font-size: 0.875rem;
      font-weight: 500;
      cursor: pointer;
      position: relative;
      transition: color 0.2s;
    }

    .settings-tab:hover {
      color: var(--text-secondary);
    }

    .settings-tab.active {
      color: var(--text-primary);
    }

    .settings-tab.active::after {
      content: '';
      position: absolute;
      bottom: -1px;
      left: 0;
      right: 0;
      height: 2px;
      background: var(--accent-gradient);
    }

    .settings-tab-content {
      display: none;
    }

    .settings-tab-content.active {
      display: block;
    }

    /* MCP Endpoint */
    .mcp-endpoint {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.75rem 1rem;
      background: var(--bg-tertiary);
      border-radius: 6px;
      font-family: monospace;
      font-size: 0.8125rem;
      margin-bottom: 1rem;
    }

    .mcp-endpoint-url {
      flex: 1;
      word-break: break-all;
    }

    .mcp-endpoint-copy {
      padding: 0.375rem;
      background: transparent;
      border: 1px solid var(--border-color);
      border-radius: 4px;
      color: var(--text-muted);
      cursor: pointer;
      transition: all 0.15s;
    }

    .mcp-endpoint-copy:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
    }

    .mcp-endpoint-copy svg {
      width: 14px;
      height: 14px;
      display: block;
    }

    /* Skills Editor */
    .skills-editor {
      width: 100%;
      min-height: 300px;
      padding: 1rem;
      background: var(--bg-tertiary);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      color: var(--text-primary);
      font-family: 'Monaco', 'Menlo', 'Consolas', monospace;
      font-size: 0.8125rem;
      line-height: 1.5;
      resize: vertical;
    }

    .skills-editor:focus {
      outline: none;
      border-color: var(--accent-color);
    }

    .skills-status {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 0;
      font-size: 0.8125rem;
    }

    .skills-status.success { color: var(--success-color); }
    .skills-status.error { color: var(--error-color); }
    .skills-status.warning { color: var(--warning-color); }
    .skills-status.info { color: var(--text-muted); }

    /* Draft Banner */
    .draft-banner {
      padding: 0.875rem 1rem;
      background: rgba(251, 191, 36, 0.1);
      border: 1px solid var(--warning-color);
      border-radius: 8px;
      margin-bottom: 1rem;
    }

    .draft-banner-title {
      font-weight: 600;
      color: var(--warning-color);
      margin-bottom: 0.25rem;
      font-size: 0.875rem;
    }

    .draft-banner-info {
      font-size: 0.8125rem;
      color: var(--text-secondary);
    }

    .draft-actions {
      display: flex;
      gap: 0.5rem;
      margin-top: 0.75rem;
    }

    .draft-actions button {
      padding: 0.5rem 0.875rem;
      border-radius: 6px;
      font-size: 0.8125rem;
      cursor: pointer;
      transition: all 0.15s;
    }

    .btn-publish {
      background: var(--success-color);
      border: none;
      color: #000;
      font-weight: 500;
    }

    .btn-publish:hover {
      opacity: 0.9;
    }

    .btn-discard {
      background: transparent;
      border: 1px solid var(--border-color);
      color: var(--text-secondary);
    }

    .btn-discard:hover {
      border-color: var(--error-color);
      color: var(--error-color);
    }

    /* Generate Button */
    .generate-docs-btn {
      width: 100%;
      padding: 0.75rem 1rem;
      background: var(--accent-gradient);
      border: none;
      border-radius: 6px;
      color: white;
      font-size: 0.875rem;
      font-weight: 500;
      cursor: pointer;
      transition: opacity 0.2s;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
    }

    .generate-docs-btn:hover {
      opacity: 0.9;
    }

    .generate-docs-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .generate-docs-btn svg {
      width: 16px;
      height: 16px;
    }

    /* Info Box */
    .info-box {
      padding: 0.75rem 1rem;
      background: rgba(102, 126, 234, 0.1);
      border: 1px solid var(--accent-color);
      border-radius: 6px;
      font-size: 0.8125rem;
      color: var(--text-secondary);
      margin-bottom: 1rem;
    }

    .info-box a {
      color: var(--accent-color);
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

    /* Environment Variables */
    .env-vars-container {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .env-var-row {
      display: flex;
      gap: 0.5rem;
      align-items: flex-start;
    }

    .env-var-key {
      flex: 0 0 180px;
      padding: 0.625rem 0.75rem;
      background: var(--bg-tertiary);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      color: var(--text-primary);
      font-family: 'Monaco', 'Menlo', monospace;
      font-size: 0.8125rem;
    }

    .env-var-key:focus {
      outline: none;
      border-color: var(--accent-color);
    }

    .env-var-key::placeholder {
      color: var(--text-muted);
      text-transform: none;
    }

    .env-var-value {
      flex: 1;
      padding: 0.625rem 0.75rem;
      background: var(--bg-tertiary);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      color: var(--text-primary);
      font-family: 'Monaco', 'Menlo', monospace;
      font-size: 0.8125rem;
    }

    .env-var-value:focus {
      outline: none;
      border-color: var(--accent-color);
    }

    .env-var-value::placeholder {
      color: var(--text-muted);
    }

    .env-var-delete {
      flex: 0 0 auto;
      padding: 0.625rem;
      background: transparent;
      border: 1px solid transparent;
      border-radius: 6px;
      color: var(--text-muted);
      cursor: pointer;
      transition: all 0.15s;
    }

    .env-var-delete:hover {
      background: rgba(248, 113, 113, 0.1);
      border-color: var(--error-color);
      color: var(--error-color);
    }

    .env-var-delete svg {
      width: 16px;
      height: 16px;
    }

    .env-var-add-btn {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 0.75rem;
      background: transparent;
      border: 1px dashed var(--border-color);
      border-radius: 6px;
      color: var(--text-secondary);
      font-size: 0.8125rem;
      cursor: pointer;
      transition: all 0.15s;
      width: fit-content;
    }

    .env-var-add-btn:hover {
      border-color: var(--accent-color);
      color: var(--accent-color);
    }

    .env-var-add-btn svg {
      width: 14px;
      height: 14px;
    }

    .env-vars-empty {
      padding: 1.5rem;
      text-align: center;
      color: var(--text-muted);
      font-size: 0.875rem;
      border: 1px dashed var(--border-color);
      border-radius: 8px;
    }

    .env-vars-limits {
      font-size: 0.75rem;
      color: var(--text-muted);
      margin-top: 0.5rem;
    }

    .env-var-masked {
      color: var(--text-muted);
      font-style: italic;
    }

    .env-var-toggle-visibility {
      flex: 0 0 auto;
      padding: 0.625rem;
      background: transparent;
      border: 1px solid transparent;
      border-radius: 6px;
      color: var(--text-muted);
      cursor: pointer;
      transition: all 0.15s;
    }

    .env-var-toggle-visibility:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
    }

    .env-var-toggle-visibility svg {
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

    .toast.warning {
      border-color: var(--warning-color);
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

    /* (settings-btn removed from profile — now in profile dropdown) */

    /* BYOK Settings */
    .byok-providers {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .byok-provider-card {
      background: var(--bg-tertiary);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 1rem;
      transition: border-color 0.2s;
    }

    .byok-provider-card:hover {
      border-color: var(--text-muted);
    }

    .byok-provider-card.configured {
      border-color: var(--success-color);
    }

    .byok-provider-card.primary {
      border-color: var(--accent-color);
      background: rgba(102, 126, 234, 0.1);
    }

    .byok-provider-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 0.5rem;
    }

    .byok-provider-info {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .byok-provider-icon {
      width: 32px;
      height: 32px;
      border-radius: 6px;
      background: var(--bg-secondary);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1rem;
    }

    .byok-provider-name {
      font-weight: 500;
    }

    .byok-provider-desc {
      font-size: 0.75rem;
      color: var(--text-muted);
    }

    .byok-provider-actions {
      display: flex;
      gap: 0.5rem;
    }

    .byok-status {
      font-size: 0.75rem;
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
    }

    .byok-status.configured {
      background: rgba(74, 222, 128, 0.15);
      color: var(--success-color);
    }

    .byok-status.primary {
      background: rgba(102, 126, 234, 0.15);
      color: var(--accent-color);
    }

    .byok-key-input {
      display: flex;
      gap: 0.5rem;
      margin-top: 0.75rem;
    }

    .byok-key-input input {
      flex: 1;
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      padding: 0.5rem 0.75rem;
      color: var(--text-primary);
      font-size: 0.875rem;
      font-family: monospace;
    }

    .byok-key-input input:focus {
      outline: none;
      border-color: var(--accent-color);
    }

    .byok-key-input input::placeholder {
      color: var(--text-muted);
    }

    .byok-btn {
      padding: 0.5rem 0.75rem;
      border-radius: 6px;
      font-size: 0.75rem;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s;
    }

    .byok-btn-primary {
      background: var(--accent-gradient);
      border: none;
      color: white;
    }

    .byok-btn-primary:hover {
      opacity: 0.9;
    }

    .byok-btn-primary:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .byok-btn-secondary {
      background: transparent;
      border: 1px solid var(--border-color);
      color: var(--text-secondary);
    }

    .byok-btn-secondary:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
    }

    .byok-btn-danger {
      background: transparent;
      border: 1px solid var(--error-color);
      color: var(--error-color);
    }

    .byok-btn-danger:hover {
      background: rgba(248, 113, 113, 0.1);
    }

    .byok-help {
      font-size: 0.75rem;
      color: var(--text-muted);
      margin-top: 0.5rem;
    }

    .byok-help a {
      color: var(--accent-color);
      text-decoration: none;
    }

    .byok-help a:hover {
      text-decoration: underline;
    }

    .byok-loading {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 2rem;
      color: var(--text-muted);
    }

    .byok-message {
      padding: 0.75rem 1rem;
      border-radius: 6px;
      margin-bottom: 1rem;
      font-size: 0.875rem;
    }

    .byok-message.success {
      background: rgba(74, 222, 128, 0.15);
      color: var(--success-color);
    }

    .byok-message.error {
      background: rgba(248, 113, 113, 0.15);
      color: var(--error-color);
    }

    /* Settings Tabs */
    .settings-tabs {
      display: flex;
      border-bottom: 1px solid var(--border-color);
      padding: 0 1.5rem;
      background: var(--bg-secondary);
    }

    .settings-tab {
      padding: 0.75rem 1.25rem;
      background: none;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      font-size: 0.875rem;
      font-weight: 500;
      border-bottom: 2px solid transparent;
      margin-bottom: -1px;
      transition: all 0.2s;
    }

    .settings-tab:hover {
      color: var(--text-secondary);
    }

    .settings-tab.active {
      color: var(--accent-color);
      border-bottom-color: var(--accent-color);
    }

    .settings-tab-content {
      display: none;
    }

    .settings-tab-content.active {
      display: block;
    }

    /* API Tokens */
    .token-create-form {
      display: flex;
      gap: 0.5rem;
      margin-bottom: 1rem;
    }

    .token-create-form input {
      flex: 1;
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      padding: 0.5rem 0.75rem;
      color: var(--text-primary);
      font-size: 0.875rem;
    }

    .token-create-form input:focus {
      outline: none;
      border-color: var(--accent-color);
    }

    .token-create-form select {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      padding: 0.5rem 0.75rem;
      color: var(--text-primary);
      font-size: 0.875rem;
      cursor: pointer;
    }

    .new-token-display {
      background: rgba(251, 191, 36, 0.1);
      border: 1px solid rgba(251, 191, 36, 0.3);
      border-radius: 8px;
      padding: 1rem;
      margin-bottom: 1rem;
    }

    .new-token-warning {
      font-size: 0.875rem;
      color: #fbbf24;
      margin-bottom: 0.75rem;
      font-weight: 500;
    }

    .new-token-value {
      display: flex;
      gap: 0.5rem;
      align-items: center;
    }

    .new-token-value code {
      flex: 1;
      background: var(--bg-tertiary);
      padding: 0.75rem;
      border-radius: 6px;
      font-family: monospace;
      font-size: 0.875rem;
      word-break: break-all;
      color: var(--text-primary);
    }

    .tokens-list {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .token-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.75rem 1rem;
      background: var(--bg-tertiary);
      border: 1px solid var(--border-color);
      border-radius: 8px;
    }

    .token-item.expired {
      opacity: 0.6;
    }

    .token-info {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      flex: 1;
    }

    .token-name {
      font-weight: 500;
      font-size: 0.875rem;
    }

    .token-meta {
      font-size: 0.75rem;
      color: var(--text-muted);
      display: flex;
      gap: 1rem;
      flex-wrap: wrap;
    }

    .token-prefix {
      font-family: monospace;
      color: var(--accent-color);
    }

    .token-expired-badge {
      background: rgba(239, 68, 68, 0.2);
      color: #ef4444;
      padding: 0.125rem 0.5rem;
      border-radius: 4px;
      font-size: 0.625rem;
      font-weight: 600;
      text-transform: uppercase;
    }

    .tokens-empty {
      text-align: center;
      padding: 2rem;
      color: var(--text-muted);
      font-size: 0.875rem;
    }

    /* Developer Resources */
    .dev-resources {
      margin-top: 2rem;
      padding-top: 2rem;
      border-top: 1px solid var(--border-color);
      width: 100%;
    }

    .dev-resources-title {
      font-size: 0.875rem;
      color: var(--text-muted);
      margin-bottom: 1rem;
      text-align: center;
    }

    .dev-resources-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 0.75rem;
    }

    @media (max-width: 600px) {
      .dev-resources-grid {
        grid-template-columns: 1fr;
      }
    }

    .dev-resource-card {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 0.875rem;
      display: flex;
      align-items: center;
      gap: 0.75rem;
      text-decoration: none;
      color: inherit;
      transition: all 0.2s;
    }

    .dev-resource-card:hover {
      border-color: var(--accent-color);
      background: var(--bg-tertiary);
    }

    .dev-resource-icon {
      font-size: 1.25rem;
    }

    .dev-resource-content {
      flex: 1;
      min-width: 0;
    }

    .dev-resource-name {
      font-weight: 500;
      font-size: 0.875rem;
      margin-bottom: 0.125rem;
    }

    .dev-resource-desc {
      font-size: 0.75rem;
      color: var(--text-muted);
      font-family: monospace;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* Quick Reference Modal */
    .quick-ref-content {
      font-family: monospace;
      font-size: 0.8125rem;
      line-height: 1.6;
    }

    .quick-ref-section {
      margin-bottom: 1.5rem;
    }

    .quick-ref-section-title {
      font-weight: 600;
      color: var(--accent-color);
      margin-bottom: 0.5rem;
      font-family: system-ui;
    }

    .quick-ref-code {
      background: var(--bg-tertiary);
      padding: 0.75rem;
      border-radius: 6px;
      overflow-x: auto;
      white-space: pre;
    }

    /* ===== Theme Toggle ===== */
    .theme-toggle .sun-icon { display: none; }
    .theme-toggle .moon-icon { display: block; }
    html.dark .theme-toggle .sun-icon { display: block; }
    html.dark .theme-toggle .moon-icon { display: none; }

    /* ===== Hero / Landing Section ===== */
    .hero-title {
      font-size: clamp(3rem, 7vw, 4.5rem);
      font-weight: 800;
      letter-spacing: -0.03em;
      line-height: 1.15;
      text-align: center;
      color: var(--text-primary);
    }
    .hero-title .accent {
      background: var(--accent-gradient);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .hero-subtitle {
      text-align: center;
      color: var(--text-secondary);
      font-size: 1.15rem;
      max-width: 520px;
      margin: 0.75rem auto 2.5rem;
      line-height: 1.6;
    }

    /* ===== Footer — exact height matches .sidebar-footer ===== */
    .site-footer {
      width: 100%;
      border-top: 1px solid var(--border-color);
      padding: 0 2rem;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      font-size: 0.8125rem;
      color: var(--text-muted);
      margin-top: auto;
      height: 64px;
      flex-shrink: 0;
    }
    .site-footer a {
      color: var(--text-secondary);
      text-decoration: none;
      transition: color 0.2s;
    }
    .site-footer a:hover { color: var(--accent-color); }
    .footer-links { display: flex; gap: 1.5rem; flex-wrap: wrap; }

    /* ===== Smooth transitions for theme switch ===== */
    .main-content, .sidebar-header, .sidebar-footer,
    .modal, .modal-overlay, .result,
    .app-item, .build-logs, .toast, .settings-input, .settings-select,
    .hero-title, .hero-subtitle {
      transition: background-color 0.3s ease, border-color 0.3s ease, color 0.3s ease;
    }
    /* Sidebar needs width transition + theme color transitions */
    .sidebar {
      transition: width 0.3s ease, background-color 0.3s ease, border-color 0.3s ease;
    }
    .main-content {
      transition: margin-left 0.3s ease, background-color 0.3s ease, border-color 0.3s ease, color 0.3s ease;
    }
  </style>
</head>
<body>
  <!-- Sidebar -->
  <aside class="sidebar" id="sidebar">
    <!-- Expanded: header with logo + toolbar buttons -->
    <div class="sidebar-header">
      <div class="logo">Ultralight</div>
      <div class="sidebar-toolbar">
        <button class="sidebar-toolbar-btn theme-toggle" id="themeToggle" title="Toggle light/dark mode">
          <svg class="sun-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
          </svg>
          <svg class="moon-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
          </svg>
        </button>
        <button class="sidebar-toolbar-btn" id="sidebarToggle" title="Collapse sidebar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
            <rect x="3" y="3" width="18" height="18" rx="3"></rect>
            <line x1="9" y1="3" x2="9" y2="21"></line>
          </svg>
        </button>
      </div>
    </div>

    <!-- Expanded: new app button -->
    <div class="new-app-section">
      <button class="upload-btn" id="newAppBtn">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="3" width="7" height="7" rx="1"></rect>
          <rect x="14" y="3" width="7" height="7" rx="1"></rect>
          <rect x="3" y="14" width="7" height="7" rx="1"></rect>
          <rect x="14" y="14" width="7" height="7" rx="1"></rect>
        </svg>
        Dashboard
      </button>
    </div>

    <!-- Collapsed rail: action icons -->
    <div class="sidebar-rail">
      <button class="sidebar-rail-btn" id="railSidebarToggle" title="Expand sidebar">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
          <rect x="3" y="3" width="18" height="18" rx="3"></rect>
          <line x1="9" y1="3" x2="9" y2="21"></line>
        </svg>
      </button>
      <button class="sidebar-rail-btn theme-toggle" id="railThemeToggle" title="Toggle light/dark mode">
        <svg class="sun-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
        </svg>
        <svg class="moon-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
        </svg>
      </button>
      <button class="sidebar-rail-btn" id="railNewApp" title="Dashboard">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="3" width="7" height="7" rx="1"></rect>
          <rect x="14" y="3" width="7" height="7" rx="1"></rect>
          <rect x="3" y="14" width="7" height="7" rx="1"></rect>
          <rect x="14" y="14" width="7" height="7" rx="1"></rect>
        </svg>
      </button>
      <div class="sidebar-rail-divider"></div>
    </div>

    <!-- Collapsed rail: app icons -->
    <div class="sidebar-rail-apps" id="railAppsList"></div>

    <!-- Expanded: full apps list -->
    <div class="apps-section">
      <div class="apps-section-title">Your Apps</div>
      <div id="appsList" class="apps-loading">Loading...</div>
    </div>

    <!-- Expanded: footer with auth -->
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
    <!-- Dashboard View -->
    <div class="dashboard-view" id="dashboardView" style="display: ${initialView === 'dashboard' ? 'flex' : 'none'};">
      <div style="width: 100%; max-width: 900px; margin: 0 auto;">
        <h1 style="font-size: 1.75rem; font-weight: 700; margin-bottom: 0.25rem;">Developer Dashboard</h1>
        <p style="color: var(--text-secondary); margin-bottom: 1.5rem;">Your MCP hosting control center</p>

        <!-- Platform MCP URL -->
        <div class="dashboard-card" style="margin-bottom: 1rem;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.5rem;">
            <h3 style="font-size: 0.9375rem; font-weight: 600;">Platform MCP Endpoint</h3>
            <span style="font-size: 0.75rem; padding: 2px 8px; border-radius: 9999px; background: rgba(34,197,94,0.15); color: var(--success-color);">Active</span>
          </div>
          <div style="display: flex; align-items: center; gap: 0.5rem;">
            <code id="platformMcpUrl" style="flex: 1; font-family: 'JetBrains Mono', monospace; font-size: 0.8125rem; background: var(--bg-tertiary); padding: 0.625rem 0.75rem; border-radius: 8px; border: 1px solid var(--border-color); overflow-x: auto; white-space: nowrap;"></code>
            <button onclick="copyPlatformMcpUrl()" style="flex-shrink: 0; padding: 0.625rem; background: var(--bg-tertiary); border: 1px solid var(--border-color); border-radius: 8px; cursor: pointer; color: var(--text-secondary); transition: color 0.2s, border-color 0.2s;" title="Copy URL">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            </button>
          </div>
          <p style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.5rem;">Connect this URL to Claude Desktop, Cursor, or any MCP-compatible client.</p>
        </div>

        <!-- Weekly Usage -->
        <div class="dashboard-card" style="margin-bottom: 1rem;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.75rem;">
            <h3 style="font-size: 0.9375rem; font-weight: 600;">Weekly Usage</h3>
            <span id="weeklyUsageText" style="font-size: 0.8125rem; color: var(--text-secondary);">Loading...</span>
          </div>
          <div style="width: 100%; height: 8px; background: var(--bg-tertiary); border-radius: 4px; overflow: hidden;">
            <div id="weeklyUsageBar" style="height: 100%; width: 0%; background: var(--accent-color); border-radius: 4px; transition: width 0.5s ease;"></div>
          </div>
          <div style="display: flex; justify-content: space-between; margin-top: 0.375rem;">
            <span id="weeklyUsageCount" style="font-size: 0.75rem; color: var(--text-muted);">0 calls</span>
            <span id="weeklyUsageLimit" style="font-size: 0.75rem; color: var(--text-muted);">— / week</span>
          </div>
        </div>

        <!-- API Tokens -->
        <div class="dashboard-card" style="margin-bottom: 1rem;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.75rem;">
            <h3 style="font-size: 0.9375rem; font-weight: 600;">API Tokens</h3>
            <button onclick="openApiKeysModal()" style="font-size: 0.8125rem; padding: 4px 12px; background: var(--bg-tertiary); border: 1px solid var(--border-color); border-radius: 6px; cursor: pointer; color: var(--text-secondary); transition: color 0.2s, border-color 0.2s;">Manage</button>
          </div>
          <div id="dashboardTokenList" style="font-size: 0.8125rem; color: var(--text-secondary);">Loading tokens...</div>
        </div>

        <!-- Supabase Config -->
        <div class="dashboard-card" style="margin-bottom: 1rem;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.5rem;">
            <h3 style="font-size: 0.9375rem; font-weight: 600;">Supabase Config</h3>
            <span id="supabaseStatus" style="font-size: 0.75rem; padding: 2px 8px; border-radius: 9999px; background: var(--bg-tertiary); color: var(--text-muted);">Not configured</span>
          </div>
          <p style="font-size: 0.8125rem; color: var(--text-secondary); margin-bottom: 0.75rem;">Set your Supabase credentials once — all your apps can use them.</p>
          <button id="configureSupabaseBtn" onclick="openSupabaseConfig()" style="font-size: 0.8125rem; padding: 6px 14px; background: var(--bg-tertiary); border: 1px solid var(--border-color); border-radius: 6px; cursor: pointer; color: var(--text-secondary); transition: color 0.2s, border-color 0.2s;">Configure</button>
        </div>

        <!-- MCP Call Log -->
        <div class="dashboard-card">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.75rem;">
            <h3 style="font-size: 0.9375rem; font-weight: 600;">Recent MCP Calls</h3>
            <button onclick="refreshCallLog()" style="font-size: 0.8125rem; padding: 4px 12px; background: var(--bg-tertiary); border: 1px solid var(--border-color); border-radius: 6px; cursor: pointer; color: var(--text-secondary); transition: color 0.2s, border-color 0.2s;">Refresh</button>
          </div>
          <div id="callLogList" style="max-height: 320px; overflow-y: auto; font-size: 0.8125rem;">
            <div style="color: var(--text-muted); padding: 2rem 0; text-align: center;">No calls yet. Connect your MCP client to get started.</div>
          </div>
        </div>
      </div>
    </div>

    <!-- App View -->
    <div class="app-view" id="appView" style="display: ${initialView === 'app' ? 'flex' : 'none'};">
      <div id="app"></div>
    </div>

    <!-- Footer -->
    <div class="site-footer" id="siteFooter" style="display: ${initialView === 'dashboard' ? 'flex' : 'none'}">
      <span>&copy; 2026 Ultralight</span>
      <div class="footer-links">
        <a href="https://www.npmjs.com/package/@ultralightpro/types" target="_blank">SDK Reference</a>
        <a href="https://www.npmjs.com/package/ultralightpro" target="_blank">CLI Tool</a>
        <a href="/mcp/platform">API / MCP</a>
        <a href="#" onclick="showQuickRef(); return false;">Quick Ref</a>
      </div>
    </div>
  </main>

  <!-- Settings Modal -->
  <div class="modal-overlay" id="settingsModal">
    <div class="modal wide">
      <div class="modal-header">
        <h2 class="modal-title">App Settings</h2>
        <button class="modal-close" onclick="closeSettingsModal()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>

      <!-- Tabs -->
      <div class="settings-tabs">
        <button class="settings-tab active" data-tab="general">General</button>
        <button class="settings-tab" data-tab="env">Environment</button>
        <button class="settings-tab" data-tab="database">Database</button>
        <button class="settings-tab" data-tab="mcp">MCP & Skills</button>
        <button class="settings-tab" data-tab="draft">Draft & Publish</button>
      </div>

      <div class="modal-body">
        <!-- General Tab -->
        <div class="settings-tab-content active" id="tab-general">
          <!-- Draft Banner (shown when draft exists) -->
          <div class="draft-banner" id="draftBannerGeneral" style="display: none;">
            <div class="draft-banner-title">📝 Draft Available</div>
            <div class="draft-banner-info">You have unpublished changes. Go to "Draft & Publish" tab to manage.</div>
          </div>

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

          <div class="settings-section">
            <div class="settings-section-title">Visibility</div>
            <div class="settings-field">
              <label for="settingsVisibility">App Visibility</label>
              <select id="settingsVisibility" class="settings-select">
                <option value="private">Private - Only you can access</option>
                <option value="unlisted">Unlisted - Anyone with link can access</option>
                <option value="public">Public - Listed in app directory</option>
              </select>
              <div id="visibilityUpgradeHint" class="upgrade-cta" style="display: none;">
                🔒 Unlock unlisted &amp; public visibility — <a href="/pricing">Upgrade to Pro</a>
              </div>
            </div>
            <div class="settings-field">
              <label for="settingsDownloadAccess">Code Download Access</label>
              <select id="settingsDownloadAccess" class="settings-select">
                <option value="owner">Owner Only - Only you can download</option>
                <option value="public">Public - Anyone can download code</option>
              </select>
            </div>
          </div>

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

        <!-- Environment Variables Tab -->
        <div class="settings-tab-content" id="tab-env">
          <div class="settings-section">
            <div class="settings-section-title">Environment Variables</div>
            <div class="info-box">
              Store secrets and configuration for your app. These are encrypted and only accessible by your app at runtime via <code>ultralight.env</code>.
            </div>

            <div id="envVarsContainer" class="env-vars-container">
              <div class="env-vars-empty" id="envVarsEmpty">
                No environment variables configured. Add one to get started.
              </div>
            </div>

            <button class="env-var-add-btn" id="addEnvVarBtn" style="margin-top: 0.75rem;">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
              Add Variable
            </button>

            <div class="env-vars-limits">
              Max 50 variables • Keys: uppercase, underscores (max 64 chars) • Values: max 4KB
            </div>
          </div>

          <div class="settings-section">
            <div class="settings-section-title">Usage in Code</div>
            <div class="quick-ref-code" style="font-size: 0.8125rem; padding: 1rem;">// Access environment variables
const apiKey = ultralight.env.MY_API_KEY;
const dbUrl = ultralight.env.DATABASE_URL;

// Check if variable exists
if (ultralight.env.FEATURE_FLAG) {
  // Feature enabled
}</div>
          </div>
        </div>

        <!-- Database Tab (Supabase) -->
        <div class="settings-tab-content" id="tab-database">
          <div class="settings-section">
            <div class="settings-section-title">Supabase Integration</div>
            <div class="info-box">
              Connect your own Supabase project to enable real database access with SQL, auth, and real-time features.
              Your credentials are encrypted and only accessible at runtime.
            </div>

            <div class="settings-field">
              <label for="supabaseUrl">Supabase URL</label>
              <input type="text" id="supabaseUrl" class="settings-input" placeholder="https://xxxxx.supabase.co" />
            </div>

            <div class="settings-field">
              <label for="supabaseAnonKey">Anon Key (public)</label>
              <div style="display: flex; gap: 0.5rem;">
                <input type="password" id="supabaseAnonKey" class="settings-input" placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." style="flex: 1;" />
                <button class="env-var-toggle-visibility" onclick="toggleSupabaseKeyVisibility('supabaseAnonKey')" title="Toggle visibility">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                    <circle cx="12" cy="12" r="3"></circle>
                  </svg>
                </button>
              </div>
              <span class="env-vars-limits">Required for client-side operations. Safe to expose.</span>
            </div>

            <div class="settings-field">
              <label for="supabaseServiceKey">Service Role Key (optional)</label>
              <div style="display: flex; gap: 0.5rem;">
                <input type="password" id="supabaseServiceKey" class="settings-input" placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." style="flex: 1;" />
                <button class="env-var-toggle-visibility" onclick="toggleSupabaseKeyVisibility('supabaseServiceKey')" title="Toggle visibility">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                    <circle cx="12" cy="12" r="3"></circle>
                  </svg>
                </button>
              </div>
              <span class="env-vars-limits" style="color: var(--warning-color);">⚠️ Grants full database access. Only use for admin operations.</span>
            </div>

            <div class="settings-field">
              <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer;">
                <input type="checkbox" id="supabaseEnabled" style="width: 16px; height: 16px;" />
                <span>Enable Supabase</span>
              </label>
              <span class="env-vars-limits">When enabled, a pre-configured Supabase client is available as <code>supabase</code> in your code.</span>
            </div>

            <div id="supabaseStatus" class="skills-status" style="display: none;"></div>
          </div>

          <div class="settings-section">
            <div class="settings-section-title">Usage in Code</div>
            <div class="quick-ref-code" style="font-size: 0.8125rem; padding: 1rem;">// Option 1: Use the pre-configured client (recommended)
const { data, error } = await supabase
  .from('posts')
  .select('*')
  .eq('user_id', ultralight.user.id);

// Option 2: Import and configure manually
import { createClient } from '@supabase/supabase-js';
const client = createClient(
  ultralight.env.SUPABASE_URL,
  ultralight.env.SUPABASE_ANON_KEY
);</div>
          </div>

          <div class="settings-section">
            <div class="settings-action-btn danger" id="removeSupabaseBtn" style="width: fit-content;">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
              Remove Supabase Configuration
            </div>
          </div>
        </div>

        <!-- MCP & Skills Tab -->
        <div class="settings-tab-content" id="tab-mcp">
          <div class="settings-section">
            <div class="settings-section-title">MCP Endpoint</div>
            <div class="info-box">
              Connect this app to AI agents via the Model Context Protocol (MCP).
              Use the endpoint below in Claude Desktop, Cursor, or other MCP clients.
            </div>
            <div class="mcp-endpoint">
              <span class="mcp-endpoint-url" id="mcpEndpointUrl">Loading...</span>
              <button class="mcp-endpoint-copy" id="copyMcpBtn" title="Copy endpoint">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
              </button>
            </div>
          </div>

          <div class="settings-section">
            <div class="settings-section-title">Skills Documentation</div>
            <div class="info-box" id="skillsInfoBox">
              Skills.md describes what your app can do. Generate from code or edit manually.
            </div>

            <div class="skills-status info" id="skillsStatus">
              <span>No documentation generated yet</span>
            </div>

            <button class="generate-docs-btn" id="generateDocsBtn">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path>
              </svg>
              Generate Documentation
            </button>

            <div class="settings-field" style="margin-top: 1rem;">
              <label for="skillsEditor">Skills.md Editor</label>
              <textarea class="skills-editor" id="skillsEditor" placeholder="# App Name\n\n## Functions\n\n### functionName\nDescription of the function..."></textarea>
            </div>

            <div class="skills-status" id="skillsValidation" style="display: none;"></div>
          </div>
        </div>

        <!-- Draft & Publish Tab -->
        <div class="settings-tab-content" id="tab-draft">
          <div class="settings-section">
            <div class="settings-section-title">Version Management</div>

            <!-- Published Version Info -->
            <div class="settings-field">
              <label>Published Version</label>
              <div style="display: flex; align-items: center; gap: 0.5rem; color: var(--text-secondary); font-size: 0.875rem;">
                <span id="publishedVersion">1.0.0</span>
                <span style="color: var(--success-color);">● Live</span>
              </div>
            </div>

            <!-- Version History -->
            <div class="settings-field">
              <label>Version History</label>
              <div id="versionHistoryList" style="margin-top: 0.25rem;">
                <div style="color: var(--text-muted); font-size: 0.8125rem;">Loading...</div>
              </div>
            </div>

            <!-- App Storage Usage -->
            <div id="appStorageInfo" class="info-box" style="display: none; margin-bottom: 0.75rem;"></div>

            <!-- Draft Section -->
            <div id="draftSection">
              <div class="draft-banner" id="draftBanner" style="display: none;">
                <div class="draft-banner-title">📝 Draft Ready</div>
                <div class="draft-banner-info">
                  Version: <strong id="draftVersion">-</strong><br>
                  Uploaded: <span id="draftUploadedAt">-</span>
                </div>
                <div class="draft-actions">
                  <button class="btn-publish" id="publishDraftBtn">
                    Publish Draft
                  </button>
                  <button class="btn-discard" id="discardDraftBtn">
                    Discard
                  </button>
                </div>
              </div>

              <div id="noDraftMessage" class="info-box">
                No draft available. Upload new code to create a draft.
              </div>
            </div>
          </div>

          <div class="settings-section">
            <div class="settings-section-title">Upload New Version</div>
            <div class="info-box">
              Upload new code as a draft. Review and test before publishing to replace the live version.
            </div>

            <div class="drop-zone" id="draftDropZone" style="min-height: 120px; margin-bottom: 0.75rem;">
              <div class="drop-zone-icon" style="font-size: 2rem;">📁</div>
              <div class="drop-zone-text" style="font-size: 0.875rem;">Drop files or click to upload draft</div>
              <input type="file" id="draftFileInput" webkitdirectory directory multiple style="display: none;">
            </div>

            <div id="draftFileList" class="file-list"></div>
            <button class="settings-action-btn" id="uploadDraftBtn" style="width: 100%; margin-top: 0.5rem;" disabled>
              Upload as Draft
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

  <!-- User Settings Modal (BYOK + API Tokens) -->
  <!-- API Keys Modal -->
  <div class="modal-overlay" id="apiKeysModal">
    <div class="modal" style="max-width: 650px;">
      <div class="modal-header">
        <h2 class="modal-title">API Keys</h2>
        <button class="modal-close" onclick="closeApiKeysModal()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
      <div class="modal-body">
        <div class="settings-section">
          <div class="info-box">
            Create personal access tokens for CLI and API access. Tokens are shown only once when created.
          </div>

          <div id="tokensMessage" class="byok-message" style="display: none;"></div>

          <!-- Create Token Form -->
          <div class="token-create-form">
            <input type="text" id="newTokenName" placeholder="Token name (e.g., CLI, Corin Bot)" maxlength="50" />
            <select id="newTokenExpiry">
              <option value="">Never expires</option>
              <option value="7">7 days</option>
              <option value="30">30 days</option>
              <option value="90">90 days</option>
              <option value="365">1 year</option>
            </select>
            <button class="byok-btn byok-btn-primary" onclick="createToken()">Create Token</button>
          </div>

          <!-- New Token Display (shown after creation) -->
          <div id="newTokenDisplay" class="new-token-display" style="display: none;">
            <div class="new-token-warning">⚠️ Copy this token now! You won't be able to see it again.</div>
            <div class="new-token-value">
              <code id="newTokenValue"></code>
              <button class="byok-btn byok-btn-secondary" onclick="copyToken()">Copy</button>
            </div>
          </div>

          <!-- Token Limit Info -->
          <div id="tokenLimitInfo" class="token-limit-info" style="display: none;"></div>

          <!-- Tokens List -->
          <div id="tokensList" class="tokens-list">
            <div class="byok-loading">Loading tokens...</div>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="modal-btn secondary" onclick="closeApiKeysModal()">Close</button>
      </div>
    </div>
  </div>


  <!-- Hidden BYOK container (deprecated from UI but keeping data layer) -->
  <div style="display: none;">
    <div id="byokMessage" class="byok-message"></div>
    <div id="byokProviders" class="byok-providers"></div>
  </div>

  <!-- Quick Reference Modal -->
  <div class="modal-overlay" id="quickRefModal">
    <div class="modal" style="max-width: 650px;">
      <div class="modal-header">
        <h2 class="modal-title">SDK Quick Reference</h2>
        <button class="modal-close" onclick="closeQuickRef()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
      <div class="modal-body quick-ref-content">
        <div class="quick-ref-section">
          <div class="quick-ref-section-title">Setup (for TypeScript autocomplete)</div>
          <div class="quick-ref-code">npm install -D @ultralightpro/types

// Then add to your file:
/// &lt;reference types="@ultralightpro/types" /&gt;</div>
        </div>

        <div class="quick-ref-section">
          <div class="quick-ref-section-title">Data Storage</div>
          <div class="quick-ref-code">await ultralight.store('key', { any: 'value' });
await ultralight.load('key');
await ultralight.list('prefix/');
await ultralight.remove('key');

// Advanced queries
await ultralight.query('notes/', {
  sort: { field: 'createdAt', order: 'desc' },
  limit: 10
});</div>
        </div>

        <div class="quick-ref-section">
          <div class="quick-ref-section-title">AI (uses your BYOK key from Settings)</div>
          <div class="quick-ref-code">const response = await ultralight.ai({
  messages: [
    { role: 'system', content: 'You are helpful.' },
    { role: 'user', content: 'Hello!' }
  ],
  temperature: 0.7,
  max_tokens: 1000
});
console.log(response.content);</div>
        </div>

        <div class="quick-ref-section">
          <div class="quick-ref-section-title">User Context</div>
          <div class="quick-ref-code">// Check auth
if (ultralight.isAuthenticated()) {
  const user = ultralight.user;
  console.log(user.email, user.tier);
}

// Require auth (throws if not logged in)
const user = ultralight.requireAuth();</div>
        </div>

        <div class="quick-ref-section">
          <div class="quick-ref-section-title">Cron Jobs</div>
          <div class="quick-ref-code">// Register a scheduled task
await ultralight.cron.register(
  'daily-report',
  '0 9 * * *',  // Every day at 9am
  'generateReport'  // Function to call
);

// Use presets
ultralight.cron.presets.DAILY_9AM  // "0 9 * * *"</div>
        </div>

        <div class="quick-ref-section">
          <div class="quick-ref-section-title">Global Utilities</div>
          <div class="quick-ref-code">_.groupBy(items, 'category')
_.sortBy(items, 'date')
uuid.v4()
dateFns.format(new Date(), 'yyyy-MM-dd')
await hash.sha256('data')</div>
        </div>
      </div>
      <div class="modal-footer">
        <a href="https://www.npmjs.com/package/@ultralightpro/types" target="_blank" class="modal-btn secondary">View on npm</a>
        <button class="modal-btn primary" onclick="closeQuickRef()">Got it</button>
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
    let userProfile = null; // Full profile from GET /api/user (tier, storage, etc.)
    let apps = [];
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
    const dashboardView = document.getElementById('dashboardView');
    const appView = document.getElementById('appView');
    const settingsModal = document.getElementById('settingsModal');
    const deleteConfirmModal = document.getElementById('deleteConfirmModal');
    const toast = document.getElementById('toast');
    const sidebar = document.getElementById('sidebar');
    const sidebarToggle = document.getElementById('sidebarToggle');
    const mainContent = document.querySelector('.main-content');

    // ============================================
    // Sidebar Toggle
    // ============================================
    let sidebarCollapsed = localStorage.getItem('sidebar_collapsed') === 'true';

    function updateSidebarState() {
      if (sidebarCollapsed) {
        sidebar.classList.add('collapsed');
        mainContent.classList.add('sidebar-collapsed');
      } else {
        sidebar.classList.remove('collapsed');
        mainContent.classList.remove('sidebar-collapsed');
      }
      renderRailApps();
    }

    sidebarToggle.addEventListener('click', () => {
      sidebarCollapsed = !sidebarCollapsed;
      localStorage.setItem('sidebar_collapsed', sidebarCollapsed);
      updateSidebarState();
    });

    // Rail "Expand sidebar" button
    document.getElementById('railSidebarToggle')?.addEventListener('click', () => {
      sidebarCollapsed = !sidebarCollapsed;
      localStorage.setItem('sidebar_collapsed', sidebarCollapsed);
      updateSidebarState();
    });

    // Rail "Dashboard" button
    document.getElementById('railNewApp')?.addEventListener('click', () => {
      navigateToDashboard();
    });

    // Render collapsed rail app icons
    function renderRailApps() {
      const rail = document.getElementById('railAppsList');
      if (!rail) return;
      if (!apps || apps.length === 0) {
        rail.innerHTML = '';
        return;
      }
      rail.innerHTML = apps.map(app => {
        const isActive = app.id === currentAppId;
        const icon = app.icon_url
          ? \`<img src="\${app.icon_url}" alt="">\`
          : getAppEmoji(app.name);
        return \`<button class="sidebar-rail-app \${isActive ? 'active' : ''}" onclick="navigateToApp(event, '\${app.id}')" title="\${escapeHtml(app.name)}">\${icon}</button>\`;
      }).join('');
    }

    // Initialize sidebar state
    updateSidebarState();

    // ============================================
    // Theme Toggle (both expanded + rail buttons)
    // ============================================
    function toggleTheme() {
      const isDark = document.documentElement.classList.toggle('dark');
      localStorage.setItem('ultralight_theme', isDark ? 'dark' : 'light');
    }
    document.getElementById('themeToggle')?.addEventListener('click', toggleTheme);
    document.getElementById('railThemeToggle')?.addEventListener('click', toggleTheme);

    // ============================================
    // Footer visibility (hide when viewing app)
    // ============================================
    function updateFooterVisibility(view) {
      const footer = document.getElementById('siteFooter');
      if (footer) footer.style.display = view === 'dashboard' ? 'flex' : 'none';
    }

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

    async function updateAuthUI() {
      if (authToken) {
        const payload = decodeJWT(authToken);
        if (payload && payload.exp * 1000 > Date.now()) {
          currentUser = payload;
          const email = payload.email || 'User';

          // Fetch full user profile (tier, storage) from DB
          try {
            const profileRes = await fetch('/api/user', {
              headers: { 'Authorization': \`Bearer \${authToken}\` }
            });
            if (profileRes.ok) {
              userProfile = await profileRes.json();
            }
          } catch (e) {
            console.warn('Failed to fetch user profile:', e);
          }

          const tier = userProfile?.tier || 'free';
          const tierText = tier === 'pro' ? 'Pro plan' : 'Free plan';

          // Extract first name from Supabase Google Auth user_metadata
          const userMeta = payload.user_metadata || {};
          const fullName = userMeta.full_name || userMeta.name || '';
          const firstName = fullName.split(' ')[0] || email.split('@')[0];
          const initial = (firstName || email).charAt(0).toUpperCase();

          authSection.innerHTML = \`
            <div class="user-section" onclick="toggleProfileDropdown(event)">
              <div class="user-avatar">\${initial}</div>
              <div class="user-info">
                <div class="user-name">\${firstName}</div>
                <div class="user-tier-text">\${tierText}</div>
              </div>
              <svg class="user-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="6 15 12 9 18 15"></polyline>
              </svg>
              <div class="profile-dropdown" id="profileDropdown">
                <div class="profile-dropdown-email">\${email}</div>
                <div class="profile-dropdown-items">
                  <button class="profile-dropdown-item" onclick="event.stopPropagation(); openApiKeysModal();">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"></path>
                    </svg>
                    API Keys
                  </button>
                  <div class="profile-dropdown-divider"></div>
                  <button class="profile-dropdown-item logout" onclick="event.stopPropagation(); signOut();">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                      <polyline points="16 17 21 12 16 7"></polyline>
                      <line x1="21" y1="12" x2="9" y2="12"></line>
                    </svg>
                    Log out
                  </button>
                </div>
              </div>
            </div>
          \`;
          loadApps();
          loadDashboardData();
          return;
        }

        // Token expired — try refresh before clearing
        const refreshToken = localStorage.getItem('ultralight_refresh_token');
        if (refreshToken) {
          console.log('[layout] Token expired, attempting refresh...');
          try {
            const res = await fetch('/auth/refresh', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ refresh_token: refreshToken }),
            });
            if (res.ok) {
              const data = await res.json();
              localStorage.setItem('ultralight_token', data.access_token);
              if (data.refresh_token) {
                localStorage.setItem('ultralight_refresh_token', data.refresh_token);
              }
              authToken = data.access_token;
              console.log('[layout] Token refreshed successfully');
              // Re-run with the new token
              await updateAuthUI();
              return;
            } else {
              console.warn('[layout] Token refresh failed:', res.status);
            }
          } catch (e) {
            console.error('[layout] Token refresh error:', e);
          }
        }
      }
      localStorage.removeItem('ultralight_token');
      localStorage.removeItem('ultralight_refresh_token');
      authToken = null;
      currentUser = null;
      appsList.innerHTML = '<div class="apps-empty">Sign in to see your apps</div>';
    }

    window.signOut = function() {
      localStorage.removeItem('ultralight_token');
      localStorage.removeItem('ultralight_refresh_token');
      window.location.reload();
    };

    // ============================================
    // Profile Dropdown
    // ============================================
    window.toggleProfileDropdown = function(e) {
      e.stopPropagation();
      const dropdown = document.getElementById('profileDropdown');
      const userSection = dropdown?.closest('.user-section');
      if (!dropdown) return;

      const isOpen = dropdown.classList.contains('open');
      if (isOpen) {
        closeProfileDropdown();
      } else {
        dropdown.classList.add('open');
        userSection?.classList.add('menu-open');
      }
    };

    function closeProfileDropdown() {
      const dropdown = document.getElementById('profileDropdown');
      const userSection = dropdown?.closest('.user-section');
      if (dropdown) {
        dropdown.classList.remove('open');
        userSection?.classList.remove('menu-open');
      }
    }

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      const dropdown = document.getElementById('profileDropdown');
      if (dropdown && dropdown.classList.contains('open')) {
        if (!e.target.closest('.user-section')) {
          closeProfileDropdown();
        }
      }
    });

    // ============================================
    // Quick Reference Modal
    // ============================================
    const quickRefModal = document.getElementById('quickRefModal');

    window.showQuickRef = function() {
      quickRefModal.classList.add('open');
    };

    window.closeQuickRef = function() {
      quickRefModal.classList.remove('open');
    };

    quickRefModal.addEventListener('click', (e) => {
      if (e.target === quickRefModal) {
        closeQuickRef();
      }
    });

    // ============================================
    // User Settings (Individual Modals)
    // ============================================
    const apiKeysModal = document.getElementById('apiKeysModal');
    const byokProviders = document.getElementById('byokProviders');
    const byokMessage = document.getElementById('byokMessage');
    let byokData = null;

    // Provider icons
    const PROVIDER_ICONS = {
      openrouter: '🌐',
      openai: '🤖',
      anthropic: '🧠',
      deepseek: '🔍',
      moonshot: '🌙'
    };

    // ============================================
    // UTILITY: Format bytes for display
    // ============================================
    function formatBytesUI(bytes) {
      if (bytes === 0) return '0 B';
      const units = ['B', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(1024));
      const val = bytes / Math.pow(1024, i);
      return val.toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
    }

    // ============================================
    // VERSION HISTORY
    // ============================================
    function loadVersionHistory(appId) {
      const list = document.getElementById('versionHistoryList');
      const storageInfo = document.getElementById('appStorageInfo');

      if (!settingsApp) {
        list.innerHTML = '';
        return;
      }

      const versions = settingsApp.versions || [];
      const metadata = settingsApp.version_metadata || [];
      const currentVersion = settingsApp.current_version;

      if (versions.length === 0) {
        list.innerHTML = '<div style="color: var(--text-muted); font-size: 0.8125rem;">No versions yet.</div>';
        return;
      }

      // Build lookup from version_metadata
      const metaMap = {};
      metadata.forEach(m => { metaMap[m.version] = m; });

      // Sort versions descending (newest first)
      const sorted = [...versions].sort((a, b) => {
        const dateA = metaMap[a]?.created_at || '';
        const dateB = metaMap[b]?.created_at || '';
        return dateB.localeCompare(dateA);
      });

      list.innerHTML = sorted.map(v => {
        const meta = metaMap[v];
        const isCurrent = v === currentVersion;
        const size = meta?.size_bytes ? formatBytesUI(meta.size_bytes) : '—';
        const date = meta?.created_at ? new Date(meta.created_at).toLocaleDateString() : '—';

        return \`
          <div class="version-item">
            <div class="version-info">
              <span class="version-label">\${v}</span>
              <span class="version-meta">\${size} · \${date}</span>
              \${isCurrent ? '<span class="version-current-badge">● Current</span>' : ''}
            </div>
            \${!isCurrent ? \`<button class="version-delete-btn" onclick="deleteVersion('\${appId}', '\${v}')">Delete</button>\` : ''}
          </div>
        \`;
      }).join('');

      // Show app storage context
      const appStorage = settingsApp.storage_bytes || 0;
      if (appStorage > 0) {
        storageInfo.style.display = 'block';
        storageInfo.textContent = \`This app uses \${formatBytesUI(appStorage)}.\`;
      } else {
        storageInfo.style.display = 'none';
      }
    }

    window.deleteVersion = async function(appId, version) {
      if (!confirm(\`Delete version \${version}? This will free up storage space.\`)) return;

      try {
        const res = await fetch(\`/api/apps/\${appId}/versions/\${version}\`, {
          method: 'DELETE',
          headers: { 'Authorization': \`Bearer \${authToken}\` }
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to delete version');

        const reclaimed = data.bytes_reclaimed || 0;
        showToast(\`Version \${version} deleted. Reclaimed \${formatBytesUI(reclaimed)}.\`);

        // Refresh version list from server
        const appRes = await fetch(\`/api/apps/\${appId}\`, {
          headers: { 'Authorization': \`Bearer \${authToken}\` }
        });
        if (appRes.ok) {
          const appData = await appRes.json();
          settingsApp = appData;
          // Update in apps list too
          const idx = apps.findIndex(a => a.id === appId);
          if (idx !== -1) apps[idx] = appData;
        }
        loadVersionHistory(appId);

        // Refresh user profile storage
        try {
          const profileRes = await fetch('/api/user', {
            headers: { 'Authorization': \`Bearer \${authToken}\` }
          });
          if (profileRes.ok) userProfile = await profileRes.json();
        } catch (e) { /* ignore */ }
      } catch (err) {
        showToast(err.message, 'error');
      }
    };

    window.openApiKeysModal = async function() {
      closeProfileDropdown();
      apiKeysModal.classList.add('open');
      await loadTokens();
    };

    window.closeApiKeysModal = function() {
      apiKeysModal.classList.remove('open');
      document.getElementById('tokensMessage').style.display = 'none';
      document.getElementById('newTokenDisplay').style.display = 'none';
    };

    // Legacy alias (in case anything still references it)
    window.openUserSettings = function() { openApiKeysModal(); };
    window.closeUserSettings = function() { closeApiKeysModal(); };

    async function loadBYOKConfig() {
      if (!authToken) return;

      byokProviders.innerHTML = '<div class="byok-loading">Loading providers...</div>';

      try {
        const res = await fetch('/api/user/byok', {
          headers: { 'Authorization': \`Bearer \${authToken}\` }
        });

        if (!res.ok) throw new Error('Failed to load BYOK config');

        byokData = await res.json();
        renderBYOKProviders();
      } catch (err) {
        console.error('Failed to load BYOK config:', err);
        byokProviders.innerHTML = '<div class="byok-loading" style="color: var(--error-color);">Failed to load providers</div>';
      }
    }

    function renderBYOKProviders() {
      if (!byokData) return;

      const { enabled, primary_provider, configs, available_providers } = byokData;

      // Create a map of configured providers
      const configuredMap = {};
      configs.forEach(c => { configuredMap[c.provider] = c; });

      const html = available_providers.map(provider => {
        const isConfigured = !!configuredMap[provider.id];
        const isPrimary = primary_provider === provider.id;
        const config = configuredMap[provider.id];

        return \`
          <div class="byok-provider-card \${isConfigured ? 'configured' : ''} \${isPrimary ? 'primary' : ''}" data-provider="\${provider.id}">
            <div class="byok-provider-header">
              <div class="byok-provider-info">
                <div class="byok-provider-icon">\${PROVIDER_ICONS[provider.id] || '🔑'}</div>
                <div>
                  <div class="byok-provider-name">\${provider.name}</div>
                  <div class="byok-provider-desc">\${provider.description}</div>
                </div>
              </div>
              <div class="byok-provider-actions">
                \${isPrimary ? '<span class="byok-status primary">Primary</span>' : ''}
                \${isConfigured && !isPrimary ? '<span class="byok-status configured">Configured</span>' : ''}
              </div>
            </div>

            \${isConfigured ? \`
              <div class="byok-key-input">
                <input type="password" placeholder="••••••••••••••••" disabled value="configured" />
                \${!isPrimary ? \`<button class="byok-btn byok-btn-secondary" onclick="setPrimaryProvider('\${provider.id}')">Set Primary</button>\` : ''}
                <button class="byok-btn byok-btn-danger" onclick="removeProvider('\${provider.id}')">Remove</button>
              </div>
              <div class="byok-help">
                Added \${config.added_at ? new Date(config.added_at).toLocaleDateString() : 'recently'} ·
                <a href="\${provider.docsUrl}" target="_blank">Docs</a>
              </div>
            \` : \`
              <div class="byok-key-input">
                <input type="password" id="key-\${provider.id}" placeholder="Paste your API key here" />
                <button class="byok-btn byok-btn-primary" onclick="addProvider('\${provider.id}')">Add Key</button>
              </div>
              <div class="byok-help">
                <a href="\${provider.apiKeyUrl}" target="_blank">Get your API key →</a>
              </div>
            \`}
          </div>
        \`;
      }).join('');

      byokProviders.innerHTML = html;
    }

    window.addProvider = async function(providerId) {
      const input = document.getElementById(\`key-\${providerId}\`);
      const apiKey = input?.value?.trim();

      if (!apiKey) {
        showBYOKMessage('Please enter an API key', 'error');
        return;
      }

      const btn = input.nextElementSibling;
      btn.disabled = true;
      btn.textContent = 'Adding...';

      try {
        const res = await fetch('/api/user/byok', {
          method: 'POST',
          headers: {
            'Authorization': \`Bearer \${authToken}\`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ provider: providerId, api_key: apiKey })
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || 'Failed to add provider');
        }

        showBYOKMessage(data.message || 'Provider added successfully', 'success');
        await loadBYOKConfig();
      } catch (err) {
        showBYOKMessage(err.message, 'error');
        btn.disabled = false;
        btn.textContent = 'Add Key';
      }
    };

    window.removeProvider = async function(providerId) {
      if (!confirm('Remove this API key? You can add it again later.')) return;

      try {
        const res = await fetch(\`/api/user/byok/\${providerId}\`, {
          method: 'DELETE',
          headers: { 'Authorization': \`Bearer \${authToken}\` }
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || 'Failed to remove provider');
        }

        showBYOKMessage(data.message || 'Provider removed', 'success');
        await loadBYOKConfig();
      } catch (err) {
        showBYOKMessage(err.message, 'error');
      }
    };

    window.setPrimaryProvider = async function(providerId) {
      try {
        const res = await fetch('/api/user/byok/primary', {
          method: 'POST',
          headers: {
            'Authorization': \`Bearer \${authToken}\`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ provider: providerId })
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || 'Failed to set primary provider');
        }

        showBYOKMessage(data.message || 'Primary provider updated', 'success');
        await loadBYOKConfig();
      } catch (err) {
        showBYOKMessage(err.message, 'error');
      }
    };

    function showBYOKMessage(message, type) {
      byokMessage.textContent = message;
      byokMessage.className = \`byok-message \${type}\`;
      byokMessage.style.display = 'block';
      setTimeout(() => { byokMessage.style.display = 'none'; }, 5000);
    }

    // Close modals on overlay click
    apiKeysModal.addEventListener('click', (e) => {
      if (e.target === apiKeysModal) closeApiKeysModal();
    });

    // ============================================
    // API Tokens
    // ============================================
    let currentTokens = [];
    let newlyCreatedToken = null;

    async function loadTokens() {
      if (!authToken) return;

      const tokensList = document.getElementById('tokensList');
      tokensList.innerHTML = '<div class="byok-loading">Loading tokens...</div>';

      try {
        const res = await fetch('/api/user/tokens', {
          headers: { 'Authorization': \`Bearer \${authToken}\` }
        });

        if (!res.ok) throw new Error('Failed to load tokens');

        const data = await res.json();
        currentTokens = data.tokens || [];
        renderTokensList();
      } catch (err) {
        console.error('Failed to load tokens:', err);
        tokensList.innerHTML = '<div class="byok-loading" style="color: var(--error-color);">Failed to load tokens</div>';
      }
    }

    function renderTokensList() {
      const tokensList = document.getElementById('tokensList');
      const limitInfo = document.getElementById('tokenLimitInfo');
      const createBtn = document.querySelector('.token-create-form .byok-btn-primary');

      // Show token limit indicator
      if (limitInfo && userProfile) {
        limitInfo.style.display = 'flex';
        const tier = userProfile.tier || 'free';
        const count = currentTokens.length;
        if (tier === 'free') {
          const maxTokens = 1;
          const atLimit = count >= maxTokens;
          limitInfo.innerHTML = \`
            <span>API Tokens: <span class="token-limit-count">\${count}/\${maxTokens}</span></span>
            \${atLimit ? '<span style="color: var(--warning-color); font-size: 0.75rem;">Limit reached — <a href="/pricing" style="color: var(--accent-color);">Upgrade to Pro</a></span>' : ''}
          \`;
          if (createBtn) createBtn.disabled = atLimit;
        } else {
          limitInfo.innerHTML = \`<span>API Tokens: <span class="token-limit-count">\${count}</span> (unlimited)</span>\`;
          if (createBtn) createBtn.disabled = false;
        }
      }

      if (currentTokens.length === 0) {
        tokensList.innerHTML = '<div class="tokens-empty">No API tokens yet. Create one to get started.</div>';
        return;
      }

      const html = currentTokens.map(token => {
        const createdAt = new Date(token.created_at).toLocaleDateString();
        const lastUsed = token.last_used_at
          ? new Date(token.last_used_at).toLocaleDateString()
          : 'Never';
        const expiresAt = token.expires_at
          ? new Date(token.expires_at).toLocaleDateString()
          : 'Never';
        const isExpired = token.expires_at && new Date(token.expires_at) < new Date();

        return \`
          <div class="token-item \${isExpired ? 'expired' : ''}">
            <div class="token-info">
              <div class="token-name">\${escapeHtml(token.name)}</div>
              <div class="token-meta">
                <span class="token-prefix">\${token.token_prefix}...</span>
                <span>Created: \${createdAt}</span>
                <span>Last used: \${lastUsed}</span>
                <span>Expires: \${expiresAt}</span>
                \${isExpired ? '<span class="token-expired-badge">Expired</span>' : ''}
              </div>
            </div>
            <button class="byok-btn byok-btn-danger" onclick="revokeToken('\${token.id}')">Revoke</button>
          </div>
        \`;
      }).join('');

      tokensList.innerHTML = html;
    }

    window.createToken = async function() {
      const nameInput = document.getElementById('newTokenName');
      const expirySelect = document.getElementById('newTokenExpiry');
      const name = nameInput.value.trim();

      if (!name) {
        showTokensMessage('Please enter a token name', 'error');
        return;
      }

      const btn = event.target;
      btn.disabled = true;
      btn.textContent = 'Creating...';

      try {
        const body = { name };
        if (expirySelect.value) {
          body.expires_in_days = parseInt(expirySelect.value);
        }

        const res = await fetch('/api/user/tokens', {
          method: 'POST',
          headers: {
            'Authorization': \`Bearer \${authToken}\`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body)
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || 'Failed to create token');
        }

        // Show the new token
        newlyCreatedToken = data.plaintext_token;
        document.getElementById('newTokenValue').textContent = newlyCreatedToken;
        document.getElementById('newTokenDisplay').style.display = 'block';

        // Clear form
        nameInput.value = '';
        expirySelect.value = '';

        showTokensMessage('Token created! Copy it now.', 'success');
        await loadTokens();
      } catch (err) {
        showTokensMessage(err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Create Token';
      }
    };

    window.copyToken = async function() {
      if (!newlyCreatedToken) return;

      try {
        await navigator.clipboard.writeText(newlyCreatedToken);
        showTokensMessage('Token copied to clipboard!', 'success');
      } catch (err) {
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = newlyCreatedToken;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        showTokensMessage('Token copied to clipboard!', 'success');
      }
    };

    window.revokeToken = async function(tokenId) {
      if (!confirm('Revoke this token? Any applications using it will stop working.')) return;

      try {
        const res = await fetch(\`/api/user/tokens/\${tokenId}\`, {
          method: 'DELETE',
          headers: { 'Authorization': \`Bearer \${authToken}\` }
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || 'Failed to revoke token');
        }

        showTokensMessage('Token revoked', 'success');
        await loadTokens();
      } catch (err) {
        showTokensMessage(err.message, 'error');
      }
    };

    function showTokensMessage(message, type) {
      const tokensMessage = document.getElementById('tokensMessage');
      tokensMessage.textContent = message;
      tokensMessage.className = \`byok-message \${type}\`;
      tokensMessage.style.display = 'block';
      setTimeout(() => { tokensMessage.style.display = 'none'; }, 5000);
    }

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

        if (!res.ok) {
          // Try debug endpoint to get more info
          console.error('loadApps failed with status:', res.status);
          try {
            const debugRes = await fetch('/api/debug/auth', {
              headers: { 'Authorization': \`Bearer \${authToken}\` }
            });
            const debugInfo = await debugRes.json();
            console.error('=== DEBUG INFO ===');
            console.error(JSON.stringify(debugInfo, null, 2));
            console.error('==================');
          } catch (debugErr) {
            console.error('Debug endpoint also failed:', debugErr);
          }
          throw new Error(\`Failed to load apps (status: \${res.status})\`);
        }

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
        renderRailApps();
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
      renderRailApps();
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
    let draftFiles = [];

    window.openSettings = async function(event, appId) {
      event.stopPropagation();
      settingsAppId = appId;
      settingsApp = apps.find(a => a.id === appId);

      if (!settingsApp) return;

      // Reset to first tab
      switchAppSettingsTab('general');

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

      // Set MCP endpoint URL
      const mcpUrl = \`\${window.location.origin}/mcp/\${appId}\`;
      document.getElementById('mcpEndpointUrl').textContent = mcpUrl;

      // Load skills.md
      loadSkillsMd(appId);

      // Load draft info & version history
      loadDraftInfo(appId);
      loadVersionHistory(appId);

      // Gate visibility options for free tier
      const visSelect = document.getElementById('settingsVisibility');
      const visHint = document.getElementById('visibilityUpgradeHint');
      if (visSelect) {
        Array.from(visSelect.options).forEach(opt => {
          if (opt.value === 'unlisted' || opt.value === 'public') {
            opt.disabled = userProfile?.tier === 'free';
          }
        });
      }
      if (visHint) {
        if (userProfile?.tier === 'free') {
          visHint.style.display = 'block';
          visHint.innerHTML = '🔒 <strong>Unlock unlisted & public visibility</strong> — <a href="/pricing" target="_blank">Upgrade to Pro</a> to share your apps publicly.';
        } else {
          visHint.style.display = 'none';
        }
      }

      // Load environment variables
      loadEnvVars(appId);

      // Load Supabase configuration
      loadSupabaseConfig(appId);

      // Published version
      document.getElementById('publishedVersion').textContent = settingsApp.current_version || '1.0.0';

      // Reset draft upload
      draftFiles = [];
      document.getElementById('draftFileList').innerHTML = '';
      document.getElementById('uploadDraftBtn').disabled = true;

      settingsModal.classList.add('open');
    };

    // Tab switching for app settings modal
    function switchAppSettingsTab(tabName) {
      // Update tab buttons within app settings modal only
      settingsModal.querySelectorAll('.settings-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.tab === tabName);
      });

      // Update tab content
      settingsModal.querySelectorAll('.settings-tab-content').forEach(content => {
        content.classList.toggle('active', content.id === \`tab-\${tabName}\`);
      });
    }

    settingsModal.querySelectorAll('.settings-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        switchAppSettingsTab(tab.dataset.tab);
      });
    });

    // Load Skills.md
    async function loadSkillsMd(appId) {
      const editor = document.getElementById('skillsEditor');
      const status = document.getElementById('skillsStatus');

      try {
        const res = await fetch(\`/api/apps/\${appId}/skills.md\`, {
          headers: { 'Authorization': \`Bearer \${authToken}\` }
        });

        if (res.ok) {
          const text = await res.text();
          editor.value = text;
          status.className = 'skills-status success';
          status.innerHTML = '✓ Documentation loaded';
        } else if (res.status === 404) {
          editor.value = '';
          status.className = 'skills-status info';
          status.innerHTML = 'No documentation generated yet. Click "Generate Documentation" to create.';
        } else {
          throw new Error('Failed to load');
        }
      } catch (err) {
        status.className = 'skills-status error';
        status.innerHTML = '✗ Failed to load documentation';
      }
    }

    // Load Draft Info
    async function loadDraftInfo(appId) {
      const draftBanner = document.getElementById('draftBanner');
      const draftBannerGeneral = document.getElementById('draftBannerGeneral');
      const noDraftMessage = document.getElementById('noDraftMessage');

      try {
        const res = await fetch(\`/api/apps/\${appId}/draft\`, {
          headers: { 'Authorization': \`Bearer \${authToken}\` }
        });

        if (!res.ok) throw new Error('Failed to load draft');

        const data = await res.json();

        if (data.has_draft) {
          draftBanner.style.display = 'block';
          draftBannerGeneral.style.display = 'block';
          noDraftMessage.style.display = 'none';
          document.getElementById('draftVersion').textContent = data.draft_version;
          document.getElementById('draftUploadedAt').textContent = new Date(data.draft_uploaded_at).toLocaleString();
        } else {
          draftBanner.style.display = 'none';
          draftBannerGeneral.style.display = 'none';
          noDraftMessage.style.display = 'block';
        }
      } catch (err) {
        console.error('Failed to load draft info:', err);
        draftBanner.style.display = 'none';
        draftBannerGeneral.style.display = 'none';
        noDraftMessage.style.display = 'block';
      }
    }

    // ============================================
    // Environment Variables
    // ============================================
    let currentEnvVars = {}; // { key: { masked, length, value? } }
    let pendingEnvVarChanges = {}; // Track changes to be saved

    async function loadEnvVars(appId) {
      const container = document.getElementById('envVarsContainer');
      const emptyState = document.getElementById('envVarsEmpty');

      try {
        const res = await fetch(\`/api/apps/\${appId}/env\`, {
          headers: { 'Authorization': \`Bearer \${authToken}\` }
        });

        if (!res.ok) {
          if (res.status === 403) {
            container.innerHTML = '<div class="env-vars-empty">You don\\'t have permission to manage environment variables for this app.</div>';
            return;
          }
          throw new Error('Failed to load env vars');
        }

        const data = await res.json();
        currentEnvVars = {};
        pendingEnvVarChanges = {};

        // Convert array to object
        if (data.env_vars && Array.isArray(data.env_vars)) {
          data.env_vars.forEach(v => {
            currentEnvVars[v.key] = { masked: v.masked, length: v.length };
          });
        }

        renderEnvVars();
      } catch (err) {
        console.error('Failed to load env vars:', err);
        container.innerHTML = '<div class="env-vars-empty">Failed to load environment variables.</div>';
      }
    }

    function renderEnvVars() {
      const container = document.getElementById('envVarsContainer');
      const emptyState = document.getElementById('envVarsEmpty');
      const keys = Object.keys(currentEnvVars);

      if (keys.length === 0 && Object.keys(pendingEnvVarChanges).length === 0) {
        container.innerHTML = '<div class="env-vars-empty" id="envVarsEmpty">No environment variables configured. Add one to get started.</div>';
        return;
      }

      // Merge existing vars with pending new vars
      const allKeys = new Set([...keys, ...Object.keys(pendingEnvVarChanges).filter(k => pendingEnvVarChanges[k] !== null)]);

      let html = '';
      allKeys.forEach(key => {
        const existing = currentEnvVars[key];
        const pending = pendingEnvVarChanges[key];
        const isNew = !existing;
        const isModified = pending !== undefined && pending !== null;
        const isDeleted = pending === null;

        if (isDeleted) return; // Skip deleted vars

        const displayValue = isModified ? pending : (existing?.masked || '');
        const placeholder = isNew ? 'value' : (existing?.masked || '••••');

        html += \`
          <div class="env-var-row" data-key="\${escapeHtml(key)}">
            <input type="text"
              class="env-var-key"
              value="\${escapeHtml(key)}"
              placeholder="KEY_NAME"
              \${!isNew ? 'readonly' : ''}
              data-original-key="\${escapeHtml(key)}"
              onchange="handleEnvKeyChange(this)"
            />
            <input type="\${isModified || isNew ? 'text' : 'password'}"
              class="env-var-value"
              value="\${isModified ? escapeHtml(pending) : ''}"
              placeholder="\${escapeHtml(placeholder)}"
              data-key="\${escapeHtml(key)}"
              onchange="handleEnvValueChange(this)"
            />
            <button class="env-var-toggle-visibility" onclick="toggleEnvVarVisibility(this)" title="Toggle visibility">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                <circle cx="12" cy="12" r="3"></circle>
              </svg>
            </button>
            <button class="env-var-delete" onclick="deleteEnvVar('\${escapeHtml(key)}')" title="Delete variable">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
            </button>
          </div>
        \`;
      });

      container.innerHTML = html;
    }

    window.handleEnvKeyChange = function(input) {
      const originalKey = input.dataset.originalKey;
      const newKey = input.value.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '');
      input.value = newKey;

      // If this is a new var being renamed
      if (pendingEnvVarChanges[originalKey] !== undefined && !currentEnvVars[originalKey]) {
        const value = pendingEnvVarChanges[originalKey];
        delete pendingEnvVarChanges[originalKey];
        pendingEnvVarChanges[newKey] = value;
        input.dataset.originalKey = newKey;

        // Update the value input's data-key
        const row = input.closest('.env-var-row');
        const valueInput = row.querySelector('.env-var-value');
        if (valueInput) valueInput.dataset.key = newKey;
      }
    };

    window.handleEnvValueChange = function(input) {
      const key = input.dataset.key;
      const value = input.value;
      pendingEnvVarChanges[key] = value;
    };

    window.toggleEnvVarVisibility = function(btn) {
      const row = btn.closest('.env-var-row');
      const input = row.querySelector('.env-var-value');
      if (input.type === 'password') {
        input.type = 'text';
      } else {
        input.type = 'password';
      }
    };

    window.deleteEnvVar = function(key) {
      if (!confirm(\`Delete environment variable "\${key}"?\`)) return;

      if (currentEnvVars[key]) {
        // Mark existing var for deletion
        pendingEnvVarChanges[key] = null;
      } else {
        // Remove pending new var
        delete pendingEnvVarChanges[key];
      }

      renderEnvVars();
    };

    // Add new env var
    document.getElementById('addEnvVarBtn')?.addEventListener('click', () => {
      // Generate a unique placeholder key
      let counter = 1;
      let newKey = 'NEW_VAR';
      while (currentEnvVars[newKey] || pendingEnvVarChanges[newKey] !== undefined) {
        newKey = \`NEW_VAR_\${counter++}\`;
      }

      pendingEnvVarChanges[newKey] = '';
      renderEnvVars();

      // Focus the new key input
      setTimeout(() => {
        const newRow = document.querySelector(\`.env-var-row[data-key="\${newKey}"]\`);
        if (newRow) {
          const keyInput = newRow.querySelector('.env-var-key');
          if (keyInput) {
            keyInput.focus();
            keyInput.select();
          }
        }
      }, 50);
    });

    // Save env vars (called from save settings)
    async function saveEnvVars() {
      if (!settingsAppId || Object.keys(pendingEnvVarChanges).length === 0) {
        return true; // Nothing to save
      }

      // Build the updates
      const updates = {};
      const deletions = [];

      for (const [key, value] of Object.entries(pendingEnvVarChanges)) {
        if (value === null) {
          deletions.push(key);
        } else if (value !== undefined) {
          // Validate key format
          if (!/^[A-Z][A-Z0-9_]*$/.test(key)) {
            showToast(\`Invalid key format: \${key}\`, 'error');
            return false;
          }
          if (key.startsWith('ULTRALIGHT')) {
            showToast(\`Reserved key prefix: \${key}\`, 'error');
            return false;
          }
          updates[key] = value;
        }
      }

      try {
        // Handle deletions first
        for (const key of deletions) {
          const res = await fetch(\`/api/apps/\${settingsAppId}/env/\${key}\`, {
            method: 'DELETE',
            headers: { 'Authorization': \`Bearer \${authToken}\` }
          });
          if (!res.ok) throw new Error(\`Failed to delete \${key}\`);
        }

        // Update/add vars if there are any
        if (Object.keys(updates).length > 0) {
          const res = await fetch(\`/api/apps/\${settingsAppId}/env\`, {
            method: 'PATCH',
            headers: {
              'Authorization': \`Bearer \${authToken}\`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ env_vars: updates })
          });

          if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || 'Failed to save env vars');
          }
        }

        // Clear pending changes
        pendingEnvVarChanges = {};
        return true;
      } catch (err) {
        console.error('Failed to save env vars:', err);
        showToast(err.message || 'Failed to save environment variables', 'error');
        return false;
      }
    }

    // ============================================
    // Supabase Configuration
    // ============================================
    let supabaseConfigLoaded = false;
    let supabaseConfigChanged = false;

    async function loadSupabaseConfig(appId) {
      const urlInput = document.getElementById('supabaseUrl');
      const anonKeyInput = document.getElementById('supabaseAnonKey');
      const serviceKeyInput = document.getElementById('supabaseServiceKey');
      const enabledCheckbox = document.getElementById('supabaseEnabled');
      const status = document.getElementById('supabaseStatus');

      try {
        const res = await fetch(\`/api/apps/\${appId}/supabase\`, {
          headers: { 'Authorization': \`Bearer \${authToken}\` }
        });

        if (!res.ok) {
          if (res.status === 403) {
            status.textContent = 'You don\\'t have permission to manage Supabase for this app.';
            status.className = 'skills-status error';
            status.style.display = 'block';
            return;
          }
          throw new Error('Failed to load Supabase config');
        }

        const data = await res.json();

        urlInput.value = data.url || '';
        anonKeyInput.value = ''; // Don't show actual key
        anonKeyInput.placeholder = data.has_anon_key ? '••••••••••••••••' : 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...';
        serviceKeyInput.value = '';
        serviceKeyInput.placeholder = data.has_service_key ? '••••••••••••••••' : 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...';
        enabledCheckbox.checked = data.enabled || false;

        supabaseConfigLoaded = true;
        supabaseConfigChanged = false;

        // Show status if configured
        if (data.url && data.has_anon_key) {
          status.textContent = '✓ Supabase configured' + (data.enabled ? ' and enabled' : ' (disabled)');
          status.className = 'skills-status ' + (data.enabled ? 'success' : 'info');
          status.style.display = 'block';
        } else {
          status.style.display = 'none';
        }

      } catch (err) {
        console.error('Failed to load Supabase config:', err);
        status.textContent = 'Failed to load Supabase configuration';
        status.className = 'skills-status error';
        status.style.display = 'block';
      }
    }

    // Track changes to Supabase config
    ['supabaseUrl', 'supabaseAnonKey', 'supabaseServiceKey', 'supabaseEnabled'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('change', () => { supabaseConfigChanged = true; });
        el.addEventListener('input', () => { supabaseConfigChanged = true; });
      }
    });

    async function saveSupabaseConfig() {
      if (!settingsAppId || !supabaseConfigChanged) {
        return true; // Nothing to save
      }

      const urlInput = document.getElementById('supabaseUrl');
      const anonKeyInput = document.getElementById('supabaseAnonKey');
      const serviceKeyInput = document.getElementById('supabaseServiceKey');
      const enabledCheckbox = document.getElementById('supabaseEnabled');

      const payload = {
        enabled: enabledCheckbox.checked,
      };

      // Only include URL if it changed
      const url = urlInput.value.trim();
      if (url) {
        payload.url = url;
      }

      // Only include keys if they were entered (not placeholder)
      if (anonKeyInput.value && anonKeyInput.value !== '') {
        payload.anon_key = anonKeyInput.value;
      }
      if (serviceKeyInput.value && serviceKeyInput.value !== '') {
        payload.service_key = serviceKeyInput.value;
      }

      try {
        const res = await fetch(\`/api/apps/\${settingsAppId}/supabase\`, {
          method: 'PUT',
          headers: {
            'Authorization': \`Bearer \${authToken}\`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Failed to save Supabase config');
        }

        supabaseConfigChanged = false;
        return true;
      } catch (err) {
        console.error('Failed to save Supabase config:', err);
        showToast(err.message || 'Failed to save Supabase configuration', 'error');
        return false;
      }
    }

    window.toggleSupabaseKeyVisibility = function(inputId) {
      const input = document.getElementById(inputId);
      if (input.type === 'password') {
        input.type = 'text';
      } else {
        input.type = 'password';
      }
    };

    // Remove Supabase configuration
    document.getElementById('removeSupabaseBtn')?.addEventListener('click', async () => {
      if (!settingsAppId || !authToken) return;

      if (!confirm('Are you sure you want to remove Supabase configuration? This cannot be undone.')) {
        return;
      }

      try {
        const res = await fetch(\`/api/apps/\${settingsAppId}/supabase\`, {
          method: 'DELETE',
          headers: { 'Authorization': \`Bearer \${authToken}\` }
        });

        if (!res.ok) throw new Error('Failed to remove Supabase config');

        // Clear form
        document.getElementById('supabaseUrl').value = '';
        document.getElementById('supabaseAnonKey').value = '';
        document.getElementById('supabaseServiceKey').value = '';
        document.getElementById('supabaseEnabled').checked = false;

        const status = document.getElementById('supabaseStatus');
        status.textContent = 'Supabase configuration removed';
        status.className = 'skills-status info';
        status.style.display = 'block';

        showToast('Supabase configuration removed');
      } catch (err) {
        showToast('Failed to remove Supabase configuration', 'error');
      }
    });

    // Copy MCP Endpoint
    document.getElementById('copyMcpBtn')?.addEventListener('click', async () => {
      const url = document.getElementById('mcpEndpointUrl').textContent;
      try {
        await navigator.clipboard.writeText(url);
        showToast('MCP endpoint copied');
      } catch (err) {
        showToast('Failed to copy', 'error');
      }
    });

    // Generate Documentation
    document.getElementById('generateDocsBtn')?.addEventListener('click', async () => {
      if (!settingsAppId || !authToken) return;

      const btn = document.getElementById('generateDocsBtn');
      const status = document.getElementById('skillsStatus');

      btn.disabled = true;
      btn.innerHTML = '<span>Generating...</span>';
      status.className = 'skills-status info';
      status.innerHTML = 'Generating documentation from code...';

      try {
        const res = await fetch(\`/api/apps/\${settingsAppId}/generate-docs\`, {
          method: 'POST',
          headers: {
            'Authorization': \`Bearer \${authToken}\`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ ai_enhance: false })
        });

        const data = await res.json();

        if (data.success || data.partial) {
          document.getElementById('skillsEditor').value = data.skills_md || '';
          status.className = 'skills-status success';
          let msg = '✓ Documentation generated';
          if (data.embedding_generated) msg += ' • Embedding updated';
          if (data.warnings?.length) msg += \` • \${data.warnings.length} warning(s)\`;
          status.innerHTML = msg;
          showToast('Documentation generated');
        } else {
          status.className = 'skills-status error';
          const errors = data.errors?.map(e => e.message).join(', ') || 'Unknown error';
          status.innerHTML = \`✗ Generation failed: \${errors}\`;
          showToast('Failed to generate docs', 'error');
        }
      } catch (err) {
        status.className = 'skills-status error';
        status.innerHTML = '✗ Failed to generate documentation';
        showToast('Failed to generate docs', 'error');
      } finally {
        btn.disabled = false;
        btn.innerHTML = \`
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path>
          </svg>
          Generate Documentation
        \`;
      }
    });

    // Validate Skills.md on edit
    let skillsValidationTimeout;
    document.getElementById('skillsEditor')?.addEventListener('input', () => {
      clearTimeout(skillsValidationTimeout);
      skillsValidationTimeout = setTimeout(() => {
        // Show validation is pending
        const validation = document.getElementById('skillsValidation');
        validation.style.display = 'block';
        validation.className = 'skills-status info';
        validation.innerHTML = 'Validating...';
      }, 500);
    });

    // Publish Draft
    document.getElementById('publishDraftBtn')?.addEventListener('click', async () => {
      if (!settingsAppId || !authToken) return;

      const btn = document.getElementById('publishDraftBtn');
      btn.disabled = true;
      btn.textContent = 'Publishing...';

      try {
        const res = await fetch(\`/api/apps/\${settingsAppId}/publish\`, {
          method: 'POST',
          headers: {
            'Authorization': \`Bearer \${authToken}\`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ regenerate_docs: true })
        });

        if (!res.ok) throw new Error('Failed to publish');

        const data = await res.json();
        showToast(\`Published version \${data.new_version}\`);

        // Update version display
        document.getElementById('publishedVersion').textContent = data.new_version;

        // Refresh draft info, version history, and app list
        await loadDraftInfo(settingsAppId);
        loadVersionHistory(settingsAppId);
        await loadApps();

        // Refresh user profile to update storage info
        if (authToken) {
          try {
            const profileRes = await fetch('/api/user', {
              headers: { 'Authorization': \`Bearer \${authToken}\` }
            });
            if (profileRes.ok) {
              userProfile = await profileRes.json();
              updateAuthUI();
            }
          } catch (e) { /* ignore */ }
        }
      } catch (err) {
        showToast('Failed to publish draft', 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Publish Draft';
      }
    });

    // Discard Draft
    document.getElementById('discardDraftBtn')?.addEventListener('click', async () => {
      if (!settingsAppId || !authToken) return;

      if (!confirm('Are you sure you want to discard this draft? This cannot be undone.')) {
        return;
      }

      const btn = document.getElementById('discardDraftBtn');
      btn.disabled = true;
      btn.textContent = 'Discarding...';

      try {
        const res = await fetch(\`/api/apps/\${settingsAppId}/draft\`, {
          method: 'DELETE',
          headers: { 'Authorization': \`Bearer \${authToken}\` }
        });

        if (!res.ok) throw new Error('Failed to discard');

        showToast('Draft discarded');
        await loadDraftInfo(settingsAppId);
      } catch (err) {
        showToast('Failed to discard draft', 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Discard';
      }
    });

    // Draft File Upload
    const draftDropZone = document.getElementById('draftDropZone');
    const draftFileInput = document.getElementById('draftFileInput');

    draftDropZone?.addEventListener('click', () => draftFileInput?.click());

    draftDropZone?.addEventListener('dragover', (e) => {
      e.preventDefault();
      draftDropZone.classList.add('dragover');
    });

    draftDropZone?.addEventListener('dragleave', () => {
      draftDropZone.classList.remove('dragover');
    });

    draftDropZone?.addEventListener('drop', (e) => {
      e.preventDefault();
      draftDropZone.classList.remove('dragover');
      draftFiles = Array.from(e.dataTransfer.files);
      updateDraftFileList();
    });

    draftFileInput?.addEventListener('change', () => {
      draftFiles = Array.from(draftFileInput.files);
      updateDraftFileList();
    });

    function updateDraftFileList() {
      const list = document.getElementById('draftFileList');
      const btn = document.getElementById('uploadDraftBtn');

      if (draftFiles.length === 0) {
        list.innerHTML = '';
        btn.disabled = true;
        return;
      }

      list.innerHTML = draftFiles.slice(0, 5).map(f => \`
        <div class="file-item">
          <span>\${f.name}</span>
          <span>\${(f.size / 1024).toFixed(1)} KB</span>
        </div>
      \`).join('');

      if (draftFiles.length > 5) {
        list.innerHTML += \`<div class="file-item" style="color: var(--text-muted);">+ \${draftFiles.length - 5} more files</div>\`;
      }

      btn.disabled = false;
    }

    // Upload Draft
    document.getElementById('uploadDraftBtn')?.addEventListener('click', async () => {
      if (!settingsAppId || !authToken || draftFiles.length === 0) return;



      const btn = document.getElementById('uploadDraftBtn');
      btn.disabled = true;
      btn.textContent = 'Uploading...';

      const formData = new FormData();
      draftFiles.forEach(f => formData.append('files', f));

      try {
        const res = await fetch(\`/api/apps/\${settingsAppId}/draft\`, {
          method: 'POST',
          headers: { 'Authorization': \`Bearer \${authToken}\` },
          body: formData
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Upload failed');
        }

        showToast('Draft uploaded successfully');

        // Reset and refresh
        draftFiles = [];
        document.getElementById('draftFileList').innerHTML = '';
        await loadDraftInfo(settingsAppId);
        loadVersionHistory(settingsAppId);

        // Refresh user profile to update storage info
        if (authToken) {
          try {
            const profileRes = await fetch('/api/user', {
              headers: { 'Authorization': \`Bearer \${authToken}\` }
            });
            if (profileRes.ok) {
              userProfile = await profileRes.json();
              updateAuthUI();
            }
          } catch (e) { /* ignore */ }
        }
      } catch (err) {
        showToast(err.message || 'Failed to upload draft', 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Upload as Draft';
      }
    });

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
        // Save general settings
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

        // Also save Skills.md if it has content
        const skillsEditor = document.getElementById('skillsEditor');
        const skillsMd = skillsEditor.value.trim();

        if (skillsMd) {
          try {
            const skillsRes = await fetch(\`/api/apps/\${settingsAppId}/skills\`, {
              method: 'PATCH',
              headers: {
                'Authorization': \`Bearer \${authToken}\`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ skills_md: skillsMd })
            });

            if (!skillsRes.ok) {
              const skillsData = await skillsRes.json();
              if (skillsData.errors) {
                const validation = document.getElementById('skillsValidation');
                validation.style.display = 'block';
                validation.className = 'skills-status error';
                validation.innerHTML = '✗ Validation errors: ' + skillsData.errors.map(e => e.message).join(', ');
                throw new Error('Skills.md validation failed');
              }
            }
          } catch (skillsErr) {
            showToast('Skills.md has errors - check the editor', 'warning');
          }
        }

        // Save environment variables
        const envSaved = await saveEnvVars();
        if (!envSaved) {
          throw new Error('Failed to save environment variables');
        }

        // Save Supabase configuration
        const supabaseSaved = await saveSupabaseConfig();
        if (!supabaseSaved) {
          throw new Error('Failed to save Supabase configuration');
        }

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

        // If viewing the deleted app, go to dashboard
        if (currentAppId === settingsAppId) {
          navigateToDashboard();
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
      dashboardView.style.display = view === 'dashboard' ? 'flex' : 'none';
      appView.style.display = view === 'app' ? 'flex' : 'none';
      currentView = view;
      updateFooterVisibility(view);
    }

    function navigateToDashboard() {
      history.pushState({}, '', '/');
      currentAppId = null;
      showView('dashboard');
      renderAppsList();
      loadDashboardData();
    }

    // ============================================
    // Dashboard Functions
    // ============================================
    const platformMcpUrlEl = document.getElementById('platformMcpUrl');
    if (platformMcpUrlEl) {
      platformMcpUrlEl.textContent = window.location.origin + '/mcp/platform';
    }

    window.copyPlatformMcpUrl = function() {
      const url = window.location.origin + '/mcp/platform';
      navigator.clipboard.writeText(url).then(() => {
        showToast('Platform MCP URL copied!');
      });
    };

    async function loadDashboardData() {
      try {
        // Load weekly usage
        const usageRes = await fetch('/api/user/usage', { headers: { 'Authorization': \`Bearer \${authToken}\` } });
        if (usageRes.ok) {
          const usage = await usageRes.json();
          const countEl = document.getElementById('weeklyUsageCount');
          const limitEl = document.getElementById('weeklyUsageLimit');
          const barEl = document.getElementById('weeklyUsageBar');
          const textEl = document.getElementById('weeklyUsageText');
          if (countEl) countEl.textContent = (usage.count || 0).toLocaleString() + ' calls';
          if (limitEl) limitEl.textContent = (usage.limit || 0).toLocaleString() + ' / week';
          if (barEl) {
            const pct = usage.limit > 0 ? Math.min(100, (usage.count / usage.limit) * 100) : 0;
            barEl.style.width = pct + '%';
            if (pct > 90) barEl.style.background = 'var(--error-color)';
            else if (pct > 70) barEl.style.background = 'var(--warning-color)';
          }
          if (textEl) textEl.textContent = usage.tier ? usage.tier.charAt(0).toUpperCase() + usage.tier.slice(1) + ' tier' : '';
        }
      } catch (e) {
        console.error('Failed to load usage:', e);
      }

      try {
        // Load token count for dashboard card
        const tokensRes = await fetch('/api/tokens', { headers: { 'Authorization': \`Bearer \${authToken}\` } });
        if (tokensRes.ok) {
          const tokens = await tokensRes.json();
          const listEl = document.getElementById('dashboardTokenList');
          if (listEl) {
            const count = Array.isArray(tokens) ? tokens.length : (tokens.tokens ? tokens.tokens.length : 0);
            listEl.textContent = count + ' active token' + (count !== 1 ? 's' : '');
          }
        }
      } catch (e) {
        console.error('Failed to load tokens:', e);
      }
    }

    window.openSupabaseConfig = function() {
      showToast('Supabase configuration coming soon.');
    };

    window.refreshCallLog = function() {
      showToast('Call log refresh coming soon.');
    };

    window.addEventListener('popstate', async (event) => {
      const path = window.location.pathname;

      if (path === '/dashboard' || path === '/') {
        currentAppId = null;
        showView('dashboard');
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
          style="width:100%;height:100%;border:none;background:var(--bg-primary);"
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
    // Dashboard
    // ============================================
    newAppBtn.addEventListener('click', navigateToDashboard);


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
    await updateAuthUI();

    // If we're in app view and have an appId, load the app via iframe
    // This ensures consistent rendering whether accessed directly via URL or via sidebar navigation
    ${initialView === 'app' && activeAppId ? `
    (async () => {
      console.log('📱 Initial app load via iframe for appId: ${activeAppId}');
      loadAndRunApp('${activeAppId}');
    })();
    ` : ''}
  </script>
</body>
</html>`;
}
