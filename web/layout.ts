// Ultralight Layout — Complete Rewrite
// World-class light-mode UI with white/black monochrome design language

export function getLayoutHTML(options: {
  title?: string;
  activeAppId?: string;
  initialView: 'home' | 'dashboard' | 'app' | 'leaderboard';
  appCode?: string;
  appName?: string;
}): string {
  const { title = 'Ultralight', activeAppId, initialView, appCode, appName } = options;

  const escapedCode = appCode
    ? appCode.replace(/\\\\/g, '\\\\\\\\').replace(/\`/g, '\\\\\`').replace(/\\$/g, '\\\\\\$')
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - Ultralight</title>
  <meta name="description" content="TypeScript functions become MCP servers. Instantly.">
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0%25' stop-color='%230a0a0a'/%3E%3Cstop offset='100%25' stop-color='%23333333'/%3E%3C/linearGradient%3E%3C/defs%3E%3Cpath d='M6 4 L6 22 Q6 28 12 28 L12 28 L12 4 L17 4 L17 28 Q17 28 20 28 Q26 28 26 22 L26 4 L21 4 L21 22 Q21 24 20 24 L12 24 Q10.5 24 10.5 22 L10.5 4 Z' fill='url(%23g)'/%3E%3C/svg%3E">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    /* ============================================
       CSS RESET
       ============================================ */
    *, *::before, *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    html {
      -webkit-font-smoothing: auto;
      -moz-osx-font-smoothing: auto;
      text-rendering: optimizeLegibility;
      scroll-behavior: smooth;
    }

    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      line-height: 1.6;
      color: var(--text-primary);
      background: var(--bg-base);
      min-height: 100vh;
      overflow-x: hidden;
    }

    a { color: inherit; text-decoration: none; }
    button { font-family: inherit; cursor: pointer; border: none; background: none; }
    input, textarea, select { font-family: inherit; }
    img, svg { display: block; max-width: 100%; }
    ul, ol { list-style: none; }

    /* ============================================
       CSS VARIABLES — DESIGN TOKENS
       ============================================ */
    :root {
      /* Background — white/light monochrome */
      --bg-base: #ffffff;
      --bg-raised: #fafafa;
      --bg-overlay: #ffffff;
      --bg-hover: rgba(0,0,0,0.04);
      --bg-active: rgba(0,0,0,0.06);
      --bg-subtle: rgba(0,0,0,0.02);

      /* Borders — subtle grays */
      --border: rgba(0,0,0,0.08);
      --border-strong: rgba(0,0,0,0.15);
      --border-focus: rgba(0,0,0,0.4);

      /* Text — black monochrome */
      --text-primary: #0a0a0a;
      --text-secondary: #555;
      --text-muted: #999;
      --text-inverse: #ffffff;

      /* Accent — black monochrome (no blue) */
      --accent: #0a0a0a;
      --accent-hover: #333;
      --accent-soft: rgba(0,0,0,0.06);
      --accent-text: #0a0a0a;

      /* Semantic */
      --success: #22c55e;
      --success-soft: rgba(34,197,94,0.1);
      --error: #ef4444;
      --error-soft: rgba(239,68,68,0.08);
      --warning: #f59e0b;
      --warning-soft: rgba(245,158,11,0.08);

      /* Spacing scale */
      --space-1: 4px;
      --space-2: 8px;
      --space-3: 12px;
      --space-4: 16px;
      --space-5: 20px;
      --space-6: 24px;
      --space-8: 32px;
      --space-10: 40px;
      --space-12: 48px;
      --space-16: 64px;
      --space-20: 80px;

      /* Radius */
      --radius-sm: 6px;
      --radius-md: 8px;
      --radius-lg: 12px;
      --radius-xl: 16px;
      --radius-full: 9999px;

      /* Shadows — subtle light-mode shadows */
      --shadow-sm: 0 1px 2px rgba(0,0,0,0.05);
      --shadow-md: 0 4px 12px rgba(0,0,0,0.08);
      --shadow-lg: 0 8px 30px rgba(0,0,0,0.1);
      --shadow-xl: 0 16px 50px rgba(0,0,0,0.12);
      --shadow-glow: 0 0 0 3px rgba(0,0,0,0.06);

      /* Typography */
      --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      --font-mono: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;

      /* Z-index scale */
      --z-dropdown: 100;
      --z-sticky: 200;
      --z-overlay: 300;
      --z-modal: 400;
      --z-toast: 500;
      --z-tooltip: 600;

      /* Transitions */
      --transition-fast: 120ms ease;
      --transition-base: 200ms ease;
      --transition-slow: 300ms ease;

      /* Layout */
      --nav-height: 64px;
      --content-max: 1200px;
      --content-narrow: 720px;
    }

    /* ============================================
       TYPOGRAPHY SYSTEM
       ============================================ */
    .text-display {
      font-size: 48px;
      font-weight: 700;
      line-height: 1.1;
      letter-spacing: -0.03em;
    }

    .text-h1 {
      font-size: 32px;
      font-weight: 700;
      line-height: 1.2;
      letter-spacing: -0.02em;
    }

    .text-h2 {
      font-size: 24px;
      font-weight: 600;
      line-height: 1.3;
      letter-spacing: -0.015em;
    }

    .text-h3 {
      font-size: 18px;
      font-weight: 600;
      line-height: 1.4;
      letter-spacing: -0.01em;
    }

    .text-body {
      font-size: 14px;
      font-weight: 400;
      line-height: 1.6;
    }

    .text-body-lg {
      font-size: 16px;
      font-weight: 400;
      line-height: 1.6;
    }

    .text-small {
      font-size: 13px;
      font-weight: 400;
      line-height: 1.5;
    }

    .text-caption {
      font-size: 12px;
      font-weight: 500;
      line-height: 1.4;
      letter-spacing: 0.01em;
    }

    .text-mono {
      font-family: var(--font-mono);
      font-size: 13px;
      font-weight: 400;
    }

    .text-secondary { color: var(--text-secondary); }
    .text-muted { color: var(--text-muted); }
    .text-accent { color: var(--accent-text); }

    /* ============================================
       LAYOUT — TOP NAV + MAIN CONTENT
       ============================================ */
    .app-wrapper {
      display: flex;
      flex-direction: column;
      min-height: 100vh;
    }

    /* Top Navigation */
    .top-nav {
      position: sticky;
      top: 0;
      z-index: var(--z-sticky);
      height: var(--nav-height);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 var(--space-6);
      background: rgba(255,255,255,0.85);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
    }

    .nav-left {
      display: flex;
      align-items: center;
      gap: var(--space-6);
    }

    .nav-logo {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      font-weight: 600;
      font-size: 15px;
      color: var(--text-primary);
      cursor: pointer;
      transition: opacity var(--transition-fast);
    }

    .nav-logo:hover { opacity: 0.8; }

    .nav-links {
      display: flex;
      align-items: center;
      gap: var(--space-1);
    }

    .nav-link {
      padding: var(--space-2) var(--space-3);
      font-size: 13px;
      font-weight: 500;
      color: var(--text-secondary);
      border-radius: var(--radius-sm);
      transition: all var(--transition-fast);
    }

    .nav-link:hover {
      color: var(--text-primary);
      background: var(--bg-hover);
    }

    .nav-link.active {
      color: var(--text-primary);
      background: var(--bg-active);
    }

    .nav-right {
      display: flex;
      align-items: center;
      gap: var(--space-3);
    }

    /* Main Content */
    .main-content {
      flex: 1;
      width: 100%;
      max-width: var(--content-max);
      margin: 0 auto;
      padding: var(--space-8) var(--space-6);
    }

    .main-content.narrow {
      max-width: var(--content-narrow);
    }

    .main-content.full {
      max-width: 100%;
    }

    /* ============================================
       BUTTON STYLES
       ============================================ */
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: var(--space-2);
      padding: 0 var(--space-4);
      height: 36px;
      font-size: 13px;
      font-weight: 500;
      border-radius: var(--radius-md);
      transition: all var(--transition-fast);
      white-space: nowrap;
      user-select: none;
      position: relative;
      overflow: hidden;
    }

    .btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      pointer-events: none;
    }

    .btn-sm {
      height: 30px;
      padding: 0 var(--space-3);
      font-size: 12px;
      border-radius: var(--radius-sm);
    }

    .btn-lg {
      height: 42px;
      padding: 0 var(--space-6);
      font-size: 14px;
      border-radius: var(--radius-lg);
    }

    .btn-icon {
      width: 36px;
      height: 36px;
      padding: 0;
      border-radius: var(--radius-md);
    }

    .btn-icon.sm {
      width: 30px;
      height: 30px;
    }

    /* Primary */
    .btn-primary {
      background: var(--accent);
      color: white;
      border: 1px solid transparent;
    }

    .btn-primary:hover {
      background: var(--accent-hover);
      box-shadow: var(--shadow-glow);
    }

    .btn-primary:active {
      transform: scale(0.98);
    }

    /* Secondary */
    .btn-secondary {
      background: var(--bg-raised);
      color: var(--text-primary);
      border: 1px solid var(--border-strong);
    }

    .btn-secondary:hover {
      background: var(--bg-hover);
      border-color: rgba(0,0,0,0.2);
    }

    .btn-secondary:active {
      background: var(--bg-active);
    }

    /* Ghost */
    .btn-ghost {
      background: transparent;
      color: var(--text-secondary);
      border: 1px solid transparent;
    }

    .btn-ghost:hover {
      color: var(--text-primary);
      background: var(--bg-hover);
    }

    .btn-ghost:active {
      background: var(--bg-active);
    }

    /* Danger */
    .btn-danger {
      background: var(--error-soft);
      color: var(--error);
      border: 1px solid transparent;
    }

    .btn-danger:hover {
      background: rgba(239,68,68,0.2);
    }

    /* ============================================
       CARD STYLES
       ============================================ */
    .card {
      background: var(--bg-raised);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      overflow: hidden;
      transition: all var(--transition-base);
    }

    .card-interactive:hover {
      border-color: var(--border-strong);
      box-shadow: var(--shadow-md);
      transform: translateY(-1px);
    }

    .card-interactive:active {
      transform: translateY(0);
    }

    .card-header {
      padding: var(--space-5) var(--space-5) 0;
    }

    .card-body {
      padding: var(--space-5);
    }

    .card-footer {
      padding: var(--space-4) var(--space-5);
      border-top: 1px solid var(--border);
      background: var(--bg-subtle);
    }

    .card-compact .card-body {
      padding: var(--space-4);
    }

    /* App Card */
    .app-card {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
      cursor: pointer;
    }

    .app-card .app-card-title {
      font-size: 14px;
      font-weight: 600;
      color: var(--text-primary);
      display: flex;
      align-items: center;
      gap: var(--space-2);
    }

    .app-card .app-card-desc {
      font-size: 13px;
      color: var(--text-secondary);
      line-height: 1.5;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    .app-card .app-card-meta {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      font-size: 12px;
      color: var(--text-muted);
    }

    .app-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: var(--space-4);
    }

    /* ============================================
       INPUT / FORM STYLES
       ============================================ */
    .input {
      width: 100%;
      height: 36px;
      padding: 0 var(--space-3);
      font-size: 13px;
      color: var(--text-primary);
      background: var(--bg-base);
      border: 1px solid var(--border-strong);
      border-radius: var(--radius-md);
      transition: all var(--transition-fast);
      outline: none;
    }

    .input:hover {
      border-color: rgba(0,0,0,0.2);
    }

    .input:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px var(--accent-soft);
    }

    .input::placeholder {
      color: var(--text-muted);
    }

    .input-lg {
      height: 42px;
      padding: 0 var(--space-4);
      font-size: 14px;
    }

    textarea.input {
      height: auto;
      min-height: 80px;
      padding: var(--space-3);
      resize: vertical;
      line-height: 1.5;
    }

    .input-group {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
    }

    .input-label {
      font-size: 13px;
      font-weight: 500;
      color: var(--text-secondary);
    }

    .input-hint {
      font-size: 12px;
      color: var(--text-muted);
    }

    .input-error {
      border-color: var(--error) !important;
      box-shadow: 0 0 0 3px var(--error-soft) !important;
    }

    /* Search input */
    .search-input-wrapper {
      position: relative;
      display: flex;
      align-items: center;
    }

    .search-input-wrapper svg {
      position: absolute;
      left: var(--space-3);
      width: 16px;
      height: 16px;
      color: var(--text-muted);
      pointer-events: none;
    }

    .search-input-wrapper .input {
      padding-left: 36px;
    }

    /* ============================================
       TOAST NOTIFICATIONS
       ============================================ */
    .toast-container {
      position: fixed;
      bottom: var(--space-6);
      right: var(--space-6);
      z-index: var(--z-toast);
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
      pointer-events: none;
    }

    .toast {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      padding: var(--space-3) var(--space-4);
      min-width: 280px;
      max-width: 420px;
      background: var(--bg-overlay);
      border: 1px solid var(--border-strong);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-lg);
      font-size: 13px;
      color: var(--text-primary);
      pointer-events: auto;
      animation: toast-in 0.3s ease forwards;
    }

    .toast.toast-out {
      animation: toast-out 0.2s ease forwards;
    }

    .toast-success { border-left: 3px solid var(--success); }
    .toast-error   { border-left: 3px solid var(--error); }
    .toast-warning { border-left: 3px solid var(--warning); }
    .toast-info    { border-left: 3px solid var(--accent); }

    .toast-close {
      margin-left: auto;
      padding: var(--space-1);
      color: var(--text-muted);
      cursor: pointer;
      border-radius: var(--radius-sm);
      transition: color var(--transition-fast);
    }

    .toast-close:hover { color: var(--text-primary); }

    @keyframes toast-in {
      from { opacity: 0; transform: translateY(8px) scale(0.96); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }

    @keyframes toast-out {
      from { opacity: 1; transform: translateY(0) scale(1); }
      to   { opacity: 0; transform: translateY(8px) scale(0.96); }
    }

    /* ============================================
       MODAL / OVERLAY STYLES
       ============================================ */
    .modal-backdrop {
      position: fixed;
      inset: 0;
      z-index: var(--z-modal);
      background: rgba(0,0,0,0.3);
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: var(--space-6);
      animation: fade-in 0.2s ease;
    }

    .modal-backdrop.hidden { display: none; }

    .modal {
      width: 100%;
      max-width: 520px;
      max-height: 85vh;
      background: var(--bg-raised);
      border: 1px solid var(--border-strong);
      border-radius: var(--radius-xl);
      box-shadow: var(--shadow-xl);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      animation: modal-in 0.25s ease;
    }

    .modal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: var(--space-5) var(--space-6);
      border-bottom: 1px solid var(--border);
    }

    .modal-header h2 {
      font-size: 16px;
      font-weight: 600;
    }

    .modal-body {
      padding: var(--space-6);
      overflow-y: auto;
      flex: 1;
    }

    .modal-footer {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: var(--space-3);
      padding: var(--space-4) var(--space-6);
      border-top: 1px solid var(--border);
    }

    @keyframes modal-in {
      from { opacity: 0; transform: scale(0.95) translateY(8px); }
      to   { opacity: 1; transform: scale(1) translateY(0); }
    }

    @keyframes fade-in {
      from { opacity: 0; }
      to   { opacity: 1; }
    }

    /* ============================================
       AUTH POPUP OVERLAY
       ============================================ */
    .auth-overlay {
      position: fixed;
      inset: 0;
      z-index: var(--z-modal);
      background: rgba(0,0,0,0.4);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: var(--space-6);
      animation: fade-in 0.3s ease;
    }

    .auth-overlay.hidden { display: none; }

    .auth-card {
      position: relative;
      width: 100%;
      max-width: 400px;
      background: var(--bg-base);
      border: 1px solid var(--border-strong);
      border-radius: var(--radius-xl);
      box-shadow: var(--shadow-xl);
      padding: var(--space-10) var(--space-8);
      text-align: center;
      animation: modal-in 0.3s ease;
    }

    .auth-card h2 {
      font-size: 22px;
      font-weight: 700;
      margin-bottom: var(--space-2);
      letter-spacing: -0.02em;
    }

    .auth-card p {
      font-size: 14px;
      color: var(--text-secondary);
      margin-bottom: var(--space-8);
      line-height: 1.6;
    }

    .auth-divider {
      display: flex;
      align-items: center;
      gap: var(--space-4);
      margin: var(--space-6) 0;
      color: var(--text-muted);
      font-size: 12px;
    }

    .auth-divider::before,
    .auth-divider::after {
      content: '';
      flex: 1;
      height: 1px;
      background: var(--border);
    }

    .auth-provider-btn {
      width: 100%;
      height: 42px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: var(--space-3);
      font-size: 14px;
      font-weight: 500;
      color: var(--text-primary);
      background: var(--bg-raised);
      border: 1px solid var(--border-strong);
      border-radius: var(--radius-md);
      transition: all var(--transition-fast);
      cursor: pointer;
      margin-bottom: var(--space-3);
    }

    .auth-provider-btn:hover {
      background: var(--bg-hover);
      border-color: rgba(0,0,0,0.2);
    }

    /* ============================================
       TAB SYSTEM
       ============================================ */
    .tabs {
      display: flex;
      align-items: center;
      gap: var(--space-1);
      border-bottom: 1px solid var(--border);
      margin-bottom: var(--space-6);
    }

    .tab {
      position: relative;
      padding: var(--space-3) var(--space-4);
      font-size: 13px;
      font-weight: 500;
      color: var(--text-muted);
      cursor: pointer;
      transition: color var(--transition-fast);
      border-bottom: 2px solid transparent;
      margin-bottom: -1px;
    }

    .tab:hover {
      color: var(--text-secondary);
    }

    .tab.active {
      color: var(--text-primary);
      border-bottom-color: var(--accent);
    }

    .tab-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 18px;
      height: 18px;
      padding: 0 5px;
      font-size: 11px;
      font-weight: 600;
      background: var(--bg-active);
      color: var(--text-secondary);
      border-radius: var(--radius-full);
      margin-left: var(--space-2);
    }

    .tab-content { display: none; }
    .tab-content.active { display: block; }

    /* Pill tabs variant */
    .tabs-pill {
      display: flex;
      align-items: center;
      gap: var(--space-1);
      padding: var(--space-1);
      background: var(--bg-subtle);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      width: fit-content;
    }

    .tabs-pill .tab {
      padding: var(--space-2) var(--space-3);
      border-bottom: none;
      border-radius: var(--radius-sm);
      margin-bottom: 0;
    }

    .tabs-pill .tab.active {
      background: var(--bg-raised);
      color: var(--text-primary);
      box-shadow: var(--shadow-sm);
    }

    /* ============================================
       ANIMATIONS & TRANSITIONS
       ============================================ */
    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }

    @keyframes slide-up {
      from { opacity: 0; transform: translateY(12px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    @keyframes slide-down {
      from { opacity: 0; transform: translateY(-12px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    @keyframes slide-in-right {
      from { opacity: 0; transform: translateX(12px); }
      to   { opacity: 1; transform: translateX(0); }
    }

    @keyframes scale-in {
      from { opacity: 0; transform: scale(0.95); }
      to   { opacity: 1; transform: scale(1); }
    }

    @keyframes shimmer {
      0% { background-position: -200% 0; }
      100% { background-position: 200% 0; }
    }

    .animate-in { animation: slide-up 0.3s ease forwards; }
    .animate-fade { animation: fade-in 0.2s ease forwards; }
    .animate-spin { animation: spin 1s linear infinite; }
    .animate-pulse { animation: pulse 2s ease-in-out infinite; }

    .skeleton {
      background: linear-gradient(90deg, var(--bg-subtle) 25%, var(--bg-hover) 50%, var(--bg-subtle) 75%);
      background-size: 200% 100%;
      animation: shimmer 1.5s ease-in-out infinite;
      border-radius: var(--radius-md);
    }

    /* Staggered children */
    .stagger > * {
      opacity: 0;
      animation: slide-up 0.3s ease forwards;
    }
    .stagger > *:nth-child(1) { animation-delay: 0ms; }
    .stagger > *:nth-child(2) { animation-delay: 50ms; }
    .stagger > *:nth-child(3) { animation-delay: 100ms; }
    .stagger > *:nth-child(4) { animation-delay: 150ms; }
    .stagger > *:nth-child(5) { animation-delay: 200ms; }
    .stagger > *:nth-child(6) { animation-delay: 250ms; }

    /* ============================================
       CONNECTION STATE MACHINE STYLES
       ============================================ */
    .connection-badge {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
      padding: var(--space-1) var(--space-3);
      font-size: 12px;
      font-weight: 500;
      border-radius: var(--radius-full);
      transition: all var(--transition-base);
    }

    .connection-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .connection-badge[data-state="connected"] {
      background: var(--success-soft);
      color: var(--success);
    }
    .connection-badge[data-state="connected"] .connection-dot {
      background: var(--success);
      box-shadow: 0 0 6px var(--success);
    }

    .connection-badge[data-state="connecting"] {
      background: var(--warning-soft);
      color: var(--warning);
    }
    .connection-badge[data-state="connecting"] .connection-dot {
      background: var(--warning);
      animation: pulse 1.5s ease-in-out infinite;
    }

    .connection-badge[data-state="disconnected"] {
      background: var(--bg-active);
      color: var(--text-muted);
    }
    .connection-badge[data-state="disconnected"] .connection-dot {
      background: var(--text-muted);
    }

    .connection-badge[data-state="error"] {
      background: var(--error-soft);
      color: var(--error);
    }
    .connection-badge[data-state="error"] .connection-dot {
      background: var(--error);
    }

    /* ============================================
       LANDING PAGE / HERO STYLES
       ============================================ */
    .hero {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      padding: var(--space-20) 0 var(--space-16);
      max-width: 680px;
      margin: 0 auto;
    }

    .hero h1 {
      font-size: 56px;
      font-weight: 700;
      line-height: 1.05;
      letter-spacing: -0.035em;
      margin-bottom: var(--space-5);
      color: var(--text-primary);
    }

    .hero-actions {
      display: flex;
      align-items: center;
      gap: var(--space-3);
    }

    .hero-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: var(--space-4);
      margin-top: var(--space-16);
      width: 100%;
      max-width: 900px;
    }

    .hero-stat {
      text-align: center;
      padding: var(--space-6);
    }

    .hero-stat .stat-value {
      font-size: 36px;
      font-weight: 700;
      color: var(--text-primary);
      letter-spacing: -0.02em;
    }

    .hero-stat .stat-label {
      font-size: 13px;
      color: var(--text-muted);
      margin-top: var(--space-1);
    }

    /* Code showcase on landing */
    .code-showcase {
      width: 100%;
      max-width: 640px;
      margin: var(--space-12) auto 0;
      background: var(--bg-raised);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      overflow: hidden;
    }

    .code-showcase-header {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      padding: var(--space-3) var(--space-4);
      border-bottom: 1px solid var(--border);
    }

    .code-showcase-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: var(--bg-active);
    }

    .code-showcase pre {
      padding: var(--space-5);
      font-family: var(--font-mono);
      font-size: 13px;
      line-height: 1.7;
      color: var(--text-secondary);
      overflow-x: auto;
    }

    /* ============================================
       DASHBOARD STYLES
       ============================================ */
    .dashboard-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: var(--space-6);
    }

    .dashboard-header h1 {
      font-size: 22px;
      font-weight: 700;
      letter-spacing: -0.02em;
    }

    .dashboard-actions {
      display: flex;
      align-items: center;
      gap: var(--space-3);
    }

    .stats-row {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: var(--space-4);
      margin-bottom: var(--space-8);
    }

    .stat-card {
      background: var(--bg-raised);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      padding: var(--space-5);
    }

    .stat-card .stat-label {
      font-size: 12px;
      font-weight: 500;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: var(--space-2);
    }

    .stat-card .stat-value {
      font-size: 28px;
      font-weight: 700;
      color: var(--text-primary);
      letter-spacing: -0.02em;
    }

    .stat-card .stat-change {
      font-size: 12px;
      margin-top: var(--space-1);
    }

    .stat-card .stat-change.positive { color: var(--success); }
    .stat-card .stat-change.negative { color: var(--error); }

    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: var(--space-16) var(--space-8);
      color: var(--text-muted);
    }

    .empty-state svg {
      width: 48px;
      height: 48px;
      margin-bottom: var(--space-4);
      opacity: 0.4;
    }

    .empty-state h3 {
      font-size: 16px;
      font-weight: 600;
      color: var(--text-secondary);
      margin-bottom: var(--space-2);
    }

    .empty-state p {
      font-size: 14px;
      max-width: 360px;
      margin-bottom: var(--space-6);
    }

    /* ============================================
       APP DETAIL VIEW STYLES
       ============================================ */
    .app-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      margin-bottom: var(--space-6);
      gap: var(--space-4);
    }

    .app-header-left {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
    }

    .app-header h1 {
      font-size: 22px;
      font-weight: 700;
      letter-spacing: -0.02em;
      display: flex;
      align-items: center;
      gap: var(--space-3);
    }

    .app-header .app-slug {
      font-family: var(--font-mono);
      font-size: 13px;
      color: var(--text-muted);
    }

    .app-header-right {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      flex-shrink: 0;
    }

    .endpoint-display {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      padding: var(--space-2) var(--space-3);
      background: var(--bg-base);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      font-family: var(--font-mono);
      font-size: 12px;
      color: var(--text-secondary);
      cursor: pointer;
      transition: all var(--transition-fast);
    }

    .endpoint-display:hover {
      border-color: var(--border-strong);
      color: var(--text-primary);
    }

    .function-list {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
    }

    .function-card {
      background: var(--bg-raised);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      padding: var(--space-5);
      transition: border-color var(--transition-fast);
    }

    .function-card:hover {
      border-color: var(--border-strong);
    }

    .function-card .fn-name {
      font-family: var(--font-mono);
      font-size: 14px;
      font-weight: 600;
      color: var(--accent-text);
      margin-bottom: var(--space-2);
    }

    .function-card .fn-desc {
      font-size: 13px;
      color: var(--text-secondary);
      margin-bottom: var(--space-3);
      line-height: 1.5;
    }

    .function-card .fn-params {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
    }

    .param-tag {
      display: inline-flex;
      align-items: center;
      gap: var(--space-1);
      padding: 2px var(--space-2);
      font-family: var(--font-mono);
      font-size: 11px;
      color: var(--text-secondary);
      background: var(--bg-subtle);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
    }

    .param-tag .param-required {
      color: var(--warning);
    }

    /* Code editor area */
    .code-editor-wrapper {
      position: relative;
      background: var(--bg-base);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      overflow: hidden;
    }

    .code-editor-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: var(--space-3) var(--space-4);
      border-bottom: 1px solid var(--border);
      background: var(--bg-raised);
    }

    .code-editor-header .file-name {
      font-family: var(--font-mono);
      font-size: 12px;
      color: var(--text-secondary);
    }

    .code-editor textarea {
      width: 100%;
      min-height: 400px;
      padding: var(--space-4);
      font-family: var(--font-mono);
      font-size: 13px;
      line-height: 1.6;
      color: var(--text-primary);
      background: transparent;
      border: none;
      outline: none;
      resize: vertical;
      tab-size: 2;
    }

    /* ============================================
       PROFILE DROPDOWN STYLES
       ============================================ */
    .profile-trigger {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      padding: var(--space-1) var(--space-2);
      border-radius: var(--radius-md);
      cursor: pointer;
      transition: background var(--transition-fast);
    }

    .profile-trigger:hover {
      background: var(--bg-hover);
    }

    .profile-avatar {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: var(--accent-soft);
      color: var(--accent);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: 600;
      overflow: hidden;
    }

    .profile-avatar img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      border-radius: 50%;
    }

    .profile-dropdown {
      position: absolute;
      top: calc(100% + var(--space-2));
      right: 0;
      z-index: var(--z-dropdown);
      min-width: 220px;
      background: var(--bg-overlay);
      border: 1px solid var(--border-strong);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-lg);
      padding: var(--space-2);
      animation: slide-down 0.15s ease forwards;
    }

    .profile-dropdown { display: none; }
    .profile-dropdown.open { display: block; }

    .profile-dropdown-item {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      padding: var(--space-2) var(--space-3);
      font-size: 13px;
      color: var(--text-secondary);
      border-radius: var(--radius-sm);
      cursor: pointer;
      transition: all var(--transition-fast);
    }

    .profile-dropdown-item:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
    }

    .profile-dropdown-item.danger {
      color: var(--error);
    }

    .profile-dropdown-item.danger:hover {
      background: var(--error-soft);
    }

    .profile-dropdown-divider {
      height: 1px;
      background: var(--border);
      margin: var(--space-2) 0;
    }

    .profile-dropdown-header {
      padding: var(--space-2) var(--space-3);
      font-size: 12px;
      color: var(--text-muted);
      font-weight: 500;
    }

    /* ============================================
       CAPABILITIES SECTION
       ============================================ */
    .cap-section {
      max-width: 820px;
      margin: 0 auto;
      padding: var(--space-20) var(--space-6) 0;
    }

    .cap-section-heading {
      font-size: 20px;
      font-weight: 400;
      color: #999;
      letter-spacing: -0.01em;
      margin-bottom: var(--space-5);
    }

    .cap-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--space-5);
    }

    .cap-card {
      border: 1px solid var(--border);
      padding: var(--space-10);
      display: flex;
      flex-direction: column;
      min-width: 0;
      overflow: hidden;
    }

    .cap-card-icon {
      width: 40px;
      height: 40px;
      background: var(--text-primary);
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: var(--space-6);
    }

    .cap-card-title {
      font-size: 20px;
      font-weight: 600;
      letter-spacing: -0.02em;
      color: var(--text-primary);
      line-height: 1.3;
      margin-bottom: var(--space-3);
    }

    .cap-card-desc {
      font-size: 14px;
      color: var(--text-muted);
      line-height: 1.6;
      flex: 1;
    }

    .cap-card-visual {
      margin-top: var(--space-6);
    }

    /* Deploy flow */
    .cap-flow {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
    }

    .cap-flow-row {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      font-size: 13px;
    }

    .cap-flow-row code {
      font-family: var(--font-mono);
      font-weight: 600;
      font-size: 13px;
      color: var(--text-primary);
      background: var(--bg-active);
      padding: 2px 8px;
      border: 1px solid var(--border);
    }

    .cap-flow-row .arrow {
      color: var(--text-muted);
    }

    .cap-flow-row .result {
      color: var(--text-muted);
    }

    /* Agent carousel */
    .cap-carousel {
      overflow: hidden;
      mask-image: linear-gradient(to right, transparent, black 5%, black 95%, transparent);
      -webkit-mask-image: linear-gradient(to right, transparent, black 5%, black 95%, transparent);
    }

    .cap-carousel-inner {
      display: flex;
      gap: var(--space-3);
      animation: cap-scroll 18s linear infinite;
      width: max-content;
    }

    .cap-carousel-inner span {
      font-size: 12px;
      font-weight: 500;
      color: var(--text-secondary);
      white-space: nowrap;
      padding: 6px 14px;
      border: 1px solid var(--border);
      background: var(--bg-raised);
    }

    @keyframes cap-scroll {
      0% { transform: translateX(0); }
      100% { transform: translateX(-50%); }
    }

    /* Portable pills */
    .cap-pills {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
    }

    .cap-pills span {
      font-size: 12px;
      font-weight: 500;
      color: var(--text-secondary);
      padding: 6px 14px;
      background: var(--bg-active);
      border: 1px solid var(--border);
    }

    /* ============================================
       SCROLLBAR STYLES
       ============================================ */
    ::-webkit-scrollbar {
      width: 6px;
      height: 6px;
    }

    ::-webkit-scrollbar-track {
      background: transparent;
    }

    ::-webkit-scrollbar-thumb {
      background: rgba(0,0,0,0.15);
      border-radius: 3px;
    }

    ::-webkit-scrollbar-thumb:hover {
      background: rgba(0,0,0,0.25);
    }

    /* Firefox */
    * {
      scrollbar-width: thin;
      scrollbar-color: rgba(0,0,0,0.15) transparent;
    }

    /* ============================================
       RESPONSIVE BREAKPOINTS
       ============================================ */
    @media (max-width: 1024px) {
      .app-grid {
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      }

      .hero h1 {
        font-size: 44px;
      }

      .hero-grid {
        grid-template-columns: repeat(2, 1fr);
      }
    }

    @media (max-width: 768px) {
      :root {
        --nav-height: 52px;
      }

      .top-nav {
        padding: 0 var(--space-4);
      }

      .nav-links {
        display: none;
      }

      .main-content {
        padding: var(--space-5) var(--space-4);
      }

      .hero {
        padding: var(--space-12) 0 var(--space-8);
      }

      .hero h1 {
        font-size: 34px;
      }

      .hero p {
        font-size: 16px;
      }

      .hero-grid {
        grid-template-columns: 1fr;
        gap: var(--space-3);
      }

      .hero-actions {
        flex-direction: column;
        width: 100%;
      }

      .hero-actions .btn {
        width: 100%;
      }

      .cap-grid {
        grid-template-columns: 1fr;
      }

      .cap-card {
        margin-left: 0;
      }

      .app-grid {
        grid-template-columns: 1fr;
      }

      .app-header {
        flex-direction: column;
      }

      .app-header-right {
        width: 100%;
        flex-wrap: wrap;
      }

      .stats-row {
        grid-template-columns: 1fr 1fr;
      }

      .dashboard-header {
        flex-direction: column;
        align-items: flex-start;
        gap: var(--space-3);
      }

      .modal {
        max-width: 100%;
        border-radius: var(--radius-lg);
      }

      .toast-container {
        left: var(--space-4);
        right: var(--space-4);
        bottom: var(--space-4);
      }

      .toast {
        min-width: unset;
        max-width: 100%;
      }
    }

    @media (max-width: 480px) {
      .hero h1 {
        font-size: 28px;
      }

      .stats-row {
        grid-template-columns: 1fr;
      }

      .text-display {
        font-size: 32px;
      }

      .auth-card {
        padding: var(--space-8) var(--space-5);
      }
    }

    /* ============================================
       UTILITY CLASSES
       ============================================ */
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0,0,0,0);
      border: 0;
    }

    .truncate {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .flex { display: flex; }
    .flex-col { flex-direction: column; }
    .items-center { align-items: center; }
    .justify-between { justify-content: space-between; }
    .gap-1 { gap: var(--space-1); }
    .gap-2 { gap: var(--space-2); }
    .gap-3 { gap: var(--space-3); }
    .gap-4 { gap: var(--space-4); }
    .gap-6 { gap: var(--space-6); }
    .gap-8 { gap: var(--space-8); }
    .w-full { width: 100%; }
    .relative { position: relative; }
    .hidden { display: none !important; }
  </style>
  </head>
  <body>

  <!-- ============================================
       TOAST CONTAINER
       ============================================ -->
  <div id="toast-container" class="toast-container"></div>

  <!-- ============================================
       AUTH POPUP OVERLAY
       ============================================ -->
  <div id="authOverlay" class="auth-overlay hidden">
    <div class="auth-card">
      <button id="authCloseBtn" onclick="document.getElementById('authOverlay').classList.add('hidden')" style="position:absolute;top:16px;right:16px;background:none;border:none;color:var(--text-muted);cursor:pointer;padding:8px;font-size:20px;line-height:1;border-radius:var(--radius-sm);transition:background var(--transition-fast);" onmouseover="this.style.background='var(--bg-hover)'" onmouseout="this.style.background='none'" aria-label="Close">&times;</button>
      <div style="display:flex;justify-content:center;margin-bottom:var(--space-6);">
        <svg width="48" height="48" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="authLogoGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stop-color="#0a0a0a"/>
              <stop offset="100%" stop-color="#333333"/>
            </linearGradient>
          </defs>
          <path d="M6 4 L6 22 Q6 28 12 28 L12 28 L12 4 L17 4 L17 28 Q17 28 20 28 Q26 28 26 22 L26 4 L21 4 L21 22 Q21 24 20 24 L12 24 Q10.5 24 10.5 22 L10.5 4 Z" fill="url(#authLogoGrad)"/>
        </svg>
      </div>
      <h2 style="text-align:center;color:var(--text-primary);font-size:20px;">Log in to give your agent superpowers</h2>
      <div style="margin-bottom:var(--space-6);"></div>
      <button id="googleAuthBtn" class="auth-provider-btn" onclick="window.open('/auth/login?return_to=' + encodeURIComponent('/?popup=1'), 'ultralight-auth', 'width=500,height=700,menubar=no,toolbar=no'); document.getElementById('authOverlay').classList.add('hidden');">
        <svg width="18" height="18" viewBox="0 0 24 24">
          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
        </svg>
        Continue with Google
      </button>
      <p style="font-size:11px;color:var(--text-muted);text-align:center;margin-top:var(--space-4);line-height:1.5;">
        By continuing, you agree to our
        <a href="/terms" style="color:var(--text-secondary);text-decoration:underline;">Terms</a> and
        <a href="/privacy" style="color:var(--text-secondary);text-decoration:underline;">Privacy Policy</a>.
      </p>
    </div>
  </div>

  <!-- ============================================
       TOP NAVIGATION BAR
       ============================================ -->
  <nav class="top-nav">
    <div class="nav-left">
      <a href="/" id="navLogoLink" class="nav-logo" style="text-decoration:none;font-size:20px;">
        Ultralight
      </a>
    </div>
    <div class="nav-right">
      <!-- Pre-auth nav items -->
      <div id="navPreAuth" style="display:flex;align-items:center;gap:var(--space-2);">
        <button id="navAuthBtn" class="btn btn-primary" style="border-radius:0;height:36px;padding:0 var(--space-5);font-size:14px;" onclick="document.getElementById('authOverlay').classList.remove('hidden')">Dashboard</button>
      </div>
      <!-- Post-auth nav items (hidden by default) -->
      <div id="navPostAuth" class="hidden flex items-center gap-3">
        <div class="relative">
          <div id="profileTrigger" class="profile-trigger">
            <div id="profileAvatar" class="profile-avatar">U</div>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
          </div>
          <div id="profileDropdown" class="profile-dropdown">
            <div id="profileDropdownHeader" class="profile-dropdown-header"><span id="profileEmail" style="font-size:12px;color:var(--text-muted);display:block;margin-top:2px;"></span></div>
            <div class="profile-dropdown-item" data-action="settings">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
              Settings
            </div>
            <div class="profile-dropdown-item" data-action="tokens">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
              API Tokens
            </div>
            <div class="profile-dropdown-item" data-action="billing">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
              Billing
            </div>
            <div class="profile-dropdown-item" data-action="supabase">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>
              Supabase
            </div>
            <div class="profile-dropdown-divider"></div>
            <div class="profile-dropdown-item danger" data-action="signout">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
              Sign Out
            </div>
          </div>
        </div>
      </div>
    </div>
  </nav>

  <!-- ============================================
       MAIN CONTENT AREA
       ============================================ -->
  <main class="main-content">

    <!-- ==========================================
         HOME / LANDING VIEW
         ========================================== -->
    <div id="homeView">
      <section class="hero">
        <h1>Give your agent<br>superpowers</h1>
        <p style="font-size:11px;font-weight:600;color:var(--text-secondary);margin-top:var(--space-8);margin-bottom:0;letter-spacing:0.08em;text-transform:uppercase;">Just paste and go</p>
        <div class="hero-actions" style="margin-top:var(--space-4);">
          <button id="heroCTA" class="btn btn-primary btn-lg" style="gap:var(--space-2);border-radius:0;" onclick="document.getElementById('authOverlay').classList.remove('hidden')">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
            <span id="heroCTAText">Copy agent instructions</span>
          </button>
        </div>
      </section>

      <!-- Setup Instructions Block (hidden until authenticated) -->
      <div id="setupBlock" class="setup-block" style="display:none;max-width:640px;margin:var(--space-8) auto 0;background:var(--bg-raised);border:1px solid var(--border-strong);border-radius:var(--radius-lg);padding:var(--space-5);overflow:hidden;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-3);">
          <span style="font-size:13px;font-weight:500;color:var(--text-secondary);">Paste this into your agent:</span>
          <button id="setupCopyBtn" class="btn btn-ghost btn-sm" style="font-size:12px;">Copy</button>
        </div>
        <pre id="setupCode" style="background:var(--bg-base);border:1px solid var(--border);border-radius:var(--radius-md);padding:var(--space-4);font-family:var(--font-mono);font-size:13px;line-height:1.6;color:var(--text-secondary);overflow-x:auto;white-space:pre-wrap;word-break:break-all;"></pre>
        <div id="connectionStatus" style="margin-top:var(--space-3);font-size:12px;color:var(--text-muted);"></div>
      </div>

      <!-- Section 1: Your personal super app -->
      <section class="cap-section">
        <div class="cap-section-heading">Your personal super app</div>
        <div class="cap-grid">
          <!-- Works with any agent -->
          <div class="cap-card">
            <div class="cap-card-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>
            </div>
            <div class="cap-card-title">Works with any agent</div>
            <div class="cap-card-desc">One standard, every agent. No vendor lock-in.</div>
            <div class="cap-card-visual">
              <div class="cap-carousel">
                <div class="cap-carousel-inner">
                  <span>OpenClaw</span>
                  <span>Claude Code</span>
                  <span>Codex</span>
                  <span>Cursor</span>
                  <span>Perplexity Computer</span>
                  <span>Kimi Code</span>
                  <span>OpenClaw</span>
                  <span>Claude Code</span>
                  <span>Codex</span>
                  <span>Cursor</span>
                  <span>Perplexity Computer</span>
                  <span>Kimi Code</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Free instant deployments -->
          <div class="cap-card">
            <div class="cap-card-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
            </div>
            <div class="cap-card-title">Free instant deployments</div>
            <div class="cap-card-desc">Ship to production in one command. No config, no Docker, no waiting.</div>
            <div class="cap-card-visual">
              <div class="cap-flow">
                <div class="cap-flow-row">
                  <code>.md</code>
                  <span class="arrow">→</span>
                  <span class="result">live url</span>
                </div>
                <div class="cap-flow-row">
                  <code>.ts</code>
                  <span class="arrow">→</span>
                  <span class="result">live mcp server</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Take everything with you -->
          <div class="cap-card">
            <div class="cap-card-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            </div>
            <div class="cap-card-title">Take everything with you</div>
            <div class="cap-card-desc">Switch agents without starting over. Your apps, skills, and memories follow you everywhere.</div>
            <div class="cap-card-visual">
              <div class="cap-pills">
                <span>Custom apps</span>
                <span>Skills</span>
                <span>Memories</span>
              </div>
            </div>
          </div>

          <!-- Granular permissions -->
          <div class="cap-card">
            <div class="cap-card-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
            </div>
            <div class="cap-card-title">Granular permissions</div>
            <div class="cap-card-desc">Per-function access control with IP allowlists, time windows, budget constraints, and argument whitelisting.</div>
          </div>
        </div>
      </section>

      <!-- Section 2: Agent app store -->
      <section class="cap-section" style="padding-top:var(--space-16);">
        <div class="cap-section-heading">Agent app store</div>
        <div class="cap-grid">
          <!-- One connection -->
          <div class="cap-card">
            <div class="cap-card-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>
            </div>
            <div class="cap-card-title">One connection, infinite possibilities</div>
            <div class="cap-card-desc">All Ultralight agents inherit every published app and skill. Add Ultralight once and extend its capabilities forever.</div>
          </div>

          <!-- Publish and monetize -->
          <div class="cap-card">
            <div class="cap-card-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>
            </div>
            <div class="cap-card-title">Publish and charge per call</div>
            <div class="cap-card-desc">Extend the capabilities of all Ultralight-connected agents and set per-function pricing with micropayments.</div>
          </div>

          <!-- One auth for everything -->
          <div class="cap-card">
            <div class="cap-card-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>
            </div>
            <div class="cap-card-title">One auth for everything</div>
            <div class="cap-card-desc">A single token connects your agent to every app in the ecosystem. No per-app API keys, no OAuth flows per service.</div>
          </div>

          <!-- One payment for everything -->
          <div class="cap-card">
            <div class="cap-card-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
            </div>
            <div class="cap-card-title">One payment for everything</div>
            <div class="cap-card-desc">A single prepaid balance covers every app your agent uses. No separate subscriptions, no surprise bills.</div>
          </div>
        </div>
      </section>

      <!-- Closing CTA -->
      <section style="max-width:820px;margin:0 auto;padding:var(--space-20) var(--space-6);text-align:center;">
        <h2 style="font-size:32px;font-weight:700;letter-spacing:-0.035em;line-height:1.15;color:var(--text-primary);margin-bottom:var(--space-4);">Give your agent superpowers.</h2>
        <p style="font-size:11px;font-weight:600;color:var(--text-secondary);letter-spacing:0.08em;text-transform:uppercase;margin-bottom:var(--space-4);">Ready to start building?</p>
        <div style="display:flex;justify-content:center;">
          <button class="btn btn-primary btn-lg" style="gap:var(--space-2);border-radius:0;" onclick="document.getElementById('authOverlay').classList.remove('hidden')">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
            <span>Copy agent instructions</span>
          </button>
        </div>
      </section>

      <!-- Footer -->
      <footer style="max-width:820px;margin:0 auto;padding:var(--space-8) var(--space-6);border-top:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;font-size:12px;color:var(--text-muted);">
        <span>&copy; 2026 Ultralight</span>
        <div style="display:flex;gap:var(--space-4);">
          <a href="https://www.npmjs.com/package/ultralightpro" target="_blank" style="color:var(--text-muted);transition:color 0.15s;" onmouseover="this.style.color='var(--text-secondary)'" onmouseout="this.style.color='var(--text-muted)'">SDK Reference</a>
          <a href="https://www.npmjs.com/package/ultralightpro" target="_blank" style="color:var(--text-muted);transition:color 0.15s;" onmouseover="this.style.color='var(--text-secondary)'" onmouseout="this.style.color='var(--text-muted)'">CLI Tool</a>
          <a href="/api" style="color:var(--text-muted);transition:color 0.15s;" onmouseover="this.style.color='var(--text-secondary)'" onmouseout="this.style.color='var(--text-muted)'">API / MCP</a>
        </div>
      </footer>
    </div>

    <!-- ==========================================
         DASHBOARD VIEW
         ========================================== -->
    <div id="dashboardView" style="display:none;">
      <div class="dashboard-header">
        <h1>Your Apps</h1>
        <div class="dashboard-actions" style="display:flex;align-items:center;gap:var(--space-3);">
          <button id="dashSetupBtn" class="btn btn-ghost btn-sm" title="Setup instructions">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
            Setup
          </button>
          <button id="newAppBtn" class="btn btn-primary btn-sm" onclick="generateSetupInstructions()">+ New App</button>
        </div>
      </div>

      <!-- Dashboard Setup Block (expandable) -->
      <div id="dashSetupBlock" class="hidden" style="background:var(--bg-raised);border:1px solid var(--border);border-radius:var(--radius-lg);padding:var(--space-4);margin-bottom:var(--space-6);">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-3);">
          <span style="font-size:13px;font-weight:500;color:var(--text-secondary);">Setup Instructions</span>
          <button id="copyDashSetup" class="btn btn-ghost btn-sm" style="font-size:12px;">Copy</button>
        </div>
        <pre id="dashSetupText" style="background:var(--bg-base);border:1px solid var(--border);border-radius:var(--radius-md);padding:var(--space-3);font-family:var(--font-mono);font-size:12px;color:var(--text-secondary);white-space:pre-wrap;word-break:break-all;"></pre>
      </div>

      <!-- Dashboard Stats -->
      <div id="dashStats" class="stats-row">
        <div class="stat-card">
          <div class="stat-label">Total Apps</div>
          <div class="stat-value" id="statTotalApps">-</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Total Calls</div>
          <div class="stat-value" id="statTotalCalls">-</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Status</div>
          <div class="stat-value" id="statStatus" style="color:var(--success);">Operational</div>
        </div>
      </div>

      <!-- App Grid -->
      <div id="appGrid" class="app-grid"></div>

      <!-- Activity Feed -->
      <section id="activityFeed" style="margin-top:var(--space-8);">
        <h2 style="font-size:16px;font-weight:600;margin-bottom:var(--space-4);color:var(--text-primary);">Recent Activity</h2>
        <div id="activityList" style="display:flex;flex-direction:column;gap:var(--space-2);"></div>
      </section>
    </div>

    <!-- ==========================================
         APP DETAIL VIEW
         ========================================== -->
    <div id="appView" style="display:none;">
      <!-- Back to Dashboard -->
      <button id="appBackBtn" class="btn btn-ghost btn-sm" style="margin-bottom:var(--space-4);gap:var(--space-2);display:inline-flex;align-items:center;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        Back to Dashboard
      </button>

      <!-- App Header -->
      <div class="app-header">
        <div class="app-header-left">
          <h1 id="appDetailName">App Name</h1>
          <div style="display:flex;align-items:center;gap:var(--space-3);margin-top:var(--space-2);">
            <span id="appDetailVersion" style="font-size:12px;padding:2px 8px;background:var(--accent-soft);color:var(--accent);border-radius:var(--radius-full);font-weight:500;">v1.0.0</span>
            <span id="appDetailStatus" style="font-size:12px;padding:2px 8px;background:rgba(52,211,153,0.1);color:var(--success);border-radius:var(--radius-full);font-weight:500;">Active</span>
          </div>
          <div style="display:flex;align-items:center;gap:var(--space-2);margin-top:var(--space-3);">
            <span style="font-size:12px;color:var(--text-muted);">MCP Endpoint:</span>
            <code id="appDetailEndpoint" style="font-size:12px;font-family:var(--font-mono);color:var(--text-secondary);background:var(--bg-active);padding:2px 8px;border-radius:var(--radius-sm);"></code>
            <button id="appEndpointCopy" class="btn btn-ghost btn-sm" style="padding:2px 6px;font-size:11px;" onclick="copyAppEndpoint()">Copy</button>
          </div>
        </div>
        <div class="app-header-right">
          <button id="appEditBtn" class="btn btn-ghost btn-sm">Edit Code</button>
          <button id="appDeleteBtn" class="btn btn-danger btn-sm">Delete</button>
        </div>
      </div>

      <!-- Tab Bar -->
      <div class="tabs" style="margin-top:var(--space-6);">
        <button class="tab active" data-tab="overview">Overview</button>
        <button class="tab" data-tab="settings">Settings</button>
        <button class="tab" data-tab="logs">Logs</button>
        <button class="tab" data-tab="business">Business</button>
      </div>

      <!-- Tab Content: Overview -->
      <div id="appOverview" class="tab-content active" data-tab-content="overview">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-6);">
          <!-- Functions List -->
          <div>
            <h3 style="font-size:14px;font-weight:600;margin-bottom:var(--space-4);color:var(--text-primary);">Functions</h3>
            <div id="appFunctionsList" style="display:flex;flex-direction:column;gap:var(--space-2);"></div>
          </div>
          <!-- Health / Recent Calls -->
          <div>
            <h3 style="font-size:14px;font-weight:600;margin-bottom:var(--space-4);color:var(--text-primary);">Health</h3>
            <div id="appHealthSummary" style="background:var(--bg-raised);border:1px solid var(--border);border-radius:var(--radius-lg);padding:var(--space-4);font-size:13px;color:var(--text-secondary);line-height:1.6;">Loading...</div>
            <h3 style="font-size:14px;font-weight:600;margin-top:var(--space-6);margin-bottom:var(--space-4);color:var(--text-primary);">Recent Calls</h3>
            <div id="appRecentCalls" style="display:flex;flex-direction:column;gap:var(--space-2);"></div>
          </div>
        </div>
      </div>

      <!-- Tab Content: Settings -->
      <div id="appSettings" class="tab-content" data-tab-content="settings">
        <!-- General Settings -->
        <details open style="margin-bottom:var(--space-4);">
          <summary style="font-size:14px;font-weight:600;color:var(--text-primary);cursor:pointer;padding:var(--space-3) 0;border-bottom:1px solid var(--border);">General</summary>
          <div id="appSettingsGeneral" style="padding:var(--space-4) 0;">
            <div style="display:flex;flex-direction:column;gap:var(--space-4);">
              <div>
                <label style="font-size:12px;font-weight:500;color:var(--text-secondary);display:block;margin-bottom:var(--space-2);">App Name</label>
                <input id="settingAppName" type="text" class="input" placeholder="My App">
              </div>
              <div>
                <label style="font-size:12px;font-weight:500;color:var(--text-secondary);display:block;margin-bottom:var(--space-2);">Description</label>
                <textarea id="settingAppDesc" class="input" rows="3" placeholder="What does this app do?" style="resize:vertical;"></textarea>
              </div>
              <button id="settingSaveGeneral" class="btn btn-primary btn-sm" style="align-self:flex-start;">Save Changes</button>
            </div>
          </div>
        </details>

        <!-- Permissions -->
        <details style="margin-bottom:var(--space-4);">
          <summary style="font-size:14px;font-weight:600;color:var(--text-primary);cursor:pointer;padding:var(--space-3) 0;border-bottom:1px solid var(--border);">Permissions</summary>
          <div id="appSettingsPermissions" style="padding:var(--space-4) 0;">
            <p style="font-size:13px;color:var(--text-muted);margin-bottom:var(--space-4);">Control who can call your functions. Apps are private by default.</p>
            <button id="managePermissionsBtn" class="btn btn-ghost btn-sm">Manage Permissions</button>
          </div>
        </details>

        <!-- Database -->
        <details style="margin-bottom:var(--space-4);">
          <summary style="font-size:14px;font-weight:600;color:var(--text-primary);cursor:pointer;padding:var(--space-3) 0;border-bottom:1px solid var(--border);">Database</summary>
          <div id="appSettingsDatabase" style="padding:var(--space-4) 0;">
            <p style="font-size:13px;color:var(--text-muted);margin-bottom:var(--space-4);">Built-in KV store is available to all apps. Pro users can connect a Supabase database.</p>
            <div id="dbConnectionStatus" style="font-size:12px;color:var(--text-muted);">Not connected</div>
          </div>
        </details>

        <!-- Environment Variables -->
        <details style="margin-bottom:var(--space-4);">
          <summary style="font-size:14px;font-weight:600;color:var(--text-primary);cursor:pointer;padding:var(--space-3) 0;border-bottom:1px solid var(--border);">Environment Variables</summary>
          <div id="appSettingsEnv" style="padding:var(--space-4) 0;">
            <p style="font-size:13px;color:var(--text-muted);margin-bottom:var(--space-4);">Set environment variables accessible via the Ultralight SDK.</p>
            <div id="envVarsList" style="display:flex;flex-direction:column;gap:var(--space-2);"></div>
          </div>
        </details>
      </div>

      <!-- Tab Content: Logs -->
      <div id="appLogs" class="tab-content" data-tab-content="logs">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-4);">
          <h3 style="font-size:14px;font-weight:600;color:var(--text-primary);">Call Log</h3>
          <button id="refreshLogsBtn" class="btn btn-ghost btn-sm">Refresh</button>
        </div>
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:13px;">
            <thead>
              <tr style="border-bottom:1px solid var(--border);">
                <th style="text-align:left;padding:var(--space-3) var(--space-4);color:var(--text-muted);font-weight:500;font-size:12px;">Time</th>
                <th style="text-align:left;padding:var(--space-3) var(--space-4);color:var(--text-muted);font-weight:500;font-size:12px;">Function</th>
                <th style="text-align:left;padding:var(--space-3) var(--space-4);color:var(--text-muted);font-weight:500;font-size:12px;">Status</th>
                <th style="text-align:left;padding:var(--space-3) var(--space-4);color:var(--text-muted);font-weight:500;font-size:12px;">Duration</th>
                <th style="text-align:left;padding:var(--space-3) var(--space-4);color:var(--text-muted);font-weight:500;font-size:12px;">Caller</th>
              </tr>
            </thead>
            <tbody id="logsTableBody"></tbody>
          </table>
        </div>
        <div id="logsEmpty" style="text-align:center;padding:var(--space-8);color:var(--text-muted);font-size:13px;">No calls recorded yet.</div>
      </div>

      <!-- Tab Content: Business -->
      <div id="appBusiness" class="tab-content" data-tab-content="business">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-6);">
          <div>
            <h3 style="font-size:14px;font-weight:600;margin-bottom:var(--space-4);color:var(--text-primary);">Pricing Configuration</h3>
            <div style="background:var(--bg-raised);border:1px solid var(--border);border-radius:var(--radius-lg);padding:var(--space-5);">
              <div style="margin-bottom:var(--space-4);">
                <label style="font-size:12px;font-weight:500;color:var(--text-secondary);display:block;margin-bottom:var(--space-2);">Price per call (USD)</label>
                <input id="appPriceInput" type="number" class="input" placeholder="0.00" step="0.001" min="0">
              </div>
              <button id="savePricingBtn" class="btn btn-primary btn-sm">Save Pricing</button>
            </div>
          </div>
          <div>
            <h3 style="font-size:14px;font-weight:600;margin-bottom:var(--space-4);color:var(--text-primary);">Revenue</h3>
            <div id="appRevenueSummary" style="background:var(--bg-raised);border:1px solid var(--border);border-radius:var(--radius-lg);padding:var(--space-5);">
              <div style="font-size:24px;font-weight:700;color:var(--text-primary);margin-bottom:var(--space-2);" id="revenueTotal">$0.00</div>
              <div style="font-size:12px;color:var(--text-muted);">Total earned from paid calls</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ==========================================
         ACCOUNT SETTINGS VIEW
         ========================================== -->
    <div id="accountView" style="display:none;">
      <button id="accountBackBtn" class="btn btn-ghost btn-sm" style="margin-bottom:var(--space-4);gap:var(--space-2);display:inline-flex;align-items:center;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        Back
      </button>
      <h1 style="font-size:22px;font-weight:700;margin-bottom:var(--space-8);letter-spacing:-0.02em;">Account Settings</h1>

      <!-- API Tokens Section -->
      <section style="margin-bottom:var(--space-8);">
        <h2 style="font-size:16px;font-weight:600;margin-bottom:var(--space-4);color:var(--text-primary);">API Tokens</h2>
        <p style="font-size:13px;color:var(--text-muted);margin-bottom:var(--space-4);">Manage your API tokens for CLI authentication and programmatic access.</p>
        <div id="tokensList" style="display:flex;flex-direction:column;gap:var(--space-2);margin-bottom:var(--space-4);"></div>
        <button id="createTokenBtn" class="btn btn-primary btn-sm">Create New Token</button>
      </section>

      <!-- Billing Section -->
      <section style="margin-bottom:var(--space-8);">
        <h2 style="font-size:16px;font-weight:600;margin-bottom:var(--space-4);color:var(--text-primary);">Billing &amp; Balance</h2>
        <div style="background:var(--bg-raised);border:1px solid var(--border);border-radius:var(--radius-lg);padding:var(--space-5);">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-4);">
            <div>
              <div style="font-size:12px;color:var(--text-muted);margin-bottom:var(--space-1);">Current Balance</div>
              <div id="accountBalance" style="font-size:28px;font-weight:700;color:var(--text-primary);">$0.00</div>
            </div>
            <button id="addFundsBtn" class="btn btn-primary btn-sm">Add Funds</button>
          </div>
          <div id="billingHistory" style="font-size:13px;color:var(--text-muted);">No billing history.</div>
        </div>
      </section>

      <!-- Supabase Servers Section -->
      <section style="margin-bottom:var(--space-8);">
        <h2 style="font-size:16px;font-weight:600;margin-bottom:var(--space-4);color:var(--text-primary);">Supabase Servers</h2>
        <p style="font-size:13px;color:var(--text-muted);margin-bottom:var(--space-4);">Connect Supabase databases to enable SQL queries from your apps.</p>
        <div id="supabaseServersList" style="display:flex;flex-direction:column;gap:var(--space-2);margin-bottom:var(--space-4);"></div>
        <button id="addSupabaseBtn" class="btn btn-ghost btn-sm">+ Add Supabase Server</button>
      </section>
    </div>

  <!-- ============================================
       MODALS
       ============================================ -->

  <!-- Delete Confirmation Modal -->
  <div id="deleteConfirmModal" class="modal-backdrop hidden">
    <div class="modal" style="max-width:420px;">
      <div class="modal-header">
        <h2>Delete App</h2>
        <button class="modal-close" onclick="document.getElementById('deleteConfirmModal').classList.add('hidden')" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:18px;">&times;</button>
      </div>
      <div class="modal-body">
        <p style="font-size:14px;color:var(--text-secondary);line-height:1.6;">Are you sure you want to delete this app? This action cannot be undone. All data, call history, and permissions will be permanently removed.</p>
      </div>
      <div class="modal-footer">
        <button id="deleteCancel" class="btn btn-ghost btn-sm" onclick="document.getElementById('deleteConfirmModal').classList.add('hidden')">Cancel</button>
        <button id="deleteConfirm" class="btn btn-danger btn-sm">Delete Permanently</button>
      </div>
    </div>
  </div>

  <!-- Skills Editor Modal -->
  <div id="skillsModal" class="modal-backdrop hidden">
    <div class="modal" style="max-width:640px;">
      <div class="modal-header">
        <h2>Edit Skills.md</h2>
        <button class="modal-close" onclick="document.getElementById('skillsModal').classList.add('hidden')" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:18px;">&times;</button>
      </div>
      <div class="modal-body">
        <p style="font-size:13px;color:var(--text-muted);margin-bottom:var(--space-3);">Describe your app's capabilities for agent discovery. Markdown supported.</p>
        <textarea id="skillsEditor" style="width:100%;min-height:300px;background:var(--bg-base);border:1px solid var(--border);border-radius:var(--radius-md);padding:var(--space-4);font-family:var(--font-mono);font-size:13px;line-height:1.6;color:var(--text-primary);resize:vertical;" placeholder="# My App\n\nDescribe what this app does..."></textarea>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost btn-sm" onclick="document.getElementById('skillsModal').classList.add('hidden')">Cancel</button>
        <button id="skillsSave" class="btn btn-primary btn-sm">Save Skills</button>
      </div>
    </div>
  </div>

  <!-- Permissions Modal -->
  <div id="permissionsModal" class="modal-backdrop hidden">
    <div class="modal" style="max-width:600px;">
      <div class="modal-header">
        <h2>Manage Permissions</h2>
        <button class="modal-close" onclick="document.getElementById('permissionsModal').classList.add('hidden')" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:18px;">&times;</button>
      </div>
      <div class="modal-body">
        <p style="font-size:13px;color:var(--text-muted);margin-bottom:var(--space-4);">Grant access to specific users and control which functions they can call.</p>
        <div id="permissionsList" style="display:flex;flex-direction:column;gap:var(--space-3);margin-bottom:var(--space-4);"></div>
        <div style="display:flex;gap:var(--space-2);">
          <input id="permissionEmail" type="email" class="input" placeholder="user@example.com" style="flex:1;">
          <button id="grantPermissionBtn" class="btn btn-primary btn-sm">Grant Access</button>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost btn-sm" onclick="document.getElementById('permissionsModal').classList.add('hidden')">Done</button>
      </div>
    </div>
  </div>

  </main>


  <script>
  (async function() {
    'use strict';

    // ===== Global State =====
    let authToken = localStorage.getItem('ultralight_token');
    let currentUser = null;
    let userProfile = null;
    let apps = [];
    let currentAppId = null;
    let currentView = '${initialView}';
    let setupCommandStr = '';
    let newlyCreatedTokenId = null;
    let connectionPollInterval = null;
    let currentEnvVars = {};
    let pendingEnvVarChanges = {};
    let appSupabaseChanged = false;
    let savedSupabaseServers = null;
    let permsGrantedUsers = [];
    let permsSelectedUserId = null;
    let currentTokens = [];
    let byokData = null;
    let draftFiles = [];
    let skillsValidationTimeout = null;

    // ===== Utilities =====
    function escapeHtml(str) {
      if (!str) return '';
      return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }
    const escHtml = escapeHtml;

    function relTime(d) {
      const ms = Date.now() - new Date(d).getTime();
      const m = Math.floor(ms / 60000);
      if (m < 1) return 'just now';
      if (m < 60) return m + 'm ago';
      const h = Math.floor(m / 60);
      if (h < 24) return h + 'h ago';
      const dy = Math.floor(h / 24);
      if (dy < 30) return dy + 'd ago';
      return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }

    function formatBytes(bytes) {
      if (!bytes || bytes === 0) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    function getAppEmoji(name) {
      const emojis = ['⚡','🔧','📡','🎯','🚀','💎','🔮','🎨','🌊','🔥','✨','🛠️','📦','🎪','🌟'];
      let hash = 0;
      for (let i = 0; i < (name || '').length; i++) hash = ((hash << 5) - hash) + name.charCodeAt(i);
      return emojis[Math.abs(hash) % emojis.length];
    }

    function decodeJWT(token) {
      try {
        const payload = token.split('.')[1];
        return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
      } catch { return null; }
    }

    // ===== Toast Notifications =====
    function showToast(message, type = 'success') {
      const container = document.getElementById('toast-container');
      const toast = document.createElement('div');
      toast.className = 'toast toast-' + type;
      toast.textContent = message;
      container.appendChild(toast);
      requestAnimationFrame(() => toast.classList.add('toast-visible'));
      setTimeout(() => {
        toast.classList.remove('toast-visible');
        setTimeout(() => toast.remove(), 300);
      }, 3000);
    }

    // ===== Authentication =====
    function showAuthOverlay() {
      document.getElementById('authOverlay').classList.remove('hidden');
    }
    function hideAuthOverlay() {
      document.getElementById('authOverlay').classList.add('hidden');
    }
    window.showAuthOverlay = showAuthOverlay;
    window.hideAuthOverlay = hideAuthOverlay;

    // Hero CTA — override onclick when authed to copy instructions instead of showing auth
    function setupHeroCTA() {
      var btn = document.getElementById('heroCTA');
      if (!btn) return;
      if (authToken) {
        btn.onclick = async function(e) {
          e.preventDefault();
          await generateSetupInstructions();
          if (setupCommandStr) {
            try {
              await navigator.clipboard.writeText(setupCommandStr);
              var textEl = document.getElementById('heroCTAText');
              if (textEl) {
                textEl.textContent = 'Copied! Now paste into your agent';
                btn.style.background = 'var(--success)';
                setTimeout(function() {
                  textEl.textContent = 'Copy agent instructions';
                  btn.style.background = '';
                }, 3000);
              }
            } catch(e2) {
              showToast('Failed to copy', 'error');
            }
          }
        };
      }
      // If not authed, the inline onclick already opens auth overlay
    }

    document.getElementById('googleAuthBtn')?.addEventListener('click', function() {
      // Open auth in new tab (MiniMax-style)
      var authUrl = '/auth/login?return_to=' + encodeURIComponent('/?popup=1');
      window.open(authUrl, 'ultralight-auth', 'width=500,height=700,menubar=no,toolbar=no');
      hideAuthOverlay();
    });

    // Close auth overlay on backdrop click
    document.getElementById('authOverlay')?.addEventListener('click', function(e) {
      if (e.target === this) hideAuthOverlay();
    });
    // Close button
    document.getElementById('authCloseBtn')?.addEventListener('click', hideAuthOverlay);

    // Listen for auth message from popup
    window.addEventListener('message', function(event) {
      if (event.origin !== window.location.origin) return;
      if (event.data && event.data.type === 'auth-success') {
        authToken = event.data.token;
        localStorage.setItem('ultralight_token', event.data.token);
        if (event.data.refreshToken) {
          localStorage.setItem('ultralight_refresh_token', event.data.refreshToken);
        }
        hideAuthOverlay();
        updateAuthUI();
      }
    });

    // Fallback: poll localStorage for token changes (handles popup auth when postMessage fails)
    // This runs continuously until a token is found — covers all auth flows
    var authPollInterval = null;
    function startAuthPoll() {
      if (authPollInterval) return;
      if (authToken) return; // Already logged in
      authPollInterval = setInterval(function() {
        var token = localStorage.getItem('ultralight_token');
        if (token && token !== authToken) {
          authToken = token;
          clearInterval(authPollInterval);
          authPollInterval = null;
          hideAuthOverlay();
          updateAuthUI();
        }
      }, 500);
      // Stop polling after 5 minutes
      setTimeout(function() {
        if (authPollInterval) {
          clearInterval(authPollInterval);
          authPollInterval = null;
        }
      }, 300000);
    }

    // Start polling immediately if not logged in
    if (!authToken) {
      startAuthPoll();
    }

    // Cross-tab storage event: fires when another tab/popup writes to localStorage
    window.addEventListener('storage', function(e) {
      if (e.key === 'ultralight_token' && e.newValue && e.newValue !== authToken) {
        authToken = e.newValue;
        if (authPollInterval) {
          clearInterval(authPollInterval);
          authPollInterval = null;
        }
        hideAuthOverlay();
        updateAuthUI();
      }
    });

    // Also re-check on focus (e.g., user switches back from auth tab)
    window.addEventListener('focus', function() {
      var token = localStorage.getItem('ultralight_token');
      if (token && token !== authToken) {
        authToken = token;
        if (authPollInterval) {
          clearInterval(authPollInterval);
          authPollInterval = null;
        }
        hideAuthOverlay();
        updateAuthUI();
      }
      // Restart polling if still not logged in
      if (!authToken) startAuthPoll();
    });

    async function updateAuthUI() {
      if (!authToken) {
        // Not authenticated
        document.getElementById('navPreAuth').classList.remove('hidden');
        document.getElementById('navPostAuth').classList.add('hidden');
        showView('home');
        return;
      }

      // Decode JWT
      const payload = decodeJWT(authToken);
      if (!payload) {
        signOut();
        return;
      }

      // Check expiration
      if (payload.exp && payload.exp * 1000 < Date.now()) {
        // Try refresh
        const refreshToken = localStorage.getItem('ultralight_refresh_token');
        if (refreshToken) {
          try {
            const res = await fetch('/auth/refresh', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ refresh_token: refreshToken }),
            });
            if (res.ok) {
              const data = await res.json();
              authToken = data.access_token;
              localStorage.setItem('ultralight_token', data.access_token);
              if (data.refresh_token) localStorage.setItem('ultralight_refresh_token', data.refresh_token);
            } else {
              signOut();
              return;
            }
          } catch {
            signOut();
            return;
          }
        } else {
          signOut();
          return;
        }
      }

      currentUser = payload;

      // Fetch full profile
      try {
        const res = await fetch('/api/user', {
          headers: { 'Authorization': 'Bearer ' + authToken },
        });
        if (res.ok) {
          userProfile = await res.json();
        }
      } catch {}

      // Update nav
      document.getElementById('navPreAuth').classList.add('hidden');
      document.getElementById('navPostAuth').classList.remove('hidden');

      // Update hero CTA to copy mode
      setupHeroCTA();

      // Set avatar
      const avatarEls = document.querySelectorAll('.profile-avatar');
      const initial = (userProfile?.first_name || userProfile?.email || currentUser.email || '?')[0].toUpperCase();
      avatarEls.forEach(el => { el.textContent = initial; });

      // Set profile info in dropdown
      const emailEl = document.getElementById('profileEmail');
      if (emailEl) emailEl.textContent = userProfile?.email || currentUser.email || '';

      // Load apps
      await loadApps();

      // Show appropriate view
      if (currentView === 'home') {
        // Check if user has apps — if yes, show dashboard
        if (apps.length > 0) {
          showView('dashboard');
          loadDashboardData();
        } else {
          // First-time user: auto-generate + auto-copy instructions
          await generateSetupInstructions();
          if (setupCommandStr) {
            try {
              await navigator.clipboard.writeText(setupCommandStr);
              var ctaBtn = document.getElementById('heroCTA');
              var ctaTxt = document.getElementById('heroCTAText');
              if (ctaBtn && ctaTxt) {
                ctaTxt.textContent = 'Copied! Now paste into your agent';
                ctaBtn.style.background = 'var(--success)';
                setTimeout(function() {
                  ctaTxt.textContent = 'Copy agent instructions';
                  ctaBtn.style.background = '';
                }, 4000);
              }
            } catch(e) {}
          }
          showSetupBlock();
        }
      } else if (currentView === 'dashboard') {
        showView('dashboard');
        loadDashboardData();
      } else if (currentView === 'app') {
        showView('app');
      }
    }

    function signOut() {
      authToken = null;
      currentUser = null;
      userProfile = null;
      apps = [];
      localStorage.removeItem('ultralight_token');
      localStorage.removeItem('ultralight_refresh_token');
      if (connectionPollInterval) clearInterval(connectionPollInterval);
      window.location.href = '/';
    }
    window.signOut = signOut;

    // ===== Navigation =====
    function showView(view) {
      currentView = view;
      ['homeView', 'dashboardView', 'appView', 'accountView'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
      });

      const viewMap = {
        home: 'homeView',
        dashboard: 'dashboardView',
        app: 'appView',
        account: 'accountView',
        leaderboard: 'dashboardView', // redirect leaderboard to dashboard
      };

      const targetId = viewMap[view];
      if (targetId) {
        const el = document.getElementById(targetId);
        if (el) el.style.display = 'block';
      }
    }

    function navigateToHome() {
      history.pushState({}, '', '/');
      currentAppId = null;
      if (authToken && apps.length > 0) {
        showView('dashboard');
        loadDashboardData();
      } else if (authToken) {
        showView('home');
        showSetupBlock();
      } else {
        showView('home');
      }
    }

    function navigateToDashboard() {
      history.pushState({}, '', '/dash');
      currentAppId = null;
      showView('dashboard');
      renderAppGrid();
      loadDashboardData();
    }

    function navigateToApp(appId) {
      history.pushState({}, '', '/a/' + appId);
      currentAppId = appId;
      showView('app');
      loadAppPage(appId);
    }
    window.navigateToApp = navigateToApp;

    function navigateToAccount() {
      history.pushState({}, '', '/settings');
      showView('account');
      loadAccountData();
    }
    window.navigateToAccount = navigateToAccount;

    window.addEventListener('popstate', async function() {
      const path = window.location.pathname;
      if (path === '/' || path === '/home') {
        navigateToHome();
      } else if (path === '/dash' || path === '/dashboard') {
        navigateToDashboard();
      } else if (path === '/settings') {
        navigateToAccount();
      } else if (path.startsWith('/a/')) {
        const appId = path.slice(3).split('/')[0];
        navigateToApp(appId);
      }
    });

    // Nav button handlers
    document.getElementById('navAuthBtn')?.addEventListener('click', showAuthOverlay);
    document.getElementById('navLogoLink')?.addEventListener('click', function(e) {
      e.preventDefault();
      navigateToHome();
    });

    // ===== Profile Dropdown =====
    const profileTrigger = document.getElementById('profileTrigger');
    const profileDropdown = document.getElementById('profileDropdown');

    if (profileTrigger) {
      profileTrigger.addEventListener('click', function(e) {
        e.stopPropagation();
        profileDropdown.classList.toggle('open');
      });
    }

    document.addEventListener('click', function(e) {
      if (profileDropdown && !profileDropdown.contains(e.target) && !profileTrigger.contains(e.target)) {
        profileDropdown.classList.remove('open');
      }
    });

    // Profile dropdown menu actions
    document.querySelectorAll('[data-action]').forEach(function(el) {
      el.addEventListener('click', function() {
        const action = this.dataset.action;
        profileDropdown.classList.remove('open');
        if (action === 'settings') navigateToAccount();
        else if (action === 'tokens') { navigateToAccount(); setTimeout(() => document.getElementById('tokensSection')?.scrollIntoView({ behavior: 'smooth' }), 100); }
        else if (action === 'billing') { navigateToAccount(); setTimeout(() => document.getElementById('billingSection')?.scrollIntoView({ behavior: 'smooth' }), 100); }
        else if (action === 'supabase') { navigateToAccount(); setTimeout(() => document.getElementById('supabaseSection')?.scrollIntoView({ behavior: 'smooth' }), 100); }
        else if (action === 'signout') signOut();
      });
    });

    // ===== Connection State Machine =====
    function updateConnectionStatus(state, detail) {
      const el = document.getElementById('connectionStatus');
      if (!el) return;
      el.className = 'connection-status';
      
      if (state === 'waiting') {
        el.classList.add('connecting');
        el.innerHTML = '<div class="status-dot"></div><span>Waiting for agent to connect...</span>';
        el.classList.remove('hidden');
      } else if (state === 'connected') {
        el.classList.add('connected');
        el.innerHTML = '<div class="status-dot"></div><span>Agent connected!' + (detail ? ' ' + escapeHtml(detail) : '') + '</span>';
        el.classList.remove('hidden');
        // After 3 seconds, transition to dashboard if they have apps
        setTimeout(function() {
          if (apps.length > 0) {
            navigateToDashboard();
          } else {
            loadApps().then(function() {
              if (apps.length > 0) navigateToDashboard();
            });
          }
        }, 3000);
      } else if (state === 'error') {
        el.classList.add('error');
        el.innerHTML = '<div class="status-dot"></div><span>Connection issue. ' + (detail || 'Try copying again.') + '</span>';
        el.classList.remove('hidden');
      } else {
        el.classList.add('hidden');
      }
    }

    function startConnectionPolling(tokenId) {
      if (connectionPollInterval) clearInterval(connectionPollInterval);
      newlyCreatedTokenId = tokenId;
      let attempts = 0;
      const maxAttempts = 40; // 2 minutes at 3s intervals

      updateConnectionStatus('waiting');

      connectionPollInterval = setInterval(async function() {
        attempts++;
        if (attempts > maxAttempts) {
          clearInterval(connectionPollInterval);
          connectionPollInterval = null;
          updateConnectionStatus('error', 'Timed out after 2 minutes.');
          return;
        }

        try {
          const res = await fetch('/api/user/tokens', {
            headers: { 'Authorization': 'Bearer ' + authToken },
          });
          if (!res.ok) return;
          const tokens = await res.json();
          const token = tokens.find(function(t) { return t.id === tokenId; });
          if (token && token.last_used_at) {
            clearInterval(connectionPollInterval);
            connectionPollInterval = null;
            updateConnectionStatus('connected');
            // Reload apps to pick up any newly created ones
            await loadApps();
          }
        } catch {}
      }, 3000);
    }

    // ===== Setup Instructions =====
    function showSetupBlock() {
      const block = document.getElementById('setupBlock');
      if (block) block.style.display = 'block';
    }

    async function generateSetupInstructions() {
      try {
        const res = await fetch('/api/user/tokens', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + authToken,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ name: 'Agent Setup — ' + new Date().toLocaleDateString() }),
        });

        if (!res.ok) {
          const mcpUrl = window.location.origin + '/mcp/platform';
          await navigator.clipboard.writeText(mcpUrl);
          showToast('MCP URL copied! Create an API token in Settings to authenticate.', 'warning');
          return;
        }

        const data = await res.json();
        const token = data.plaintext_token;
        const tokenId = data.id;

        setupCommandStr = "I'd like you to set up Ultralight, the instant MCP app platform.\\nRun: npx ultralightpro setup --token " + token;

        const commandEl = document.getElementById('setupCode');
        if (commandEl) commandEl.textContent = setupCommandStr;

        showSetupBlock();

        // Start polling for connection
        if (tokenId) startConnectionPolling(tokenId);

      } catch (err) {
        const mcpUrl = window.location.origin + '/mcp/platform';
        await navigator.clipboard.writeText(mcpUrl);
        showToast('MCP URL copied!', 'success');
      }
    }

    // Copy setup command
    document.getElementById('copySetupBtn')?.addEventListener('click', async function() {
      if (!setupCommandStr) return;
      try {
        await navigator.clipboard.writeText(setupCommandStr);
        const btn = this;
        const orig = btn.innerHTML;
        btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg> Copied!';
        btn.classList.add('btn-success-flash');
        setTimeout(function() { btn.innerHTML = orig; btn.classList.remove('btn-success-flash'); }, 2000);
      } catch {
        showToast('Failed to copy. Select and copy manually.', 'error');
      }
    });

    // Dashboard setup instructions button (collapsed version)
    document.getElementById('dashSetupBtn')?.addEventListener('click', async function() {
      if (!setupCommandStr) {
        await generateSetupInstructions();
      }
      // Show a mini modal or expand the setup block
      const block = document.getElementById('dashSetupBlock');
      if (block) {
        block.classList.toggle('hidden');
        if (!block.classList.contains('hidden')) {
          const el = document.getElementById('dashSetupText');
          if (el) el.textContent = setupCommandStr;
        }
      }
    });

    document.getElementById('copyDashSetup')?.addEventListener('click', async function() {
      if (!setupCommandStr) return;
      await navigator.clipboard.writeText(setupCommandStr);
      showToast('Setup instructions copied!');
    });

    // ===== Apps =====
    async function loadApps() {
      if (!authToken) return;
      try {
        const res = await fetch('/api/apps/me', {
          headers: { 'Authorization': 'Bearer ' + authToken },
        });
        if (res.ok) {
          apps = await res.json();
          renderAppGrid();
        }
      } catch {}
    }

    function renderAppGrid() {
      const grid = document.getElementById('appGrid');
      if (!grid) return;

      if (!apps || apps.length === 0) {
        grid.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📡</div><div class="empty-state-title">No apps yet</div><div class="empty-state-desc">Copy the setup instructions and paste them into your agent to deploy your first app.</div></div>';
        return;
      }

      grid.innerHTML = apps.map(function(app) {
        const emoji = getAppEmoji(app.name || app.slug);
        const name = escapeHtml(app.name || app.slug || 'Untitled');
        const desc = escapeHtml((app.description || '').slice(0, 80));
        const version = escapeHtml(app.current_version || 'v1.0.0');
        const fnCount = (app.manifest?.functions || []).length;
        return '<div class="app-card" onclick="navigateToApp(\\\'' + app.id + '\\\')">' +
          '<div class="app-card-header">' +
            '<span class="app-card-emoji">' + emoji + '</span>' +
            '<span class="app-card-name">' + name + '</span>' +
            '<span class="app-card-version">' + version + '</span>' +
          '</div>' +
          (desc ? '<div class="app-card-desc">' + desc + '</div>' : '') +
          '<div class="app-card-meta">' + fnCount + ' function' + (fnCount !== 1 ? 's' : '') + '</div>' +
        '</div>';
      }).join('');

      // Update stats
      const totalAppsEl = document.getElementById('statTotalApps');
      if (totalAppsEl) totalAppsEl.textContent = apps.length;
    }

    // ===== Dashboard =====
    async function loadDashboardData() {
      renderAppGrid();
      loadRecentActivity();
      loadDashStats();
    }

    async function loadDashStats() {
      // Total calls from call log
      try {
        const res = await fetch('/api/user/call-log?limit=1', {
          headers: { 'Authorization': 'Bearer ' + authToken },
        });
        if (res.ok) {
          const data = await res.json();
          const totalCallsEl = document.getElementById('statTotalCalls');
          if (totalCallsEl) totalCallsEl.textContent = (data.total || data.length || 0).toLocaleString();
        }
      } catch {}
    }

    async function loadRecentActivity() {
      const feed = document.getElementById('activityFeed');
      if (!feed) return;

      try {
        const res = await fetch('/api/user/call-log?limit=20', {
          headers: { 'Authorization': 'Bearer ' + authToken },
        });
        if (!res.ok) {
          feed.innerHTML = '<div class="empty-state"><div class="empty-state-desc">No recent activity</div></div>';
          return;
        }
        const logs = await res.json();
        const items = Array.isArray(logs) ? logs : (logs.logs || []);

        if (items.length === 0) {
          feed.innerHTML = '<div class="empty-state"><div class="empty-state-desc">No recent activity. Deploy an app to get started.</div></div>';
          return;
        }

        const appNames = {};
        apps.forEach(function(a) { appNames[a.id] = a.name || a.slug; });

        feed.innerHTML = '<div class="activity-list">' + items.slice(0, 15).map(function(log) {
          const appName = escapeHtml(appNames[log.app_id] || log.app_name || 'Unknown');
          const fn = escapeHtml(log.function_name || log.method || '');
          const success = log.success !== false;
          const time = relTime(log.created_at);
          return '<div class="activity-item">' +
            '<div class="activity-dot' + (success ? '' : ' activity-dot-error') + '"></div>' +
            '<div class="activity-content">' +
              '<span class="activity-fn">' + fn + '()</span>' +
              '<span class="activity-sep">·</span>' +
              '<span class="activity-app">' + appName + '</span>' +
            '</div>' +
            '<span class="activity-time">' + time + '</span>' +
          '</div>';
        }).join('') + '</div>';
      } catch {
        feed.innerHTML = '<div class="empty-state"><div class="empty-state-desc">Could not load activity.</div></div>';
      }
    }

    // ===== App Detail Page =====
    async function loadAppPage(appId) {
      if (!authToken || !appId) return;

      // Reset tab to overview
      switchAppTab('overview');

      try {
        const res = await fetch('/api/apps/' + appId, {
          headers: { 'Authorization': 'Bearer ' + authToken },
        });
        if (!res.ok) {
          showToast('Failed to load app', 'error');
          return;
        }
        const app = await res.json();

        // App header
        const nameEl = document.getElementById('appDetailName');
        if (nameEl) nameEl.textContent = app.name || app.slug || 'Untitled';

        const versionEl = document.getElementById('appDetailVersion');
        if (versionEl) versionEl.textContent = app.current_version || 'v1.0.0';

        document.title = (app.name || app.slug) + ' - Ultralight';

        // MCP Endpoint
        const endpointUrl = window.location.origin + '/mcp/' + appId;
        const endpointEl = document.getElementById('appDetailEndpoint');
        if (endpointEl) endpointEl.textContent = endpointUrl;

        // Store current app data for editing
        window._currentApp = app;

        // Load all sections
        loadAppOverview(app);
        loadAppSettings(app);
        loadAppLogs(appId);
        loadAppBusiness(appId, app);

      } catch (err) {
        showToast('Error loading app: ' + (err.message || ''), 'error');
      }
    }

    // Tab switching
    function switchAppTab(tab) {
      document.querySelectorAll('.tab[data-tab]').forEach(function(btn) {
        btn.classList.toggle('active', btn.dataset.tab === tab);
      });
      document.querySelectorAll('.tab-content').forEach(function(panel) {
        panel.style.display = panel.dataset.tabContent === tab ? 'block' : 'none';
      });
    }
    window.switchAppTab = switchAppTab;

    // Tab click handlers
    document.querySelectorAll('.tab[data-tab][data-tab]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        switchAppTab(this.dataset.tab);
      });
    });

    // ===== App Overview =====
    function loadAppOverview(app) {
      const container = document.getElementById('appOverview');
      if (!container) return;

      const fns = app.manifest?.functions || [];
      const functionsHtml = fns.length > 0
        ? '<div class="function-list">' + fns.map(function(fn) {
            const params = fn.parameters?.map(function(p) {
              return '<span class="fn-param">' + escapeHtml(p.name) + '<span class="fn-param-type">: ' + escapeHtml(p.type || 'any') + '</span>' + (p.required ? '' : '?') + '</span>';
            }).join(', ') || '';
            return '<div class="function-item">' +
              '<div class="function-name"><code>' + escapeHtml(fn.name) + '</code>(' + params + ')</div>' +
              (fn.description ? '<div class="function-desc">' + escapeHtml(fn.description) + '</div>' : '') +
            '</div>';
          }).join('') + '</div>'
        : '<div class="empty-state"><div class="empty-state-desc">No functions found in manifest.</div></div>';

      container.innerHTML =
        '<div class="section-card">' +
          '<h3 class="section-title">Functions</h3>' +
          functionsHtml +
        '</div>' +
        '<div class="section-card" id="appHealthSummary">' +
          '<h3 class="section-title">Health</h3>' +
          '<div class="loading-text">Loading...</div>' +
        '</div>' +
        '<div class="section-card" id="appRecentCalls">' +
          '<h3 class="section-title">Recent Calls</h3>' +
          '<div class="loading-text">Loading...</div>' +
        '</div>';

      // Load health
      loadAppHealth(app.id);
      // Load recent calls for this app
      loadAppRecentCalls(app.id);
    }

    async function loadAppHealth(appId) {
      const container = document.getElementById('appHealthSummary');
      if (!container) return;
      try {
        const res = await fetch('/api/apps/' + appId + '/health', {
          headers: { 'Authorization': 'Bearer ' + authToken },
        });
        if (!res.ok) {
          container.querySelector('.loading-text').textContent = 'Could not load health data.';
          return;
        }
        const data = await res.json();
        const isHealthy = !data.is_unhealthy;
        const autoHeal = data.auto_heal_enabled;

        let html = '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">' +
          '<div class="status-dot" style="background:' + (isHealthy ? 'var(--success)' : 'var(--error)') + ';width:8px;height:8px;border-radius:50%"></div>' +
          '<span style="font-weight:500">' + (isHealthy ? 'All healthy' : 'Issues detected') + '</span>' +
          '<label style="margin-left:auto;display:flex;align-items:center;gap:6px;font-size:13px;color:var(--text-secondary);cursor:pointer">' +
            '<input type="checkbox" id="autoHealToggle" ' + (autoHeal ? 'checked' : '') + ' onchange="toggleAutoHeal(\\\'' + appId + '\\\', this.checked)"> Auto-heal' +
          '</label>' +
        '</div>';

        if (data.function_health && Object.keys(data.function_health).length > 0) {
          html += Object.entries(data.function_health).map(function(entry) {
            const fn = entry[0], stats = entry[1];
            const errorRate = stats.error_rate || 0;
            const color = errorRate > 50 ? 'var(--error)' : errorRate > 10 ? 'var(--warning)' : 'var(--success)';
            return '<div style="display:flex;align-items:center;gap:8px;padding:6px 0;font-size:13px">' +
              '<code style="flex:1;color:var(--text-primary)">' + escapeHtml(fn) + '</code>' +
              '<div style="width:60px;height:4px;background:var(--bg-hover);border-radius:2px;overflow:hidden">' +
                '<div style="height:100%;width:' + Math.min(errorRate, 100) + '%;background:' + color + ';border-radius:2px"></div>' +
              '</div>' +
              '<span style="width:40px;text-align:right;color:' + color + '">' + errorRate.toFixed(0) + '%</span>' +
            '</div>';
          }).join('');
        }

        container.innerHTML = '<h3 class="section-title">Health</h3>' + html;
      } catch {
        container.querySelector('.loading-text').textContent = 'Could not load health data.';
      }
    }

    window.toggleAutoHeal = async function(appId, enabled) {
      try {
        const res = await fetch('/api/apps/' + appId + '/health', {
          method: 'PATCH',
          headers: { 'Authorization': 'Bearer ' + authToken, 'Content-Type': 'application/json' },
          body: JSON.stringify({ auto_heal_enabled: enabled }),
        });
        if (res.ok) showToast('Auto-heal ' + (enabled ? 'enabled' : 'disabled'));
        else {
          showToast('Failed to update auto-heal', 'error');
          document.getElementById('autoHealToggle').checked = !enabled;
        }
      } catch {
        showToast('Failed to update', 'error');
        document.getElementById('autoHealToggle').checked = !enabled;
      }
    };

    async function loadAppRecentCalls(appId) {
      const container = document.getElementById('appRecentCalls');
      if (!container) return;
      try {
        const res = await fetch('/api/user/call-log?limit=10&app_id=' + appId, {
          headers: { 'Authorization': 'Bearer ' + authToken },
        });
        if (!res.ok) {
          container.innerHTML = '<h3 class="section-title">Recent Calls</h3><div class="empty-state"><div class="empty-state-desc">No calls recorded yet.</div></div>';
          return;
        }
        const data = await res.json();
        const logs = Array.isArray(data) ? data : (data.logs || []);

        if (logs.length === 0) {
          container.innerHTML = '<h3 class="section-title">Recent Calls</h3><div class="empty-state"><div class="empty-state-desc">No calls recorded yet.</div></div>';
          return;
        }

        container.innerHTML = '<h3 class="section-title">Recent Calls</h3><div class="activity-list">' +
          logs.map(function(log) {
            const success = log.success !== false;
            const fn = escapeHtml(log.function_name || '');
            const time = relTime(log.created_at);
            const dur = log.duration_ms ? log.duration_ms + 'ms' : '';
            return '<div class="activity-item">' +
              '<div class="activity-dot' + (success ? '' : ' activity-dot-error') + '"></div>' +
              '<span class="activity-fn">' + fn + '()</span>' +
              (dur ? '<span class="activity-sep">·</span><span style="color:var(--text-muted);font-size:12px">' + dur + '</span>' : '') +
              '<span class="activity-time">' + time + '</span>' +
            '</div>';
          }).join('') + '</div>';
      } catch {
        container.innerHTML = '<h3 class="section-title">Recent Calls</h3><div class="empty-state"><div class="empty-state-desc">Could not load calls.</div></div>';
      }
    }

    // ===== Copy Functions =====
    window.copyAppEndpoint = function() {
      const url = window.location.origin + '/mcp/' + currentAppId;
      navigator.clipboard.writeText(url).then(function() { showToast('MCP endpoint copied!'); });
    };

    window.copyPlatformMcpUrl = function() {
      navigator.clipboard.writeText(window.location.origin + '/mcp/platform').then(function() { showToast('Platform MCP URL copied!'); });
    };

    window.downloadAppCode = async function() {
      if (!currentAppId || !authToken) return;
      try {
        const res = await fetch('/api/apps/' + currentAppId + '/download', {
          headers: { 'Authorization': 'Bearer ' + authToken },
        });
        if (!res.ok) { showToast('Failed to download', 'error'); return; }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = (window._currentApp?.slug || currentAppId) + '.zip';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch { showToast('Download failed', 'error'); }
    };

    // ===== 14. App Settings Tab =====
    function loadAppSettings(app) {
      const container = document.getElementById('appSettings');
      if (!container) return;

      container.innerHTML =
        // General section
        '<div class="section-card">' +
          '<h3 class="section-title" onclick="this.parentElement.classList.toggle(\\\'collapsed\\\')">General <span class="collapse-icon">▾</span></h3>' +
          '<div class="section-body">' +
            '<div class="form-group"><label class="form-label">App Name</label><input type="text" id="settingName" class="form-input" value="' + escapeHtml(app.name || '') + '"></div>' +
            '<div class="form-group"><label class="form-label">Visibility</label><select id="settingVisibility" class="form-input"><option value="private"' + (app.visibility === 'private' ? ' selected' : '') + '>Private</option><option value="unlisted"' + (app.visibility === 'unlisted' ? ' selected' : '') + '>Unlisted</option><option value="published"' + (app.visibility === 'published' ? ' selected' : '') + '>Published</option></select></div>' +
            '<div class="form-group"><label class="form-label">Download Access</label><select id="settingDownload" class="form-input"><option value="owner"' + (app.download_access === 'owner' ? ' selected' : '') + '>Owner Only</option><option value="public"' + (app.download_access === 'public' ? ' selected' : '') + '>Public</option></select></div>' +
            '<div class="form-group"><label class="form-label">Version</label><select id="settingVersion" class="form-input">' +
              (app.versions || []).map(function(v) {
                return '<option value="' + escapeHtml(v.version) + '"' + (v.version === app.current_version ? ' selected' : '') + '>' + escapeHtml(v.version) + (v.version === app.current_version ? ' (current)' : '') + '</option>';
              }).join('') +
            '</select></div>' +
            '<div style="display:flex;gap:8px;margin-top:12px">' +
              '<button class="btn btn-primary btn-sm" onclick="saveAppSettings()">Save Changes</button>' +
              '<button class="btn btn-ghost btn-sm" onclick="downloadAppCode()">Download Code</button>' +
              '<button class="btn btn-danger btn-sm" style="margin-left:auto" onclick="showDeleteConfirm()">Delete App</button>' +
            '</div>' +
          '</div>' +
        '</div>' +

        // Permissions section
        '<div class="section-card">' +
          '<h3 class="section-title" onclick="this.parentElement.classList.toggle(\\\'collapsed\\\')">Permissions <span class="collapse-icon">▾</span></h3>' +
          '<div class="section-body" id="permissionsContent"><div class="loading-text">Loading...</div></div>' +
        '</div>' +

        // Database section
        '<div class="section-card">' +
          '<h3 class="section-title" onclick="this.parentElement.classList.toggle(\\\'collapsed\\\')">Database <span class="collapse-icon">▾</span></h3>' +
          '<div class="section-body" id="databaseContent"><div class="loading-text">Loading...</div></div>' +
        '</div>' +

        // Environment Variables section
        '<div class="section-card">' +
          '<h3 class="section-title" onclick="this.parentElement.classList.toggle(\\\'collapsed\\\')">Environment Variables <span class="collapse-icon">▾</span></h3>' +
          '<div class="section-body" id="envVarsContent"><div class="loading-text">Loading...</div></div>' +
        '</div>' +

        // Skills section
        '<div class="section-card">' +
          '<h3 class="section-title" onclick="this.parentElement.classList.toggle(\\\'collapsed\\\')">Skills / Documentation <span class="collapse-icon">▾</span></h3>' +
          '<div class="section-body" id="skillsContent"><div class="loading-text">Loading...</div></div>' +
        '</div>';

      // Load sub-sections
      loadPermissions(app.id);
      loadDatabase(app.id);
      loadEnvVars(app.id);
      loadSkills(app.id);
    }

    window.saveAppSettings = async function() {
      if (!currentAppId || !authToken) return;
      try {
        const body = {
          name: document.getElementById('settingName')?.value,
          visibility: document.getElementById('settingVisibility')?.value,
          download_access: document.getElementById('settingDownload')?.value,
        };
        const versionVal = document.getElementById('settingVersion')?.value;
        if (versionVal && window._currentApp && versionVal !== window._currentApp.current_version) {
          body.current_version = versionVal;
        }
        const res = await fetch('/api/apps/' + currentAppId, {
          method: 'PATCH',
          headers: { 'Authorization': 'Bearer ' + authToken, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (res.ok) {
          showToast('Settings saved!');
          await loadApps();
        } else {
          const data = await res.json().catch(function() { return {}; });
          showToast(data.error || 'Failed to save', 'error');
        }
      } catch { showToast('Failed to save settings', 'error'); }
    };

    // ===== 15. Delete App =====
    window.showDeleteConfirm = function() {
      const modal = document.getElementById('deleteConfirmModal');
      if (modal) {
        const nameEl = modal.querySelector('.delete-app-name');
        if (nameEl) nameEl.textContent = window._currentApp?.name || currentAppId;
        modal.classList.remove('hidden');
      }
    };

    document.getElementById('deleteConfirm')?.addEventListener('click', async function() {
      if (!currentAppId || !authToken) return;
      this.disabled = true;
      this.textContent = 'Deleting...';
      try {
        const res = await fetch('/api/apps/' + currentAppId, {
          method: 'DELETE',
          headers: { 'Authorization': 'Bearer ' + authToken },
        });
        if (res.ok) {
          showToast('App deleted');
          document.getElementById('deleteConfirmModal').classList.add('hidden');
          await loadApps();
          navigateToDashboard();
        } else {
          showToast('Failed to delete app', 'error');
        }
      } catch { showToast('Failed to delete', 'error'); }
      this.disabled = false;
      this.textContent = 'Delete Permanently';
    });
    document.getElementById('deleteCancel')?.addEventListener('click', function() {
      document.getElementById('deleteConfirmModal').classList.add('hidden');
    });

    // ===== 16. Permissions =====
    async function loadPermissions(appId) {
      const container = document.getElementById('permissionsContent');
      if (!container) return;
      try {
        const res = await fetch('/api/user/permissions/' + appId, {
          headers: { 'Authorization': 'Bearer ' + authToken },
        });
        if (!res.ok) { container.innerHTML = '<div class="empty-state"><div class="empty-state-desc">Could not load permissions.</div></div>'; return; }
        const data = await res.json();
        permsGrantedUsers = data.users || data || [];

        let html = '<div style="display:flex;gap:8px;margin-bottom:12px">' +
          '<input type="email" id="permEmailInput" class="form-input form-input-sm" placeholder="user@email.com" style="flex:1">' +
          '<button class="btn btn-primary btn-sm" onclick="addPermissionUser()">Grant Access</button>' +
        '</div>';

        if (permsGrantedUsers.length > 0) {
          html += permsGrantedUsers.map(function(u) {
            const email = escapeHtml(u.email || u.granted_to_email || 'Unknown');
            const fnCount = u.functions ? u.functions.length : 0;
            return '<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border)">' +
              '<span style="flex:1;font-size:13px">' + email + '</span>' +
              '<span style="font-size:12px;color:var(--text-muted)">' + fnCount + ' fn</span>' +
              '<button class="btn btn-ghost btn-sm" onclick="openPermissionsDetail(\\\'' + escapeHtml(u.user_id || '') + '\\\', \\\'' + email + '\\\')">Edit</button>' +
              '<button class="btn btn-danger btn-sm" onclick="revokePermission(\\\'' + escapeHtml(u.user_id || '') + '\\\', \\\'' + email + '\\\')">Revoke</button>' +
            '</div>';
          }).join('');
        } else {
          html += '<div style="font-size:13px;color:var(--text-muted);padding:8px 0">No users have access to this app.</div>';
        }
        container.innerHTML = html;
      } catch { container.innerHTML = '<div class="empty-state"><div class="empty-state-desc">Could not load permissions.</div></div>'; }
    }

    window.addPermissionUser = async function() {
      const email = document.getElementById('permEmailInput')?.value?.trim();
      if (!email || !currentAppId) return;
      try {
        // Get app functions
        const fns = (window._currentApp?.manifest?.functions || []).map(function(f) { return f.name; });
        const perms = fns.map(function(fn) { return { function_name: fn, allowed: true }; });

        const res = await fetch('/api/user/permissions/' + currentAppId, {
          method: 'PUT',
          headers: { 'Authorization': 'Bearer ' + authToken, 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email, permissions: perms }),
        });
        if (res.ok) {
          showToast('Access granted to ' + email);
          document.getElementById('permEmailInput').value = '';
          loadPermissions(currentAppId);
        } else {
          const data = await res.json().catch(function() { return {}; });
          showToast(data.error || 'Failed to grant access', 'error');
        }
      } catch { showToast('Failed to grant access', 'error'); }
    };

    window.revokePermission = async function(userId, email) {
      if (!confirm('Revoke access for ' + email + '?')) return;
      try {
        const res = await fetch('/api/user/permissions/' + currentAppId + '?user_id=' + userId, {
          method: 'DELETE',
          headers: { 'Authorization': 'Bearer ' + authToken },
        });
        if (res.ok) {
          showToast('Access revoked');
          loadPermissions(currentAppId);
        } else showToast('Failed to revoke', 'error');
      } catch { showToast('Failed to revoke', 'error'); }
    };

    window.openPermissionsDetail = function(userId, email) {
      // Open the permissions modal for detailed per-function editing
      permsSelectedUserId = userId;
      const modal = document.getElementById('permissionsModal');
      modal.classList.remove('hidden');
      const detail = document.getElementById('permsDetail');
      if (detail) {
        detail.innerHTML = '<div class="loading-text">Loading permissions for ' + escapeHtml(email) + '...</div>';
        loadPermissionDetail(currentAppId, userId, email);
      }
    };

    async function loadPermissionDetail(appId, userId, email) {
      const detail = document.getElementById('permsDetail');
      try {
        const res = await fetch('/api/user/permissions/' + appId + '?user_id=' + userId, {
          headers: { 'Authorization': 'Bearer ' + authToken },
        });
        if (!res.ok) { detail.innerHTML = 'Failed to load.'; return; }
        const data = await res.json();
        const perms = data.permissions || data || [];
        const fns = window._currentApp?.manifest?.functions || [];

        let html = '<h4 style="margin-bottom:12px;font-size:14px">' + escapeHtml(email) + '</h4>';
        html += fns.map(function(fn, idx) {
          const perm = perms.find(function(p) { return p.function_name === fn.name; });
          const allowed = perm ? perm.allowed : false;
          const constraints = perm?.constraints ? JSON.stringify(perm.constraints, null, 2) : '';
          return '<div style="padding:8px 0;border-bottom:1px solid var(--border)">' +
            '<label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer">' +
              '<input type="checkbox" class="perm-fn-cb" data-fn="' + escapeHtml(fn.name) + '" ' + (allowed ? 'checked' : '') + '>' +
              '<code>' + escapeHtml(fn.name) + '</code>' +
            '</label>' +
            (constraints ? '<textarea class="form-input perm-constraints" data-fn="' + escapeHtml(fn.name) + '" style="margin-top:6px;font-size:12px;height:60px" placeholder="Arg constraints JSON">' + escapeHtml(constraints) + '</textarea>' : '') +
          '</div>';
        }).join('');

        html += '<div style="display:flex;gap:8px;margin-top:12px">' +
          '<button class="btn btn-primary btn-sm" onclick="savePermissionDetail(\\\'' + escapeHtml(userId) + '\\\')">Save</button>' +
          '<button class="btn btn-ghost btn-sm" onclick="document.getElementById(\\\'permissionsModal\\\').classList.add(\\\'hidden\\\')">Cancel</button>' +
        '</div>';

        detail.innerHTML = html;
      } catch { detail.innerHTML = 'Failed to load.'; }
    }

    window.savePermissionDetail = async function(userId) {
      const checkboxes = document.querySelectorAll('.perm-fn-cb');
      const perms = [];
      checkboxes.forEach(function(cb) {
        const fn = cb.dataset.fn;
        const allowed = cb.checked;
        const constraintsEl = document.querySelector('.perm-constraints[data-fn="' + fn + '"]');
        let constraints = null;
        if (constraintsEl && constraintsEl.value.trim()) {
          try { constraints = JSON.parse(constraintsEl.value); } catch { showToast('Invalid JSON for ' + fn, 'error'); return; }
        }
        const perm = { function_name: fn, allowed: allowed };
        if (constraints) perm.constraints = constraints;
        perms.push(perm);
      });

      try {
        const res = await fetch('/api/user/permissions/' + currentAppId, {
          method: 'PUT',
          headers: { 'Authorization': 'Bearer ' + authToken, 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_id: userId, permissions: perms }),
        });
        if (res.ok) {
          showToast('Permissions saved!');
          document.getElementById('permissionsModal').classList.add('hidden');
          loadPermissions(currentAppId);
        } else showToast('Failed to save permissions', 'error');
      } catch { showToast('Failed to save', 'error'); }
    };

    // ===== 17. Database (Supabase) =====
    async function loadDatabase(appId) {
      const container = document.getElementById('databaseContent');
      if (!container) return;

      try {
        // Load saved servers if not cached
        if (!savedSupabaseServers) {
          const srvRes = await fetch('/api/user/supabase', {
            headers: { 'Authorization': 'Bearer ' + authToken },
          });
          if (srvRes.ok) savedSupabaseServers = await srvRes.json();
        }

        // Load current app config
        let currentConfig = null;
        try {
          const cfgRes = await fetch('/api/apps/' + appId + '/supabase', {
            headers: { 'Authorization': 'Bearer ' + authToken },
          });
          if (cfgRes.ok) currentConfig = await cfgRes.json();
        } catch {}

        const servers = savedSupabaseServers || [];
        let html = '<div class="form-group"><label class="form-label">Supabase Server</label>' +
          '<select id="dbServerSelect" class="form-input" onchange="onDbServerChange()">' +
            '<option value="">None</option>' +
            servers.map(function(s) {
              const selected = currentConfig && currentConfig.config_id === s.id ? ' selected' : '';
              return '<option value="' + s.id + '"' + selected + '>' + escapeHtml(s.url || s.id) + '</option>';
            }).join('') +
          '</select></div>' +
          '<button class="btn btn-primary btn-sm" onclick="saveDbConfig()">Save Database Config</button>';

        container.innerHTML = html;
        appSupabaseChanged = false;
      } catch { container.innerHTML = '<div class="empty-state"><div class="empty-state-desc">Could not load database config.</div></div>'; }
    }

    window.onDbServerChange = function() { appSupabaseChanged = true; };

    window.saveDbConfig = async function() {
      const serverId = document.getElementById('dbServerSelect')?.value || '';
      try {
        const res = await fetch('/api/apps/' + currentAppId + '/supabase', {
          method: 'PUT',
          headers: { 'Authorization': 'Bearer ' + authToken, 'Content-Type': 'application/json' },
          body: JSON.stringify({ config_id: serverId || null }),
        });
        if (res.ok) showToast('Database config saved!');
        else showToast('Failed to save', 'error');
      } catch { showToast('Failed to save', 'error'); }
    };

    // ===== 18. Environment Variables =====
    async function loadEnvVars(appId) {
      const container = document.getElementById('envVarsContent');
      if (!container) return;
      currentEnvVars = {};
      pendingEnvVarChanges = {};

      try {
        const res = await fetch('/api/apps/' + appId + '/env', {
          headers: { 'Authorization': 'Bearer ' + authToken },
        });
        if (res.ok) {
          const data = await res.json();
          // Convert array to object if needed
          if (Array.isArray(data)) {
            data.forEach(function(item) { currentEnvVars[item.key] = item.value; });
          } else {
            currentEnvVars = data || {};
          }
        }
      } catch {}

      renderEnvVars(document.getElementById('envVarsContent'));
    }

    function renderEnvVars(container) {
      const keys = Object.keys(currentEnvVars);
      let html = '';

      keys.forEach(function(key) {
        html += '<div class="env-var-row" style="display:flex;gap:8px;align-items:center;margin-bottom:8px">' +
          '<input type="text" class="form-input form-input-sm" value="' + escapeHtml(key) + '" readonly style="width:140px;font-family:var(--font-mono);font-size:12px">' +
          '<input type="password" class="form-input form-input-sm env-value" data-key="' + escapeHtml(key) + '" value="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022" style="flex:1;font-family:var(--font-mono);font-size:12px">' +
          '<button class="btn btn-ghost btn-sm" onclick="this.previousElementSibling.type = this.previousElementSibling.type === \\\'password\\\' ? \\\'text\\\' : \\\'password\\\'">&#128065;</button>' +
          '<button class="btn btn-danger btn-sm" onclick="deleteEnvVar(\\\'' + escapeHtml(key) + '\\\')">&#215;</button>' +
        '</div>';
      });

      html += '<div style="display:flex;gap:8px;margin-top:12px">' +
        '<input type="text" id="newEnvKey" class="form-input form-input-sm" placeholder="KEY_NAME" style="width:140px;font-family:var(--font-mono);font-size:12px">' +
        '<input type="text" id="newEnvValue" class="form-input form-input-sm" placeholder="value" style="flex:1;font-family:var(--font-mono);font-size:12px">' +
        '<button class="btn btn-primary btn-sm" onclick="addEnvVar()">Add</button>' +
      '</div>' +
      '<button class="btn btn-primary btn-sm" style="margin-top:12px" onclick="saveEnvVars()">Save Environment Variables</button>';

      container.innerHTML = html;
    }

    window.addEnvVar = function() {
      const key = document.getElementById('newEnvKey')?.value?.trim().toUpperCase();
      const value = document.getElementById('newEnvValue')?.value || '';
      if (!key) { showToast('Key is required', 'error'); return; }
      if (!/^[A-Z][A-Z0-9_]*$/.test(key)) { showToast('Key must be uppercase A-Z, 0-9, underscore', 'error'); return; }
      if (key.startsWith('ULTRALIGHT')) { showToast('ULTRALIGHT prefix is reserved', 'error'); return; }
      currentEnvVars[key] = value;
      pendingEnvVarChanges[key] = value;
      renderEnvVars(document.getElementById('envVarsContent'));
    };

    window.deleteEnvVar = function(key) {
      delete currentEnvVars[key];
      pendingEnvVarChanges[key] = null; // null = delete
      renderEnvVars(document.getElementById('envVarsContent'));
    };

    window.saveEnvVars = async function() {
      if (!currentAppId) return;
      try {
        // Collect all env var values (including modified password fields)
        const envData = {};
        document.querySelectorAll('.env-value').forEach(function(input) {
          const key = input.dataset.key;
          if (input.value && input.value !== '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022') {
            envData[key] = input.value;
          }
        });
        // Add pending changes
        Object.keys(pendingEnvVarChanges).forEach(function(key) {
          if (pendingEnvVarChanges[key] === null) {
            // Delete
            delete envData[key];
          } else {
            envData[key] = pendingEnvVarChanges[key];
          }
        });

        // Handle deletions
        const deleteKeys = Object.keys(pendingEnvVarChanges).filter(function(k) { return pendingEnvVarChanges[k] === null; });
        for (const key of deleteKeys) {
          await fetch('/api/apps/' + currentAppId + '/env/' + key, {
            method: 'DELETE',
            headers: { 'Authorization': 'Bearer ' + authToken },
          });
        }

        // Patch remaining
        const updateData = {};
        Object.keys(envData).forEach(function(k) { updateData[k] = envData[k]; });
        if (Object.keys(updateData).length > 0) {
          await fetch('/api/apps/' + currentAppId + '/env', {
            method: 'PATCH',
            headers: { 'Authorization': 'Bearer ' + authToken, 'Content-Type': 'application/json' },
            body: JSON.stringify(updateData),
          });
        }

        showToast('Environment variables saved!');
        pendingEnvVarChanges = {};
        loadEnvVars(currentAppId);
      } catch { showToast('Failed to save environment variables', 'error'); }
    };

    // ===== 19. Skills / Documentation =====
    async function loadSkills(appId) {
      const container = document.getElementById('skillsContent');
      if (!container) return;
      try {
        const res = await fetch('/api/apps/' + appId + '/skills.md', {
          headers: { 'Authorization': 'Bearer ' + authToken },
        });
        if (res.ok) {
          const text = await res.text();
          container.innerHTML = '<pre style="font-size:12px;font-family:var(--font-mono);white-space:pre-wrap;color:var(--text-secondary);max-height:200px;overflow:auto;padding:12px;background:var(--bg-base);border-radius:8px;border:1px solid var(--border)">' + escapeHtml(text).slice(0, 2000) + '</pre>' +
            '<div style="display:flex;gap:8px;margin-top:12px">' +
              '<button class="btn btn-secondary btn-sm" onclick="openSkillsEditor()">Edit Skills.md</button>' +
              '<button class="btn btn-ghost btn-sm" onclick="generateDocs()">Generate Docs</button>' +
            '</div>';
        } else {
          container.innerHTML = '<div style="font-size:13px;color:var(--text-muted)">No Skills.md found.</div>' +
            '<button class="btn btn-primary btn-sm" style="margin-top:8px" onclick="generateDocs()">Generate Documentation</button>';
        }
      } catch { container.innerHTML = '<div class="empty-state"><div class="empty-state-desc">Could not load skills.</div></div>'; }
    }

    window.openSkillsEditor = async function() {
      const modal = document.getElementById('skillsModal');
      modal.classList.remove('hidden');
      const editor = document.getElementById('skillsEditor');
      if (editor) {
        try {
          const res = await fetch('/api/apps/' + currentAppId + '/skills.md', {
            headers: { 'Authorization': 'Bearer ' + authToken },
          });
          if (res.ok) editor.value = await res.text();
        } catch {}
      }
    };

    window.saveSkills = async function() {
      const editor = document.getElementById('skillsEditor');
      if (!editor || !currentAppId) return;
      try {
        const res = await fetch('/api/apps/' + currentAppId + '/skills', {
          method: 'PATCH',
          headers: { 'Authorization': 'Bearer ' + authToken, 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: editor.value }),
        });
        if (res.ok) {
          showToast('Skills.md saved!');
          document.getElementById('skillsModal').classList.add('hidden');
          loadSkills(currentAppId);
        } else showToast('Failed to save skills', 'error');
      } catch { showToast('Failed to save', 'error'); }
    };

    window.generateDocs = async function() {
      if (!currentAppId) return;
      showToast('Generating documentation...');
      try {
        const res = await fetch('/api/apps/' + currentAppId + '/generate-docs', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + authToken },
        });
        if (res.ok) {
          showToast('Documentation generated!');
          loadSkills(currentAppId);
        } else showToast('Failed to generate docs', 'error');
      } catch { showToast('Generation failed', 'error'); }
    };

    // ===== App Logs Tab =====
    async function loadAppLogs(appId) {
      const container = document.getElementById('appLogs');
      if (!container) return;
      container.innerHTML = '<div class="loading-text">Loading logs...</div>';

      try {
        const res = await fetch('/api/user/call-log?limit=50&app_id=' + appId, {
          headers: { 'Authorization': 'Bearer ' + authToken },
        });
        if (!res.ok) { container.innerHTML = '<div class="empty-state"><div class="empty-state-desc">Could not load logs.</div></div>'; return; }
        const data = await res.json();
        const logs = Array.isArray(data) ? data : (data.logs || []);

        if (logs.length === 0) {
          container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📋</div><div class="empty-state-title">No logs yet</div><div class="empty-state-desc">Logs will appear here when your app receives calls.</div></div>';
          return;
        }

        container.innerHTML = '<div class="section-card"><h3 class="section-title">Call Log</h3>' +
          '<table style="width:100%;font-size:13px;border-collapse:collapse">' +
          '<thead><tr style="border-bottom:1px solid var(--border);text-align:left">' +
            '<th style="padding:8px 12px;color:var(--text-muted);font-weight:500">Status</th>' +
            '<th style="padding:8px 12px;color:var(--text-muted);font-weight:500">Function</th>' +
            '<th style="padding:8px 12px;color:var(--text-muted);font-weight:500">Duration</th>' +
            '<th style="padding:8px 12px;color:var(--text-muted);font-weight:500">Time</th>' +
          '</tr></thead><tbody>' +
          logs.map(function(log) {
            const success = log.success !== false;
            return '<tr style="border-bottom:1px solid var(--border)">' +
              '<td style="padding:8px 12px"><div class="status-dot" style="width:8px;height:8px;border-radius:50%;background:' + (success ? 'var(--success)' : 'var(--error)') + '"></div></td>' +
              '<td style="padding:8px 12px;font-family:var(--font-mono)">' + escapeHtml(log.function_name || log.method || '') + '</td>' +
              '<td style="padding:8px 12px;color:var(--text-muted)">' + (log.duration_ms ? log.duration_ms + 'ms' : '-') + '</td>' +
              '<td style="padding:8px 12px;color:var(--text-muted)">' + relTime(log.created_at) + '</td>' +
            '</tr>';
          }).join('') +
          '</tbody></table></div>';
      } catch { container.innerHTML = '<div class="empty-state"><div class="empty-state-desc">Could not load logs.</div></div>'; }
    }

    // ===== App Business Tab =====
    async function loadAppBusiness(appId, app) {
      const container = document.getElementById('appBusiness');
      if (!container) return;

      // Pricing section
      const pricingConfig = app.pricing_config || {};
      const defaultPrice = pricingConfig.default_price_cents || 0;
      const fnPrices = pricingConfig.function_prices ? JSON.stringify(pricingConfig.function_prices, null, 2) : '';

      let html = '<div class="section-card">' +
        '<h3 class="section-title">Pricing</h3>' +
        '<div class="form-group"><label class="form-label">Default price per call (cents)</label>' +
          '<input type="number" id="pricingDefault" class="form-input form-input-sm" value="' + defaultPrice + '" min="0" style="width:120px"></div>' +
        '<div class="form-group"><label class="form-label">Per-function price overrides (JSON)</label>' +
          '<textarea id="pricingFnOverrides" class="form-input" style="height:80px;font-family:var(--font-mono);font-size:12px" placeholder=\'{"function_name": 5}\'>' + escapeHtml(fnPrices) + '</textarea></div>' +
        '<button class="btn btn-primary btn-sm" onclick="savePricing()">Save Pricing</button>' +
      '</div>';

      // Revenue section
      html += '<div class="section-card" id="revenueSection">' +
        '<h3 class="section-title">Revenue</h3>' +
        '<div class="loading-text">Loading...</div>' +
      '</div>';

      container.innerHTML = html;

      // Load revenue data
      loadAppRevenue(appId);
    }

    window.savePricing = async function() {
      if (!currentAppId) return;
      const defaultCents = parseInt(document.getElementById('pricingDefault')?.value || '0', 10);
      let fnPrices = null;
      const fnText = document.getElementById('pricingFnOverrides')?.value?.trim();
      if (fnText) {
        try { fnPrices = JSON.parse(fnText); } catch { showToast('Invalid JSON in price overrides', 'error'); return; }
      }
      try {
        const pricingConfig = { default_price_cents: defaultCents };
        if (fnPrices) pricingConfig.function_prices = fnPrices;
        const res = await fetch('/api/apps/' + currentAppId, {
          method: 'PATCH',
          headers: { 'Authorization': 'Bearer ' + authToken, 'Content-Type': 'application/json' },
          body: JSON.stringify({ pricing_config: pricingConfig }),
        });
        if (res.ok) showToast('Pricing saved!');
        else showToast('Failed to save pricing', 'error');
      } catch { showToast('Failed to save', 'error'); }
    };

    async function loadAppRevenue(appId) {
      const container = document.getElementById('revenueSection');
      if (!container) return;
      try {
        const res = await fetch('/api/apps/' + appId + '/earnings?period=30d', {
          headers: { 'Authorization': 'Bearer ' + authToken },
        });
        if (!res.ok) { container.querySelector('.loading-text').textContent = 'No revenue data.'; return; }
        const data = await res.json();

        let html = '<h3 class="section-title">Revenue</h3>';
        html += '<div style="display:flex;gap:24px;margin-bottom:16px">' +
          '<div><div style="font-size:12px;color:var(--text-muted)">Lifetime</div><div style="font-size:20px;font-weight:600">$' + ((data.total_earned_cents || 0) / 100).toFixed(2) + '</div></div>' +
          '<div><div style="font-size:12px;color:var(--text-muted)">Last 30 days</div><div style="font-size:20px;font-weight:600">$' + ((data.period_earned_cents || 0) / 100).toFixed(2) + '</div></div>' +
          '<div><div style="font-size:12px;color:var(--text-muted)">Calls</div><div style="font-size:20px;font-weight:600">' + (data.period_transfers || 0) + '</div></div>' +
        '</div>';

        if (data.by_function && data.by_function.length > 0) {
          html += '<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">By function</div>';
          html += data.by_function.slice(0, 8).map(function(f) {
            return '<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px;border-bottom:1px solid var(--border)">' +
              '<code>' + escapeHtml(f.function_name) + '</code>' +
              '<span style="color:var(--text-muted)">' + f.call_count + ' calls · $' + ((f.earned_cents || 0) / 100).toFixed(2) + '</span>' +
            '</div>';
          }).join('');
        }

        container.innerHTML = html;
      } catch { container.querySelector('.loading-text').textContent = 'Could not load revenue.'; }
    }

    // ===== Account Settings =====
    async function loadAccountData() {
      loadTokens();
      loadHostingData();
      loadSupabaseServers();
    }

    // --- API Tokens ---
    async function loadTokens() {
      const container = document.getElementById('tokensList');
      if (!container) return;
      try {
        const res = await fetch('/api/user/tokens', {
          headers: { 'Authorization': 'Bearer ' + authToken },
        });
        if (!res.ok) return;
        currentTokens = await res.json();

        if (currentTokens.length === 0) {
          container.innerHTML = '<div style="font-size:13px;color:var(--text-muted);padding:8px 0">No API tokens. Create one to connect agents.</div>';
          return;
        }

        container.innerHTML = currentTokens.map(function(t) {
          const prefix = escapeHtml(t.token_prefix || t.id?.slice(0, 8) || '');
          const created = new Date(t.created_at).toLocaleDateString();
          const lastUsed = t.last_used_at ? relTime(t.last_used_at) : 'Never';
          const expired = t.expires_at && new Date(t.expires_at) < new Date();
          return '<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--border);font-size:13px">' +
            '<code style="color:var(--text-primary)">' + prefix + '...</code>' +
            '<span style="color:var(--text-muted)">Created ' + created + '</span>' +
            '<span style="color:var(--text-muted)">Last used: ' + lastUsed + '</span>' +
            (expired ? '<span style="color:var(--error);font-size:11px">Expired</span>' : '') +
            '<button class="btn btn-danger btn-sm" style="margin-left:auto" onclick="revokeToken(\'' + t.id + '\')">Revoke</button>' +
          '</div>';
        }).join('');
      } catch {}
    }

    window.createToken = async function() {
      const nameInput = document.getElementById('tokenName');
      const expirySelect = document.getElementById('tokenExpiry');
      const name = nameInput?.value?.trim() || 'API Token';
      const expiry = expirySelect?.value || '';

      try {
        const body = { name: name };
        if (expiry) body.expires_in_days = parseInt(expiry, 10);

        const res = await fetch('/api/user/tokens', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + authToken, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) { showToast('Failed to create token', 'error'); return; }
        const data = await res.json();

        if (data.plaintext_token) {
          const tokenDisplay = document.getElementById('newTokenDisplay');
          if (tokenDisplay) {
            tokenDisplay.classList.remove('hidden');
            document.getElementById('newTokenValue').textContent = data.plaintext_token;
          }
        }
        if (nameInput) nameInput.value = '';
        showToast('Token created! Copy it now — it won\'t be shown again.');
        loadTokens();
      } catch { showToast('Failed to create token', 'error'); }
    };

    window.copyNewToken = function() {
      const el = document.getElementById('newTokenValue');
      if (el) navigator.clipboard.writeText(el.textContent).then(function() { showToast('Token copied!'); });
    };

    window.revokeToken = async function(tokenId) {
      if (!confirm('Revoke this API token? This cannot be undone.')) return;
      try {
        const res = await fetch('/api/user/tokens/' + tokenId, {
          method: 'DELETE',
          headers: { 'Authorization': 'Bearer ' + authToken },
        });
        if (res.ok) { showToast('Token revoked'); loadTokens(); }
        else showToast('Failed to revoke', 'error');
      } catch { showToast('Failed to revoke', 'error'); }
    };

    // --- Billing ---
    async function loadHostingData() {
      const balanceEl = document.getElementById('accountBalance');
      const statusEl = document.getElementById('accountStatus');
      if (!balanceEl) return;

      try {
        const res = await fetch('/api/user/hosting', {
          headers: { 'Authorization': 'Bearer ' + authToken },
        });
        if (!res.ok) return;
        const data = await res.json();

        const cents = data.hosting_balance_cents || 0;
        balanceEl.textContent = '$' + (cents / 100).toFixed(2);
        balanceEl.style.color = cents <= 0 ? 'var(--error)' : 'var(--text-primary)';

        if (statusEl) {
          statusEl.textContent = cents > 0 ? 'Active' : 'No Balance';
          statusEl.style.background = cents > 0 ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)';
          statusEl.style.color = cents > 0 ? 'var(--success)' : 'var(--error)';
        }

        // Auto top-up
        const autoTopup = data.auto_topup || {};
        const enabledEl = document.getElementById('autoTopupEnabled');
        const fieldsEl = document.getElementById('autoTopupFields');
        if (enabledEl) enabledEl.checked = autoTopup.enabled || false;
        if (fieldsEl) fieldsEl.style.display = autoTopup.enabled ? 'block' : 'none';
        if (enabledEl) enabledEl.onchange = function() { if (fieldsEl) fieldsEl.style.display = enabledEl.checked ? 'block' : 'none'; };

        const thresholdEl = document.getElementById('autoTopupThreshold');
        const amountEl = document.getElementById('autoTopupAmount');
        if (thresholdEl) thresholdEl.value = String(autoTopup.threshold_cents || 100);
        if (amountEl) amountEl.value = String(autoTopup.amount_cents || 1000);
      } catch {}
    }

    window.startDeposit = async function() {
      const amountCents = parseInt(document.getElementById('depositAmount')?.value || '2500', 10);
      try {
        const res = await fetch('/api/user/hosting/checkout', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + authToken, 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount_cents: amountCents }),
        });
        const data = await res.json();
        if (!res.ok) { showToast(data.error || 'Failed to start checkout', 'error'); return; }
        if (data.checkout_url) {
          window.open(data.checkout_url, '_blank');
          showToast('Checkout opened. Balance updates after payment.');
        }
      } catch { showToast('Failed to start deposit', 'error'); }
    };

    window.saveAutoTopup = async function() {
      const enabled = document.getElementById('autoTopupEnabled')?.checked || false;
      const thresholdCents = parseInt(document.getElementById('autoTopupThreshold')?.value || '100', 10);
      const amountCents = parseInt(document.getElementById('autoTopupAmount')?.value || '1000', 10);
      try {
        const res = await fetch('/api/user/hosting/auto-topup', {
          method: 'PATCH',
          headers: { 'Authorization': 'Bearer ' + authToken, 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: enabled, threshold_cents: thresholdCents, amount_cents: amountCents }),
        });
        if (res.ok) { showToast('Auto top-up saved'); loadHostingData(); }
        else showToast('Failed to save', 'error');
      } catch { showToast('Failed to save', 'error'); }
    };

    // --- Supabase Servers ---
    async function loadSupabaseServers() {
      const container = document.getElementById('supabaseServersList');
      if (!container) return;
      try {
        const res = await fetch('/api/user/supabase', {
          headers: { 'Authorization': 'Bearer ' + authToken },
        });
        if (!res.ok) return;
        savedSupabaseServers = await res.json();

        if (!savedSupabaseServers || savedSupabaseServers.length === 0) {
          container.innerHTML = '<div style="font-size:13px;color:var(--text-muted);padding:8px 0">No Supabase servers configured.</div>';
          return;
        }

        container.innerHTML = savedSupabaseServers.map(function(s) {
          return '<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--border);font-size:13px">' +
            '<span style="flex:1;font-family:var(--font-mono);font-size:12px">' + escapeHtml(s.url || s.id) + '</span>' +
            '<button class="btn btn-danger btn-sm" onclick="deleteSupabaseServer(\'' + s.id + '\')">Remove</button>' +
          '</div>';
        }).join('');
      } catch {}
    }

    window.addSupabaseServer = async function() {
      const url = document.getElementById('supabaseUrl')?.value?.trim();
      const anonKey = document.getElementById('supabaseAnonKey')?.value?.trim();
      const serviceKey = document.getElementById('supabaseServiceKey')?.value?.trim();
      if (!url || !anonKey) { showToast('URL and Anon Key are required', 'error'); return; }
      try {
        const body = { url: url, anon_key: anonKey };
        if (serviceKey) body.service_role_key = serviceKey;
        const res = await fetch('/api/user/supabase', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + authToken, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (res.ok) {
          showToast('Supabase server added!');
          document.getElementById('supabaseUrl').value = '';
          document.getElementById('supabaseAnonKey').value = '';
          document.getElementById('supabaseServiceKey').value = '';
          loadSupabaseServers();
        } else showToast('Failed to add server', 'error');
      } catch { showToast('Failed to add', 'error'); }
    };

    window.deleteSupabaseServer = async function(configId) {
      if (!confirm('Remove this Supabase server?')) return;
      try {
        const res = await fetch('/api/user/supabase/' + configId, {
          method: 'DELETE',
          headers: { 'Authorization': 'Bearer ' + authToken },
        });
        if (res.ok) { showToast('Server removed'); loadSupabaseServers(); }
        else showToast('Failed to remove', 'error');
      } catch { showToast('Failed to remove', 'error'); }
    };


    // ===== Error Handling =====
    window.onerror = function(msg, src, line) {
      console.error('Runtime Error:', msg, 'at line', line);
    };
    window.onunhandledrejection = function(e) {
      console.error('Unhandled rejection:', e.reason);
    };

    // ===== Initialization =====
    await updateAuthUI();

    // Handle initial view
    ${initialView === 'app' && activeAppId ? `
    (async function() {
      await loadAppPage('${activeAppId}');
    })();
    ` : ''}

    // Handle ?setup=1 redirect (from OAuth popup fallback)
    (function() {
      var params = new URLSearchParams(window.location.search);
      if (params.get('setup') === '1' && authToken) {
        params.delete('setup');
        var cleanUrl = params.toString() ? window.location.pathname + '?' + params.toString() : window.location.pathname;
        history.replaceState({}, '', cleanUrl);
        setTimeout(function() { generateSetupInstructions(); }, 300);
      }
      if (params.get('popup') === '1') {
        // Clean up popup param
        params.delete('popup');
        var cleanUrl2 = params.toString() ? window.location.pathname + '?' + params.toString() : window.location.pathname;
        history.replaceState({}, '', cleanUrl2);
      }
    })();

    // Handle Stripe checkout redirect
    (function() {
      var params = new URLSearchParams(window.location.search);
      var topup = params.get('topup');
      if (topup === 'success') {
        var amountCents = parseInt(params.get('amount') || '0', 10);
        var dollars = amountCents > 0 ? ' ($' + (amountCents / 100).toFixed(2) + ')' : '';
        showToast('Deposit successful' + dollars + '! Balance will update shortly.');
        history.replaceState({}, '', window.location.pathname);
        setTimeout(function() { loadHostingData(); }, 2000);
        setTimeout(function() { loadHostingData(); }, 5000);
      } else if (topup === 'cancelled') {
        showToast('Deposit cancelled.', 'error');
        history.replaceState({}, '', window.location.pathname);
      }
    })();

  })();
  </script>
  </body>
</html>`;
}
