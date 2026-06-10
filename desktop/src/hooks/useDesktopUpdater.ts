import { useCallback, useEffect, useRef, useState } from 'react';
import { relaunch } from '@tauri-apps/plugin-process';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { DESKTOP_UPDATER_ENABLED, formatUpdateDate, summarizeUpdateNotes } from '../lib/updater';
import { createDesktopLogger } from '../lib/logging';

const UPDATE_CHECK_DELAY_MS = 4000;

export type DesktopUpdatePhase = 'idle' | 'available' | 'downloading' | 'installing';

export interface DesktopUpdateController {
  readonly enabled: boolean;
  readonly visible: boolean;
  readonly phase: DesktopUpdatePhase;
  readonly version: string | null;
  readonly currentVersion: string | null;
  readonly publishedAt: string | null;
  readonly notes: string | null;
  readonly downloadedBytes: number;
  readonly totalBytes: number | null;
  readonly error: string | null;
  dismiss: () => void;
  install: () => Promise<void>;
}

interface UpdateState {
  readonly phase: DesktopUpdatePhase;
  readonly version: string | null;
  readonly currentVersion: string | null;
  readonly publishedAt: string | null;
  readonly notes: string | null;
  readonly downloadedBytes: number;
  readonly totalBytes: number | null;
  readonly error: string | null;
}

const INITIAL_STATE: UpdateState = {
  phase: 'idle',
  version: null,
  currentVersion: null,
  publishedAt: null,
  notes: null,
  downloadedBytes: 0,
  totalBytes: null,
  error: null,
};

const updaterLogger = createDesktopLogger('updater');

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return 'The update could not be installed. Please try again on the next launch.';
}

export function useDesktopUpdater(): DesktopUpdateController {
  const [state, setState] = useState<UpdateState>(INITIAL_STATE);
  const pendingUpdateRef = useRef<Update | null>(null);
  const checkStartedRef = useRef(false);

  const closePendingUpdate = useCallback(async () => {
    const pendingUpdate = pendingUpdateRef.current;
    pendingUpdateRef.current = null;

    if (!pendingUpdate) return;

    try {
      await pendingUpdate.close();
    } catch (error) {
      updaterLogger.warn('Failed to close pending update handle', { error });
    }
  }, []);

  const dismiss = useCallback(() => {
    setState(INITIAL_STATE);
    void closePendingUpdate();
  }, [closePendingUpdate]);

  const install = useCallback(async () => {
    const pendingUpdate = pendingUpdateRef.current;
    if (!DESKTOP_UPDATER_ENABLED || !pendingUpdate) return;

    try {
      let downloadedBytes = 0;
      setState(prev => ({
        ...prev,
        phase: 'downloading',
        downloadedBytes: 0,
        totalBytes: null,
        error: null,
      }));

      await pendingUpdate.downloadAndInstall((event) => {
        switch (event.event) {
          case 'Started':
            downloadedBytes = 0;
            setState(prev => ({
              ...prev,
              phase: 'downloading',
              downloadedBytes: 0,
              totalBytes: event.data.contentLength ?? null,
            }));
            break;
          case 'Progress':
            downloadedBytes += event.data.chunkLength;
            setState(prev => ({
              ...prev,
              phase: 'downloading',
              downloadedBytes,
              totalBytes: prev.totalBytes,
            }));
            break;
          case 'Finished':
            setState(prev => ({
              ...prev,
              phase: 'installing',
              downloadedBytes,
            }));
            break;
        }
      });

      await closePendingUpdate();
      await relaunch();
    } catch (error) {
      setState(prev => ({
        ...prev,
        phase: 'available',
        error: toErrorMessage(error),
      }));
    }
  }, [closePendingUpdate]);

  useEffect(() => {
    if (!DESKTOP_UPDATER_ENABLED || checkStartedRef.current) return;

    let disposed = false;
    const timer = window.setTimeout(async () => {
      checkStartedRef.current = true;

      try {
        const pendingUpdate = await check();
        if (disposed) {
          await pendingUpdate?.close();
          return;
        }

        if (!pendingUpdate) return;

        pendingUpdateRef.current = pendingUpdate;
        setState({
          phase: 'available',
          version: pendingUpdate.version,
          currentVersion: pendingUpdate.currentVersion,
          publishedAt: formatUpdateDate(pendingUpdate.date),
          notes: summarizeUpdateNotes(pendingUpdate.body),
          downloadedBytes: 0,
          totalBytes: null,
          error: null,
        });
      } catch (error) {
        if (!disposed) {
          updaterLogger.warn('Update check failed', { error });
        }
      }
    }, UPDATE_CHECK_DELAY_MS);

    return () => {
      disposed = true;
      window.clearTimeout(timer);
      if (!pendingUpdateRef.current) {
        checkStartedRef.current = false;
      }
      void closePendingUpdate();
    };
  }, [closePendingUpdate]);

  return {
    enabled: DESKTOP_UPDATER_ENABLED,
    visible: state.phase !== 'idle',
    phase: state.phase,
    version: state.version,
    currentVersion: state.currentVersion,
    publishedAt: state.publishedAt,
    notes: state.notes,
    downloadedBytes: state.downloadedBytes,
    totalBytes: state.totalBytes,
    error: state.error,
    dismiss,
    install,
  };
}
