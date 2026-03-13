// Central app state — manages view routing + project selection.

import { useState, useCallback } from 'react';

// ── Types ──

export type AppView =
  | { kind: 'home' }
  | { kind: 'agent'; agentId: string };

export interface UseAppStateReturn {
  view: AppView;
  navigateHome: () => void;
  navigateToAgent: (agentId: string) => void;
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

// ── Hook ──

export function useAppState(): UseAppStateReturn {
  const [view, setView] = useState<AppView>({ kind: 'home' });
  const [selectedProjectDir, _setSelectedProjectDir] = useState<string | null>(
    getStoredProjectDir
  );

  const navigateHome = useCallback(() => {
    setView({ kind: 'home' });
  }, []);

  const navigateToAgent = useCallback((agentId: string) => {
    setView({ kind: 'agent', agentId });
  }, []);

  const setSelectedProjectDir = useCallback((dir: string | null) => {
    _setSelectedProjectDir(dir);
    storeProjectDir(dir);
  }, []);

  return {
    view,
    navigateHome,
    navigateToAgent,
    selectedProjectDir,
    setSelectedProjectDir,
  };
}
