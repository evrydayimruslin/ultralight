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
      overscroll-behavior: none;
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
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
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
      padding-top: calc(var(--nav-height) + var(--space-12));
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
      align-items: flex-start;
      text-align: left;
      padding: var(--space-20) var(--space-6) var(--space-10);
      max-width: 820px;
      margin: 0 auto;
    }

    .hero h1 {
      font-size: 56px;
      font-weight: 600;
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
       APP LIST STYLES (replaces app-grid)
       ============================================ */
    .app-list {
      display: flex;
      flex-direction: column;
    }

    .app-row {
      display: flex;
      align-items: center;
      gap: var(--space-4);
      padding: var(--space-4) var(--space-3);
      border-bottom: 1px solid var(--border);
      cursor: pointer;
      transition: background var(--transition-fast);
    }

    .app-row:first-child {
      border-top: none;
    }

    .app-row:hover {
      background: var(--bg-hover);
    }

    .app-row-emoji {
      font-size: 20px;
      width: 32px;
      text-align: center;
      flex-shrink: 0;
    }

    .app-row-info {
      flex: 1;
      min-width: 0;
    }

    .app-row-name {
      font-size: 14px;
      font-weight: 600;
      color: var(--text-primary);
      display: flex;
      align-items: center;
      gap: var(--space-2);
    }

    .app-row-version {
      font-size: 11px;
      padding: 1px 6px;
      background: var(--accent-soft);
      color: var(--accent);
      font-weight: 500;
    }

    .app-row-fn-count {
      font-size: 11px;
      padding: 1px 6px;
      background: var(--bg-raised);
      border: 1px solid var(--border);
      color: var(--text-muted);
      font-weight: 500;
    }

    .app-row-desc {
      font-size: 13px;
      color: var(--text-secondary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-top: 2px;
    }

    /* ============================================
       SETTINGS SIDEBAR LAYOUT
       ============================================ */
    .settings-layout {
      display: flex;
      gap: var(--space-8);
      min-height: 60vh;
    }

    .settings-sidebar {
      width: 200px;
      flex-shrink: 0;
      position: sticky;
      top: calc(var(--nav-height) + var(--space-8));
      align-self: flex-start;
    }

    .settings-sidebar-item {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      padding: var(--space-2) var(--space-3);
      font-size: 13px;
      color: var(--text-secondary);
      cursor: pointer;
      transition: all var(--transition-fast);
      border-left: 2px solid transparent;
    }

    .settings-sidebar-item:hover {
      color: var(--text-primary);
      background: var(--bg-hover);
    }

    .settings-sidebar-item.active {
      color: var(--text-primary);
      font-weight: 600;
      border-left-color: var(--accent);
      background: var(--bg-subtle);
    }

    .settings-content {
      flex: 1;
      min-width: 0;
    }

    .settings-panel {
      animation: fade-in 0.15s ease;
    }

    .settings-sidebar-back {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      padding: var(--space-2) var(--space-3);
      font-size: 13px;
      color: var(--text-muted);
      cursor: pointer;
      transition: all var(--transition-fast);
      margin-bottom: var(--space-3);
      border-left: 2px solid transparent;
    }

    .settings-sidebar-back:hover {
      color: var(--text-primary);
    }

    .nav-copy-btn {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
      padding: var(--space-2) var(--space-4);
      font-size: 13px;
      font-weight: 500;
      color: var(--text-primary);
      background: var(--bg-hover);
      border: none;
      cursor: pointer;
      transition: all var(--transition-fast);
    }

    .nav-copy-btn:hover {
      background: var(--text-primary);
      color: var(--bg-base);
    }

    .app-overview-header {
      margin-bottom: var(--space-6);
      padding-bottom: var(--space-6);
      border-bottom: 1px solid var(--border);
    }

    .app-overview-header h1 {
      font-size: 22px;
      font-weight: 700;
      letter-spacing: -0.02em;
      margin-bottom: var(--space-2);
    }

    .app-panel-name {
      font-size: 22px;
      font-weight: 600;
      color: var(--text-primary);
      letter-spacing: -0.02em;
    }

    .app-section-title {
      font-size: 14px;
      font-weight: 500;
      color: var(--text-muted);
      margin-top: var(--space-1);
      margin-bottom: var(--space-5);
    }

    .app-overview-meta {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
    }

    .app-overview-meta .meta-row {
      display: flex;
      align-items: center;
      gap: var(--space-3);
    }

    /* ============================================
       MARKETPLACE STYLES
       ============================================ */
    .marketplace-search {
      width: 100%;
      padding: var(--space-2) var(--space-3);
      font-size: 13px;
      border: 1px solid var(--border);
      border-radius: 0;
      background: var(--bg-base);
      color: var(--text-primary);
      outline: none;
      transition: border-color var(--transition-fast);
    }

    .marketplace-search:focus {
      border-color: var(--text-primary);
    }

    .marketplace-search::placeholder {
      color: var(--text-tertiary);
    }

    .marketplace-filters {
      display: flex;
      gap: var(--space-2);
      margin-top: var(--space-3);
    }

    .marketplace-filter {
      padding: var(--space-1) var(--space-3);
      font-size: 12px;
      border: 1px solid var(--border);
      border-radius: 0;
      background: var(--bg-base);
      color: var(--text-secondary);
      cursor: pointer;
      transition: all var(--transition-fast);
    }

    .marketplace-filter:hover {
      border-color: var(--text-primary);
      color: var(--text-primary);
    }

    .marketplace-filter.active {
      background: var(--text-primary);
      color: var(--bg-base);
      border-color: var(--text-primary);
    }

    .marketplace-results {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
      margin-top: var(--space-4);
    }

    .marketplace-card {
      padding: var(--space-3) var(--space-4);
      border: 1px solid var(--border);
      background: var(--bg-base);
      cursor: pointer;
      transition: all var(--transition-fast);
    }

    .marketplace-card:hover {
      border-color: var(--text-primary);
    }

    .marketplace-card-header {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      margin-bottom: var(--space-2);
    }

    .marketplace-card-name {
      font-size: 14px;
      font-weight: 600;
      color: var(--text-primary);
    }

    .marketplace-badge {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      padding: 1px 6px;
      border: 1px solid var(--border);
      color: var(--text-tertiary);
    }

    .marketplace-card-desc {
      font-size: 13px;
      color: var(--text-secondary);
      line-height: 1.4;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    .marketplace-stats {
      display: flex;
      gap: var(--space-3);
      margin-top: var(--space-2);
      font-size: 11px;
      color: var(--text-tertiary);
    }

    /* ============================================
       APP DETAIL VIEW STYLES
       ============================================ */
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
      padding: var(--space-12) var(--space-6) 0;
    }

    .cap-section-heading {
      font-size: 11px;
      font-weight: 600;
      color: var(--text-secondary);
      letter-spacing: 0.08em;
      text-transform: uppercase;
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
        padding-top: calc(var(--nav-height) + var(--space-8));
      }

      .hero {
        padding: var(--space-12) var(--space-4) var(--space-8);
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

      .settings-layout {
        flex-direction: column;
      }

      .settings-sidebar {
        width: 100%;
        position: static;
        display: flex;
        gap: var(--space-1);
        overflow-x: auto;
        border-bottom: 1px solid var(--border);
        padding-bottom: var(--space-2);
        margin-bottom: var(--space-4);
      }

      .settings-sidebar-item {
        border-left: none;
        border-bottom: 2px solid transparent;
        white-space: nowrap;
        padding: var(--space-2) var(--space-3);
      }

      .settings-sidebar-item.active {
        border-left-color: transparent;
        border-bottom-color: var(--accent);
      }

      .nav-copy-btn {
        display: none;
      }

      .settings-sidebar-back {
        display: none;
      }

      .app-overview-header {
        padding-bottom: var(--space-4);
      }
    }

    @media (max-width: 480px) {
      .hero h1 {
        font-size: 28px;
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
      <button id="googleAuthBtn" class="auth-provider-btn" onclick="window.location.href='/auth/login';">
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
      <!-- Pre-auth nav items (hidden until JS checks auth state) -->
      <div id="navPreAuth" style="display:none;align-items:center;gap:var(--space-2);">
        <button id="navAuthBtn" class="btn btn-primary" style="border-radius:0;height:36px;padding:0 var(--space-5);font-size:14px;" onclick="document.getElementById('authOverlay').classList.remove('hidden')">Dashboard</button>
      </div>
      <!-- Post-auth nav items (hidden until JS checks auth state) -->
      <div id="navPostAuth" class="hidden" style="display:none;align-items:center;gap:var(--space-3);">
        <button id="navCopyInstructionsBtn" class="nav-copy-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
          Copy agent instructions
        </button>
        <div class="relative">
          <div id="profileTrigger" class="profile-trigger">
            <div id="profileAvatar" class="profile-avatar">U</div>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
          </div>
          <div id="profileDropdown" class="profile-dropdown">
            <div id="profileDropdownHeader" class="profile-dropdown-header"><span id="profileEmail" style="font-size:12px;color:var(--text-muted);display:block;margin-top:2px;"></span></div>
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
          <button id="heroCTA" class="btn btn-primary btn-lg" style="gap:var(--space-2);border-radius:0;">
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

      <!-- Section 1: Agent native infrastructure -->
      <section class="cap-section">
        <div class="cap-section-heading">Agent native infrastructure</div>
        <div class="cap-grid">
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
      <section style="max-width:820px;margin:0 auto;padding:var(--space-20) var(--space-6);text-align:left;">
        <h2 style="font-size:32px;font-weight:600;letter-spacing:-0.035em;line-height:1.15;color:var(--text-primary);margin-bottom:var(--space-8);">Start now.</h2>
        <div style="display:flex;justify-content:flex-start;">
          <button id="bottomCTA" class="btn btn-primary btn-lg" style="gap:var(--space-2);border-radius:0;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
            <span id="bottomCTAText">Copy agent instructions</span>
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
      <div class="settings-layout">
        <!-- Sidebar -->
        <nav class="settings-sidebar">
          <div class="settings-sidebar-item active" data-dash-section="library">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg>
            Library
          </div>
          <div class="settings-sidebar-item" data-dash-section="marketplace">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
            Marketplace
          </div>
          <div class="settings-sidebar-item" data-dash-section="keys">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
            API Keys
          </div>
          <div class="settings-sidebar-item" data-dash-section="offers">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
            Offers
          </div>
          <div class="settings-sidebar-item" data-dash-section="billing">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
            Wallet
          </div>
        </nav>

        <!-- Content Panels -->
        <div class="settings-content">
          <!-- Library Panel -->
          <section id="dashLibraryPanel" class="settings-panel">
            <h2 style="font-size:16px;font-weight:600;margin-bottom:var(--space-4);color:var(--text-primary);">Library</h2>
            <div id="appList" class="app-list"></div>
          </section>

          <!-- Marketplace Panel -->
          <section id="dashMarketplacePanel" class="settings-panel" style="display:none;">
            <h2 style="font-size:16px;font-weight:600;margin-bottom:var(--space-4);color:var(--text-primary);">Marketplace</h2>
            <input id="marketplaceSearch" class="marketplace-search" type="text" placeholder="Search apps and skills...">
            <div class="marketplace-filters">
              <button class="marketplace-filter active" data-mp-type="all">All</button>
              <button class="marketplace-filter" data-mp-type="apps">Apps</button>
              <button class="marketplace-filter" data-mp-type="skills">Skills</button>
            </div>
            <div id="marketplaceResults" class="marketplace-results">
              <div style="font-size:13px;color:var(--text-muted);padding:var(--space-4) 0;">Loading...</div>
            </div>
          </section>

          <!-- Offers Panel -->
          <section id="dashOffersPanel" class="settings-panel" style="display:none;">
            <h2 style="font-size:16px;font-weight:600;margin-bottom:var(--space-4);color:var(--text-primary);">My Offers</h2>
            <div id="offersIncoming" style="margin-bottom:var(--space-6);"></div>
            <div id="offersOutgoing"></div>
          </section>

          <!-- API Keys Panel -->
          <section id="dashKeysPanel" class="settings-panel" style="display:none;">
            <h2 style="font-size:16px;font-weight:600;margin-bottom:var(--space-4);color:var(--text-primary);">API Keys</h2>
            <p style="font-size:13px;color:var(--text-muted);margin-bottom:var(--space-4);">Manage your API tokens for CLI authentication and programmatic access.</p>
            <div id="tokensList" style="display:flex;flex-direction:column;gap:var(--space-2);margin-bottom:var(--space-4);"></div>
            <button id="createTokenBtn" class="btn btn-primary btn-sm" style="border-radius:0;">Create New Token</button>
          </section>

          <!-- Wallet Panel -->
          <section id="dashBillingPanel" class="settings-panel" style="display:none;">
            <h2 style="font-size:16px;font-weight:600;margin-bottom:var(--space-4);color:var(--text-primary);">Wallet</h2>

            <!-- Balance Section -->
            <div style="background:var(--bg-raised);border:1px solid var(--border);padding:var(--space-5);margin-bottom:var(--space-4);">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-4);">
                <div>
                  <div style="font-size:12px;color:var(--text-muted);margin-bottom:var(--space-1);">Available Balance</div>
                  <div id="accountBalance" style="font-size:28px;font-weight:700;color:var(--text-primary);">$0.00</div>
                </div>
                <div style="display:flex;gap:var(--space-2);">
                  <button id="addFundsBtn" class="btn btn-primary btn-sm" style="border-radius:0;">Add Funds</button>
                  <button id="withdrawBtn" class="btn btn-sm" style="border-radius:0;border:1px solid var(--border);display:none;" onclick="showWithdrawModal()">Withdraw</button>
                </div>
              </div>
            </div>

            <!-- Earnings Section -->
            <div style="background:var(--bg-raised);border:1px solid var(--border);padding:var(--space-5);margin-bottom:var(--space-4);">
              <div style="font-size:13px;font-weight:600;color:var(--text-primary);margin-bottom:var(--space-3);">Earnings</div>
              <div id="earningsSummary" style="font-size:13px;color:var(--text-muted);">Loading...</div>
            </div>

            <!-- Bank Payouts Section -->
            <div style="background:var(--bg-raised);border:1px solid var(--border);padding:var(--space-5);margin-bottom:var(--space-4);">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-3);">
                <div style="font-size:13px;font-weight:600;color:var(--text-primary);">Bank Payouts</div>
                <span id="connectStatusBadge" style="font-size:11px;padding:2px 8px;border-radius:2px;background:rgba(239,68,68,0.15);color:var(--error);">Not Connected</span>
              </div>
              <div id="connectSection">
                <p style="font-size:13px;color:var(--text-muted);margin-bottom:var(--space-3);">Connect your bank account to withdraw earnings.</p>
                <button id="connectBankBtn" class="btn btn-sm" style="border-radius:0;border:1px solid var(--border);" onclick="startConnectOnboarding()">Connect Bank Account</button>
              </div>
              <div id="payoutsHistory" style="margin-top:var(--space-3);font-size:13px;color:var(--text-muted);"></div>
            </div>

            <!-- Auto Top-up Section -->
            <div style="background:var(--bg-raised);border:1px solid var(--border);padding:var(--space-5);">
              <div style="font-size:13px;font-weight:600;color:var(--text-primary);margin-bottom:var(--space-3);">Auto Top-up</div>
              <label style="display:flex;align-items:center;gap:var(--space-2);font-size:13px;color:var(--text-secondary);cursor:pointer;margin-bottom:var(--space-3);">
                <input type="checkbox" id="autoTopupEnabled" style="accent-color:var(--accent);">
                Enable automatic top-up when balance is low
              </label>
              <div id="autoTopupFields" style="display:none;">
                <div style="display:flex;gap:var(--space-3);margin-bottom:var(--space-3);">
                  <div style="flex:1;">
                    <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:4px;">Threshold (cents)</label>
                    <input type="number" id="autoTopupThreshold" value="100" style="width:100%;padding:6px 8px;background:var(--bg-primary);border:1px solid var(--border);color:var(--text-primary);font-size:13px;">
                  </div>
                  <div style="flex:1;">
                    <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:4px;">Amount (cents)</label>
                    <input type="number" id="autoTopupAmount" value="1000" style="width:100%;padding:6px 8px;background:var(--bg-primary);border:1px solid var(--border);color:var(--text-primary);font-size:13px;">
                  </div>
                </div>
                <button class="btn btn-sm" style="border-radius:0;border:1px solid var(--border);" onclick="saveAutoTopup()">Save</button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>

    <!-- ==========================================
         APP DETAIL VIEW
         ========================================== -->
    <div id="appView" style="display:none;">
      <div class="settings-layout">
        <!-- App Sidebar -->
        <nav class="settings-sidebar">
          <div class="settings-sidebar-back" id="appBackBtn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            Back
          </div>
          <div class="settings-sidebar-item active" data-app-section="overview">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
            Overview
          </div>
          <div class="settings-sidebar-item" data-app-section="permissions">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
            Permissions
          </div>
          <div class="settings-sidebar-item" data-app-section="environment">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
            Environment
          </div>
          <div class="settings-sidebar-item" data-app-section="payments">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>
            Payments
          </div>
          <div class="settings-sidebar-item" data-app-section="logs">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
            Logs
          </div>
          <div class="settings-sidebar-item" data-app-section="market">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6"/></svg>
            Market
          </div>
        </nav>

        <!-- Content Panels -->
        <div class="settings-content">
          <!-- Overview Panel -->
          <section id="appOverviewPanel" class="settings-panel">
            <div id="appOverviewHeader" class="app-overview-header"></div>
            <h2 class="app-section-title">Overview</h2>
            <div id="appGeneralSettings"></div>
            <div id="appFunctionsSection"></div>
            <div id="skillsContent"></div>
          </section>

          <!-- Permissions Panel -->
          <section id="appPermissionsPanel" class="settings-panel" style="display:none;">
            <div class="app-panel-name"></div>
            <h2 class="app-section-title">Permissions</h2>
            <div id="appVisibilitySection"></div>
            <div id="permissionsContent"></div>
          </section>

          <!-- Environment Panel -->
          <section id="appEnvironmentPanel" class="settings-panel" style="display:none;">
            <div class="app-panel-name"></div>
            <h2 class="app-section-title">Environment</h2>
            <div id="databaseContent"></div>
            <div id="envVarsContent" style="margin-top:var(--space-6);"></div>
          </section>

          <!-- Payments Panel -->
          <section id="appPaymentsPanel" class="settings-panel" style="display:none;">
            <div class="app-panel-name"></div>
            <h2 class="app-section-title">Payments</h2>
            <div id="appPricingSection"></div>
            <div id="revenueSection" style="margin-top:var(--space-6);"></div>
          </section>

          <!-- Logs Panel -->
          <section id="appLogsPanel" class="settings-panel" style="display:none;">
            <div class="app-panel-name"></div>
            <h2 class="app-section-title">Logs</h2>
            <div id="appLogsContent"></div>
            <div id="appHealthSection" style="margin-top:var(--space-6);"></div>
          </section>

          <!-- Market Panel -->
          <section id="appMarketPanel" class="settings-panel" style="display:none;">
            <div class="app-panel-name"></div>
            <h2 class="app-section-title">Market</h2>
            <div id="appMarketContent"></div>
            <div id="appMarketBids" style="margin-top:var(--space-6);"></div>
            <div id="appMarketHistory" style="margin-top:var(--space-6);"></div>
          </section>
        </div>
      </div>
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
    let setupCommandStr = localStorage.getItem('ultralight_setup_v3') || '';

    // Instant auth nav switch — prevents flash of wrong nav state
    if (authToken) {
      document.getElementById('navPostAuth').style.display = 'flex';
      document.getElementById('navPostAuth').classList.remove('hidden');
    } else {
      document.getElementById('navPreAuth').style.display = 'flex';
    }
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

    // Hero CTA — handles both authenticated (copy with token) and pre-auth (provisional token) flows
    // Shared copy + animation helper for CTA buttons
    // Shows green checkmark SVG + "Copied! Paste to agent" for 5 seconds, then reverts
    async function copyAndAnimateCTA(btn, textEl, origBtnHTML) {
      if (!setupCommandStr) return;
      try {
        await navigator.clipboard.writeText(setupCommandStr);
        var checkSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
        btn.innerHTML = checkSvg + ' <span>' + 'Copied! Paste to agent' + '</span>';
        btn.style.background = 'var(--text-primary)';
        btn.style.color = 'var(--bg-base)';
        setTimeout(function() {
          btn.innerHTML = origBtnHTML;
          btn.style.background = '';
          btn.style.color = '';
        }, 5000);
      } catch(e2) {
        showToast('Failed to copy', 'error');
      }
    }

    function setupHeroCTA() {
      var btn = document.getElementById('heroCTA');
      if (!btn) return;
      var origHTML = btn.innerHTML;
      if (authToken) {
        // Authenticated: generate instructions with real API token
        btn.onclick = async function(e) {
          e.preventDefault();
          if (!setupCommandStr) {
            var textEl = document.getElementById('heroCTAText');
            if (textEl) textEl.textContent = 'Generating...';
            btn.disabled = true;
            await generateSetupInstructions();
            btn.disabled = false;
          }
          await copyAndAnimateCTA(btn, null, origHTML);
        };
      } else {
        // Not authenticated: create provisional token (zero-friction onboarding)
        btn.onclick = async function(e) {
          e.preventDefault();
          if (!setupCommandStr) {
            var textEl = document.getElementById('heroCTAText');
            if (textEl) textEl.textContent = 'Setting up...';
            btn.disabled = true;
            try {
              await generateProvisionalInstructions();
            } catch(err) {
              if (textEl) textEl.textContent = 'Copy agent instructions';
              btn.disabled = false;
              // Fallback: show auth overlay if provisional creation fails
              document.getElementById('authOverlay').classList.remove('hidden');
              return;
            }
            btn.disabled = false;
          }
          await copyAndAnimateCTA(btn, null, origHTML);
        };
      }
    }

    function setupBottomCTA() {
      var btn = document.getElementById('bottomCTA');
      if (!btn) return;
      var origHTML = btn.innerHTML;
      if (authToken) {
        btn.onclick = async function(e) {
          e.preventDefault();
          if (!setupCommandStr) {
            var textEl = document.getElementById('bottomCTAText');
            if (textEl) textEl.textContent = 'Generating...';
            btn.disabled = true;
            await generateSetupInstructions();
            btn.disabled = false;
          }
          await copyAndAnimateCTA(btn, null, origHTML);
        };
      } else {
        btn.onclick = async function(e) {
          e.preventDefault();
          if (!setupCommandStr) {
            var textEl = document.getElementById('bottomCTAText');
            if (textEl) textEl.textContent = 'Setting up...';
            btn.disabled = true;
            try {
              await generateProvisionalInstructions();
            } catch(err) {
              if (textEl) textEl.textContent = 'Copy agent instructions';
              btn.disabled = false;
              document.getElementById('authOverlay').classList.remove('hidden');
              return;
            }
            btn.disabled = false;
          }
          await copyAndAnimateCTA(btn, null, origHTML);
        };
      }
    }

    // Close auth overlay on backdrop click
    document.getElementById('authOverlay')?.addEventListener('click', function(e) {
      if (e.target === this) hideAuthOverlay();
    });
    // Close button
    document.getElementById('authCloseBtn')?.addEventListener('click', hideAuthOverlay);

    // Auth is same-window redirect — token is stored in localStorage by callback page
    // On page load, authToken is already read from localStorage above

    async function updateAuthUI() {
      // Always set up hero CTA (handles both pre-auth and post-auth paths)
      setupHeroCTA();
      setupBottomCTA();

      if (!authToken) {
        // Not authenticated — clear any stale cached instructions from a previous session
        setupCommandStr = '';
        localStorage.removeItem('ultralight_setup_v3');
        document.getElementById('navPreAuth').classList.remove('hidden');
        var navPostEl = document.getElementById('navPostAuth');
        navPostEl.classList.add('hidden');
        navPostEl.style.display = 'none';
        showView('home');
        return;
      }

      // Clean up provisional state now that user is authenticated
      localStorage.removeItem('ultralight_provisional_token_id');
      localStorage.removeItem('ultralight_provisional_user_id');

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
          // Store user ID for marketplace ownership checks
          if (userProfile && userProfile.id) {
            window._currentUserId = userProfile.id;
          }
        }
      } catch {}

      // Update nav
      console.log('[updateAuthUI] switching to post-auth nav');
      document.getElementById('navPreAuth').classList.add('hidden');
      var navPost = document.getElementById('navPostAuth');
      navPost.classList.remove('hidden');
      navPost.style.display = 'flex';

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
            var ctaBtn = document.getElementById('heroCTA');
            if (ctaBtn) {
              await copyAndAnimateCTA(ctaBtn, null, ctaBtn.innerHTML);
            }
          }
          showSetupBlock();
        }
      } else if (currentView === 'dashboard') {
        // Check if URL is actually a settings sub-route
        var pathname = window.location.pathname;
        if (pathname === '/settings' || pathname.startsWith('/settings/')) {
          var settingsSection = pathname.split('/settings/')[1] || 'keys';
          if (settingsSection === 'tokens') settingsSection = 'keys';
          showView('dashboard');
          switchDashSection(settingsSection);
          loadAccountData();
        } else if (pathname === '/marketplace') {
          showView('dashboard');
          switchDashSection('marketplace');
        } else {
          showView('dashboard');
          switchDashSection('library');
          loadDashboardData();
        }
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
      localStorage.removeItem('ultralight_setup_v3');
      if (connectionPollInterval) clearInterval(connectionPollInterval);
      window.location.href = '/';
    }
    window.signOut = signOut;

    // ===== Navigation =====
    function showView(view) {
      currentView = view;
      ['homeView', 'dashboardView', 'appView'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
      });

      const viewMap = {
        home: 'homeView',
        dashboard: 'dashboardView',
        app: 'appView',
        leaderboard: 'dashboardView',
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
      switchDashSection('library');
      renderAppList();
      loadDashboardData();
    }

    function navigateToApp(appId, section) {
      var sec = section || 'overview';
      if (sec === 'overview') {
        history.pushState({}, '', '/a/' + appId);
      } else {
        history.pushState({}, '', '/a/' + appId + '/' + sec);
      }
      currentAppId = appId;
      showView('app');
      loadAppPage(appId, sec);
    }
    window.navigateToApp = navigateToApp;

    function navigateToAccount(section) {
      var sec = section || 'keys';
      // Map old names to new
      if (sec === 'tokens') sec = 'keys';
      history.pushState({}, '', '/settings/' + sec);
      showView('dashboard');
      switchDashSection(sec);
      loadAccountData();
    }
    window.navigateToAccount = navigateToAccount;

    window.addEventListener('popstate', async function() {
      const path = window.location.pathname;
      if (path === '/' || path === '/home') {
        navigateToHome();
      } else if (path === '/dash' || path === '/dashboard') {
        showView('dashboard');
        switchDashSection('library');
        renderAppList();
        loadDashboardData();
      } else if (path === '/marketplace') {
        showView('dashboard');
        switchDashSection('marketplace');
      } else if (path === '/settings' || path.startsWith('/settings/')) {
        const section = path.split('/settings/')[1] || 'keys';
        showView('dashboard');
        switchDashSection(section);
        loadAccountData();
      } else if (path.startsWith('/a/')) {
        const parts = path.slice(3).split('/');
        const appId = parts[0];
        const section = parts[1] || 'overview';
        currentAppId = appId;
        showView('app');
        loadAppPage(appId, section);
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
        if (action === 'signout') signOut();
      });
    });

    // ===== Dashboard Sidebar =====
    let activeDashSection = 'library';

    function switchDashSection(section) {
      activeDashSection = section;

      // Update sidebar active state
      document.querySelectorAll('[data-dash-section]').forEach(function(el) {
        el.classList.toggle('active', el.dataset.dashSection === section);
      });

      // Show/hide panels
      var panelMap = {
        library: 'dashLibraryPanel',
        marketplace: 'dashMarketplacePanel',
        offers: 'dashOffersPanel',
        keys: 'dashKeysPanel',
        billing: 'dashBillingPanel'
      };

      Object.values(panelMap).forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.style.display = 'none';
      });

      var panel = document.getElementById(panelMap[section]);
      if (panel) panel.style.display = 'block';

      // Update URL and load section data
      if (section === 'library') {
        history.replaceState({}, '', '/dash');
      } else if (section === 'marketplace') {
        history.replaceState({}, '', '/marketplace');
        loadMarketplace('', 'all');
      } else if (section === 'offers') {
        history.replaceState({}, '', '/settings/offers');
        loadMyOffers();
      } else if (section === 'keys') {
        history.replaceState({}, '', '/settings/' + section);
        loadTokens();
      } else if (section === 'billing') {
        history.replaceState({}, '', '/settings/billing');
        loadHostingData();
        loadEarnings();
        loadConnectStatus();
        loadPayouts();
      } else {
        history.replaceState({}, '', '/settings/' + section);
      }
    }

    // Dashboard sidebar click handlers
    document.querySelectorAll('[data-dash-section]').forEach(function(el) {
      el.addEventListener('click', function() {
        switchDashSection(this.dataset.dashSection);
      });
    });

    // ===== Marketplace =====
    var marketplaceType = 'all';
    var marketplaceDebounce = null;
    var marketplaceLoaded = false;

    function loadMarketplace(query, type) {
      var resultsEl = document.getElementById('marketplaceResults');
      if (!resultsEl) return;
      resultsEl.innerHTML = '<div style="font-size:13px;color:var(--text-muted);padding:var(--space-4) 0;">Loading...</div>';

      var params = new URLSearchParams();
      if (query) params.set('q', query);
      if (type && type !== 'all') params.set('type', type);
      params.set('limit', '30');

      fetch('/api/discover/marketplace?' + params.toString())
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (!data.results || data.results.length === 0) {
            resultsEl.innerHTML = '<div style="font-size:13px;color:var(--text-muted);padding:var(--space-4) 0;">No results found.</div>';
            return;
          }
          resultsEl.innerHTML = data.results.map(function(item) {
            var badge = item.type === 'app' ? 'App' : 'Skill';
            var desc = item.description || '';
            if (desc.length > 120) desc = desc.slice(0, 120) + '...';
            var stats = '';
            if (item.type === 'app') {
              var parts = [];
              if (item.likes > 0) parts.push(item.likes + ' likes');
              if (item.runs_30d > 0) parts.push(item.runs_30d + ' runs');
              if (item.fully_native) parts.push('native');
              if (parts.length > 0) stats = '<div class="marketplace-stats">' + parts.join(' &middot; ') + '</div>';
            } else {
              var tagStr = (item.tags || []).slice(0, 3).join(', ');
              if (tagStr) stats = '<div class="marketplace-stats">' + tagStr + '</div>';
            }
            var clickAction = item.type === 'app'
              ? 'navigateToApp(\\\'' + item.id + '\\\')'
              : 'window.open(\\\'' + (item.url || '/p/' + item.slug) + '\\\', \\\'_blank\\\')';
            return '<div class="marketplace-card" onclick="' + clickAction + '">'
              + '<div class="marketplace-card-header">'
              + '<span class="marketplace-card-name">' + (item.name || item.slug) + '</span>'
              + '<span class="marketplace-badge">' + badge + '</span>'
              + '</div>'
              + (desc ? '<div class="marketplace-card-desc">' + desc + '</div>' : '')
              + stats
              + '</div>';
          }).join('');
          marketplaceLoaded = true;
        })
        .catch(function() {
          resultsEl.innerHTML = '<div style="font-size:13px;color:var(--text-muted);padding:var(--space-4) 0;">Failed to load marketplace.</div>';
        });
    }

    // Marketplace search input
    var mpSearchInput = document.getElementById('marketplaceSearch');
    if (mpSearchInput) {
      mpSearchInput.addEventListener('input', function() {
        var q = this.value.trim();
        if (marketplaceDebounce) clearTimeout(marketplaceDebounce);
        marketplaceDebounce = setTimeout(function() {
          loadMarketplace(q, marketplaceType);
        }, 300);
      });
    }

    // ===== My Offers =====
    function loadMyOffers() {
      var inEl = document.getElementById('offersIncoming');
      var outEl = document.getElementById('offersOutgoing');
      if (!inEl || !outEl) return;

      inEl.innerHTML = '<div class="loading-text">Loading incoming offers...</div>';
      outEl.innerHTML = '<div class="loading-text">Loading outgoing bids...</div>';

      fetch('/api/marketplace/offers', {
        headers: { 'Authorization': 'Bearer ' + authToken },
      }).then(function(res) {
        if (!res.ok) throw new Error('Failed to load');
        return res.json();
      }).then(function(data) {
        var incoming = data.incoming || [];
        var outgoing = data.outgoing || [];

        // Incoming bids (as seller)
        if (incoming.length === 0) {
          inEl.innerHTML =
            '<h3 style="font-size:14px;font-weight:600;margin-bottom:var(--space-3);color:var(--text-primary)">Incoming Bids</h3>' +
            '<p style="font-size:13px;color:var(--text-muted)">No active bids on your apps.</p>';
        } else {
          inEl.innerHTML =
            '<h3 style="font-size:14px;font-weight:600;margin-bottom:var(--space-3);color:var(--text-primary)">Incoming Bids (' + incoming.length + ')</h3>' +
            '<table style="width:100%;font-size:13px;border-collapse:collapse">' +
              '<thead><tr style="border-bottom:1px solid var(--border);text-align:left">' +
                '<th style="padding:8px 12px;color:var(--text-muted);font-weight:500">App</th>' +
                '<th style="padding:8px 12px;color:var(--text-muted);font-weight:500">Bidder</th>' +
                '<th style="padding:8px 12px;color:var(--text-muted);font-weight:500">Amount</th>' +
                '<th style="padding:8px 12px;color:var(--text-muted);font-weight:500">Message</th>' +
                '<th style="padding:8px 12px;color:var(--text-muted);font-weight:500">Time</th>' +
                '<th style="padding:8px 12px;color:var(--text-muted);font-weight:500">Actions</th>' +
              '</tr></thead><tbody>' +
              incoming.map(function(bid) {
                return '<tr style="border-bottom:1px solid var(--border)">' +
                  '<td style="padding:8px 12px"><a href="/a/' + bid.app_id + '/market" style="color:var(--accent)">' + escapeHtml(bid.app_name || 'Unknown') + '</a></td>' +
                  '<td style="padding:8px 12px">' + escapeHtml(bid.bidder_email || 'Unknown') + '</td>' +
                  '<td style="padding:8px 12px;font-weight:600;color:var(--success)">$' + (bid.amount_cents / 100).toFixed(2) + '</td>' +
                  '<td style="padding:8px 12px;color:var(--text-muted);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHtml(bid.message || '-') + '</td>' +
                  '<td style="padding:8px 12px;color:var(--text-muted)">' + relTime(bid.created_at) + '</td>' +
                  '<td style="padding:8px 12px">' +
                    '<button class="btn btn-primary btn-sm" style="margin-right:4px" onclick="acceptBid(\'' + bid.bid_id + '\',\'' + bid.app_id + '\')">Accept</button>' +
                    '<button class="btn btn-secondary btn-sm" onclick="rejectBid(\'' + bid.bid_id + '\',\'' + bid.app_id + '\')">Reject</button>' +
                  '</td>' +
                '</tr>';
              }).join('') +
            '</tbody></table>';
        }

        // Outgoing bids (as buyer)
        if (outgoing.length === 0) {
          outEl.innerHTML =
            '<h3 style="font-size:14px;font-weight:600;margin-bottom:var(--space-3);color:var(--text-primary)">Your Bids</h3>' +
            '<p style="font-size:13px;color:var(--text-muted)">You haven\'t placed any bids.</p>';
        } else {
          outEl.innerHTML =
            '<h3 style="font-size:14px;font-weight:600;margin-bottom:var(--space-3);color:var(--text-primary)">Your Bids (' + outgoing.length + ')</h3>' +
            '<table style="width:100%;font-size:13px;border-collapse:collapse">' +
              '<thead><tr style="border-bottom:1px solid var(--border);text-align:left">' +
                '<th style="padding:8px 12px;color:var(--text-muted);font-weight:500">App</th>' +
                '<th style="padding:8px 12px;color:var(--text-muted);font-weight:500">Amount</th>' +
                '<th style="padding:8px 12px;color:var(--text-muted);font-weight:500">Status</th>' +
                '<th style="padding:8px 12px;color:var(--text-muted);font-weight:500">Escrow</th>' +
                '<th style="padding:8px 12px;color:var(--text-muted);font-weight:500">Time</th>' +
                '<th style="padding:8px 12px;color:var(--text-muted);font-weight:500">Actions</th>' +
              '</tr></thead><tbody>' +
              outgoing.map(function(bid) {
                var statusColor = bid.status === 'active' ? 'var(--accent)' : bid.status === 'accepted' ? 'var(--success)' : 'var(--text-muted)';
                var cancelBtn = bid.status === 'active'
                  ? '<button class="btn btn-secondary btn-sm" onclick="cancelBidFromUI(\'' + bid.bid_id + '\',\'' + bid.app_id + '\')">Cancel</button>'
                  : '';
                return '<tr style="border-bottom:1px solid var(--border)">' +
                  '<td style="padding:8px 12px"><a href="/a/' + bid.app_id + '/market" style="color:var(--accent)">' + escapeHtml(bid.app_name || 'Unknown') + '</a></td>' +
                  '<td style="padding:8px 12px;font-weight:600">$' + (bid.amount_cents / 100).toFixed(2) + '</td>' +
                  '<td style="padding:8px 12px"><span style="color:' + statusColor + '">' + bid.status + '</span></td>' +
                  '<td style="padding:8px 12px;color:var(--text-muted)">' + bid.escrow_status + '</td>' +
                  '<td style="padding:8px 12px;color:var(--text-muted)">' + relTime(bid.created_at) + '</td>' +
                  '<td style="padding:8px 12px">' + cancelBtn + '</td>' +
                '</tr>';
              }).join('') +
            '</tbody></table>';
        }
      }).catch(function() {
        inEl.innerHTML = '<p style="font-size:13px;color:var(--text-muted)">Could not load offers.</p>';
        outEl.innerHTML = '';
      });
    }

    // Marketplace filter pills
    document.querySelectorAll('[data-mp-type]').forEach(function(el) {
      el.addEventListener('click', function() {
        marketplaceType = this.dataset.mpType;
        document.querySelectorAll('[data-mp-type]').forEach(function(btn) {
          btn.classList.toggle('active', btn.dataset.mpType === marketplaceType);
        });
        var q = (document.getElementById('marketplaceSearch') || {}).value || '';
        loadMarketplace(q.trim(), marketplaceType);
      });
    });

    // ===== App Sidebar =====
    let activeAppSection = 'overview';

    function switchAppSection(section) {
      activeAppSection = section;

      // Update sidebar active state
      document.querySelectorAll('[data-app-section]').forEach(function(el) {
        el.classList.toggle('active', el.dataset.appSection === section);
      });

      // Show/hide panels
      var panelMap = {
        overview: 'appOverviewPanel',
        permissions: 'appPermissionsPanel',
        environment: 'appEnvironmentPanel',
        payments: 'appPaymentsPanel',
        logs: 'appLogsPanel',
        market: 'appMarketPanel'
      };

      Object.values(panelMap).forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.style.display = 'none';
      });

      var panel = document.getElementById(panelMap[section]);
      if (panel) panel.style.display = 'block';

      // Update URL
      if (section === 'overview') {
        history.replaceState({}, '', '/a/' + currentAppId);
      } else {
        history.replaceState({}, '', '/a/' + currentAppId + '/' + section);
      }
    }

    // App sidebar click handlers
    document.querySelectorAll('[data-app-section]').forEach(function(el) {
      el.addEventListener('click', function() {
        switchAppSection(this.dataset.appSection);
      });
    });

    // Back button handler
    document.getElementById('appBackBtn')?.addEventListener('click', function(e) {
      e.preventDefault();
      navigateToDashboard();
    });

    // Nav copy instructions button
    document.getElementById('navCopyInstructionsBtn')?.addEventListener('click', async function() {
      var btn = document.getElementById('navCopyInstructionsBtn');
      var origText = btn.innerHTML;
      if (!setupCommandStr) {
        btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="animation:spin 1s linear infinite"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg> Generating...';
        btn.disabled = true;
        await generateSetupInstructions();
        btn.disabled = false;
      }
      if (setupCommandStr) {
        try {
          await navigator.clipboard.writeText(setupCommandStr);
          btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Copied. Paste to agent';
          btn.style.background = 'var(--text-primary)';
          btn.style.color = 'var(--bg-base)';
          setTimeout(function() {
            btn.innerHTML = origText;
            btn.style.background = '';
            btn.style.color = '';
          }, 5000);
        } catch(e) {
          btn.innerHTML = origText;
          showToast('Failed to copy', 'error');
        }
      } else {
        btn.innerHTML = origText;
        showToast('Could not generate setup instructions', 'error');
      }
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
        // Fetch onboarding template and create token in parallel
        var [templateRes, tokenRes] = await Promise.all([
          fetch('/api/onboarding/instructions'),
          fetch('/api/user/tokens', {
            method: 'POST',
            headers: {
              'Authorization': 'Bearer ' + authToken,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ name: 'Agent Setup — ' + new Date().toLocaleString() }),
          })
        ]);

        // Use dynamic template, fall back to minimal hardcoded string
        var template = "I'd like you to set up Ultralight, the instant MCP app platform.\\nRun: npx ultralightpro setup --token {TOKEN}";
        if (templateRes.ok) {
          try {
            var templateData = await templateRes.json();
            if (templateData.template) template = templateData.template;
          } catch (e) { /* use fallback template */ }
        }

        if (!tokenRes.ok) {
          setupCommandStr = window.location.origin + '/mcp/platform';
          return;
        }

        var data = await tokenRes.json();
        var token = data.plaintext_token;
        var tokenId = data.id;

        setupCommandStr = template.replace(/\\{TOKEN\\}/g, token).replace(/\\{SESSION_NOTE\\}/g, '');
        localStorage.setItem('ultralight_setup_v3', setupCommandStr);

        var commandEl = document.getElementById('setupCode');
        if (commandEl) commandEl.textContent = setupCommandStr;

        showSetupBlock();

        // Start polling for connection
        if (tokenId) startConnectionPolling(tokenId);

      } catch (err) {
        setupCommandStr = window.location.origin + '/mcp/platform';
      }
    }

    // Generate setup instructions for unauthenticated visitors (provisional token)
    async function generateProvisionalInstructions() {
      // Fetch template and create provisional token in parallel
      var [templateRes, provRes] = await Promise.all([
        fetch('/api/onboarding/instructions'),
        fetch('/auth/provisional', { method: 'POST' })
      ]);

      // Use dynamic template, fall back to minimal hardcoded string
      var template = "I'd like you to set up Ultralight, the instant MCP app platform.\\nRun: npx ultralightpro setup --token {TOKEN}";
      if (templateRes.ok) {
        try {
          var templateData = await templateRes.json();
          if (templateData.template) template = templateData.template;
        } catch (e) { /* use fallback template */ }
      }

      if (!provRes.ok) {
        if (provRes.status === 429) {
          showToast('Rate limit reached. Please sign in instead.', 'error');
        }
        throw new Error('Failed to create provisional token');
      }

      var data = await provRes.json();
      var token = data.token;
      var tokenId = data.token_id;

      // Store provisional IDs for merge on OAuth sign-in
      localStorage.setItem('ultralight_provisional_token_id', tokenId);
      localStorage.setItem('ultralight_provisional_user_id', data.user_id);

      // Replace placeholders — provisional users get a session note about limits
      var sessionNote = '\\n> Note: This is a provisional session (50 calls/day, 5MB storage, no memory). Sign in at ultralight.dev to unlock full access and keep your data permanently.\\n';
      setupCommandStr = template.replace(/\\{TOKEN\\}/g, token).replace(/\\{SESSION_NOTE\\}/g, sessionNote);
      localStorage.setItem('ultralight_setup_v3', setupCommandStr);

      var commandEl = document.getElementById('setupCode');
      if (commandEl) commandEl.textContent = setupCommandStr;

      // Note: don't call startConnectionPolling() for provisional users —
      // it requires JWT auth which provisional users don't have.
      // Connection polling happens after they sign in and merge.
    }

    // Copy setup command
    document.getElementById('setupCopyBtn')?.addEventListener('click', async function() {
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

    // ===== Apps =====
    async function loadApps() {
      if (!authToken) return;
      try {
        const res = await fetch('/api/apps/me', {
          headers: { 'Authorization': 'Bearer ' + authToken },
        });
        if (res.ok) {
          apps = await res.json();
          renderAppList();
        }
      } catch {}
    }

    function renderAppList(filterText) {
      const list = document.getElementById('appList');
      if (!list) return;

      const filtered = filterText
        ? apps.filter(function(a) {
            const searchStr = ((a.name || '') + ' ' + (a.description || '') + ' ' + (a.slug || '')).toLowerCase();
            return searchStr.indexOf(filterText.toLowerCase()) !== -1;
          })
        : apps;

      if (!filtered || filtered.length === 0) {
        list.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📡</div><div class="empty-state-title">' +
          (filterText ? 'No matching apps' : 'No apps yet') +
          '</div><div class="empty-state-desc">' +
          (filterText ? 'Try a different search term.' : 'Copy the agent instructions and paste them into your agent to deploy your first app.') +
          '</div></div>';
        return;
      }

      list.innerHTML = filtered.map(function(app) {
        const emoji = getAppEmoji(app.name || app.slug);
        const name = escapeHtml(app.name || app.slug || 'Untitled');
        const desc = escapeHtml((app.description || '').slice(0, 120));
        const version = escapeHtml(app.current_version || 'v1.0.0');
        const fnCount = (app.manifest?.functions || []).length;
        return '<div class="app-row" onclick="navigateToApp(\\\'' + app.id + '\\\')">' +
          '<div class="app-row-emoji">' + emoji + '</div>' +
          '<div class="app-row-info">' +
            '<div class="app-row-name">' + name +
              ' <span class="app-row-version">' + version + '</span>' +
              ' <span class="app-row-fn-count">' + fnCount + ' fn' + (fnCount !== 1 ? 's' : '') + '</span>' +
            '</div>' +
            (desc ? '<div class="app-row-desc">' + desc + '</div>' : '') +
          '</div>' +
        '</div>';
      }).join('');
    }

    // Search input listener
    document.getElementById('appSearchInput')?.addEventListener('input', function() {
      renderAppList(this.value);
    });

    // (Copy agent instructions moved to nav bar — see navCopyInstructionsBtn handler above)

    // ===== Dashboard =====
    async function loadDashboardData() {
      renderAppList();
    }


    // ===== App Detail Page =====
    async function loadAppPage(appId, section) {
      if (!authToken || !appId) return;

      var sec = section || 'overview';
      switchAppSection(sec);

      try {
        const res = await fetch('/api/apps/' + appId, {
          headers: { 'Authorization': 'Bearer ' + authToken },
        });
        if (!res.ok) {
          showToast('Failed to load app', 'error');
          return;
        }
        const app = await res.json();

        document.title = (app.name || app.slug) + ' - Ultralight';

        // Store current app data for editing
        window._currentApp = app;

        // Set app name on all panels
        var appName = escapeHtml(app.name || app.slug || 'Untitled');
        document.querySelectorAll('.app-panel-name').forEach(function(el) {
          el.textContent = app.name || app.slug || 'Untitled';
        });

        // Load all sections
        loadAppOverview(app);
        loadAppPermissions(app);
        loadAppEnvironment(app);
        loadAppPayments(appId, app);
        loadAppLogsSection(appId);
        loadAppMarket(appId, app);

      } catch (err) {
        showToast('Error loading app: ' + (err.message || ''), 'error');
      }
    }

    // ===== App Overview =====
    function loadAppOverview(app) {
      // -- App header (meta only — app name is set by loadAppPage) --
      const headerEl = document.getElementById('appOverviewHeader');
      if (headerEl) {
        const endpointUrl = window.location.origin + '/mcp/' + app.id;
        headerEl.innerHTML =
          '<div class="app-panel-name">' + escapeHtml(app.name || app.slug || 'Untitled') + '</div>' +
          '<div class="app-overview-meta" style="margin-bottom:var(--space-4);">' +
            '<div class="meta-row">' +
              '<span style="font-size:12px;padding:2px 8px;background:var(--accent-soft);color:var(--accent);font-weight:500;">' + escapeHtml(app.current_version || 'v1.0.0') + '</span>' +
              '<span style="font-size:12px;padding:2px 8px;background:rgba(52,211,153,0.1);color:var(--success);font-weight:500;">Active</span>' +
            '</div>' +
            '<div class="meta-row">' +
              '<span style="font-size:12px;color:var(--text-muted);">MCP Endpoint:</span>' +
              '<code style="font-size:12px;font-family:var(--font-mono);color:var(--text-secondary);background:var(--bg-active);padding:2px 8px;">' + escapeHtml(endpointUrl) + '</code>' +
              '<button class="btn btn-ghost btn-sm" style="padding:2px 6px;font-size:11px;" onclick="copyAppEndpoint()">Copy</button>' +
            '</div>' +
          '</div>';
      }

      // -- General settings --
      const generalEl = document.getElementById('appGeneralSettings');
      if (generalEl) {
        generalEl.innerHTML =
          '<div class="section-card">' +
            '<h3 class="section-title">General</h3>' +
            '<div style="display:flex;flex-direction:column;gap:var(--space-4);">' +
              '<div><label class="form-label">App Name</label><input type="text" id="settingName" class="form-input" value="' + escapeHtml(app.name || '') + '"></div>' +
              '<div><label class="form-label">Visibility</label><select id="settingVisibility" class="form-input"><option value="private"' + (app.visibility === 'private' ? ' selected' : '') + '>Private</option><option value="unlisted"' + (app.visibility === 'unlisted' ? ' selected' : '') + '>Unlisted</option><option value="published"' + (app.visibility === 'published' ? ' selected' : '') + '>Published</option></select></div>' +
              '<div><label class="form-label">Download Access</label><select id="settingDownload" class="form-input"><option value="owner"' + (app.download_access === 'owner' ? ' selected' : '') + '>Owner Only</option><option value="public"' + (app.download_access === 'public' ? ' selected' : '') + '>Public</option></select></div>' +
              '<div><label class="form-label">Version</label><select id="settingVersion" class="form-input">' +
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
          '</div>';
      }

      // -- Functions list --
      const fnsEl = document.getElementById('appFunctionsSection');
      if (fnsEl) {
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
          : '<div style="font-size:13px;color:var(--text-muted);">No functions found in manifest.</div>';

        fnsEl.innerHTML =
          '<div class="section-card">' +
            '<h3 class="section-title">Functions</h3>' +
            functionsHtml +
          '</div>';
      }

      // -- Skills --
      const skillsEl = document.getElementById('skillsContent');
      if (skillsEl) {
        skillsEl.innerHTML = '<div class="section-card"><h3 class="section-title">Skills / Documentation</h3><div class="loading-text">Loading...</div></div>';
        loadSkills(app.id);
      }
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

    // ===== App Section Loaders =====
    function loadAppPermissions(app) {
      // Visibility + download access selectors
      const visEl = document.getElementById('appVisibilitySection');
      if (visEl) {
        visEl.innerHTML =
          '<div class="section-card" style="margin-bottom:var(--space-4);">' +
            '<h3 class="section-title">Access Control</h3>' +
            '<div style="display:flex;flex-direction:column;gap:var(--space-4);">' +
              '<div><label class="form-label">Visibility</label><select id="permVisibility" class="form-input"><option value="private"' + (app.visibility === 'private' ? ' selected' : '') + '>Private</option><option value="unlisted"' + (app.visibility === 'unlisted' ? ' selected' : '') + '>Unlisted</option><option value="published"' + (app.visibility === 'published' ? ' selected' : '') + '>Published</option></select></div>' +
              '<div><label class="form-label">Download Access</label><select id="permDownload" class="form-input"><option value="owner"' + (app.download_access === 'owner' ? ' selected' : '') + '>Owner Only</option><option value="public"' + (app.download_access === 'public' ? ' selected' : '') + '>Public</option></select></div>' +
            '</div>' +
          '</div>';
      }
      // Load granted users
      const permsEl = document.getElementById('permissionsContent');
      if (permsEl) {
        permsEl.innerHTML = '<div class="loading-text">Loading...</div>';
        loadPermissions(app.id);
      }
    }

    function loadAppEnvironment(app) {
      const dbEl = document.getElementById('databaseContent');
      if (dbEl) {
        dbEl.innerHTML = '<div class="section-card"><h3 class="section-title">Database</h3><div class="loading-text">Loading...</div></div>';
        loadDatabase(app.id);
      }
      const envEl = document.getElementById('envVarsContent');
      if (envEl) {
        envEl.innerHTML = '<div class="section-card"><h3 class="section-title">Environment Variables</h3><div class="loading-text">Loading...</div></div>';
        loadEnvVars(app.id);
      }
    }

    function loadAppPayments(appId, app) {
      const pricingEl = document.getElementById('appPricingSection');
      if (pricingEl) {
        const pricingConfig = app.pricing_config || {};
        const defaultPrice = pricingConfig.default_price_cents || 0;
        const fnPrices = pricingConfig.function_prices ? JSON.stringify(pricingConfig.function_prices, null, 2) : '';

        pricingEl.innerHTML =
          '<div class="section-card">' +
            '<h3 class="section-title">Pricing</h3>' +
            '<div class="form-group"><label class="form-label">Default price per call (cents)</label>' +
              '<input type="number" id="pricingDefault" class="form-input form-input-sm" value="' + defaultPrice + '" min="0" style="width:120px"></div>' +
            '<div class="form-group"><label class="form-label">Per-function price overrides (JSON)</label>' +
              '<textarea id="pricingFnOverrides" class="form-input" style="height:80px;font-family:var(--font-mono);font-size:12px" placeholder="e.g. {&quot;fn_name&quot;: 5}">' + escapeHtml(fnPrices) + '</textarea></div>' +
            '<button class="btn btn-primary btn-sm" onclick="savePricing()">Save Pricing</button>' +
          '</div>';
      }

      const revEl = document.getElementById('revenueSection');
      if (revEl) {
        revEl.innerHTML = '<div class="section-card"><h3 class="section-title">Revenue</h3><div class="loading-text">Loading...</div></div>';
        loadAppRevenue(appId);
      }
    }

    function loadAppLogsSection(appId) {
      const logsEl = document.getElementById('appLogsContent');
      if (logsEl) {
        logsEl.innerHTML = '<div class="loading-text">Loading logs...</div>';

        fetch('/api/user/call-log?limit=50&app_id=' + appId, {
          headers: { 'Authorization': 'Bearer ' + authToken },
        }).then(function(res) {
          if (!res.ok) { logsEl.innerHTML = '<div style="color:var(--text-muted);font-size:13px">Could not load logs.</div>'; return; }
          return res.json();
        }).then(function(data) {
          if (!data) return;
          const logs = Array.isArray(data) ? data : (data.logs || []);

          if (logs.length === 0) {
            logsEl.innerHTML = '<div style="color:var(--text-muted);font-size:13px;padding:var(--space-4) 0;">No calls recorded yet.</div>';
            return;
          }

          logsEl.innerHTML =
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
                '<td style="padding:8px 12px"><div style="width:8px;height:8px;border-radius:50%;background:' + (success ? 'var(--success)' : 'var(--error)') + '"></div></td>' +
                '<td style="padding:8px 12px;font-family:var(--font-mono)">' + escapeHtml(log.function_name || log.method || '') + '</td>' +
                '<td style="padding:8px 12px;color:var(--text-muted)">' + (log.duration_ms ? log.duration_ms + 'ms' : '-') + '</td>' +
                '<td style="padding:8px 12px;color:var(--text-muted)">' + relTime(log.created_at) + '</td>' +
              '</tr>';
            }).join('') +
            '</tbody></table>';
        }).catch(function() {
          logsEl.innerHTML = '<div style="color:var(--text-muted);font-size:13px">Could not load logs.</div>';
        });
      }

      // Health section
      const healthEl = document.getElementById('appHealthSection');
      if (healthEl) {
        healthEl.innerHTML = '<div class="section-card" id="appHealthSummary"><h3 class="section-title">Health</h3><div class="loading-text">Loading...</div></div>';
        loadAppHealth(appId);
      }
    }

    // ===== Market Tab =====
    function loadAppMarket(appId, app) {
      const contentEl = document.getElementById('appMarketContent');
      const bidsEl = document.getElementById('appMarketBids');
      const historyEl = document.getElementById('appMarketHistory');
      if (!contentEl) return;

      const isOwner = app && app.owner_id === window._currentUserId;

      contentEl.innerHTML = '<div class="loading-text">Loading marketplace data...</div>';
      if (bidsEl) bidsEl.innerHTML = '';
      if (historyEl) historyEl.innerHTML = '';

      fetch('/api/marketplace/listing/' + appId, {
        headers: { 'Authorization': 'Bearer ' + authToken },
      }).then(function(res) {
        if (!res.ok) throw new Error('Failed to load');
        return res.json();
      }).then(function(data) {
        const listing = data.listing;
        const bids = data.bids || [];
        const appData = data.app;

        // ── Listing / Ask Price Section ──
        if (isOwner) {
          // Owner: show ask price form + incoming bids
          var askVal = listing && listing.ask_price_cents ? (listing.ask_price_cents / 100).toFixed(2) : '';
          var floorVal = listing && listing.floor_price_cents ? (listing.floor_price_cents / 100).toFixed(2) : '';
          var instantBuy = listing ? listing.instant_buy : false;
          var noteVal = listing && listing.listing_note ? listing.listing_note : '';

          contentEl.innerHTML =
            '<div class="section-card">' +
              '<h3 class="section-title">Sell This App</h3>' +
              '<p style="font-size:13px;color:var(--text-muted);margin-bottom:var(--space-4)">Set an ask price to list this app for sale on the marketplace. Buyers can also place bids without an ask price.</p>' +
              '<div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3);margin-bottom:var(--space-3)">' +
                '<div>' +
                  '<label style="display:block;font-size:12px;color:var(--text-muted);margin-bottom:4px">Ask Price ($)</label>' +
                  '<input id="mktAskPrice" type="number" step="0.01" min="0" placeholder="e.g. 50.00" value="' + askVal + '" class="input-field" style="width:100%">' +
                '</div>' +
                '<div>' +
                  '<label style="display:block;font-size:12px;color:var(--text-muted);margin-bottom:4px">Floor Price ($)</label>' +
                  '<input id="mktFloorPrice" type="number" step="0.01" min="0" placeholder="Min bid" value="' + floorVal + '" class="input-field" style="width:100%">' +
                '</div>' +
              '</div>' +
              '<div style="margin-bottom:var(--space-3)">' +
                '<label style="display:block;font-size:12px;color:var(--text-muted);margin-bottom:4px">Listing Note</label>' +
                '<input id="mktNote" type="text" placeholder="Optional pitch to buyers" value="' + escapeHtml(noteVal) + '" class="input-field" style="width:100%">' +
              '</div>' +
              '<div style="display:flex;align-items:center;gap:var(--space-3);margin-bottom:var(--space-4)">' +
                '<label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer">' +
                  '<input id="mktInstantBuy" type="checkbox"' + (instantBuy ? ' checked' : '') + '>' +
                  ' Allow instant buy at ask price' +
                '</label>' +
              '</div>' +
              '<div style="display:flex;gap:var(--space-2)">' +
                '<button class="btn btn-primary btn-sm" onclick="saveAskPrice(\'' + appId + '\')">Save Listing</button>' +
                (askVal ? '<button class="btn btn-secondary btn-sm" onclick="removeAskPrice(\'' + appId + '\')">Remove Ask Price</button>' : '') +
              '</div>' +
            '</div>';

          // ── Incoming Bids Table ──
          if (bidsEl) {
            if (bids.length === 0) {
              bidsEl.innerHTML =
                '<div class="section-card">' +
                  '<h3 class="section-title">Incoming Bids</h3>' +
                  '<p style="font-size:13px;color:var(--text-muted)">No active bids on this app.</p>' +
                '</div>';
            } else {
              bidsEl.innerHTML =
                '<div class="section-card">' +
                  '<h3 class="section-title">Incoming Bids (' + bids.length + ')</h3>' +
                  '<table style="width:100%;font-size:13px;border-collapse:collapse">' +
                    '<thead><tr style="border-bottom:1px solid var(--border);text-align:left">' +
                      '<th style="padding:8px 12px;color:var(--text-muted);font-weight:500">Bidder</th>' +
                      '<th style="padding:8px 12px;color:var(--text-muted);font-weight:500">Amount</th>' +
                      '<th style="padding:8px 12px;color:var(--text-muted);font-weight:500">Message</th>' +
                      '<th style="padding:8px 12px;color:var(--text-muted);font-weight:500">Time</th>' +
                      '<th style="padding:8px 12px;color:var(--text-muted);font-weight:500">Actions</th>' +
                    '</tr></thead><tbody>' +
                    bids.map(function(bid) {
                      return '<tr style="border-bottom:1px solid var(--border)">' +
                        '<td style="padding:8px 12px">' + escapeHtml(bid.bidder_email || bid.bidder_id.slice(0, 8)) + '</td>' +
                        '<td style="padding:8px 12px;font-weight:600;color:var(--success)">$' + (bid.amount_cents / 100).toFixed(2) + '</td>' +
                        '<td style="padding:8px 12px;color:var(--text-muted);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHtml(bid.message || '-') + '</td>' +
                        '<td style="padding:8px 12px;color:var(--text-muted)">' + relTime(bid.created_at) + '</td>' +
                        '<td style="padding:8px 12px">' +
                          '<button class="btn btn-primary btn-sm" style="margin-right:4px" onclick="acceptBid(\'' + bid.id + '\',\'' + appId + '\')">Accept</button>' +
                          '<button class="btn btn-secondary btn-sm" onclick="rejectBid(\'' + bid.id + '\',\'' + appId + '\')">Reject</button>' +
                        '</td>' +
                      '</tr>';
                    }).join('') +
                  '</tbody></table>' +
                '</div>';
            }
          }
        } else {
          // Non-owner: show ask price info + bid form
          var askDisplay = listing && listing.ask_price_cents
            ? '<span style="font-size:24px;font-weight:700;color:var(--success)">$' + (listing.ask_price_cents / 100).toFixed(2) + '</span>'
            : '<span style="font-size:14px;color:var(--text-muted)">Open to offers</span>';

          var floorDisplay = listing && listing.floor_price_cents
            ? '<span style="font-size:12px;color:var(--text-muted);margin-left:var(--space-2)">Floor: $' + (listing.floor_price_cents / 100).toFixed(2) + '</span>'
            : '';

          var instantBuyBtn = listing && listing.instant_buy && listing.ask_price_cents
            ? '<button class="btn btn-primary" style="margin-top:var(--space-3)" onclick="buyNow(\'' + appId + '\')">Buy Now — $' + (listing.ask_price_cents / 100).toFixed(2) + '</button>'
            : '';

          var noteDisplay = listing && listing.listing_note
            ? '<p style="font-size:13px;color:var(--text-secondary);margin-top:var(--space-2);font-style:italic">' + escapeHtml(listing.listing_note) + '</p>'
            : '';

          // Check if user already has active bid
          var myBid = bids.find(function(b) { return b.bidder_id === window._currentUserId; });

          contentEl.innerHTML =
            '<div class="section-card">' +
              '<h3 class="section-title">Acquire This App</h3>' +
              '<div style="margin-bottom:var(--space-4)">' +
                '<div style="display:flex;align-items:baseline;gap:var(--space-2)">' +
                  '<span style="font-size:12px;color:var(--text-muted)">Ask Price:</span> ' + askDisplay + floorDisplay +
                '</div>' +
                noteDisplay +
                instantBuyBtn +
              '</div>' +
              (myBid
                ? '<div style="padding:var(--space-3);background:var(--bg-secondary);border-radius:var(--radius);margin-bottom:var(--space-3)">' +
                    '<p style="font-size:13px;font-weight:500">Your active bid: <span style="color:var(--success)">$' + (myBid.amount_cents / 100).toFixed(2) + '</span></p>' +
                    '<button class="btn btn-secondary btn-sm" style="margin-top:var(--space-2)" onclick="cancelBidFromUI(\'' + myBid.id + '\',\'' + appId + '\')">Cancel Bid</button>' +
                  '</div>'
                : '<div style="border-top:1px solid var(--border);padding-top:var(--space-4)">' +
                    '<h4 style="font-size:14px;font-weight:500;margin-bottom:var(--space-3)">Place a Bid</h4>' +
                    '<div style="display:grid;grid-template-columns:1fr 2fr;gap:var(--space-3);margin-bottom:var(--space-3)">' +
                      '<div>' +
                        '<label style="display:block;font-size:12px;color:var(--text-muted);margin-bottom:4px">Amount ($)</label>' +
                        '<input id="mktBidAmount" type="number" step="0.01" min="0.01" placeholder="50.00" class="input-field" style="width:100%">' +
                      '</div>' +
                      '<div>' +
                        '<label style="display:block;font-size:12px;color:var(--text-muted);margin-bottom:4px">Message (optional)</label>' +
                        '<input id="mktBidMessage" type="text" placeholder="Message to owner" class="input-field" style="width:100%">' +
                      '</div>' +
                    '</div>' +
                    '<button class="btn btn-primary btn-sm" onclick="placeBidFromUI(\'' + appId + '\')">Place Bid</button>' +
                  '</div>'
              ) +
            '</div>';
        }

        // ── Provenance / Sale History ──
        if (historyEl) {
          var provenance = listing && listing.provenance ? listing.provenance : [];
          if (provenance.length > 0) {
            historyEl.innerHTML =
              '<div class="section-card">' +
                '<h3 class="section-title">Provenance</h3>' +
                '<div style="font-size:13px">' +
                  provenance.map(function(p, i) {
                    return '<div style="display:flex;align-items:center;gap:var(--space-2);padding:8px 0' + (i < provenance.length - 1 ? ';border-bottom:1px solid var(--border)' : '') + '">' +
                      '<div style="width:20px;height:20px;border-radius:50%;background:var(--bg-secondary);display:flex;align-items:center;justify-content:center;font-size:10px;color:var(--text-muted)">' + (i + 1) + '</div>' +
                      '<div>' +
                        '<span style="color:var(--text-primary)">' + escapeHtml(p.email || p.owner_id.slice(0, 8)) + '</span>' +
                        (p.price_cents ? ' <span style="color:var(--text-muted)">— $' + (p.price_cents / 100).toFixed(2) + '</span>' : '') +
                        ' <span style="color:var(--text-muted);font-size:11px">' + (p.acquired_at ? relTime(p.acquired_at) : '') + '</span>' +
                      '</div>' +
                    '</div>';
                  }).join('') +
                '</div>' +
              '</div>';
          }
        }
      }).catch(function(err) {
        contentEl.innerHTML = '<div class="section-card"><p style="font-size:13px;color:var(--text-muted)">Marketplace data unavailable.</p></div>';
      });
    }

    // Market action handlers
    window.saveAskPrice = function(appId) {
      var price = parseFloat((document.getElementById('mktAskPrice') || {}).value) || 0;
      var floor = parseFloat((document.getElementById('mktFloorPrice') || {}).value) || 0;
      var instantBuy = (document.getElementById('mktInstantBuy') || {}).checked || false;
      var note = (document.getElementById('mktNote') || {}).value || '';

      fetch('/api/marketplace/ask', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + authToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          app_id: appId,
          price_cents: price > 0 ? Math.round(price * 100) : null,
          floor_cents: floor > 0 ? Math.round(floor * 100) : null,
          instant_buy: instantBuy,
          note: note || null,
        }),
      }).then(function(res) {
        if (!res.ok) return res.json().then(function(e) { throw new Error(e.error || 'Failed'); });
        showToast('Listing updated!');
        loadAppMarket(appId, window._currentApp);
      }).catch(function(err) {
        showToast(err.message || 'Failed to save listing', 'error');
      });
    };

    window.removeAskPrice = function(appId) {
      fetch('/api/marketplace/ask', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + authToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_id: appId, price_cents: null }),
      }).then(function(res) {
        if (!res.ok) return res.json().then(function(e) { throw new Error(e.error || 'Failed'); });
        showToast('Ask price removed');
        loadAppMarket(appId, window._currentApp);
      }).catch(function(err) {
        showToast(err.message || 'Failed to remove ask price', 'error');
      });
    };

    window.acceptBid = function(bidId, appId) {
      if (!confirm('Accept this bid? This will transfer ownership of the app. You will receive 90% of the bid amount.')) return;
      fetch('/api/marketplace/accept', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + authToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ bid_id: bidId }),
      }).then(function(res) {
        if (!res.ok) return res.json().then(function(e) { throw new Error(e.error || 'Failed'); });
        return res.json();
      }).then(function(data) {
        showToast('App sold for $' + (data.sale_price_cents / 100).toFixed(2) + '! You received $' + (data.seller_payout_cents / 100).toFixed(2) + '.');
        // Reload — ownership changed
        setTimeout(function() { window.location.reload(); }, 1500);
      }).catch(function(err) {
        showToast(err.message || 'Failed to accept bid', 'error');
      });
    };

    window.rejectBid = function(bidId, appId) {
      fetch('/api/marketplace/reject', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + authToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ bid_id: bidId }),
      }).then(function(res) {
        if (!res.ok) return res.json().then(function(e) { throw new Error(e.error || 'Failed'); });
        showToast('Bid rejected');
        loadAppMarket(appId, window._currentApp);
        loadMyOffers(); // Refresh offers dashboard if visible
      }).catch(function(err) {
        showToast(err.message || 'Failed to reject bid', 'error');
      });
    };

    window.placeBidFromUI = function(appId) {
      var amount = parseFloat((document.getElementById('mktBidAmount') || {}).value);
      var message = (document.getElementById('mktBidMessage') || {}).value || '';
      if (!amount || amount <= 0) { showToast('Enter a valid bid amount', 'error'); return; }

      fetch('/api/marketplace/bid', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + authToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          app_id: appId,
          amount_cents: Math.round(amount * 100),
          message: message || null,
        }),
      }).then(function(res) {
        if (!res.ok) return res.json().then(function(e) { throw new Error(e.error || 'Failed'); });
        showToast('Bid placed! $' + amount.toFixed(2) + ' escrowed from your balance.');
        loadAppMarket(appId, window._currentApp);
      }).catch(function(err) {
        showToast(err.message || 'Failed to place bid', 'error');
      });
    };

    window.cancelBidFromUI = function(bidId, appId) {
      fetch('/api/marketplace/cancel', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + authToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ bid_id: bidId }),
      }).then(function(res) {
        if (!res.ok) return res.json().then(function(e) { throw new Error(e.error || 'Failed'); });
        showToast('Bid cancelled. Escrow refunded.');
        loadAppMarket(appId, window._currentApp);
        loadMyOffers(); // Refresh offers dashboard if visible
      }).catch(function(err) {
        showToast(err.message || 'Failed to cancel bid', 'error');
      });
    };

    window.buyNow = function(appId) {
      if (!confirm('Buy this app now at the listed ask price? This will transfer ownership to you immediately.')) return;
      fetch('/api/marketplace/buy', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + authToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_id: appId }),
      }).then(function(res) {
        if (!res.ok) return res.json().then(function(e) { throw new Error(e.error || 'Failed'); });
        return res.json();
      }).then(function(data) {
        showToast('Purchase complete! You now own this app.');
        setTimeout(function() { window.location.reload(); }, 1500);
      }).catch(function(err) {
        showToast(err.message || 'Failed to buy app', 'error');
      });
    };

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

    // (Old loadAppSettings removed — content split across loadAppOverview, loadAppPermissions, loadAppEnvironment)

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
    // (Old loadAppLogs and loadAppBusiness removed — replaced by loadAppLogsSection and loadAppPayments)

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
        var tokenData = await res.json();
        currentTokens = tokenData.tokens || tokenData;

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
            '<button class="btn btn-danger btn-sm" style="margin-left:auto" onclick="revokeToken(\\\'' + t.id + '\\\')">Revoke</button>' +
          '</div>';
        }).join('');
      } catch {}
    }

    window.createToken = async function() {
      var name = prompt('Token name:');
      if (!name || !name.trim()) return;

      try {
        var createBtn = document.getElementById('createTokenBtn');
        if (createBtn) { createBtn.disabled = true; createBtn.textContent = 'Creating...'; }

        const res = await fetch('/api/user/tokens', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + authToken, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name.trim() }),
        });

        if (createBtn) { createBtn.disabled = false; createBtn.textContent = 'Create New Token'; }

        if (!res.ok) {
          var errData = await res.json().catch(function() { return {}; });
          showToast(errData.error || 'Failed to create token', 'error');
          return;
        }
        const data = await res.json();

        if (data.plaintext_token) {
          try {
            await navigator.clipboard.writeText(data.plaintext_token);
            showToast('Token created and copied to clipboard!');
          } catch {
            prompt('Token created! Copy it now — it will not be shown again:', data.plaintext_token);
          }
        }
        loadTokens();
      } catch { showToast('Failed to create token', 'error'); }
    };

    document.getElementById('createTokenBtn')?.addEventListener('click', function() {
      window.createToken();
    });

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

    // --- Earnings ---
    async function loadEarnings() {
      var el = document.getElementById('earningsSummary');
      if (!el) return;
      try {
        var res = await fetch('/api/user/earnings?period=30d', {
          headers: { 'Authorization': 'Bearer ' + authToken },
        });
        if (!res.ok) { el.textContent = 'Failed to load earnings'; return; }
        var data = await res.json();
        var total = (data.total_earned_cents / 100).toFixed(2);
        var period = (data.period_earned_cents / 100).toFixed(2);
        el.innerHTML =
          '<div style="display:flex;gap:var(--space-6);margin-bottom:var(--space-2);">' +
            '<div><div style="font-size:11px;color:var(--text-muted);">Lifetime</div><div style="font-size:18px;font-weight:600;">$' + total + '</div></div>' +
            '<div><div style="font-size:11px;color:var(--text-muted);">Last 30 days</div><div style="font-size:18px;font-weight:600;">$' + period + '</div></div>' +
            '<div><div style="font-size:11px;color:var(--text-muted);">Transfers</div><div style="font-size:18px;font-weight:600;">' + (data.period_transfers || 0) + '</div></div>' +
          '</div>';
      } catch { el.textContent = 'Failed to load earnings'; }
    }

    // --- Connect Status ---
    async function loadConnectStatus() {
      var badge = document.getElementById('connectStatusBadge');
      var section = document.getElementById('connectSection');
      var withdrawBtn = document.getElementById('withdrawBtn');
      try {
        var res = await fetch('/api/user/connect/status', {
          headers: { 'Authorization': 'Bearer ' + authToken },
        });
        if (!res.ok) return;
        var data = await res.json();
        if (data.payouts_enabled) {
          if (badge) { badge.textContent = 'Connected'; badge.style.background = 'rgba(34,197,94,0.15)'; badge.style.color = 'var(--success)'; }
          if (section) section.innerHTML = '<p style="font-size:13px;color:var(--text-secondary);">Your bank account is connected and ready for withdrawals.</p>';
          if (withdrawBtn) withdrawBtn.style.display = '';
        } else if (data.connected && data.onboarded) {
          if (badge) { badge.textContent = 'Pending'; badge.style.background = 'rgba(234,179,8,0.15)'; badge.style.color = '#ca8a04'; }
          if (section) section.innerHTML = '<p style="font-size:13px;color:var(--text-muted);">Onboarding complete. Stripe is reviewing your account.</p>';
          if (withdrawBtn) withdrawBtn.style.display = 'none';
        } else if (data.connected) {
          if (badge) { badge.textContent = 'Incomplete'; badge.style.background = 'rgba(234,179,8,0.15)'; badge.style.color = '#ca8a04'; }
          if (withdrawBtn) withdrawBtn.style.display = 'none';
        } else {
          if (withdrawBtn) withdrawBtn.style.display = 'none';
        }
      } catch {}
    }

    // --- Connect Onboarding ---
    window.startConnectOnboarding = async function() {
      try {
        var res = await fetch('/api/user/connect/onboard', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + authToken },
        });
        var data = await res.json();
        if (!res.ok) { showToast(data.error || 'Failed to start onboarding', 'error'); return; }
        if (data.onboarding_url) {
          window.open(data.onboarding_url, '_blank');
          showToast('Stripe onboarding opened. Complete the setup to enable withdrawals.');
        }
      } catch { showToast('Failed to start onboarding', 'error'); }
    };

    // --- Withdraw ---
    window.showWithdrawModal = async function() {
      var input = prompt('Enter withdrawal amount in dollars (minimum $10.00):');
      if (!input) return;
      var dollars = parseFloat(input);
      if (isNaN(dollars) || dollars < 10) { showToast('Minimum withdrawal is $10.00', 'error'); return; }
      var cents = Math.round(dollars * 100);
      var fee = Math.ceil(cents * 0.0025 + 25);
      var net = cents - fee;
      if (!confirm('Withdraw $' + (cents / 100).toFixed(2) + '?\\n\\nStripe fee: $' + (fee / 100).toFixed(2) + '\\nYou will receive: ~$' + (net / 100).toFixed(2) + '\\n\\nProceed?')) return;

      try {
        var res = await fetch('/api/user/connect/withdraw', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + authToken, 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount_cents: cents }),
        });
        var data = await res.json();
        if (!res.ok) { showToast(data.error || 'Withdrawal failed', 'error'); return; }
        showToast('Withdrawal of $' + (cents / 100).toFixed(2) + ' initiated! Check your bank in 2-3 business days.');
        loadHostingData();
        loadPayouts();
      } catch { showToast('Withdrawal failed', 'error'); }
    };

    // --- Payout History ---
    async function loadPayouts() {
      var el = document.getElementById('payoutsHistory');
      if (!el) return;
      try {
        var res = await fetch('/api/user/connect/payouts', {
          headers: { 'Authorization': 'Bearer ' + authToken },
        });
        if (!res.ok) return;
        var data = await res.json();
        if (!data.payouts || data.payouts.length === 0) {
          el.textContent = 'No withdrawal history.';
          return;
        }
        el.innerHTML = data.payouts.map(function(p) {
          var statusColor = p.status === 'paid' ? 'var(--success)' : p.status === 'failed' ? 'var(--error)' : 'var(--text-muted)';
          return '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px;">' +
            '<span>$' + (p.amount_cents / 100).toFixed(2) + '</span>' +
            '<span style="color:' + statusColor + ';">' + p.status + '</span>' +
            '<span style="color:var(--text-muted);">' + new Date(p.created_at).toLocaleDateString() + '</span>' +
          '</div>';
        }).join('');
      } catch {}
    }

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
            '<button class="btn btn-danger btn-sm" onclick="deleteSupabaseServer(\\\'' + s.id + '\\\')">Remove</button>' +
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
      var pathParts = window.location.pathname.slice(3).split('/');
      var section = pathParts[1] || 'overview';
      currentAppId = '${activeAppId}';
      showView('app');
      await loadAppPage('${activeAppId}', section);
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

    // Handle Stripe Connect redirect
    (function() {
      var params = new URLSearchParams(window.location.search);
      var connect = params.get('connect');
      if (connect === 'complete') {
        showToast('Bank account setup complete! Checking status...');
        history.replaceState({}, '', '/settings/billing');
        switchDashSection('billing');
        setTimeout(function() { loadConnectStatus(); }, 1500);
      } else if (connect === 'refresh') {
        showToast('Onboarding session expired. Click "Connect Bank Account" to continue.', 'error');
        history.replaceState({}, '', '/settings/billing');
        switchDashSection('billing');
      }
    })();

  })();
  </script>
  </body>
</html>`;
}
