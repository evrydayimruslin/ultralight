// Project directory hook.
// Manages the working directory for local tools.
// Sources: 1) CLI launch cwd (from Tauri), 2) In-app folder picker.

import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';

export interface UseProjectDirReturn {
  /** Current project root path (null if not set) */
  projectDir: string | null;
  /** Whether we're still resolving the initial cwd */
  loading: boolean;
  /** Open a native folder picker to change the project directory */
  pickDirectory: () => Promise<void>;
  /** Manually set the project directory */
  setProjectDir: (dir: string) => void;
}

export function useProjectDir(): UseProjectDirReturn {
  const [projectDir, setProjectDir] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // On mount, try to get the current working directory from the Rust side
  useEffect(() => {
    async function getCwd() {
      try {
        // Use a simple shell command to get cwd — this is the directory
        // Tauri was launched from (or the app bundle directory)
        const cwd = await invoke<string>('shell_exec', {
          projectRoot: '/',
          command: 'pwd',
        });
        const dir = cwd.trim();

        // Only use it if it looks like a real project directory
        // (not the root filesystem or app bundle)
        if (
          dir &&
          dir !== '/' &&
          !dir.includes('.app/Contents') &&
          !dir.includes('/Applications/')
        ) {
          setProjectDir(dir);
        }
      } catch {
        // No cwd available — user will need to pick a directory
      } finally {
        setLoading(false);
      }
    }

    getCwd();
  }, []);

  const pickDirectory = useCallback(async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select Project Directory',
      });

      if (selected && typeof selected === 'string') {
        setProjectDir(selected);
      }
    } catch (err) {
      console.error('[useProjectDir] Folder picker error:', err);
    }
  }, []);

  return {
    projectDir,
    loading,
    pickDirectory,
    setProjectDir,
  };
}
