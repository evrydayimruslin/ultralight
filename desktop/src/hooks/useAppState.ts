// Central app state — manages view routing + navigation history + project selection.

import { useState, useCallback, useRef } from 'react';

// ── Types ──

export type AppView =
  | { kind: 'home' }
  | { kind: 'agent'; agentId: string; initialMessage?: string }
  | { kind: 'new-chat' }
  | { kind: 'capabilities' }
  | { kind: 'profile' }
  | { kind: 'wallet' }
  | { kind: 'settings' };

export interface UseAppStateReturn {
  view: AppView;
  navigateHome: () => void;
  navigateToAgent: (agentId: string, initialMessage?: string) => void;
  navigateToNewChat: () => void;
  navigateToCapabilities: () => void;
  navigateToProfile: () => void;
  navigateToWallet: () => void;
  navigateToSettings: () => void;
  canGoBack: boolean;
  canGoForward: boolean;
  goBack: () => void;
  goForward: () => void;
  selectedProjectDir: string | null;
  setSelectedProjectDir: (dir: string | null) => void;
}

// ── Storage keys ──

const STORAGE_PROJECT_DIR = 'ul_selected_project_dir';

function getStoredProjectDir(): string | null {
  try {
    return localStorage.getItem(STORAGE_PROJECT_DIR);
  } catch {
    return null;
  }
}

function storeProjectDir(dir: string | null) {
  try {
    if (dir) {
      localStorage.setItem(STORAGE_PROJECT_DIR, dir);
    } else {
      localStorage.removeItem(STORAGE_PROJECT_DIR);
    }
  } catch {
    // ignore
  }
}

// ── Helpers ──

const MAX_HISTORY = 50;

function viewsEqual(a: AppView, b: AppView): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'agent' && b.kind === 'agent') return a.agentId === b.agentId;
  return true;
}

// ── Hook ──

export function useAppState(): UseAppStateReturn {
  const historyRef = useRef<{ stack: AppView[]; index: number }>({
    stack: [{ kind: 'home' }],
    index: 0,
  });
  const [view, setView] = useState<AppView>({ kind: 'home' });
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);

  const [selectedProjectDir, _setSelectedProjectDir] = useState<string | null>(
    getStoredProjectDir
  );

  const syncState = useCallback(() => {
    const h = historyRef.current;
    setView(h.stack[h.index]);
    setCanGoBack(h.index > 0);
    setCanGoForward(h.index < h.stack.length - 1);
  }, []);

  const navigate = useCallback((newView: AppView) => {
    const h = historyRef.current;
    // Skip if navigating to same view
    if (viewsEqual(h.stack[h.index], newView)) return;
    // Truncate forward history and push
    h.stack = [...h.stack.slice(0, h.index + 1), newView];
    h.index = h.stack.length - 1;
    // Cap history size
    if (h.stack.length > MAX_HISTORY) {
      h.stack = h.stack.slice(-MAX_HISTORY);
      h.index = h.stack.length - 1;
    }
    syncState();
  }, [syncState]);

  const goBack = useCallback(() => {
    const h = historyRef.current;
    if (h.index > 0) {
      h.index -= 1;
      syncState();
    }
  }, [syncState]);

  const goForward = useCallback(() => {
    const h = historyRef.current;
    if (h.index < h.stack.length - 1) {
      h.index += 1;
      syncState();
    }
  }, [syncState]);

  const navigateHome = useCallback(() => navigate({ kind: 'home' }), [navigate]);
  const navigateToAgent = useCallback((agentId: string, initialMessage?: string) => navigate({ kind: 'agent', agentId, initialMessage }), [navigate]);
  const navigateToNewChat = useCallback(() => navigate({ kind: 'new-chat' }), [navigate]);
  const navigateToCapabilities = useCallback(() => navigate({ kind: 'capabilities' }), [navigate]);
  const navigateToProfile = useCallback(() => navigate({ kind: 'profile' }), [navigate]);
  const navigateToWallet = useCallback(() => navigate({ kind: 'wallet' }), [navigate]);
  const navigateToSettings = useCallback(() => navigate({ kind: 'settings' }), [navigate]);

  const setSelectedProjectDir = useCallback((dir: string | null) => {
    _setSelectedProjectDir(dir);
    storeProjectDir(dir);
  }, []);

  return {
    view,
    navigateHome,
    navigateToAgent,
    navigateToNewChat,
    navigateToCapabilities,
    navigateToProfile,
    navigateToWallet,
    navigateToSettings,
    canGoBack,
    canGoForward,
    goBack,
    goForward,
    selectedProjectDir,
    setSelectedProjectDir,
  };
}
