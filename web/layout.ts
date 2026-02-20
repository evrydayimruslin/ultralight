// Shared Layout Component
// ChatGPT-like UI with persistent sidebar

export function getLayoutHTML(options: {
  title?: string;
  activeAppId?: string;
  initialView: 'home' | 'dashboard' | 'app' | 'leaderboard';
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

    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg-primary);
      color: var(--text-primary);
      min-height: 100vh;
      display: flex;
    }

    /* Sidebar */
    .sidebar {
      width: var(--sidebar-width);
      height: calc(100vh - 52px);
      background: var(--bg-secondary);
      display: flex;
      flex-direction: column;
      position: fixed;
      left: 0;
      top: 52px;
      z-index: 100;
      transition: width 0.3s ease;
      overflow: hidden;
    }

    .sidebar.collapsed {
      width: 56px;
    }

    /* Sidebar toggle area */
    .sidebar-toggle-area {
      display: flex;
      align-items: center;
      padding: 0.5rem;
      flex-shrink: 0;
    }
    .sidebar.collapsed .sidebar-toggle-area {
      display: none;
    }
    .sidebar-toggle-btn {
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
    .sidebar-toggle-btn:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
    }
    .sidebar-toggle-btn svg {
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

    .nav-btn {
      justify-content: flex-start;
      border: none;
      padding: 0.45rem 0.75rem;
      border-radius: 6px;
      font-size: 0.8125rem;
      color: var(--text-secondary);
    }
    .nav-btn:hover {
      border: none;
      background: var(--bg-hover);
      color: var(--text-primary);
    }
    .nav-active {
      background: var(--bg-tertiary);
      color: var(--text-primary);
      font-weight: 600;
    }
    .nav-active:hover {
      background: var(--bg-tertiary);
    }

    .gaps-filter-btn {
      padding: 0.35rem 0.75rem;
      border-radius: 9999px;
      font-size: 0.75rem;
      font-weight: 500;
      background: var(--bg-tertiary);
      border: 1px solid var(--border-color);
      color: var(--text-secondary);
      cursor: pointer;
      transition: all 0.15s;
    }
    .gaps-filter-btn:hover {
      border-color: var(--accent-color);
      color: var(--accent-color);
    }
    .gaps-filter-active {
      border-color: var(--accent-color);
      color: var(--accent-color);
      background: var(--bg-secondary);
    }

    .home-card {
      display: flex;
      gap: 0.625rem;
      padding: 0.625rem 0.75rem;
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      transition: border-color 0.15s;
      text-decoration: none;
      color: inherit;
      cursor: pointer;
    }
    .home-card:hover {
      border-color: var(--text-muted);
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

    /* Token count (in dashboard card header) — no limits, all tiers unlimited */

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
      padding-top: 52px;
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

    .main-content {
      transition: margin-left 0.3s ease;
    }

    /* ===== Top Bar (full-width, YouTube-style) ===== */
    .top-bar {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      height: 52px;
      background: var(--bg-primary);
      display: flex;
      align-items: center;
      padding: 0 1.25rem;
      gap: 0.75rem;
      z-index: 200;
    }
    .top-bar-left {
      display: flex;
      align-items: center;
      width: 240px;
      flex-shrink: 0;
    }
    .top-bar-left .logo {
      font-size: 1.2rem;
      font-weight: 700;
      background: var(--accent-gradient);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      text-decoration: none;
    }
    .top-bar-center {
      flex: 1;
      display: flex;
      justify-content: center;
    }
    .top-bar-right {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      width: 240px;
      justify-content: flex-end;
      flex-shrink: 0;
    }
    .top-bar-search {
      width: 100%;
      max-width: 560px;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      background: var(--bg-tertiary);
      border: 1px solid var(--border-color);
      border-radius: 9999px;
      padding: 0.5rem 1rem;
    }
    .top-bar-search input {
      flex: 1;
      background: transparent;
      border: none;
      color: var(--text-primary);
      font-size: 0.8125rem;
      outline: none;
    }
    .top-bar-search svg { width: 16px; height: 16px; color: var(--text-muted); flex-shrink: 0; }
    .top-bar-btn {
      display: flex;
      align-items: center;
      gap: 0.375rem;
      padding: 0.375rem 0.75rem;
      background: transparent;
      border: 1px solid var(--border-color);
      border-radius: 6px;
      color: var(--text-secondary);
      font-size: 0.8125rem;
      cursor: pointer;
      transition: all 0.15s;
    }
    .top-bar-btn:hover { background: var(--bg-secondary); color: var(--text-primary); }
    .top-bar-btn svg { width: 16px; height: 16px; }
    .top-bar-connect-btn {
      display: none;
      align-items: center;
      gap: 0.375rem;
      padding: 0.4rem 0.875rem;
      background: var(--accent-color);
      color: #fff;
      border: none;
      border-radius: 9999px;
      font-size: 0.8125rem;
      font-weight: 500;
      cursor: pointer;
      transition: filter 0.15s;
      white-space: nowrap;
    }
    .top-bar-connect-btn:hover { filter: brightness(1.1); }
    .top-bar-connect-btn.visible { display: flex; }
    .top-bar-profile {
      position: relative;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.25rem 0.5rem;
      border-radius: 6px;
      cursor: pointer;
      transition: background 0.15s;
    }
    .top-bar-profile:hover { background: var(--bg-secondary); }
    .top-bar-profile-dropdown {
      display: none;
      position: absolute;
      top: 100%;
      right: 0;
      margin-top: 4px;
      min-width: 220px;
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      z-index: 300;
      padding: 0.5rem;
    }
    .top-bar-profile-dropdown.open { display: block; }
    .top-bar-profile-dropdown-email {
      padding: 0.5rem 0.75rem;
      font-size: 0.75rem;
      color: var(--text-muted);
      border-bottom: 1px solid var(--border-color);
      margin-bottom: 0.25rem;
    }
    .top-bar-profile-dropdown-item {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      width: 100%;
      padding: 0.5rem 0.75rem;
      background: transparent;
      border: none;
      border-radius: 4px;
      color: var(--text-secondary);
      font-size: 0.8125rem;
      cursor: pointer;
      transition: all 0.15s;
    }
    .top-bar-profile-dropdown-item:hover { background: var(--bg-tertiary); color: var(--text-primary); }
    .top-bar-profile-dropdown-item svg { width: 16px; height: 16px; }

    /* ===== Right Sidebar (X/Twitter-style) ===== */
    .right-sidebar {
      position: fixed;
      top: 72px;
      right: 20px;
      width: 300px;
      max-height: calc(100vh - 92px);
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 16px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.04);
      overflow: hidden;
      display: none;
      flex-direction: column;
      z-index: 50;
    }
    .right-sidebar.visible { display: flex; }
    .right-sidebar-header {
      padding: 0.875rem 1rem 0;
      flex-shrink: 0;
    }
    .right-sidebar-tabs {
      display: flex;
      gap: 0;
      border-bottom: 1px solid var(--border-color);
      padding: 0 1rem;
    }
    .right-sidebar-tab {
      flex: 1;
      padding: 0.625rem 0;
      font-size: 0.8125rem;
      font-weight: 500;
      color: var(--text-muted);
      background: none;
      border: none;
      border-bottom: 2px solid transparent;
      cursor: pointer;
      text-align: center;
      transition: color 0.15s, border-color 0.15s;
    }
    .right-sidebar-tab:hover { color: var(--text-primary); }
    .right-sidebar-tab.active {
      color: var(--text-primary);
      border-bottom-color: var(--accent-color);
    }
    .right-sidebar-content {
      flex: 1;
      overflow-y: auto;
      padding: 0.75rem 1rem;
    }
    .main-content.has-right-sidebar { margin-right: 340px; }

    /* ===== Home Page Hero ===== */
    .home-view {
      flex-direction: column;
      width: 100%;
      padding-top: 52px;
      overflow-y: auto;
    }
    .home-hero {
      min-height: calc(100vh - 52px);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 2rem;
    }
    .home-hero-title {
      font-size: clamp(2.75rem, 5vw, 4rem);
      font-weight: 800;
      letter-spacing: -0.03em;
      line-height: 1.1;
      color: var(--text-primary);
      margin-bottom: 2rem;
    }
    .home-cta-row {
      display: flex;
      gap: 0.75rem;
      align-items: center;
    }
    .home-cta-primary {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.75rem 1.75rem;
      background: var(--accent-color);
      color: #fff;
      border: none;
      border-radius: 9999px;
      font-size: 0.9375rem;
      font-weight: 600;
      cursor: pointer;
      transition: filter 0.15s;
    }
    .home-cta-primary:hover { filter: brightness(1.1); }
    .home-cta-secondary {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.75rem 1.75rem;
      background: transparent;
      color: var(--text-primary);
      border: 1px solid var(--border-color);
      border-radius: 9999px;
      font-size: 0.9375rem;
      font-weight: 500;
      cursor: pointer;
      text-decoration: none;
      transition: background 0.15s, border-color 0.15s;
    }
    .home-cta-secondary:hover { background: var(--bg-tertiary); border-color: var(--text-muted); }
    .home-features {
      max-width: 960px;
      margin: 0 auto;
      padding: 4rem 2rem;
      width: 100%;
    }
    .home-features-title {
      font-size: 1.5rem;
      font-weight: 700;
      text-align: center;
      margin-bottom: 2rem;
    }
    .home-feature-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 1rem;
    }
    .home-feature-card {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      padding: 1.25rem;
      transition: border-color 0.15s;
    }
    .home-feature-card:hover { border-color: var(--accent-color); }
    .home-feature-card h4 {
      font-size: 0.875rem;
      font-weight: 600;
      margin-bottom: 0.375rem;
    }
    .home-feature-card p {
      font-size: 0.8125rem;
      color: var(--text-secondary);
      line-height: 1.5;
    }
    .home-charts {
      max-width: 960px;
      margin: 0 auto;
      padding: 0 2rem 4rem;
      width: 100%;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 2rem;
    }
    .home-chart-section h3 {
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--text-muted);
      margin-bottom: 0.75rem;
    }

    /* ===== App Page ===== */
    .app-page {
      flex-direction: column;
      padding-top: 52px;
      min-height: 100vh;
      overflow-y: auto;
    }
    .app-page-inner {
      width: 100%;
      max-width: 700px;
      margin: 0 auto;
      padding: 1.5rem 1rem 4rem;
    }
    .app-endpoint-bar {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.875rem 1rem;
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 10px;
      margin-bottom: 1.5rem;
    }
    .app-endpoint-url {
      flex: 1;
      overflow: hidden;
    }
    .app-endpoint-url code {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.8125rem;
      color: var(--text-primary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      display: block;
    }
    .app-endpoint-actions {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-shrink: 0;
    }
    .app-version-select {
      background: var(--bg-tertiary);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      padding: 0.375rem 0.5rem;
      color: var(--text-primary);
      font-size: 0.75rem;
      cursor: pointer;
    }
    .app-endpoint-copy {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      background: var(--bg-tertiary);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      cursor: pointer;
      color: var(--text-secondary);
      transition: all 0.15s;
    }
    .app-endpoint-copy:hover { background: var(--accent-color); color: #fff; border-color: var(--accent-color); }
    .app-endpoint-copy svg { width: 16px; height: 16px; }

    /* Collapsible sections */
    .app-section {
      border: 1px solid var(--border-color);
      border-radius: 10px;
      margin-bottom: 0.75rem;
      overflow: hidden;
      background: var(--bg-primary);
    }
    .app-section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
      padding: 0.875rem 1rem;
      background: transparent;
      border: none;
      cursor: pointer;
      color: var(--text-primary);
      transition: background 0.15s;
    }
    .app-section-header:hover { background: var(--bg-secondary); }
    .app-section-title { font-size: 0.9375rem; font-weight: 600; }
    .app-section-chevron {
      width: 18px;
      height: 18px;
      color: var(--text-muted);
      transition: transform 0.2s;
    }
    .app-section.collapsed .app-section-chevron { transform: rotate(-90deg); }
    .app-section-body {
      padding: 0 1rem 1rem;
    }
    .app-section.collapsed .app-section-body { display: none; }
    .app-field { margin-bottom: 0.75rem; }
    .app-field label {
      display: block;
      font-size: 0.8125rem;
      font-weight: 500;
      color: var(--text-secondary);
      margin-bottom: 0.375rem;
    }
    .app-section-actions {
      display: flex;
      gap: 0.75rem;
      margin-top: 0.5rem;
    }

    /* Floating save */
    .floating-save {
      position: fixed;
      bottom: 1.5rem;
      left: 50%;
      transform: translateX(-50%);
      z-index: 80;
      animation: floatIn 0.2s ease;
    }
    @keyframes floatIn {
      from { opacity: 0; transform: translateX(-50%) translateY(10px); }
      to { opacity: 1; transform: translateX(-50%) translateY(0); }
    }
    .floating-save-btn {
      padding: 0.625rem 1.5rem;
      background: var(--accent-color);
      color: #fff;
      border: none;
      border-radius: 8px;
      font-size: 0.875rem;
      font-weight: 500;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(0,0,0,0.2);
      transition: all 0.15s;
    }
    .floating-save-btn:hover { filter: brightness(1.1); }
  </style>
</head>
<body>
  <!-- Top Bar (full-width, YouTube-style) -->
  <div class="top-bar" id="topBar">
    <div class="top-bar-left">
      <a href="/" class="logo" onclick="event.preventDefault(); navigateToHome();">Ultralight</a>
    </div>
    <div class="top-bar-center">
      <div class="top-bar-search" style="position: relative;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
        <input type="text" id="searchInput" placeholder="Search apps..." oninput="handleSearch(this.value)" autocomplete="off" />
        <div id="searchDropdown" style="display: none; position: absolute; top: 100%; left: 0; right: 0; margin-top: 4px; background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); z-index: 300; max-height: 300px; overflow-y: auto;"></div>
      </div>
    </div>
    <div class="top-bar-right">
      <button class="top-bar-connect-btn" id="topBarConnectBtn" onclick="copyConnectUrl()">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
        <span id="connectBtnText">Connect</span>
      </button>
      <div class="top-bar-profile" id="topBarProfile" onclick="toggleTopBarDropdown(event)">
        <!-- Populated by updateAuthUI -->
      </div>
      <div class="top-bar-profile-dropdown" id="topBarDropdown">
        <div class="top-bar-profile-dropdown-email">Not signed in</div>
        <button class="top-bar-profile-dropdown-item" onclick="event.stopPropagation(); signOut();">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
          Sign Out
        </button>
      </div>
    </div>
  </div>

  <!-- Sidebar -->
  <aside class="sidebar" id="sidebar">
    <!-- Collapse toggle (expanded state only) -->
    <div class="sidebar-toggle-area">
      <button class="sidebar-toggle-btn" id="sidebarToggle" title="Collapse sidebar">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
          <rect x="3" y="3" width="18" height="18" rx="3"></rect>
          <line x1="9" y1="3" x2="9" y2="21"></line>
        </svg>
      </button>
    </div>

    <!-- Expanded: main navigation -->
    <div class="new-app-section" style="display:flex;flex-direction:column;gap:0.25rem">
      <button class="upload-btn nav-btn${initialView === 'home' ? ' nav-active' : ''}" id="navHomeBtn" data-view="home">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
          <polyline points="9 22 9 12 15 12 15 22"></polyline>
        </svg>
        Home
      </button>
      <button class="upload-btn nav-btn${initialView === 'dashboard' ? ' nav-active' : ''}" id="newAppBtn" data-view="dashboard">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="3"></circle>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
        </svg>
        Dashboard
      </button>
      <button class="upload-btn nav-btn${initialView === 'leaderboard' ? ' nav-active' : ''}" id="navLeaderboardBtn" data-view="leaderboard">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5C7 4 7 7 7 7"></path>
          <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5C17 4 17 7 17 7"></path>
          <path d="M4 22h16"></path>
          <path d="M10 22V8a2 2 0 0 0-2-2H6"></path>
          <path d="M14 22V8a2 2 0 0 1 2-2h2"></path>
        </svg>
        Leaderboard
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
      <button class="sidebar-rail-btn" id="railNewApp" title="Dashboard">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="3"></circle>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
        </svg>
      </button>
      <div class="sidebar-rail-divider"></div>
    </div>

    <!-- Collapsed rail: app icons -->
    <div class="sidebar-rail-apps" id="railAppsList"></div>

    <!-- Expanded: full apps list -->
    <div class="apps-section">
      <div class="apps-section-title">Library</div>
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
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.5rem">
          <div>
            <h1 style="font-size: 1.75rem; font-weight: 700; margin-bottom: 0.25rem;">Developer Dashboard</h1>
            <p style="color: var(--text-secondary);">Your MCP hosting control center</p>
          </div>
          <button class="top-bar-btn" onclick="openLogsModal()" style="flex-shrink:0">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>
            Logs
          </button>
        </div>

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
          <details style="margin-top: 0.75rem;">
            <summary style="font-size: 0.75rem; color: var(--text-secondary); cursor: pointer; user-select: none;">Setup instructions for Claude Desktop &amp; Cursor</summary>
            <div style="margin-top: 0.5rem; font-size: 0.75rem; color: var(--text-muted); line-height: 1.6;">
              <p style="margin-bottom: 0.5rem;">Add this to your MCP client config (<code style="font-size: 0.6875rem; padding: 1px 4px; background: var(--bg-tertiary); border-radius: 4px;">claude_desktop_config.json</code> or <code style="font-size: 0.6875rem; padding: 1px 4px; background: var(--bg-tertiary); border-radius: 4px;">.cursor/mcp.json</code>):</p>
              <div style="position: relative;">
                <pre id="platformBridgeConfig" style="background: var(--bg-tertiary); border: 1px solid var(--border-color); border-radius: 8px; padding: 0.75rem; font-family: 'JetBrains Mono', monospace; font-size: 0.6875rem; overflow-x: auto; white-space: pre; margin: 0;"></pre>
                <button onclick="copyPlatformBridgeConfig()" style="position: absolute; top: 6px; right: 6px; padding: 4px; background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 4px; cursor: pointer; color: var(--text-secondary);" title="Copy config">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                </button>
              </div>
              <p style="margin-top: 0.5rem;">Replace <code style="font-size: 0.6875rem; padding: 1px 4px; background: var(--bg-tertiary); border-radius: 4px;">YOUR_TOKEN</code> with an API token from below. Requires <code style="font-size: 0.6875rem; padding: 1px 4px; background: var(--bg-tertiary); border-radius: 4px;">npx</code> (Node.js 18+).</p>
            </div>
          </details>
        </div>


        <!-- API Tokens -->
        <div class="dashboard-card" style="margin-bottom: 1rem;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.75rem;">
            <h3 style="font-size: 0.9375rem; font-weight: 600;">API Tokens</h3>
            <span id="tokenCount" style="font-size: 0.75rem; color: var(--text-muted);"></span>
          </div>
          <p style="font-size: 0.8125rem; color: var(--text-muted); margin-bottom: 0.75rem;">Personal access tokens for CLI and API access. Tokens are shown only once when created.</p>

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

          <!-- Tokens List -->
          <div id="tokensList" class="tokens-list">
            <div class="byok-loading">Loading tokens...</div>
          </div>
        </div>

        <!-- Supabase Servers -->
        <div class="dashboard-card" style="margin-bottom: 1rem;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.75rem;">
            <h3 style="font-size: 0.9375rem; font-weight: 600;">Supabase Servers</h3>
            <span id="supabaseServerCount" style="font-size: 0.75rem; color: var(--text-muted);"></span>
          </div>
          <p style="font-size: 0.8125rem; color: var(--text-muted); margin-bottom: 0.75rem;">Save your Supabase projects here, then assign them to apps from app settings.</p>

          <div id="supabaseMessage" class="byok-message" style="display: none;"></div>

          <!-- Add Server Form -->
          <div class="supabase-add-form" id="supabaseAddForm" style="display: none;">
            <div class="settings-field" style="margin-bottom: 0.5rem;">
              <input type="text" id="sbNewName" class="settings-input" placeholder="Server name (e.g., Production, Staging)" maxlength="100" style="font-size: 0.8125rem;" />
            </div>
            <div class="settings-field" style="margin-bottom: 0.5rem;">
              <input type="text" id="sbNewUrl" class="settings-input" placeholder="https://xxxxx.supabase.co" style="font-size: 0.8125rem;" />
            </div>
            <div class="settings-field" style="margin-bottom: 0.5rem;">
              <div style="display: flex; gap: 0.5rem;">
                <input type="password" id="sbNewAnonKey" class="settings-input" placeholder="Anon key (required)" style="flex: 1; font-size: 0.8125rem;" />
                <button class="env-var-toggle-visibility" onclick="toggleSupabaseKeyVisibility('sbNewAnonKey')" title="Toggle visibility">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                </button>
              </div>
            </div>
            <div class="settings-field" style="margin-bottom: 0.75rem;">
              <div style="display: flex; gap: 0.5rem;">
                <input type="password" id="sbNewServiceKey" class="settings-input" placeholder="Service role key (optional)" style="flex: 1; font-size: 0.8125rem;" />
                <button class="env-var-toggle-visibility" onclick="toggleSupabaseKeyVisibility('sbNewServiceKey')" title="Toggle visibility">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                </button>
              </div>
            </div>
            <div style="display: flex; gap: 0.5rem;">
              <button class="byok-btn byok-btn-primary" onclick="saveNewSupabaseServer()">Save Server</button>
              <button class="byok-btn byok-btn-secondary" onclick="cancelAddSupabaseServer()">Cancel</button>
            </div>
          </div>

          <!-- Add Server Button (shown when form is hidden) -->
          <button id="supabaseAddBtn" class="byok-btn byok-btn-secondary" onclick="showAddSupabaseForm()" style="margin-bottom: 0.75rem;">+ Add Server</button>

          <!-- Servers List -->
          <div id="supabaseServersList" class="tokens-list">
            <div class="byok-loading">Loading servers...</div>
          </div>
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

    <!-- Home View -->
    <!-- Home View (Hero + Features + Charts) -->
    <div class="home-view" id="homeView" style="display: ${initialView === 'home' ? 'flex' : 'none'};">
      <!-- Hero (above the fold) -->
      <div class="home-hero">
        <h1 class="home-hero-title">Make agents limitless</h1>
        <div class="home-cta-row">
          <a href="#home-features" class="home-cta-secondary" onclick="event.preventDefault(); document.getElementById('home-features').scrollIntoView({behavior:'smooth'});">Learn more</a>
          <button class="home-cta-primary" id="heroConnectBtn" onclick="copyConnectUrl()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
            <span id="heroConnectText">Connect</span>
          </button>
        </div>
      </div>

      <!-- Core Features (below the fold) -->
      <div class="home-features" id="home-features">
        <h2 class="home-features-title">Everything agents need</h2>
        <div class="home-feature-grid">
          <div class="home-feature-card">
            <h4>MCP Protocol</h4>
            <p>Standard Model Context Protocol endpoint. Works with Claude Desktop, Cursor, and any MCP client.</p>
          </div>
          <div class="home-feature-card">
            <h4>TypeScript Functions</h4>
            <p>Write plain TypeScript. Export functions, get tool endpoints. No boilerplate or framework lock-in.</p>
          </div>
          <div class="home-feature-card">
            <h4>Key-Value Storage</h4>
            <p>Built-in persistent storage via ultralight.store() and ultralight.load(). No database setup needed.</p>
          </div>
          <div class="home-feature-card">
            <h4>Supabase Integration</h4>
            <p>Connect your own Supabase project for relational data, auth, and realtime subscriptions.</p>
          </div>
          <div class="home-feature-card">
            <h4>Environment Secrets</h4>
            <p>Securely store API keys and credentials. Injected at runtime, never exposed in code.</p>
          </div>
          <div class="home-feature-card">
            <h4>Permissions &amp; Sharing</h4>
            <p>Granular per-function permissions. Share apps with specific users or make them public.</p>
          </div>
        </div>
      </div>

      <!-- Top Charts -->
      <div class="home-charts">
        <div class="home-chart-section">
          <h3>Top MCP Servers</h3>
          <div id="homeTopApps" style="display:flex;flex-direction:column;gap:0.375rem">
            <div style="color: var(--text-muted); font-size: 0.8125rem; padding: 1.5rem 0; text-align: center;">Loading...</div>
          </div>
        </div>
        <div class="home-chart-section">
          <h3>Recent Content</h3>
          <div id="homeTopContent" style="display:flex;flex-direction:column;gap:0.375rem">
            <div style="color: var(--text-muted); font-size: 0.8125rem; padding: 1rem 0; text-align: center;">Loading...</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Leaderboard View -->
    <div class="dashboard-view" id="leaderboardView" style="display: ${initialView === 'leaderboard' ? 'flex' : 'none'};">
      <div style="width: 100%; max-width: 600px; margin: 0 auto;">
        <h1 style="font-size: 1.75rem; font-weight: 700; margin-bottom: 0.25rem;">Leaderboard</h1>
        <p style="color: var(--text-secondary); margin-bottom: 0.5rem;">Earn points by building MCP servers that fill platform gaps.</p>
        <div id="leaderboardSeason" style="margin-bottom:1.25rem"></div>
        <div id="leaderboardList" style="display:flex;flex-direction:column">
          <div style="color: var(--text-muted); font-size: 0.8125rem; padding: 2rem 0; text-align: center;">Loading...</div>
        </div>
      </div>
    </div>

    <!-- App View / App Page -->
    <div class="app-page" id="appView" style="display: ${initialView === 'app' ? 'flex' : 'none'};">
      <div class="app-page-inner">
        <!-- MCP Endpoint + Version -->
        <div class="app-endpoint-bar">
          <div class="app-endpoint-url">
            <code id="appMcpUrl">Loading...</code>
          </div>
          <div class="app-endpoint-actions">
            <select id="appVersionSelect" class="app-version-select">
              <option>Loading...</option>
            </select>
            <button class="app-endpoint-copy" id="copyAppMcpBtn" title="Copy MCP URL" onclick="copyAppMcpUrl()">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            </button>
            <button class="app-endpoint-copy" id="openDashboardBtn" title="Open Dashboard" onclick="openAppDashboard()">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"></rect><rect x="14" y="3" width="7" height="7" rx="1"></rect><rect x="3" y="14" width="7" height="7" rx="1"></rect><rect x="14" y="14" width="7" height="7" rx="1"></rect></svg>
            </button>
          </div>
        </div>

        <!-- Client Setup Instructions -->
        <details style="margin: 0.5rem 0 0.75rem 0;">
          <summary style="font-size: 0.75rem; color: var(--text-secondary); cursor: pointer; user-select: none; padding: 0.25rem 0;">Setup for Claude Desktop &amp; Cursor</summary>
          <div style="margin-top: 0.5rem; font-size: 0.75rem; color: var(--text-muted); line-height: 1.6;">
            <p style="margin-bottom: 0.5rem;">Add to your MCP client config:</p>
            <div style="position: relative;">
              <pre id="appBridgeConfig" style="background: var(--bg-tertiary); border: 1px solid var(--border-color); border-radius: 8px; padding: 0.75rem; font-family: 'JetBrains Mono', monospace; font-size: 0.6875rem; overflow-x: auto; white-space: pre; margin: 0;"></pre>
              <button onclick="copyAppBridgeConfig()" style="position: absolute; top: 6px; right: 6px; padding: 4px; background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 4px; cursor: pointer; color: var(--text-secondary);" title="Copy config">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
              </button>
            </div>
            <p style="margin-top: 0.5rem;">Replace <code style="font-size: 0.6875rem; padding: 1px 4px; background: var(--bg-tertiary); border-radius: 4px;">YOUR_TOKEN</code> with your API token. Requires <code style="font-size: 0.6875rem; padding: 1px 4px; background: var(--bg-tertiary); border-radius: 4px;">npx</code> (Node.js 18+).</p>
          </div>
        </details>

        <!-- Collapsible: General -->
        <div class="app-section" id="sectionGeneral">
          <button class="app-section-header" onclick="toggleAppSection('General')">
            <span class="app-section-title">General</span>
            <svg class="app-section-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </button>
          <div class="app-section-body">
            <div class="app-field">
              <label>App Name</label>
              <input type="text" id="appPageName" class="settings-input" placeholder="My App" />
            </div>
            <div class="app-field">
              <label>Visibility</label>
              <select id="appPageVisibility" class="settings-select">
                <option value="private">Private — Only you and granted users</option>
                <option value="unlisted">Unlisted — Anyone with link</option>
                <option value="published">Published — Listed publicly</option>
              </select>
              <div id="appVisibilityHint" class="upgrade-cta" style="display: none;"></div>
            </div>
            <div class="app-field">
              <label>Code Download Access</label>
              <select id="appPageDownload" class="settings-select">
                <option value="owner">Owner Only</option>
                <option value="public">Public — Anyone can download</option>
              </select>
            </div>
            <div class="app-section-actions">
              <button class="settings-action-btn" onclick="downloadAppCode()">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                Download Code
              </button>
              <button class="settings-action-btn danger" onclick="deleteApp()">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                Delete App
              </button>
            </div>
          </div>
        </div>

        <!-- Collapsible: Permissions -->
        <div class="app-section" id="sectionPermissions">
          <button class="app-section-header" onclick="toggleAppSection('Permissions')">
            <span class="app-section-title">Permissions</span>
            <svg class="app-section-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </button>
          <div class="app-section-body">
            <div id="permsProContext" style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 0.5rem;">Control who can access this app.</div>
            <div style="display: flex; align-items: center; justify-content: space-between;">
              <span id="appPermsSummary" style="font-size: 0.8125rem; color: var(--text-secondary);">No users granted access</span>
              <button class="byok-btn byok-btn-secondary" onclick="openPermissionsModal()">Manage</button>
            </div>
          </div>
        </div>

        <!-- Collapsible: Database -->
        <div class="app-section" id="sectionDatabase">
          <button class="app-section-header" onclick="toggleAppSection('Database')">
            <span class="app-section-title">Database</span>
            <svg class="app-section-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </button>
          <div class="app-section-body">
            <div class="app-field">
              <label>Supabase Server</label>
              <select id="appPageSupabase" class="settings-select">
                <option value="">None — Supabase disabled</option>
              </select>
            </div>
          </div>
        </div>

        <!-- Collapsible: Skills -->
        <div class="app-section" id="sectionSkills">
          <button class="app-section-header" onclick="toggleAppSection('Skills')">
            <span class="app-section-title">Skills</span>
            <svg class="app-section-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </button>
          <div class="app-section-body">
            <div style="display: flex; align-items: center; justify-content: space-between;">
              <span id="appSkillsSummary" style="font-size: 0.8125rem; color: var(--text-secondary);">No skills documented</span>
              <button class="byok-btn byok-btn-secondary" onclick="openSkillsModal()">Edit Skills</button>
            </div>
          </div>
        </div>

        <!-- Collapsible: Environment -->
        <div class="app-section" id="sectionEnvironment">
          <button class="app-section-header" onclick="toggleAppSection('Environment')">
            <span class="app-section-title">Environment</span>
            <svg class="app-section-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </button>
          <div class="app-section-body">
            <div style="display: flex; align-items: center; justify-content: space-between;">
              <span id="appEnvSummary" style="font-size: 0.8125rem; color: var(--text-secondary);">No variables configured</span>
              <button class="byok-btn byok-btn-secondary" onclick="openEnvModal()">Edit</button>
            </div>
          </div>
        </div>

        <!-- Floating Save Button -->
        <div class="floating-save" id="floatingSave" style="display: none;">
          <button class="floating-save-btn" onclick="saveAppPageChanges()">Save Changes</button>
        </div>
      </div>
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

  <!-- Right Sidebar (X/Twitter-style, leaderboard only) -->
  <aside class="right-sidebar" id="rightSidebar">
    <div class="right-sidebar-header" id="rightSidebarHeader"></div>
    <div class="right-sidebar-tabs" id="rightSidebarTabs"></div>
    <div class="right-sidebar-content" id="rightSidebarContent">
      <div style="color:var(--text-muted);font-size:0.8125rem;padding:1rem 0;text-align:center">Loading...</div>
    </div>
  </aside>

  <!-- Hidden BYOK container (deprecated from UI but keeping data layer) -->
  <div style="display: none;">
    <div id="byokMessage" class="byok-message"></div>
    <div id="byokProviders" class="byok-providers"></div>
  </div>

  <!-- Skills Modal -->
  <div class="modal-overlay" id="skillsModal">
    <div class="modal wide">
      <div class="modal-header">
        <h2 class="modal-title">Edit Skills</h2>
        <button class="modal-close" onclick="closeSkillsModal()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>
      <div class="modal-body">
        <div class="settings-section">
          <div class="info-box">Skills.md describes what your app can do. Generate from code or edit manually.</div>
          <div id="skillsModalStatus" class="skills-status info" style="margin-bottom: 0.75rem;">No documentation generated yet</div>
          <button id="generateDocsBtn" class="generate-docs-btn" style="margin-bottom: 0.75rem;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"></path><path d="M2 17l10 5 10-5"></path><path d="M2 12l10 5 10-5"></path></svg>
            Generate Documentation
          </button>
          <textarea id="skillsEditor" class="skills-editor" placeholder="# App Name\n\n## Functions\n\n### functionName\nDescription of the function..."></textarea>
          <div id="skillsValidation" class="skills-status" style="display: none;"></div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="modal-btn secondary" onclick="closeSkillsModal()">Cancel</button>
        <button class="modal-btn primary" id="saveSkillsBtn" onclick="saveSkillsFromModal()">Save Skills</button>
      </div>
    </div>
  </div>

  <!-- Environment Modal -->
  <div class="modal-overlay" id="envModal">
    <div class="modal wide">
      <div class="modal-header">
        <h2 class="modal-title">Environment Variables</h2>
        <button class="modal-close" onclick="closeEnvModal()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>
      <div class="modal-body">
        <div class="settings-section">
          <div class="info-box">Store secrets and configuration. Encrypted and only accessible at runtime via <code>ultralight.env</code>.</div>
          <div id="envModalVarsContainer" class="env-vars-container">
            <div id="envModalVarsEmpty" class="env-vars-empty">No environment variables set.</div>
          </div>
          <button id="envModalAddBtn" class="env-var-add-btn" style="margin-top: 0.75rem;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            Add Variable
          </button>
          <div class="env-vars-limits" style="margin-top: 0.5rem;">Max 50 variables · Keys: uppercase, underscores (max 64 chars) · Values: max 4KB</div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="modal-btn secondary" onclick="closeEnvModal()">Cancel</button>
        <button class="modal-btn primary" id="saveEnvBtn" onclick="saveEnvFromModal()">Save Variables</button>
      </div>
    </div>
  </div>

  <!-- Permissions Modal -->
  <div class="modal-overlay" id="permissionsModal">
    <div class="modal wide">
      <div class="modal-header">
        <h2 class="modal-title">App Permissions</h2>
        <button class="modal-close" onclick="closePermissionsModal()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>
      <div class="modal-body">
        <div class="settings-section">
          <div class="info-box" id="permsInfoBox">Grant access to specific users for this app. The app owner always has full access.</div>

          <!-- Add user by email -->
          <div style="display: flex; gap: 0.5rem; margin-bottom: 1rem;">
            <input type="email" id="permsEmailInput" class="settings-input" placeholder="Enter email address..." style="flex: 1;" />
            <button class="byok-btn byok-btn-primary" onclick="addPermissionUser()" style="white-space: nowrap; padding: 0.5rem 1rem;">Add User</button>
          </div>
          <div id="permsAddError" style="color: var(--error-color); font-size: 0.75rem; margin-top: -0.5rem; margin-bottom: 0.75rem; display: none;"></div>

          <!-- Granted users list -->
          <div id="permsUsersList" class="tokens-list" style="margin-bottom: 0.75rem;"></div>
          <div id="permsEmpty" style="text-align: center; padding: 2rem; color: var(--text-muted); font-size: 0.8125rem;">No users have been granted access yet.</div>

          <!-- Per-user function permissions (shown when a user is selected) -->
          <div id="permsUserDetail" style="display: none; border-top: 1px solid var(--border-color); padding-top: 1rem; margin-top: 0.75rem;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
              <span id="permsDetailTitle" style="font-size: 0.875rem; font-weight: 500; color: var(--text-primary);">User Functions</span>
              <div id="permsGranularBtns" style="display: flex; gap: 0.5rem;">
                <button class="byok-btn byok-btn-secondary" onclick="allowAllPermissions()" style="font-size: 0.75rem; padding: 2px 10px;">Allow All</button>
                <button class="byok-btn byok-btn-secondary" onclick="denyAllPermissions()" style="font-size: 0.75rem; padding: 2px 10px;">Deny All</button>
              </div>
            </div>
            <div id="permsMatrix" class="tokens-list"></div>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="modal-btn secondary" onclick="closePermissionsModal()">Close</button>
        <button class="modal-btn primary" id="savePermsBtn" onclick="savePermissions()">Save Permissions</button>
      </div>
    </div>
  </div>

  <!-- Logs Modal -->
  <div class="modal-overlay" id="logsModal">
    <div class="modal wide">
      <div class="modal-header">
        <h2 class="modal-title" id="logsModalTitle">MCP Call Logs</h2>
        <button class="modal-close" onclick="closeLogsModal()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>
      <div class="modal-body">
        <div id="logsContent" style="max-height: 60vh; overflow-y: auto;">
          <div id="logsEmpty" style="text-align: center; padding: 2rem; color: var(--text-muted); font-size: 0.8125rem;">Loading logs...</div>
          <div id="logsList" class="tokens-list" style="display: none;"></div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="modal-btn secondary" onclick="closeLogsModal()">Close</button>
        <button class="modal-btn secondary" onclick="refreshLogs()">Refresh</button>
      </div>
    </div>
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

    // ============================================
    // DOM Elements
    // ============================================
    const authSection = document.getElementById('authSection');
    const appsList = document.getElementById('appsList');
    const newAppBtn = document.getElementById('newAppBtn');
    const dashboardView = document.getElementById('dashboardView');
    const homeView = document.getElementById('homeView');
    const leaderboardView = document.getElementById('leaderboardView');
    const appView = document.getElementById('appView');
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
    // Footer visibility (hide when viewing app)
    // ============================================
    function updateFooterVisibility(view) {
      const footer = document.getElementById('siteFooter');
      if (footer) footer.style.display = (view === 'dashboard' || view === 'home') ? 'flex' : 'none';
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

          // Extract first name from Supabase Google Auth user_metadata
          const userMeta = payload.user_metadata || {};
          const fullName = userMeta.full_name || userMeta.name || '';
          const firstName = fullName.split(' ')[0] || email.split('@')[0];
          const initial = (firstName || email).charAt(0).toUpperCase();

          // Sidebar: hide auth when logged in (profile moves to top bar)
          authSection.innerHTML = '';

          // Top bar profile
          const topBarProfile = document.getElementById('topBarProfile');
          if (topBarProfile) {
            topBarProfile.innerHTML = \`
              <div class="user-avatar" style="width: 28px; height: 28px; font-size: 0.75rem;">\${initial}</div>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
            \`;
            const topBarDropdown = document.getElementById('topBarDropdown');
            if (topBarDropdown) {
              topBarDropdown.querySelector('.top-bar-profile-dropdown-email').textContent = email;
            }
          }
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
    // Top Bar Profile Dropdown
    // ============================================
    window.toggleTopBarDropdown = function(e) {
      e.stopPropagation();
      const dropdown = document.getElementById('topBarDropdown');
      if (!dropdown) return;
      const isOpen = dropdown.classList.contains('open');
      if (isOpen) {
        closeTopBarDropdown();
      } else {
        dropdown.classList.add('open');
      }
    };

    function closeTopBarDropdown() {
      const dropdown = document.getElementById('topBarDropdown');
      if (dropdown) dropdown.classList.remove('open');
    }

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      const dropdown = document.getElementById('topBarDropdown');
      if (dropdown && dropdown.classList.contains('open')) {
        if (!e.target.closest('.top-bar-profile') && !e.target.closest('.top-bar-profile-dropdown')) {
          closeTopBarDropdown();
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

      const appData = apps.find(a => a.id === appId);
      if (!appData) {
        if (list) list.innerHTML = '';
        return;
      }

      const versions = appData.versions || [];
      const metadata = appData.version_metadata || [];
      const currentVersion = appData.current_version;

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
      const appStorage = appData.storage_bytes || 0;
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
          // Update in apps list
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

    // Tokens are now managed inline on the dashboard — no modal needed.
    // Legacy aliases in case profile dropdown or other code references these:
    window.openApiKeysModal = async function() {
      closeTopBarDropdown();
      showView('dashboard');
      await loadTokens();
    };
    window.closeApiKeysModal = function() {};
    window.openUserSettings = function() { openApiKeysModal(); };
    window.closeUserSettings = function() {};

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
      const countEl = document.getElementById('tokenCount');

      // Update token count header — all tiers have unlimited tokens
      if (countEl) {
        countEl.textContent = currentTokens.length + ' token' + (currentTokens.length !== 1 ? 's' : '');
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
          console.error('loadApps failed with status:', res.status, 'token prefix:', authToken?.substring(0, 8) || 'none');
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
          <div class="app-item \${isActive ? 'active' : ''}" data-app-id="\${app.id}" onclick="navigateToApp(event, '\${app.id}')">
            <div class="app-icon">\${icon}</div>
            <div class="app-info">
              <div class="app-name">\${escapeHtml(app.name)}</div>
              <div class="app-meta">\${date}</div>
            </div>
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
    // App Page
    // ============================================
    let draftFiles = [];

    // Load Skills.md
    async function loadSkillsMd(appId) {
      const editor = document.getElementById('skillsEditor');
      const status = document.getElementById('skillsModalStatus');

      try {
        const res = await fetch(\`/api/apps/\${appId}/skills.md\`, {
          headers: { 'Authorization': \`Bearer \${authToken}\` }
        });

        if (res.ok) {
          const text = await res.text();
          editor.value = text;
          if (status) {
            status.className = 'skills-status success';
            status.innerHTML = '✓ Documentation loaded';
          }
        } else if (res.status === 404) {
          editor.value = '';
          if (status) {
            status.className = 'skills-status info';
            status.innerHTML = 'No documentation generated yet. Click "Generate Documentation" to create.';
          }
        } else {
          throw new Error('Failed to load');
        }
      } catch (err) {
        if (status) {
          status.className = 'skills-status error';
          status.innerHTML = '✗ Failed to load documentation';
        }
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
      const container = document.getElementById('envModalVarsContainer');
      const emptyState = document.getElementById('envModalVarsEmpty');

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
      const container = document.getElementById('envModalVarsContainer');
      const emptyState = document.getElementById('envModalVarsEmpty');
      const keys = Object.keys(currentEnvVars);

      if (keys.length === 0 && Object.keys(pendingEnvVarChanges).length === 0) {
        container.innerHTML = '<div class="env-vars-empty" id="envModalVarsEmpty">No environment variables set.</div>';
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
    document.getElementById('envModalAddBtn')?.addEventListener('click', () => {
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

    // Save env vars (called from env modal)
    async function saveEnvVars() {
      if (!currentAppId || Object.keys(pendingEnvVarChanges).length === 0) {
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
          const res = await fetch(\`/api/apps/\${currentAppId}/env/\${key}\`, {
            method: 'DELETE',
            headers: { 'Authorization': \`Bearer \${authToken}\` }
          });
          if (!res.ok) throw new Error(\`Failed to delete \${key}\`);
        }

        // Update/add vars if there are any
        if (Object.keys(updates).length > 0) {
          const res = await fetch(\`/api/apps/\${currentAppId}/env\`, {
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
    // Supabase Servers (Dashboard CRUD)
    // ============================================
    let savedSupabaseServers = [];

    async function loadSupabaseServers() {
      if (!authToken) return;

      const listEl = document.getElementById('supabaseServersList');
      if (listEl) listEl.innerHTML = '<div class="byok-loading">Loading servers...</div>';

      try {
        const res = await fetch('/api/user/supabase', {
          headers: { 'Authorization': \`Bearer \${authToken}\` }
        });
        if (!res.ok) throw new Error('Failed to load servers');
        const data = await res.json();
        savedSupabaseServers = data.configs || [];
        renderSupabaseServers();
      } catch (err) {
        console.error('Failed to load Supabase servers:', err);
        if (listEl) listEl.innerHTML = '<div class="byok-loading" style="color: var(--error-color);">Failed to load servers</div>';
      }
    }

    function renderSupabaseServers() {
      const listEl = document.getElementById('supabaseServersList');
      const countEl = document.getElementById('supabaseServerCount');

      if (countEl) {
        countEl.textContent = savedSupabaseServers.length + ' server' + (savedSupabaseServers.length !== 1 ? 's' : '');
      }

      if (!listEl) return;

      if (savedSupabaseServers.length === 0) {
        listEl.innerHTML = '<div class="tokens-empty">No Supabase servers saved yet. Add one to get started.</div>';
        return;
      }

      const html = savedSupabaseServers.map(server => {
        const createdAt = new Date(server.created_at).toLocaleDateString();
        // Extract project ref from URL for display
        const urlShort = server.supabase_url.replace('https://', '').replace('.supabase.co', '');
        return \`
          <div class="token-item">
            <div class="token-info">
              <div class="token-name">\${escapeHtml(server.name)}</div>
              <div class="token-meta">
                <span class="token-prefix">\${urlShort}</span>
                <span>Added: \${createdAt}</span>
                \${server.has_service_key ? '<span style="color: var(--accent-color);">+ service key</span>' : ''}
              </div>
            </div>
            <button class="byok-btn byok-btn-danger" onclick="deleteSupabaseServer('\${server.id}')">Remove</button>
          </div>
        \`;
      }).join('');

      listEl.innerHTML = html;
    }

    window.showAddSupabaseForm = function() {
      document.getElementById('supabaseAddForm').style.display = 'block';
      document.getElementById('supabaseAddBtn').style.display = 'none';
      document.getElementById('sbNewName').focus();
    };

    window.cancelAddSupabaseServer = function() {
      document.getElementById('supabaseAddForm').style.display = 'none';
      document.getElementById('supabaseAddBtn').style.display = '';
      // Clear form
      ['sbNewName', 'sbNewUrl', 'sbNewAnonKey', 'sbNewServiceKey'].forEach(id => {
        document.getElementById(id).value = '';
      });
    };

    window.saveNewSupabaseServer = async function() {
      const name = document.getElementById('sbNewName').value.trim();
      const url = document.getElementById('sbNewUrl').value.trim();
      const anonKey = document.getElementById('sbNewAnonKey').value.trim();
      const serviceKey = document.getElementById('sbNewServiceKey').value.trim();

      if (!name) { showSupabaseMessage('Server name is required', 'error'); return; }
      if (!url) { showSupabaseMessage('Supabase URL is required', 'error'); return; }
      if (!anonKey) { showSupabaseMessage('Anon key is required', 'error'); return; }

      try {
        const res = await fetch('/api/user/supabase', {
          method: 'POST',
          headers: {
            'Authorization': \`Bearer \${authToken}\`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ name, url, anon_key: anonKey, service_key: serviceKey || undefined })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to save server');

        showSupabaseMessage('Server saved!', 'success');
        cancelAddSupabaseServer();
        await loadSupabaseServers();
      } catch (err) {
        showSupabaseMessage(err.message, 'error');
      }
    };

    window.deleteSupabaseServer = async function(configId) {
      if (!confirm('Remove this Supabase server? Apps using it will lose their database connection.')) return;

      try {
        const res = await fetch(\`/api/user/supabase/\${configId}\`, {
          method: 'DELETE',
          headers: { 'Authorization': \`Bearer \${authToken}\` }
        });
        if (!res.ok) throw new Error('Failed to remove server');

        showSupabaseMessage('Server removed', 'success');
        await loadSupabaseServers();
      } catch (err) {
        showSupabaseMessage(err.message, 'error');
      }
    };

    function showSupabaseMessage(message, type) {
      const el = document.getElementById('supabaseMessage');
      if (!el) return;
      el.textContent = message;
      el.className = \`byok-message \${type}\`;
      el.style.display = 'block';
      setTimeout(() => { el.style.display = 'none'; }, 5000);
    }

    window.toggleSupabaseKeyVisibility = function(inputId) {
      const input = document.getElementById(inputId);
      if (input.type === 'password') {
        input.type = 'text';
      } else {
        input.type = 'password';
      }
    };

    // ============================================
    // App Settings: Supabase Server Dropdown
    // ============================================
    let appSupabaseChanged = false;

    async function loadAppSupabaseDropdown(appId) {
      const select = document.getElementById('appSupabaseSelect');
      if (!select) return;

      // Reset
      select.innerHTML = '<option value="">None — Supabase disabled</option>';
      appSupabaseChanged = false;

      // Populate saved servers
      if (savedSupabaseServers.length === 0) {
        // Try loading if not yet fetched
        try {
          const res = await fetch('/api/user/supabase', {
            headers: { 'Authorization': \`Bearer \${authToken}\` }
          });
          if (res.ok) {
            const data = await res.json();
            savedSupabaseServers = data.configs || [];
          }
        } catch (e) { /* ignore */ }
      }

      savedSupabaseServers.forEach(server => {
        const opt = document.createElement('option');
        opt.value = server.id;
        const urlShort = server.supabase_url.replace('https://', '').replace('.supabase.co', '');
        opt.textContent = server.name + ' (' + urlShort + ')';
        select.appendChild(opt);
      });

      // Get current app's supabase_config_id
      try {
        const res = await fetch(\`/api/apps/\${appId}/supabase\`, {
          headers: { 'Authorization': \`Bearer \${authToken}\` }
        });
        if (res.ok) {
          const data = await res.json();
          if (data.config_id) {
            select.value = data.config_id;
          }
          updateAppSupabaseInfo();
        }
      } catch (e) { /* ignore */ }

      // Listen for changes
      select.onchange = function() {
        appSupabaseChanged = true;
        updateAppSupabaseInfo();
      };
    }

    function updateAppSupabaseInfo() {
      const select = document.getElementById('appSupabaseSelect');
      const infoEl = document.getElementById('appSupabaseInfo');
      if (!select || !infoEl) return;

      const selectedId = select.value;
      if (!selectedId) {
        infoEl.style.display = 'none';
        return;
      }

      const server = savedSupabaseServers.find(s => s.id === selectedId);
      if (server) {
        infoEl.style.display = 'block';
        infoEl.innerHTML = \`<strong>\${escapeHtml(server.name)}</strong> — \${escapeHtml(server.supabase_url)}\${server.has_service_key ? ' (+ service key)' : ''}\`;
      } else {
        infoEl.style.display = 'none';
      }
    }

    async function saveAppSupabaseConfig() {
      if (!currentAppId || !appSupabaseChanged) return true;

      const select = document.getElementById('appSupabaseSelect');
      const configId = select ? select.value : '';

      try {
        const res = await fetch(\`/api/apps/\${currentAppId}/supabase\`, {
          method: 'PUT',
          headers: {
            'Authorization': \`Bearer \${authToken}\`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ config_id: configId || null })
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Failed to save Supabase config');
        }

        appSupabaseChanged = false;
        return true;
      } catch (err) {
        console.error('Failed to save app Supabase config:', err);
        showToast(err.message || 'Failed to save Supabase configuration', 'error');
        return false;
      }
    }

    // Generate Documentation
    document.getElementById('generateDocsBtn')?.addEventListener('click', async () => {
      if (!currentAppId || !authToken) return;

      const btn = document.getElementById('generateDocsBtn');
      const status = document.getElementById('skillsModalStatus');

      btn.disabled = true;
      btn.innerHTML = '<span>Generating...</span>';
      status.className = 'skills-status info';
      status.innerHTML = 'Generating documentation from code...';

      try {
        const res = await fetch(\`/api/apps/\${currentAppId}/generate-docs\`, {
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
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"></path><path d="M2 17l10 5 10-5"></path><path d="M2 12l10 5 10-5"></path></svg>
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
      if (!currentAppId || !authToken) return;

      const btn = document.getElementById('publishDraftBtn');
      btn.disabled = true;
      btn.textContent = 'Publishing...';

      try {
        const res = await fetch(\`/api/apps/\${currentAppId}/publish\`, {
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
        await loadDraftInfo(currentAppId);
        loadVersionHistory(currentAppId);
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
      if (!currentAppId || !authToken) return;

      if (!confirm('Are you sure you want to discard this draft? This cannot be undone.')) {
        return;
      }

      const btn = document.getElementById('discardDraftBtn');
      btn.disabled = true;
      btn.textContent = 'Discarding...';

      try {
        const res = await fetch(\`/api/apps/\${currentAppId}/draft\`, {
          method: 'DELETE',
          headers: { 'Authorization': \`Bearer \${authToken}\` }
        });

        if (!res.ok) throw new Error('Failed to discard');

        showToast('Draft discarded');
        await loadDraftInfo(currentAppId);
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
      if (!currentAppId || !authToken || draftFiles.length === 0) return;



      const btn = document.getElementById('uploadDraftBtn');
      btn.disabled = true;
      btn.textContent = 'Uploading...';

      const formData = new FormData();
      draftFiles.forEach(f => formData.append('files', f));

      try {
        const res = await fetch(\`/api/apps/\${currentAppId}/draft\`, {
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
        await loadDraftInfo(currentAppId);
        loadVersionHistory(currentAppId);

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

    // ============================================
    // App Page Functions
    // ============================================

    // Load App Page data
    async function loadAppPage(appId) {
      const app = apps.find(a => a.id === appId);
      if (!app) return;

      document.title = \`\${app.name || app.slug} - Ultralight\`;

      // MCP Endpoint URL
      const mcpUrl = \`\${window.location.origin}/mcp/\${appId}\`;
      document.getElementById('appMcpUrl').textContent = mcpUrl;

      // Populate bridge config for Claude Desktop / Cursor
      const bridgeEl = document.getElementById('appBridgeConfig');
      if (bridgeEl) {
        const slug = app.slug || 'my-app';
        const bridgeConfig = JSON.stringify({
          mcpServers: {
            [slug]: {
              command: "npx",
              args: [
                "mcp-remote",
                mcpUrl,
                "--header",
                "Authorization: Bearer YOUR_TOKEN"
              ]
            }
          }
        }, null, 2);
        bridgeEl.textContent = bridgeConfig;
      }

      // Version dropdown
      const versionSelect = document.getElementById('appVersionSelect');
      versionSelect.innerHTML = '<option>Loading...</option>';
      try {
        const res = await fetch(\`/api/apps/\${appId}\`, {
          headers: { 'Authorization': \`Bearer \${authToken}\` }
        });
        if (res.ok) {
          const appData = await res.json();
          const versions = appData.versions || [];
          const activeVersion = appData.current_version || '1.0.0';
          if (versions.length > 0) {
            versionSelect.innerHTML = versions.map(v =>
              \`<option value="\${v}" \${v === activeVersion ? 'selected' : ''}>\${v}\${v === activeVersion ? ' ● live' : ''}</option>\`
            ).join('');
          } else {
            versionSelect.innerHTML = \`<option value="\${activeVersion}" selected>\${activeVersion} ● live</option>\`;
          }
        }
      } catch (e) { console.error('Failed to load versions:', e); }

      // General fields
      document.getElementById('appPageName').value = app.name || '';
      const visSelect = document.getElementById('appPageVisibility');
      visSelect.value = app.visibility || 'private';
      // All visibility options available to all users
      const visHint = document.getElementById('appVisibilityHint');
      if (visHint) visHint.style.display = 'none';
      document.getElementById('appPageDownload').value = app.download_access || 'owner';

      // Supabase dropdown
      const sbSelect = document.getElementById('appPageSupabase');
      sbSelect.innerHTML = '<option value="">None — Supabase disabled</option>';
      savedSupabaseServers.forEach(server => {
        const opt = document.createElement('option');
        opt.value = server.id;
        const urlShort = server.supabase_url.replace('https://', '').replace('.supabase.co', '');
        opt.textContent = server.name + ' (' + urlShort + ')';
        sbSelect.appendChild(opt);
      });
      // Load current app Supabase config
      try {
        const sbRes = await fetch(\`/api/apps/\${appId}/supabase\`, {
          headers: { 'Authorization': \`Bearer \${authToken}\` }
        });
        if (sbRes.ok) {
          const sbData = await sbRes.json();
          if (sbData.config_id) sbSelect.value = sbData.config_id;
        }
      } catch (e) { /* ignore */ }

      // Skills summary
      try {
        const skillsRes = await fetch(\`/api/apps/\${appId}/skills.md\`, {
          headers: { 'Authorization': \`Bearer \${authToken}\` }
        });
        if (skillsRes.ok) {
          const skillsData = await skillsRes.json();
          const parsed = skillsData.skills_parsed || [];
          const summaryEl = document.getElementById('appSkillsSummary');
          if (summaryEl) {
            summaryEl.textContent = parsed.length > 0
              ? parsed.length + ' function' + (parsed.length !== 1 ? 's' : '') + ' documented'
              : 'No skills documented';
          }
        }
      } catch (e) { /* ignore */ }

      // Env summary
      try {
        const envRes = await fetch(\`/api/apps/\${appId}/env\`, {
          headers: { 'Authorization': \`Bearer \${authToken}\` }
        });
        if (envRes.ok) {
          const envData = await envRes.json();
          const envArr = envData.env_vars || [];
          const keyCount = Array.isArray(envArr) ? envArr.length : Object.keys(envArr).length;
          const envSummaryEl = document.getElementById('appEnvSummary');
          if (envSummaryEl) {
            envSummaryEl.textContent = keyCount > 0
              ? keyCount + ' variable' + (keyCount !== 1 ? 's' : '') + ' configured'
              : 'No variables configured';
          }
        }
      } catch (e) { /* ignore */ }

      // Permissions summary: load granted user count
      const permsSummaryEl = document.getElementById('appPermsSummary');
      if (permsSummaryEl) {
        try {
          const permsRes = await fetch(\`/api/user/permissions/\${appId}\`, {
            headers: { 'Authorization': \`Bearer \${authToken}\` }
          });
          const permsData = permsRes.ok ? await permsRes.json() : { users: [] };
          const userCount = (permsData.users || []).length;
          permsSummaryEl.textContent = userCount > 0
            ? userCount + ' user' + (userCount !== 1 ? 's' : '') + ' granted access'
            : 'No users granted access';
        } catch (e) {
          permsSummaryEl.textContent = 'Not configured';
        }
      }

      // Permissions context
      const proCtx = document.getElementById('permsProContext');
      if (proCtx) {
        proCtx.textContent = 'Granular per-function control for each user.';
      }

      // Hide floating save
      document.getElementById('floatingSave').style.display = 'none';

      // Track changes for floating save
      ['appPageName', 'appPageVisibility', 'appPageDownload', 'appPageSupabase', 'appVersionSelect'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
          el.onchange = () => { document.getElementById('floatingSave').style.display = 'block'; };
          el.oninput = () => { document.getElementById('floatingSave').style.display = 'block'; };
        }
      });
    }

    // Save App Page Changes
    window.saveAppPageChanges = async function() {
      if (!currentAppId || !authToken) return;
      const btn = document.querySelector('.floating-save-btn');
      btn.disabled = true;
      btn.textContent = 'Saving...';
      try {
        // Save general settings
        const res = await fetch(\`/api/apps/\${currentAppId}\`, {
          method: 'PATCH',
          headers: { 'Authorization': \`Bearer \${authToken}\`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: document.getElementById('appPageName').value.trim(),
            visibility: document.getElementById('appPageVisibility').value,
            download_access: document.getElementById('appPageDownload').value,
          })
        });
        if (!res.ok) throw new Error('Failed to save');

        // Save Supabase config
        const sbSelect = document.getElementById('appPageSupabase');
        await fetch(\`/api/apps/\${currentAppId}/supabase\`, {
          method: 'PUT',
          headers: { 'Authorization': \`Bearer \${authToken}\`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ config_id: sbSelect.value || null })
        });

        // Save active version
        const versionSelect = document.getElementById('appVersionSelect');
        if (versionSelect.value) {
          await fetch(\`/api/apps/\${currentAppId}\`, {
            method: 'PATCH',
            headers: { 'Authorization': \`Bearer \${authToken}\`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ current_version: versionSelect.value })
          });
        }

        showToast('Changes saved');
        document.getElementById('floatingSave').style.display = 'none';
        await loadApps();
      } catch (err) {
        showToast('Failed to save changes', 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Save Changes';
      }
    };

    // Toggle collapsible app section
    window.toggleAppSection = function(name) {
      const section = document.getElementById('section' + name);
      if (section) section.classList.toggle('collapsed');
    };

    // Skills Modal
    window.openSkillsModal = async function() {
      document.getElementById('skillsModal').classList.add('open');
      if (!currentAppId) return;
      try {
        const res = await fetch(\`/api/apps/\${currentAppId}/skills.md\`, {
          headers: { 'Authorization': \`Bearer \${authToken}\` }
        });
        if (res.ok) {
          const data = await res.json();
          document.getElementById('skillsEditor').value = data.skills_md || '';
          const parsed = data.skills_parsed || [];
          const statusEl = document.getElementById('skillsModalStatus');
          statusEl.textContent = parsed.length > 0
            ? \`✓ \${parsed.length} function\${parsed.length !== 1 ? 's' : ''} documented\`
            : 'No documentation generated yet';
          statusEl.className = parsed.length > 0 ? 'skills-status success' : 'skills-status info';
        }
      } catch (e) { console.error('Failed to load skills:', e); }
    };
    window.closeSkillsModal = function() {
      document.getElementById('skillsModal').classList.remove('open');
    };
    window.saveSkillsFromModal = async function() {
      if (!currentAppId) return;
      const btn = document.getElementById('saveSkillsBtn');
      btn.disabled = true;
      btn.textContent = 'Saving...';
      try {
        const skillsMd = document.getElementById('skillsEditor').value;
        const res = await fetch(\`/api/apps/\${currentAppId}/skills\`, {
          method: 'PATCH',
          headers: { 'Authorization': \`Bearer \${authToken}\`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ skills_md: skillsMd })
        });
        if (!res.ok) {
          const data = await res.json();
          if (data.errors) {
            const validation = document.getElementById('skillsValidation');
            validation.style.display = 'block';
            validation.className = 'skills-status error';
            validation.innerHTML = '✗ ' + data.errors.map(e => e.message).join(', ');
            throw new Error('Validation failed');
          }
          throw new Error('Failed to save');
        }
        showToast('Skills saved');
        closeSkillsModal();
        await loadAppPage(currentAppId);
      } catch (err) {
        if (!err.message.includes('Validation')) showToast(err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Save Skills';
      }
    };

    // Environment Modal
    window.openEnvModal = async function() {
      document.getElementById('envModal').classList.add('open');
      if (!currentAppId) return;
      await loadEnvVars(currentAppId);
    };
    window.closeEnvModal = function() {
      document.getElementById('envModal').classList.remove('open');
    };
    window.saveEnvFromModal = async function() {
      const btn = document.getElementById('saveEnvBtn');
      btn.disabled = true;
      btn.textContent = 'Saving...';
      try {
        const saved = await saveEnvVars();
        if (saved) {
          showToast('Environment variables saved');
          closeEnvModal();
          await loadAppPage(currentAppId);
        }
      } catch (err) {
        showToast('Failed to save', 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Save Variables';
      }
    };

    // ============================================
    // Permissions Modal (Per-User Model B)
    // ============================================
    let permsGrantedUsers = [];
    let permsSelectedUserId = null;

    window.openPermissionsModal = async function() {
      document.getElementById('permissionsModal').classList.add('open');
      document.getElementById('permsEmailInput').value = '';
      document.getElementById('permsAddError').style.display = 'none';
      document.getElementById('permsUserDetail').style.display = 'none';
      permsSelectedUserId = null;

      // Update modal info box
      const infoBox = document.getElementById('permsInfoBox');
      if (infoBox) {
        infoBox.textContent = 'Grant access to specific users with per-function control.';
      }

      await loadPermissionsUsers();
    };

    window.closePermissionsModal = function() {
      document.getElementById('permissionsModal').classList.remove('open');
    };

    async function loadPermissionsUsers() {
      if (!currentAppId) return;
      const usersList = document.getElementById('permsUsersList');
      const emptyEl = document.getElementById('permsEmpty');

      try {
        const res = await fetch(\`/api/user/permissions/\${currentAppId}\`, {
          headers: { 'Authorization': \`Bearer \${authToken}\` }
        });
        const data = res.ok ? await res.json() : { users: [] };
        permsGrantedUsers = data.users || [];

        if (permsGrantedUsers.length === 0) {
          usersList.style.display = 'none';
          emptyEl.style.display = 'block';
          // Update summary on app page
          const summaryEl = document.getElementById('appPermsSummary');
          if (summaryEl) summaryEl.textContent = 'No users granted access';
          return;
        }

        emptyEl.style.display = 'none';
        usersList.style.display = 'block';
        usersList.innerHTML = permsGrantedUsers.map(u => {
          const isPending = u.status === 'pending';
          return \`
          <div class="token-item" style="display: flex; align-items: center; justify-content: space-between; padding: 0.625rem 0.875rem; cursor: \${isPending ? 'default' : 'pointer'}; \${isPending ? 'opacity: 0.7;' : ''} \${permsSelectedUserId === u.user_id ? 'background: var(--bg-tertiary);' : ''}"
               \${isPending ? '' : \`onclick="selectPermissionUser('\${u.user_id}')"\`}>
            <div>
              <div style="font-size: 0.8125rem; color: var(--text-primary);">
                \${escapeHtml(u.display_name || u.email)}
                \${isPending ? '<span style="font-size: 0.6875rem; color: var(--warning-color, #f59e0b); margin-left: 0.5rem; font-weight: 500;">Pending invite</span>' : ''}
              </div>
              <div style="font-size: 0.75rem; color: var(--text-muted);">\${escapeHtml(u.email)} · \${u.function_count} function\${u.function_count !== 1 ? 's' : ''} \${isPending ? 'invited' : 'allowed'}</div>
            </div>
            <button class="byok-btn byok-btn-secondary" onclick="event.stopPropagation(); \${isPending ? \`revokePendingUser('\${escapeHtml(u.email)}')\` : \`revokePermissionUser('\${u.user_id}', '\${escapeHtml(u.email)}')\`}" style="font-size: 0.75rem; padding: 2px 10px; color: var(--error-color);">Revoke</button>
          </div>\`;
        }).join('');

        // Update summary on app page
        const summaryEl = document.getElementById('appPermsSummary');
        if (summaryEl) {
          const activeCount = permsGrantedUsers.filter(u => u.status !== 'pending').length;
          const pendingCount = permsGrantedUsers.filter(u => u.status === 'pending').length;
          const parts = [];
          if (activeCount > 0) parts.push(activeCount + ' user' + (activeCount !== 1 ? 's' : '') + ' granted');
          if (pendingCount > 0) parts.push(pendingCount + ' pending');
          summaryEl.textContent = parts.length > 0 ? parts.join(', ') : 'No users granted access';
        }
      } catch (err) {
        usersList.innerHTML = '<div style="text-align: center; padding: 1rem; color: var(--error-color);">Failed to load users</div>';
        usersList.style.display = 'block';
        emptyEl.style.display = 'none';
      }
    }

    window.addPermissionUser = async function() {
      const input = document.getElementById('permsEmailInput');
      const errorEl = document.getElementById('permsAddError');
      const email = input.value.trim();

      if (!email || !email.includes('@')) {
        errorEl.textContent = 'Please enter a valid email address';
        errorEl.style.display = 'block';
        return;
      }

      errorEl.style.display = 'none';

      // Get app functions to grant all by default
      const app = apps.find(a => a.id === currentAppId);
      const fns = app?.skills_parsed?.functions || [];

      if (fns.length === 0) {
        errorEl.textContent = 'No functions documented. Add Skills.md first to configure permissions.';
        errorEl.style.display = 'block';
        return;
      }

      // Grant all functions by default when adding a new user
      const perms = fns.map(fn => ({ function_name: fn.name, allowed: true }));

      try {
        const res = await fetch(\`/api/user/permissions/\${currentAppId}\`, {
          method: 'PUT',
          headers: { 'Authorization': \`Bearer \${authToken}\`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, permissions: perms })
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Failed to add user');
        }

        const data = await res.json().catch(() => ({}));
        input.value = '';
        if (data.status === 'pending') {
          showToast('Invite created — access will activate when user signs up');
        } else {
          showToast('User added with full access');
        }
        await loadPermissionsUsers();
      } catch (err) {
        errorEl.textContent = err.message || 'Failed to add user';
        errorEl.style.display = 'block';
      }
    };

    window.selectPermissionUser = async function(targetUserId) {
      permsSelectedUserId = targetUserId;

      // Highlight selected user in list
      document.querySelectorAll('#permsUsersList .token-item').forEach(el => {
        el.style.background = '';
      });
      event?.target?.closest?.('.token-item')?.style && (event.target.closest('.token-item').style.background = 'var(--bg-tertiary)');

      // Show detail panel
      const detailEl = document.getElementById('permsUserDetail');
      detailEl.style.display = 'block';

      const matrix = document.getElementById('permsMatrix');
      matrix.innerHTML = '<div style="text-align: center; padding: 1rem; color: var(--text-muted);">Loading...</div>';

      const user = permsGrantedUsers.find(u => u.user_id === targetUserId);
      document.getElementById('permsDetailTitle').textContent = \`Functions for \${user?.display_name || user?.email || 'user'}\`;

      try {
        // Load permissions for this user+app
        const permsRes = await fetch(\`/api/user/permissions/\${currentAppId}?user_id=\${targetUserId}\`, {
          headers: { 'Authorization': \`Bearer \${authToken}\` }
        });
        const permsData = permsRes.ok ? await permsRes.json() : { permissions: [] };
        const permsMap = {};
        const permsArgsMap = {};
        (permsData.permissions || []).forEach(p => {
          permsMap[p.function_name] = p.allowed;
          if (p.allowed_args) permsArgsMap[p.function_name] = p.allowed_args;
        });

        // Get app functions
        const app = apps.find(a => a.id === currentAppId);
        const fns = app?.skills_parsed?.functions || [];

        if (fns.length === 0) {
          matrix.innerHTML = '<div style="text-align: center; padding: 1.5rem; color: var(--text-muted); font-size: 0.8125rem;">No functions documented.</div>';
          return;
        }

        // Granular per-function controls for all users
        const granularBtns = document.getElementById('permsGranularBtns');
        if (granularBtns) granularBtns.style.display = 'flex';

        matrix.innerHTML = fns.map((fn, fnIdx) => {
          const allowed = permsMap[fn.name] === true;
          const argConstraints = permsArgsMap[fn.name] || null;
          const argJson = argConstraints ? JSON.stringify(argConstraints, null, 2) : '';
          const hasArgs = argConstraints && Object.keys(argConstraints).length > 0;
          return \`<div class="token-item" style="padding: 0.625rem 0.875rem;">
            <div style="display: flex; align-items: center; justify-content: space-between;">
              <div>
                <div style="font-family: 'JetBrains Mono', monospace; font-size: 0.8125rem; color: var(--text-primary);">\${fn.name}</div>
                <div style="font-size: 0.75rem; color: var(--text-muted);">\${fn.description || 'No description'}</div>
              </div>
              <div style="display: flex; align-items: center; gap: 0.75rem;">
                <button class="byok-btn byok-btn-secondary" onclick="toggleArgConstraints(\${fnIdx})" style="font-size: 0.6875rem; padding: 2px 8px; \${hasArgs ? 'color: var(--accent-color); border-color: var(--accent-color);' : ''}">\${hasArgs ? 'Args \u2713' : 'Args'}</button>
                <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer;">
                  <input type="checkbox" data-fn="\${fn.name}" \${allowed ? 'checked' : ''} style="width: 16px; height: 16px; accent-color: var(--accent-color);" />
                  <span style="font-size: 0.75rem; color: var(--text-secondary);">\${allowed ? 'Allowed' : 'Denied'}</span>
                </label>
              </div>
            </div>
            <div id="argConstraints-\${fnIdx}" style="display: none; margin-top: 0.5rem; padding: 0.5rem; background: var(--bg-secondary, #111); border-radius: 6px;">
              <div style="font-size: 0.6875rem; color: var(--text-muted); margin-bottom: 0.375rem;">
                Arg whitelist (JSON). E.g. <code style="font-size: 0.65rem;">{"region": ["us-east", "eu-west"]}</code>
              </div>
              <textarea data-args-fn="\${fn.name}" rows="3" style="width: 100%; padding: 0.375rem 0.5rem; background: var(--bg-primary, #0a0a0a); border: 1px solid var(--border-color, #2a2a2a); border-radius: 4px; color: var(--text-primary); font-family: 'JetBrains Mono', monospace; font-size: 0.75rem; resize: vertical;">\${escapeHtml(argJson)}</textarea>
            </div>
          </div>\`;
        }).join('');

        matrix.querySelectorAll('input[type="checkbox"][data-fn]').forEach(cb => {
          cb.addEventListener('change', () => {
            cb.nextElementSibling.textContent = cb.checked ? 'Allowed' : 'Denied';
          });
        });
      } catch (err) {
        matrix.innerHTML = '<div style="text-align: center; padding: 1rem; color: var(--error-color);">Failed to load permissions</div>';
      }
    };

    window.revokePermissionUser = async function(targetUserId, email) {
      if (!confirm(\`Revoke all access for \${email}?\`)) return;

      try {
        const res = await fetch(\`/api/user/permissions/\${currentAppId}?user_id=\${targetUserId}\`, {
          method: 'DELETE',
          headers: { 'Authorization': \`Bearer \${authToken}\` }
        });
        if (!res.ok) throw new Error('Failed');
        showToast('User access revoked');

        if (permsSelectedUserId === targetUserId) {
          permsSelectedUserId = null;
          document.getElementById('permsUserDetail').style.display = 'none';
        }
        await loadPermissionsUsers();
      } catch (err) {
        showToast('Failed to revoke access', 'error');
      }
    };

    window.revokePendingUser = async function(email) {
      if (!confirm(\`Revoke pending invite for \${email}?\`)) return;

      try {
        const res = await fetch(\`/api/user/permissions/\${currentAppId}?email=\${encodeURIComponent(email)}&pending=true\`, {
          method: 'DELETE',
          headers: { 'Authorization': \`Bearer \${authToken}\` }
        });
        if (!res.ok) throw new Error('Failed');
        showToast('Pending invite revoked');
        await loadPermissionsUsers();
      } catch (err) {
        showToast('Failed to revoke invite', 'error');
      }
    };

    window.allowAllPermissions = function() {
      document.querySelectorAll('#permsMatrix input[type="checkbox"][data-fn]').forEach(cb => {
        cb.checked = true;
        if (cb.nextElementSibling) cb.nextElementSibling.textContent = 'Allowed';
      });
    };

    window.denyAllPermissions = function() {
      document.querySelectorAll('#permsMatrix input[type="checkbox"][data-fn]').forEach(cb => {
        cb.checked = false;
        if (cb.nextElementSibling) cb.nextElementSibling.textContent = 'Denied';
      });
    };

    window.toggleArgConstraints = function(fnIdx) {
      const el = document.getElementById('argConstraints-' + fnIdx);
      if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
    };

    window.savePermissions = async function() {
      if (!permsSelectedUserId || !currentAppId) {
        showToast('Select a user first', 'error');
        return;
      }

      const perms = [];
      document.querySelectorAll('#permsMatrix input[type="checkbox"][data-fn]').forEach(cb => {
        const entry = { function_name: cb.dataset.fn, allowed: cb.checked };
        // Check for arg constraints textarea
        const argsTA = document.querySelector(\`textarea[data-args-fn="\${cb.dataset.fn}"]\`);
        if (argsTA && argsTA.value.trim()) {
          try {
            const parsed = JSON.parse(argsTA.value.trim());
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
              entry.allowed_args = parsed;
            }
          } catch (e) {
            // Invalid JSON — skip silently, will be sent without allowed_args
          }
        }
        perms.push(entry);
      });

      try {
        const res = await fetch(\`/api/user/permissions/\${currentAppId}\`, {
          method: 'PUT',
          headers: { 'Authorization': \`Bearer \${authToken}\`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_id: permsSelectedUserId, permissions: perms })
        });
        if (!res.ok) throw new Error('Failed to save');
        showToast('Permissions saved');
        await loadPermissionsUsers();
      } catch (err) {
        showToast('Failed to save permissions', 'error');
      }
    };

    // ============================================
    // Logs Modal
    // ============================================
    window.openLogsModal = async function() {
      document.getElementById('logsModal').classList.add('open');
      const titleEl = document.getElementById('logsModalTitle');
      if (currentView === 'app' && currentAppId) {
        const app = apps.find(a => a.id === currentAppId);
        titleEl.textContent = \`Logs: \${app?.name || 'App'}\`;
      } else {
        titleEl.textContent = 'MCP Call Logs';
      }
      await refreshLogs();
    };
    window.closeLogsModal = function() {
      document.getElementById('logsModal').classList.remove('open');
    };
    window.refreshLogs = async function() {
      const listEl = document.getElementById('logsList');
      const emptyEl = document.getElementById('logsEmpty');
      listEl.style.display = 'none';
      emptyEl.style.display = 'block';
      emptyEl.textContent = 'Loading logs...';

      try {
        let url = '/api/user/call-log?limit=100';
        if (currentView === 'app' && currentAppId) {
          url += \`&app_id=\${currentAppId}\`;
        }
        const res = await fetch(url, {
          headers: { 'Authorization': \`Bearer \${authToken}\` }
        });
        if (!res.ok) throw new Error('Failed');
        const { logs } = await res.json();

        if (!logs || logs.length === 0) {
          emptyEl.textContent = 'No call logs yet. Make some MCP tool calls to see them here.';
          return;
        }

        listEl.style.display = 'block';
        emptyEl.style.display = 'none';
        listEl.innerHTML = logs.map(log => {
          const time = new Date(log.created_at).toLocaleString();
          const statusDot = log.success ? '🟢' : '🔴';
          const duration = log.duration_ms ? \`\${log.duration_ms}ms\` : '';
          const appLabel = log.app_name ? \`<span style="color: var(--accent-color);">\${log.app_name}</span> · \` : '';
          return \`<div class="token-item" style="padding: 0.5rem 0.875rem;">
            <div style="display: flex; align-items: center; justify-content: space-between;">
              <div>
                <span style="font-size: 0.75rem;">\${statusDot}</span>
                <span style="font-family: 'JetBrains Mono', monospace; font-size: 0.8125rem; color: var(--text-primary);">\${log.function_name}</span>
                <span style="font-size: 0.75rem; color: var(--text-muted);"> \${log.method}</span>
              </div>
              <span style="font-size: 0.75rem; color: var(--text-muted);">\${duration}</span>
            </div>
            <div style="font-size: 0.6875rem; color: var(--text-muted); margin-top: 2px;">\${appLabel}\${time}\${log.error_message ? ' · <span style="color: var(--error-color);">' + log.error_message + '</span>' : ''}</div>
          </div>\`;
        }).join('');
      } catch (err) {
        emptyEl.textContent = 'Failed to load logs.';
      }
    };

    // ============================================
    // Search
    // ============================================
    let searchTimeout = null;
    window.handleSearch = function(query) {
      clearTimeout(searchTimeout);
      const dropdown = document.getElementById('searchDropdown');

      if (!query || query.trim().length < 2) {
        dropdown.style.display = 'none';
        return;
      }

      searchTimeout = setTimeout(async () => {
        const q = query.trim().toLowerCase();
        let html = '';

        // Your Apps - local filter
        const myApps = apps.filter(a =>
          a.name?.toLowerCase().includes(q) || a.slug?.toLowerCase().includes(q)
        ).slice(0, 5);

        if (myApps.length > 0) {
          html += '<div style="padding: 0.5rem 0.75rem; font-size: 0.6875rem; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em;">Your Apps</div>';
          html += myApps.map(a =>
            \`<div class="top-bar-profile-dropdown-item" onclick="document.getElementById('searchInput').value=''; document.getElementById('searchDropdown').style.display='none'; navigateToApp(event, '\${a.id}')" style="padding: 0.5rem 0.75rem; cursor: pointer;">
              <span style="font-size: 0.8125rem;">\${a.name || a.slug}</span>
              <span style="font-size: 0.6875rem; color: var(--text-muted); margin-left: 0.5rem;">\${a.visibility || 'private'}</span>
            </div>\`
          ).join('');
        }

        // App Store - discover API
        try {
          const discoverRes = await fetch('/api/discover', {
            method: 'POST',
            headers: { 'Authorization': \`Bearer \${authToken}\`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: q, limit: 5 })
          });
          if (discoverRes.ok) {
            const { results } = await discoverRes.json();
            if (results && results.length > 0) {
              html += '<div style="padding: 0.5rem 0.75rem; font-size: 0.6875rem; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; border-top: 1px solid var(--border-color); margin-top: 0.25rem;">App Store</div>';
              html += results.map(r =>
                \`<div class="top-bar-profile-dropdown-item" onclick="window.location.href='/a/\${r.id}'" style="padding: 0.5rem 0.75rem; cursor: pointer;">
                  <span style="font-size: 0.8125rem;">\${r.name || r.slug}</span>
                  <span style="font-size: 0.6875rem; color: var(--text-muted); margin-left: 0.5rem;">by \${r.owner_name || 'unknown'}</span>
                </div>\`
              ).join('');
            }
          }
        } catch (e) { /* App store search failed silently */ }

        if (!html) {
          html = '<div style="padding: 1rem; text-align: center; color: var(--text-muted); font-size: 0.8125rem;">No results found</div>';
        }

        dropdown.innerHTML = html;
        dropdown.style.display = 'block';
      }, 300);
    };

    // Close search on click outside
    document.addEventListener('click', (e) => {
      const search = document.querySelector('.top-bar-search');
      if (search && !search.contains(e.target)) {
        document.getElementById('searchDropdown').style.display = 'none';
      }
    });

    // Copy App MCP URL
    window.copyAppMcpUrl = function() {
      const url = document.getElementById('appMcpUrl').textContent;
      navigator.clipboard.writeText(url).then(() => showToast('MCP URL copied!'));
    };

    window.copyAppBridgeConfig = function() {
      const el = document.getElementById('appBridgeConfig');
      if (el) {
        navigator.clipboard.writeText(el.textContent).then(() => {
          showToast('Bridge config copied!');
        });
      }
    };

    window.openAppDashboard = function() {
      if (!currentAppId) return;
      window.open(\`/http/\${currentAppId}/_ui\`, '_blank');
    };

    // Download app code
    window.downloadAppCode = async function() {
      if (!currentAppId || !authToken) return;
      try {
        const res = await fetch(\`/api/apps/\${currentAppId}/download\`, {
          headers: { 'Authorization': \`Bearer \${authToken}\` }
        });
        if (!res.ok) throw new Error('Failed to download');
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const appRef = apps.find(x => x.id === currentAppId);
        a.download = (appRef?.slug || 'app') + '.zip';
        a.click();
        URL.revokeObjectURL(url);
      } catch (err) {
        showToast('Failed to download code', 'error');
      }
    };

    // Delete app
    window.deleteApp = function() {
      if (!currentAppId) return;
      const app = apps.find(a => a.id === currentAppId);
      document.getElementById('deleteAppName').textContent = app?.name || 'this app';
      deleteConfirmModal.classList.add('open');
    };

    window.closeDeleteConfirm = function() {
      deleteConfirmModal.classList.remove('open');
    };

    deleteConfirmModal.addEventListener('click', (e) => {
      if (e.target === deleteConfirmModal) closeDeleteConfirm();
    });

    // Close modals on overlay click
    document.getElementById('skillsModal')?.addEventListener('click', (e) => {
      if (e.target.id === 'skillsModal') closeSkillsModal();
    });
    document.getElementById('envModal')?.addEventListener('click', (e) => {
      if (e.target.id === 'envModal') closeEnvModal();
    });
    document.getElementById('permissionsModal')?.addEventListener('click', (e) => {
      if (e.target.id === 'permissionsModal') closePermissionsModal();
    });
    document.getElementById('permsEmailInput')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); addPermissionUser(); }
    });

    document.getElementById('confirmDeleteBtn').addEventListener('click', async () => {
      if (!currentAppId || !authToken) return;

      const btn = document.getElementById('confirmDeleteBtn');
      btn.disabled = true;
      btn.textContent = 'Deleting...';

      try {
        const res = await fetch(\`/api/apps/\${currentAppId}\`, {
          method: 'DELETE',
          headers: { 'Authorization': \`Bearer \${authToken}\` }
        });

        if (!res.ok) throw new Error('Failed to delete app');

        showToast('App deleted successfully');
        closeDeleteConfirm();

        // Go to dashboard after deleting
        navigateToDashboard();

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
      await loadAppPage(appId);
    };

    function showView(view) {
      homeView.style.display = view === 'home' ? 'flex' : 'none';
      dashboardView.style.display = view === 'dashboard' ? 'flex' : 'none';
      leaderboardView.style.display = view === 'leaderboard' ? 'flex' : 'none';
      appView.style.display = view === 'app' ? 'flex' : 'none';
      currentView = view;
      updateFooterVisibility(view);
      updateNavActive(view);
      updateConnectButtonVisibility(view);
      updateRightSidebar(view);
    }

    function updateConnectButtonVisibility(view) {
      const btn = document.getElementById('topBarConnectBtn');
      if (btn) btn.classList.toggle('visible', view !== 'home');
    }

    function updateRightSidebar(view) {
      const rs = document.getElementById('rightSidebar');
      const mc = document.querySelector('.main-content');
      if (view === 'leaderboard') {
        rs.classList.add('visible');
        mc.classList.add('has-right-sidebar');
        loadRightSidebarData();
      } else {
        rs.classList.remove('visible');
        mc.classList.remove('has-right-sidebar');
      }
    }

    async function loadRightSidebarData() {
      const header = document.getElementById('rightSidebarHeader');
      const tabs = document.getElementById('rightSidebarTabs');
      const content = document.getElementById('rightSidebarContent');
      header.innerHTML = '<h3 style="font-size:0.9375rem;font-weight:600;margin-bottom:0.5rem">Platform Gaps</h3>';
      tabs.innerHTML =
        '<button class="right-sidebar-tab active" data-status="open" onclick="filterRightGaps(\\\'open\\\')">Open</button>' +
        '<button class="right-sidebar-tab" data-status="claimed" onclick="filterRightGaps(\\\'claimed\\\')">Claimed</button>' +
        '<button class="right-sidebar-tab" data-status="fulfilled" onclick="filterRightGaps(\\\'fulfilled\\\')">Fulfilled</button>' +
        '<button class="right-sidebar-tab" data-status="all" onclick="filterRightGaps(\\\'all\\\')">All</button>';
      await loadRightSidebarGaps(content, 'open');
    }

    window.filterRightGaps = async function(status) {
      const tabs = document.querySelectorAll('.right-sidebar-tab');
      tabs.forEach(t => t.classList.toggle('active', t.dataset.status === status));
      const content = document.getElementById('rightSidebarContent');
      await loadRightSidebarGaps(content, status);
    };

    async function loadRightSidebarGaps(container, status) {
      container.innerHTML = '<div style="color:var(--text-muted);font-size:0.8125rem;padding:1rem 0;text-align:center">Loading...</div>';
      try {
        const res = await fetch('/api/homepage?type=gaps&status=' + status + '&limit=30');
        if (res.ok) {
          const data = await res.json();
          renderGapCards(container, data.results || data || [], 30);
        } else {
          container.innerHTML = '<div style="color:var(--text-muted);font-size:0.8125rem;padding:1rem 0;text-align:center">Failed to load.</div>';
        }
      } catch {
        container.innerHTML = '<div style="color:var(--text-muted);font-size:0.8125rem;padding:1rem 0;text-align:center">Failed to load.</div>';
      }
    }

    window.copyConnectUrl = function() {
      const url = window.location.origin + '/mcp/platform';
      navigator.clipboard.writeText(url).then(() => {
        // Update hero button text
        const heroText = document.getElementById('heroConnectText');
        if (heroText) {
          heroText.textContent = 'Copied \\u2713';
          setTimeout(() => { heroText.textContent = 'Connect'; }, 1500);
        }
        // Update top bar button text
        const topText = document.getElementById('connectBtnText');
        if (topText) {
          topText.textContent = 'Copied \\u2713';
          setTimeout(() => { topText.textContent = 'Connect'; }, 1500);
        }
      }).catch(() => {});
    };

    function updateNavActive(view) {
      document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.toggle('nav-active', btn.dataset.view === view);
      });
    }

    function navigateToHome() {
      history.pushState({}, '', '/');
      currentAppId = null;
      showView('home');
      loadHomeData();
    }

    function navigateToDashboard() {
      history.pushState({}, '', '/dash');
      currentAppId = null;
      showView('dashboard');
      renderAppsList();
      loadDashboardData();
    }

    window.navigateToGaps = function() {
      navigateToLeaderboard();
    };

    window.navigateToLeaderboard = function() {
      history.pushState({}, '', '/leaderboard');
      currentAppId = null;
      showView('leaderboard');
      loadLeaderboardData();
    };

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

    window.copyPlatformBridgeConfig = function() {
      const url = window.location.origin + '/mcp/platform';
      const config = JSON.stringify({
        mcpServers: {
          "ultralight-platform": {
            command: "npx",
            args: [
              "mcp-remote",
              url,
              "--header",
              "Authorization: Bearer YOUR_TOKEN"
            ]
          }
        }
      }, null, 2);
      navigator.clipboard.writeText(config).then(() => {
        showToast('Bridge config copied!');
      });
    };

    // Populate the platform bridge config snippet
    (function() {
      const el = document.getElementById('platformBridgeConfig');
      if (el) {
        const url = window.location.origin + '/mcp/platform';
        const config = JSON.stringify({
          mcpServers: {
            "ultralight-platform": {
              command: "npx",
              args: [
                "mcp-remote",
                url,
                "--header",
                "Authorization: Bearer YOUR_TOKEN"
              ]
            }
          }
        }, null, 2);
        el.textContent = config;
      }
    })();

    async function loadDashboardData() {
      // Load tokens inline on dashboard
      await loadTokens();

      // Load Supabase servers inline on dashboard
      await loadSupabaseServers();

    }

    window.refreshCallLog = function() {
      showToast('Call log refresh coming soon.');
    };

    // ============================================
    // Home View Data
    // ============================================

    function escHtml(s) { return s ? String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') : ''; }
    function relTime(d) {
      const ms = Date.now() - new Date(d).getTime();
      const m = Math.floor(ms/60000);
      if (m < 60) return m + 'm ago';
      const h = Math.floor(m/60);
      if (h < 24) return h + 'h ago';
      const dy = Math.floor(h/24);
      if (dy < 30) return dy + 'd ago';
      return new Date(d).toLocaleDateString('en-US',{month:'short',day:'numeric'});
    }

    const severityColors = { critical:'#ef4444', high:'#f59e0b', medium:'var(--accent-color)', low:'var(--text-muted)' };

    async function loadHomeData() {
      try {
        // Fetch top apps for the charts section
        const appsRes = await fetch('/api/homepage?type=apps&limit=10');
        const topAppsEl = document.getElementById('homeTopApps');
        if (appsRes.ok) {
          const data = await appsRes.json();
          const apps = data.results || [];
          if (apps.length > 0) {
            topAppsEl.innerHTML = apps.slice(0, 10).map((a, i) =>
              '<a href="/app/' + escHtml(a.id) + '" class="home-card" style="text-decoration:none;color:inherit">' +
              '<div style="width:1.25rem;font-size:0.75rem;font-weight:700;color:var(--text-muted);padding-top:0.1rem">' + (i+1) + '</div>' +
              '<div style="flex:1;min-width:0">' +
              '<div style="font-size:0.8125rem;font-weight:600;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escHtml(a.name || a.slug) + '</div>' +
              (a.description ? '<div style="font-size:0.75rem;color:var(--text-secondary);margin-top:0.1rem;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden">' + escHtml(a.description).slice(0,100) + '</div>' : '') +
              '</div></a>'
            ).join('');
          } else {
            topAppsEl.innerHTML = '<div style="color:var(--text-muted);font-size:0.8125rem;padding:1rem 0;text-align:center">No MCP servers published yet.</div>';
          }
        }

        // Content placeholder
        const homeContentEl = document.getElementById('homeTopContent');
        if (homeContentEl) homeContentEl.innerHTML = '<div style="color:var(--text-muted);font-size:0.8125rem;padding:1rem 0;text-align:center">Coming soon</div>';

      } catch (err) {
        console.error('[HOME] Failed to load data:', err);
      }
    }

    function renderGapCards(container, gaps, limit) {
      if (!gaps || gaps.length === 0) {
        container.innerHTML = '<div style="color:var(--text-muted);font-size:0.8125rem;padding:1.5rem 0;text-align:center">No open gaps right now.</div>';
        return;
      }
      container.innerHTML = gaps.slice(0, limit).map(g =>
        '<div class="home-card" style="flex-direction:column;gap:0.35rem">' +
        '<div style="display:flex;align-items:center;gap:0.5rem">' +
        '<span style="font-size:0.6rem;padding:0.1rem 0.4rem;border-radius:9999px;color:#fff;font-weight:600;text-transform:uppercase;background:' + (severityColors[g.severity]||'var(--text-muted)') + '">' + escHtml(g.severity) + '</span>' +
        '<span style="font-size:0.75rem;font-weight:600;color:var(--warning-color,#f59e0b);margin-left:auto">' + (g.points_value||0) + ' pts</span>' +
        '</div>' +
        '<div style="font-size:0.8125rem;font-weight:600;color:var(--text-primary)">' + escHtml(g.title) + '</div>' +
        '<div style="font-size:0.75rem;color:var(--text-secondary);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">' + escHtml(g.description).slice(0,160) + '</div>' +
        '</div>'
      ).join('');
    }

    function renderLeaderboardRows(container, entries, limit) {
      if (!entries || entries.length === 0) {
        container.innerHTML = '<div style="color:var(--text-muted);font-size:0.8125rem;padding:1.5rem 0;text-align:center">No points earned yet.</div>';
        return;
      }
      const medals = ['🥇','🥈','🥉'];
      container.innerHTML = entries.slice(0, limit).map((u, i) =>
        '<div style="display:flex;align-items:center;gap:0.75rem;padding:0.5rem 0;border-bottom:1px solid var(--border-color)">' +
        '<span style="width:1.5rem;text-align:center;font-size:' + (i < 3 ? '1.1rem' : '0.8rem') + ';font-weight:700;color:var(--text-muted)">' + (medals[i] || (i+1)) + '</span>' +
        '<a href="/u/' + escHtml(u.user_id) + '" style="flex:1;font-size:0.8125rem;font-weight:500;color:var(--accent-color);text-decoration:none">' + escHtml(u.display_name) + '</a>' +
        '<span style="font-size:0.8rem;font-weight:700;color:var(--warning-color,#f59e0b)">' + (u.total_points||0).toLocaleString() + ' pts</span>' +
        '</div>'
      ).join('');
    }

    // ============================================
    // Gaps View Data
    // ============================================

    let currentGapFilter = 'open';

    window.filterGaps = function(status) {
      currentGapFilter = status;
      document.querySelectorAll('.gaps-filter-btn').forEach(btn => {
        btn.classList.toggle('gaps-filter-active', btn.dataset.status === status);
      });
      loadGapsData(status);
    };

    async function loadGapsData(status) {
      const container = document.getElementById('gapsList');
      container.innerHTML = '<div style="color:var(--text-muted);font-size:0.8125rem;padding:2rem 0;text-align:center">Loading...</div>';

      try {
        const url = '/api/homepage?type=gaps&status=' + status + '&limit=50';
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          const gaps = data.results || data || [];
          renderGapCards(container, gaps, 50);
        } else {
          container.innerHTML = '<div style="color:var(--text-muted);font-size:0.8125rem;padding:2rem 0;text-align:center">Failed to load gaps.</div>';
        }
      } catch {
        container.innerHTML = '<div style="color:var(--text-muted);font-size:0.8125rem;padding:2rem 0;text-align:center">Failed to load gaps.</div>';
      }
    }

    // ============================================
    // Leaderboard View Data
    // ============================================

    async function loadLeaderboardData() {
      const container = document.getElementById('leaderboardList');
      const seasonEl = document.getElementById('leaderboardSeason');
      container.innerHTML = '<div style="color:var(--text-muted);font-size:0.8125rem;padding:2rem 0;text-align:center">Loading...</div>';

      try {
        const res = await fetch('/api/homepage?type=leaderboard&limit=50');
        if (res.ok) {
          const data = await res.json();
          const entries = data.results || data || [];
          if (data.season) {
            seasonEl.innerHTML = '<span style="display:inline-block;background:var(--bg-tertiary);padding:0.2rem 0.75rem;border-radius:9999px;font-size:0.8rem;color:var(--accent-color);font-weight:500">' + escHtml(data.season.name) + '</span>';
          }
          renderLeaderboardRows(container, entries, 50);
        } else {
          container.innerHTML = '<div style="color:var(--text-muted);font-size:0.8125rem;padding:2rem 0;text-align:center">Failed to load leaderboard.</div>';
        }
      } catch {
        container.innerHTML = '<div style="color:var(--text-muted);font-size:0.8125rem;padding:2rem 0;text-align:center">Failed to load leaderboard.</div>';
      }
    }

    window.addEventListener('popstate', async (event) => {
      const path = window.location.pathname;

      if (path === '/') {
        currentAppId = null;
        showView('home');
        loadHomeData();
      } else if (path === '/dash' || path === '/dashboard') {
        currentAppId = null;
        showView('dashboard');
        renderAppsList();
      } else if (path === '/gaps' || path === '/leaderboard') {
        currentAppId = null;
        showView('leaderboard');
        loadLeaderboardData();
      } else if (path.startsWith('/a/')) {
        const appId = path.slice(3).split('/')[0];
        currentAppId = appId;
        showView('app');
        renderAppsList();
        await loadAppPage(appId);
      }
    });

    // (loadAndRunApp and createRuntime removed — replaced by loadAppPage)

    // ============================================
    // Dashboard
    // ============================================
    newAppBtn.addEventListener('click', navigateToDashboard);
    document.getElementById('navHomeBtn').addEventListener('click', navigateToHome);
    document.getElementById('navLeaderboardBtn').addEventListener('click', navigateToLeaderboard);


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

    // If we're in app view and have an appId, load the app page
    ${initialView === 'app' && activeAppId ? `
    (async () => {
      console.log('📱 Initial app page load for appId: ${activeAppId}');
      await loadAppPage('${activeAppId}');
    })();
    ` : ''}

    // Load data for the initial view
    ${initialView === 'home' ? 'loadHomeData();' : ''}
    ${initialView === 'leaderboard' ? 'loadLeaderboardData();' : ''}
    // Initialize connect button and right sidebar visibility
    updateConnectButtonVisibility('${initialView}');
    updateRightSidebar('${initialView}');
  </script>
</body>
</html>`;
}
