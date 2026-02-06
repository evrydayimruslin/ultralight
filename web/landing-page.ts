// Unified Landing + Upload Page
// Modern, light-mode-first design with dark toggle
// Replaces the old upload-page.ts with a professional 2026-era design

export function getLandingPageHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ultralight — Deploy AI-powered apps in seconds</title>
  <meta name="description" content="The fastest way to deploy AI-powered apps. Drop your code, get a live URL instantly.">

  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          colors: {
            'ul': {
              50: '#f5f3ff', 100: '#ede9fe', 200: '#ddd6fe', 300: '#c4b5fd',
              400: '#a78bfa', 500: '#8b5cf6', 600: '#7c3aed', 700: '#6d28d9',
              800: '#5b21b6', 900: '#4c1d95',
            }
          },
          fontFamily: {
            sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
            mono: ['JetBrains Mono', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
          }
        }
      }
    }
  </script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">

  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html { scroll-behavior: smooth; }

    /* Subtle gradient background */
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      min-height: 100vh;
      background: linear-gradient(180deg, #f8f7ff 0%, #ffffff 40%, #fafafa 100%);
      color: #18181b;
      transition: background 0.4s ease, color 0.4s ease;
    }

    .dark body, html.dark body {
      background: linear-gradient(180deg, #0c0a1a 0%, #0a0a0f 40%, #09090b 100%);
      color: #fafafa;
    }

    /* Animated gradient orb behind hero */
    .hero-glow {
      position: absolute;
      top: -120px;
      left: 50%;
      transform: translateX(-50%);
      width: 600px;
      height: 400px;
      background: radial-gradient(ellipse, rgba(139, 92, 246, 0.08) 0%, transparent 70%);
      pointer-events: none;
      z-index: 0;
    }
    html.dark .hero-glow {
      background: radial-gradient(ellipse, rgba(139, 92, 246, 0.15) 0%, transparent 70%);
    }

    /* Drop zone specific styles */
    .drop-zone-active {
      border-color: #8b5cf6 !important;
      background: rgba(139, 92, 246, 0.05) !important;
    }
    html.dark .drop-zone-active {
      background: rgba(139, 92, 246, 0.1) !important;
    }

    /* Smooth transitions for theme */
    *, *::before, *::after {
      transition-property: background-color, border-color, color, box-shadow;
      transition-duration: 0.2s;
      transition-timing-function: ease;
    }

    /* Build log colors */
    .log-info { color: #71717a; }
    .log-success { color: #22c55e; }
    .log-error { color: #ef4444; }
    .log-warn { color: #f59e0b; }
    html.dark .log-info { color: #a1a1aa; }

    /* Custom scrollbar */
    ::-webkit-scrollbar { width: 5px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: #d4d4d8; border-radius: 3px; }
    ::-webkit-scrollbar-thumb:hover { background: #a1a1aa; }
    html.dark ::-webkit-scrollbar-thumb { background: #3f3f46; }
    html.dark ::-webkit-scrollbar-thumb:hover { background: #52525b; }

    /* Pill animation */
    @keyframes float {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-4px); }
    }
    .feature-pill:nth-child(1) { animation: float 3s ease-in-out infinite; }
    .feature-pill:nth-child(2) { animation: float 3s ease-in-out 0.5s infinite; }
    .feature-pill:nth-child(3) { animation: float 3s ease-in-out 1s infinite; }

    /* Toast */
    .toast-enter { transform: translateY(20px); opacity: 0; }
    .toast-active { transform: translateY(0); opacity: 1; }

    /* File input hidden */
    input[type="file"] { display: none; }
  </style>
</head>
<body class="flex flex-col min-h-screen">
  <!-- ========== NAV ========== -->
  <nav class="w-full px-6 py-4 flex items-center justify-between max-w-6xl mx-auto relative z-10">
    <a href="/" class="flex items-center gap-2 text-xl font-bold">
      <span class="text-2xl">⚡</span>
      <span class="bg-gradient-to-r from-ul-500 to-ul-700 bg-clip-text text-transparent">Ultralight</span>
    </a>
    <div class="flex items-center gap-3">
      <div id="authSection">
        <a href="/auth/login" class="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 hover:border-ul-300 dark:hover:border-ul-600 hover:shadow-sm transition-all">
          <svg class="w-4 h-4" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          Sign in
        </a>
      </div>
      <!-- Theme Toggle -->
      <button id="themeToggle" class="p-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:text-ul-500 hover:border-ul-300 dark:hover:border-ul-600 transition-all" title="Toggle theme">
        <svg id="sunIcon" class="w-5 h-5 hidden dark:block" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
        </svg>
        <svg id="moonIcon" class="w-5 h-5 block dark:hidden" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
        </svg>
      </button>
    </div>
  </nav>

  <!-- ========== MAIN CONTENT ========== -->
  <main class="flex-1 flex flex-col items-center px-4 sm:px-6 relative">
    <div class="hero-glow"></div>

    <!-- Hero Section -->
    <section id="heroSection" class="text-center pt-12 sm:pt-20 pb-8 sm:pb-12 relative z-10 max-w-3xl mx-auto">
      <h1 class="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-zinc-900 dark:text-white leading-[1.1]">
        Deploy AI-powered apps<br>
        <span class="bg-gradient-to-r from-ul-500 to-ul-700 bg-clip-text text-transparent">in seconds</span>
      </h1>
      <p class="mt-4 sm:mt-6 text-lg sm:text-xl text-zinc-500 dark:text-zinc-400 max-w-xl mx-auto leading-relaxed">
        Drop your code, get a live URL. Every app is an MCP server, an API endpoint, and a web app — instantly.
      </p>
    </section>

    <!-- Upload Zone -->
    <section class="w-full max-w-2xl mx-auto relative z-10 pb-6">
      <!-- App Name (hidden until files are added) -->
      <div id="nameField" class="mb-4 hidden">
        <input type="text" id="appName"
          class="w-full px-4 py-3 text-base rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/80 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-ul-400/50 focus:border-ul-400 transition-all"
          placeholder="App name (optional)">
      </div>

      <!-- Drop Zone -->
      <div id="dropZone"
        class="group relative w-full min-h-[220px] sm:min-h-[260px] border-2 border-dashed border-zinc-300 dark:border-zinc-600 rounded-2xl flex flex-col items-center justify-center p-8 cursor-pointer hover:border-ul-400 dark:hover:border-ul-500 hover:bg-ul-50/30 dark:hover:bg-ul-900/10 transition-all">
        <div class="text-5xl mb-4 opacity-40 group-hover:opacity-60 transition-opacity">
          <svg class="w-14 h-14 text-zinc-400 dark:text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z"/>
          </svg>
        </div>
        <div class="text-base sm:text-lg font-medium text-zinc-600 dark:text-zinc-300 mb-1">Drop your code here or click to browse</div>
        <div class="text-sm text-zinc-400 dark:text-zinc-500">.ts .tsx .js .jsx .json .md .css — Max 10MB</div>
        <input type="file" id="fileInput" webkitdirectory directory multiple>
      </div>

      <!-- File List -->
      <div id="fileList" class="mt-3 space-y-1.5"></div>

      <!-- Deploy Button -->
      <button id="deployBtn" disabled
        class="mt-4 w-full py-3.5 px-6 text-base font-semibold text-white rounded-xl bg-gradient-to-r from-ul-500 to-ul-700 hover:from-ul-600 hover:to-ul-800 disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-ul-500/20 hover:shadow-ul-500/30 transition-all active:scale-[0.99]">
        Deploy App
      </button>

      <!-- Build Logs -->
      <div id="buildLogs" class="hidden mt-4 bg-zinc-50 dark:bg-zinc-900/80 border border-zinc-200 dark:border-zinc-700 rounded-xl p-4 font-mono text-sm max-h-[240px] overflow-y-auto"></div>

      <!-- Result -->
      <div id="result" class="hidden mt-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl p-5">
        <div class="text-sm font-medium text-green-600 dark:text-green-400 mb-2 flex items-center gap-1.5">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>
          Your app is live!
        </div>
        <div class="flex items-center gap-2">
          <div id="resultUrl" class="flex-1 font-mono text-sm bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2.5 break-all text-zinc-800 dark:text-zinc-200"></div>
          <button id="copyBtn" class="shrink-0 p-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-500 hover:text-ul-500 hover:border-ul-300 transition-all" title="Copy URL">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
          </button>
        </div>
        <div class="mt-3 flex gap-2">
          <button id="openAppBtn" class="px-4 py-2 text-sm font-medium rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 hover:border-ul-300 transition-all">Open App</button>
          <button id="newUploadBtn" class="px-4 py-2 text-sm font-medium rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 hover:border-ul-300 transition-all">Deploy Another</button>
        </div>
      </div>
    </section>

    <!-- Feature Pills -->
    <section id="featurePills" class="flex flex-wrap justify-center gap-3 sm:gap-4 pb-10 sm:pb-16 relative z-10">
      <div class="feature-pill flex items-center gap-2 px-5 py-2.5 rounded-full bg-white dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 text-sm font-medium text-zinc-600 dark:text-zinc-300 shadow-sm">
        <svg class="w-4 h-4 text-ul-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.86-1.03a4.5 4.5 0 00-1.242-7.244l-4.5-4.5a4.5 4.5 0 00-6.364 6.364L4.34 8.342"/></svg>
        Instant URL
      </div>
      <div class="feature-pill flex items-center gap-2 px-5 py-2.5 rounded-full bg-white dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 text-sm font-medium text-zinc-600 dark:text-zinc-300 shadow-sm">
        <svg class="w-4 h-4 text-ul-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714a2.25 2.25 0 00.659 1.591L19 14.5M14.25 3.104c.251.023.501.05.75.082M19 14.5l-2.47 2.47a2.25 2.25 0 01-1.59.659H9.06a2.25 2.25 0 01-1.591-.659L5 14.5m14 0V6.837a2.25 2.25 0 00-.659-1.591L15.5 2.5"/></svg>
        MCP Server
      </div>
      <div class="feature-pill flex items-center gap-2 px-5 py-2.5 rounded-full bg-white dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 text-sm font-medium text-zinc-600 dark:text-zinc-300 shadow-sm">
        <svg class="w-4 h-4 text-ul-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5a17.92 17.92 0 01-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418"/></svg>
        Edge Deploy
      </div>
    </section>
  </main>

  <!-- ========== FOOTER ========== -->
  <footer class="w-full border-t border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-zinc-900/50 backdrop-blur-sm">
    <div class="max-w-6xl mx-auto px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-4">
      <div class="text-sm text-zinc-400 dark:text-zinc-500">
        &copy; 2026 Ultralight
      </div>
      <div class="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-zinc-500 dark:text-zinc-400">
        <a href="https://www.npmjs.com/package/@ultralightpro/types" target="_blank" class="hover:text-ul-500 transition-colors">SDK Reference</a>
        <a href="https://www.npmjs.com/package/ultralightpro" target="_blank" class="hover:text-ul-500 transition-colors">CLI Tool</a>
        <a href="/mcp/platform" class="hover:text-ul-500 transition-colors">API / MCP</a>
        <a href="https://github.com/nicholasgriffintn/ultralight" target="_blank" class="hover:text-ul-500 transition-colors">Docs</a>
      </div>
    </div>
  </footer>

  <!-- ========== TOAST ========== -->
  <div id="toast" class="fixed bottom-5 right-5 px-4 py-3 rounded-xl text-sm font-medium shadow-lg border z-50 transition-all duration-300 toast-enter pointer-events-none
    bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-800 dark:text-zinc-200"></div>

  <!-- ========== JAVASCRIPT ========== -->
  <script>
    // ==========================================
    // Theme Toggle with localStorage persistence
    // ==========================================
    (function initTheme() {
      const stored = localStorage.getItem('ultralight_theme');
      if (stored === 'dark' || (!stored && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        document.documentElement.classList.add('dark');
      }
    })();

    document.getElementById('themeToggle').addEventListener('click', () => {
      const isDark = document.documentElement.classList.toggle('dark');
      localStorage.setItem('ultralight_theme', isDark ? 'dark' : 'light');
    });

    // ==========================================
    // State
    // ==========================================
    let files = [];
    let authToken = localStorage.getItem('ultralight_token');

    // DOM refs
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    const fileList = document.getElementById('fileList');
    const deployBtn = document.getElementById('deployBtn');
    const buildLogs = document.getElementById('buildLogs');
    const result = document.getElementById('result');
    const resultUrl = document.getElementById('resultUrl');
    const copyBtn = document.getElementById('copyBtn');
    const appNameInput = document.getElementById('appName');
    const nameField = document.getElementById('nameField');
    const authSection = document.getElementById('authSection');
    const toast = document.getElementById('toast');

    // ==========================================
    // Auth
    // ==========================================
    function decodeJWT(token) {
      try {
        const base64Url = token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        return JSON.parse(atob(base64));
      } catch { return null; }
    }

    async function updateAuthUI() {
      if (authToken) {
        const payload = decodeJWT(authToken);
        if (payload && payload.exp * 1000 > Date.now()) {
          const email = payload.email || 'User';
          authSection.innerHTML = \`
            <div class="flex items-center gap-3">
              <span class="text-sm text-zinc-600 dark:text-zinc-300">\${email}</span>
              <a href="/upload" class="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-ul-500 text-white hover:bg-ul-600 transition-all">
                <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6z"/><path stroke-linecap="round" d="M3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25z"/><path stroke-linecap="round" d="M13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6z"/><path stroke-linecap="round" d="M13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25a2.25 2.25 0 01-2.25-2.25v-2.25z"/></svg>
                Dashboard
              </a>
              <button onclick="signOut()" class="p-1.5 rounded-lg text-zinc-400 hover:text-red-500 transition-colors" title="Sign out">
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
              </button>
            </div>
          \`;
          return;
        }

        // Token expired — try refresh
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
              localStorage.setItem('ultralight_token', data.access_token);
              if (data.refresh_token) localStorage.setItem('ultralight_refresh_token', data.refresh_token);
              authToken = data.access_token;
              await updateAuthUI();
              return;
            }
          } catch {}
        }
      }
      localStorage.removeItem('ultralight_token');
      localStorage.removeItem('ultralight_refresh_token');
      authToken = null;
    }

    function signOut() {
      localStorage.removeItem('ultralight_token');
      localStorage.removeItem('ultralight_refresh_token');
      window.location.reload();
    }
    window.signOut = signOut;

    updateAuthUI();

    // ==========================================
    // Toast
    // ==========================================
    function showToast(message, type = 'success') {
      toast.textContent = message;
      toast.className = toast.className.replace(/border-\\S+/g, '');
      if (type === 'error') toast.classList.add('border-red-400');
      else if (type === 'success') toast.classList.add('border-green-400');
      else toast.classList.add('border-zinc-300');
      toast.classList.remove('toast-enter');
      toast.classList.add('toast-active');
      toast.classList.remove('pointer-events-none');
      setTimeout(() => {
        toast.classList.remove('toast-active');
        toast.classList.add('toast-enter');
        toast.classList.add('pointer-events-none');
      }, 3000);
    }

    // ==========================================
    // Upload Logic
    // ==========================================
    dropZone.addEventListener('click', () => fileInput.click());

    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('drop-zone-active');
    });

    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('drop-zone-active');
    });

    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('drop-zone-active');
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
        nameField.classList.add('hidden');
        deployBtn.disabled = true;
        return;
      }

      nameField.classList.remove('hidden');
      const displayed = files.slice(0, 8);
      fileList.innerHTML = displayed.map(f => \`
        <div class="flex justify-between items-center px-3 py-2 bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-100 dark:border-zinc-700/50 rounded-lg text-sm">
          <span class="text-zinc-700 dark:text-zinc-300 truncate">\${f.webkitRelativePath || f.name}</span>
          <span class="text-zinc-400 dark:text-zinc-500 shrink-0 ml-3">\${(f.size / 1024).toFixed(1)} KB</span>
        </div>
      \`).join('');

      if (files.length > 8) {
        fileList.innerHTML += \`<div class="text-center text-xs text-zinc-400 dark:text-zinc-500 py-1">+ \${files.length - 8} more files</div>\`;
      }

      deployBtn.disabled = false;
    }

    function log(level, message) {
      const entry = document.createElement('div');
      entry.className = 'log-' + level + ' py-0.5';
      entry.textContent = '[' + new Date().toLocaleTimeString() + '] ' + message;
      buildLogs.appendChild(entry);
      buildLogs.scrollTop = buildLogs.scrollHeight;
    }

    deployBtn.addEventListener('click', async () => {
      buildLogs.classList.remove('hidden');
      buildLogs.innerHTML = '';
      deployBtn.disabled = true;
      result.classList.add('hidden');

      const currentToken = localStorage.getItem('ultralight_token');
      if (!currentToken) {
        log('error', 'Please sign in to deploy');
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
          headers: { 'Authorization': 'Bearer ' + currentToken },
          body: formData
        });

        const data = await res.json();
        if (data.build_logs) data.build_logs.forEach(l => log(l.level, l.message));

        if (data.app_id) {
          result.classList.remove('hidden');
          const fullUrl = window.location.origin + data.url;
          resultUrl.textContent = fullUrl;
          resultUrl.dataset.url = fullUrl;
          resultUrl.dataset.appId = data.app_id;
          log('success', 'Deploy complete!');
        } else {
          log('error', data.error || 'Upload failed');
          deployBtn.disabled = false;
        }
      } catch (err) {
        log('error', err.message);
        deployBtn.disabled = false;
      }
    });

    // Copy URL
    copyBtn.addEventListener('click', async () => {
      const url = resultUrl.dataset.url;
      try {
        await navigator.clipboard.writeText(url);
        showToast('URL copied to clipboard');
        copyBtn.innerHTML = '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>';
        setTimeout(() => {
          copyBtn.innerHTML = '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>';
        }, 2000);
      } catch {}
    });

    // Open app
    document.getElementById('openAppBtn')?.addEventListener('click', () => {
      const appId = resultUrl.dataset.appId;
      if (appId) window.location.href = '/a/' + appId;
    });

    // New upload
    document.getElementById('newUploadBtn')?.addEventListener('click', () => {
      files = [];
      fileList.innerHTML = '';
      buildLogs.classList.add('hidden');
      buildLogs.innerHTML = '';
      result.classList.add('hidden');
      deployBtn.disabled = true;
      appNameInput.value = '';
      nameField.classList.add('hidden');
    });
  </script>
</body>
</html>`;
}
