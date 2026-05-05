// Widget inbox discovery, explicit widget pulls, and cached widget HTML loading.

import { useState, useEffect, useCallback, useRef } from 'react';
import { executeMcpTool, executeAppMcpTool } from '../lib/api';
import { fetchFromApi, getToken } from '../lib/storage';
import type { WidgetMeta } from '../../../shared/contracts/widget.ts';
import {
  discoverWidgetSources,
  recordLegacyWidgetContractObservations,
  type WidgetToolDescriptor,
} from '../lib/widgetContracts';
import { createDesktopLogger } from '../lib/logging';
import {
  coerceWidgetMetaFromPayload,
  getWidgetSourceKey,
  fetchWidgetDataPayload,
  isWidgetPullDue,
  loadWidgetHtml,
  pruneStaleWidgetCaches,
  readWidgetHtmlCache,
  readWidgetPullSettings,
  type WidgetAppSource,
  type WidgetPullSettings,
  fetchWidgetUiPayload,
  updateWidgetHtmlCacheMeta,
  updateWidgetPullStats,
  writeWidgetPullSettings,
  writeWidgetHtmlCache,
} from '../lib/widgetRuntime';

export type { WidgetAppSource } from '../lib/widgetRuntime';

export interface WidgetInboxState {
  sources: WidgetAppSource[];
  metas: Record<string, WidgetMeta>;
  loading: boolean;
  totalBadge: number;
  lastPoll: number;
  settings: Record<string, WidgetPullSettings>;
}

const widgetInboxLogger = createDesktopLogger('WidgetInbox');

async function fetchAppVersion(appUuid: string, token: string): Promise<string | null> {
  try {
    const res = await fetchFromApi(`/api/apps/${appUuid}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const version = data?.current_version;
    return typeof version === 'string' || typeof version === 'number' ? String(version) : null;
  } catch {
    return null;
  }
}

export function useWidgetInbox(options: { active?: boolean } = {}) {
  const active = options.active ?? true;
  const [state, setState] = useState<WidgetInboxState>({
    sources: [],
    metas: {},
    loading: true,
    totalBadge: 0,
    lastPoll: 0,
    settings: {},
  });
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);
  const sourcesRef = useRef<WidgetAppSource[]>([]);
  const settingsRef = useRef<Record<string, WidgetPullSettings>>({});
  const pollInFlightRef = useRef(false);
  const activeRef = useRef(active);
  activeRef.current = active;

  const readSettingsForSources = useCallback((sources: WidgetAppSource[]) => {
    const next: Record<string, WidgetPullSettings> = {};
    for (const source of sources) {
      next[getWidgetSourceKey(source)] = readWidgetPullSettings(source);
    }
    return next;
  }, []);

  const readCachedMetasForSources = useCallback((sources: WidgetAppSource[]) => {
    const metas: Record<string, WidgetMeta> = {};
    for (const source of sources) {
      const cached = readWidgetHtmlCache(source.appUuid, source.widgetName, source.appVersion);
      if (cached?.meta) {
        metas[getWidgetSourceKey(source)] = cached.meta;
      }
    }
    return metas;
  }, []);

  const totalBadgeForSources = useCallback((sources: WidgetAppSource[], metas: Record<string, WidgetMeta>) => {
    return sources.reduce((total, source) => {
      return total + (metas[getWidgetSourceKey(source)]?.badge_count ?? 0);
    }, 0);
  }, []);

  const applySourcesState = useCallback((sources: WidgetAppSource[]) => {
    const settings = readSettingsForSources(sources);
    const cachedMetas = readCachedMetasForSources(sources);
    sourcesRef.current = sources;
    settingsRef.current = settings;

    setState(prev => {
      const metas: Record<string, WidgetMeta> = {};
      for (const source of sources) {
        const key = getWidgetSourceKey(source);
        const meta = prev.metas[key] ?? cachedMetas[key];
        if (meta) metas[key] = meta;
      }
      return {
        ...prev,
        sources,
        settings,
        metas,
        totalBadge: totalBadgeForSources(sources, metas),
        loading: false,
      };
    });
  }, [readCachedMetasForSources, readSettingsForSources, totalBadgeForSources]);

  const recordPull = useCallback((source: WidgetAppSource) => {
    const key = getWidgetSourceKey(source);
    const nextSettings = updateWidgetPullStats(source);
    settingsRef.current = {
      ...settingsRef.current,
      [key]: nextSettings,
    };
    if (mountedRef.current) {
      setState(prev => ({
        ...prev,
        settings: {
          ...prev.settings,
          [key]: nextSettings,
        },
      }));
    }
  }, []);

  const discoverSources = useCallback(async (): Promise<WidgetAppSource[]> => {
    const sources: WidgetAppSource[] = [];
    const token = getToken();
    if (!token) return sources;

    try {
      widgetInboxLogger.debug('Starting widget discovery');
      const libraryResult = await executeMcpTool('ul.discover', { scope: 'library' });
      if (libraryResult.isError) return sources;

      const libraryText = libraryResult.content?.[0]?.text || '';
      const library = JSON.parse(libraryText);
      const markdown = library.library || '';
      const sections = markdown.split(/^## /m).filter(Boolean);

      for (const section of sections) {
        const lines = section.split('\n');
        const name = lines[0]?.trim();
        if (!name) continue;

        const uuidMatch = section.match(/\/(?:http|mcp)\/([a-f0-9-]{36})/);
        if (!uuidMatch) continue;
        const appUuid = uuidMatch[1];

        let tools: WidgetToolDescriptor[] = [];
        try {
          const res = await fetchFromApi(`/mcp/${appUuid}`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: crypto.randomUUID(), method: 'tools/list', params: {} }),
          });
          const data = await res.json();
          tools = data?.result?.tools || [];
        } catch { continue; }

        const appVersion = await fetchAppVersion(appUuid, token);
        const discovery = discoverWidgetSources({
          appUuid,
          appName: name,
          tools,
        });
        recordLegacyWidgetContractObservations(discovery.legacyObservations);
        if (discovery.legacyObservations.length > 0) {
          widgetInboxLogger.warn('App still exposes legacy widget contracts', {
            appName: name,
            legacyContracts: discovery.legacyObservations.map((observation) => observation.legacyFunction),
          });
        }
        sources.push(...discovery.sources.map((source) => ({ ...source, appVersion })));
      }

      // If multiple apps expose the same widget, keep the most recently discovered one.
      const seen = new Map<string, number>();
      sources.forEach((s, i) => seen.set(`${s.appName}:${s.widgetName}`, i));
      const deduped = sources.filter((s, i) => seen.get(`${s.appName}:${s.widgetName}`) === i);
      if (deduped.length < sources.length) {
        widgetInboxLogger.debug('Deduped duplicate widgets', {
          duplicateCount: sources.length - deduped.length,
        });
      }

      widgetInboxLogger.debug('Completed widget discovery', { widgetCount: deduped.length });
      return deduped;
    } catch (e) {
      widgetInboxLogger.error('Widget discovery failed', { error: e });
    }
    return sources;
  }, []);

  const pollMeta = useCallback(async (
    source: WidgetAppSource,
    settings: WidgetPullSettings,
    reason: string,
  ): Promise<WidgetMeta | null> => {
    let attemptedPull = false;
    try {
      const cached = readWidgetHtmlCache(source.appUuid, source.widgetName, source.appVersion);
      const cachedMeta = cached?.meta ?? null;
      const widgetPull = {
        widgetName: source.widgetName,
        intervalMs: settings.intervalMs,
        reason,
      };

      if (source.dataFunction && source.dataFunction !== source.uiFunction) {
        attemptedPull = true;
        const dataPayload = await fetchWidgetDataPayload(source, executeAppMcpTool, widgetPull);
        const dataMeta = coerceWidgetMetaFromPayload(dataPayload?.raw, source.appName, cachedMeta);
        if (dataMeta) {
          if (cached) {
            updateWidgetHtmlCacheMeta(source.appUuid, source.widgetName, source.appVersion, dataMeta);
          }
          return dataMeta;
        }
      }

      if (cachedMeta) return cachedMeta;

      attemptedPull = true;
      const payload = await fetchWidgetUiPayload(source, executeAppMcpTool, widgetPull);
      if (!payload) return null;
      const uiMeta = coerceWidgetMetaFromPayload(payload.raw, source.appName, cachedMeta);
      if (payload.appHtml) {
        writeWidgetHtmlCache(source.appUuid, source.widgetName, payload.appHtml, payload.version, Date.now(), uiMeta);
      }

      return uiMeta;
    } catch {
      return null;
    } finally {
      if (attemptedPull) {
        recordPull(source);
      }
    }
  }, [recordPull]);

  const pollAll = useCallback(async (
    sources: WidgetAppSource[],
    options: { force?: boolean; reason?: string; showLoading?: boolean } = {},
  ) => {
    if (pollInFlightRef.current) return;
    pollInFlightRef.current = true;
    const force = options.force === true;
    const reason = options.reason || (force ? 'manual_refresh' : 'scheduled');
    const allSources = sourcesRef.current.length > 0 ? sourcesRef.current : sources;

    if (options.showLoading && mountedRef.current) {
      setState(prev => ({ ...prev, loading: true }));
    }

    const inactive = !activeRef.current;
    const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
    if (sources.length === 0) {
      if (mountedRef.current) {
        setState(prev => ({ ...prev, loading: false, metas: {}, totalBadge: 0, lastPoll: Date.now() }));
      }
      pollInFlightRef.current = false;
      return;
    }

    const now = Date.now();
    const targets = force || (!hidden && !inactive)
      ? sources.filter((source) => {
        if (force) return true;
        const settings = settingsRef.current[getWidgetSourceKey(source)] ?? readWidgetPullSettings(source);
        return isWidgetPullDue(settings, now);
      })
      : [];

    if (targets.length === 0) {
      if (mountedRef.current) {
        setState(prev => ({
          ...prev,
          loading: false,
          lastPoll: now,
          totalBadge: totalBadgeForSources(allSources, prev.metas),
        }));
      }
      pollInFlightRef.current = false;
      return;
    }

    const pulledMetas: Record<string, WidgetMeta> = {};

    await Promise.all(
      targets.map(async (source) => {
        const key = getWidgetSourceKey(source);
        const settings = settingsRef.current[key] ?? readWidgetPullSettings(source);
        const meta = await pollMeta(source, settings, reason);
        if (meta) {
          pulledMetas[key] = meta;
        }
      })
    );

    if (mountedRef.current) {
      setState(prev => {
        const metas = { ...prev.metas, ...pulledMetas };
        return {
          ...prev,
          metas,
          totalBadge: totalBadgeForSources(allSources, metas),
          loading: false,
          lastPoll: Date.now(),
        };
      });
    }
    pollInFlightRef.current = false;
  }, [pollMeta, totalBadgeForSources]);

  const getAppHtml = useCallback(async (source: WidgetAppSource): Promise<string | null> => {
    try {
      const key = getWidgetSourceKey(source);
      const settings = settingsRef.current[key] ?? readWidgetPullSettings(source);
      const result = await loadWidgetHtml(source, {
        executor: executeAppMcpTool,
        widgetPull: {
          widgetName: source.widgetName,
          intervalMs: settings.intervalMs,
          reason: 'open',
        },
      });
      if (result && !result.fromCache) {
        recordPull(source);
      }
      return result?.html ?? null;
    } catch {
      return null;
    }
  }, [recordPull]);

  const refresh = useCallback(async (options: { forcePull?: boolean } = {}) => {
    if (!mountedRef.current) return;
    setState(prev => ({ ...prev, loading: true }));
    const sources = await discoverSources();
    if (!mountedRef.current) return;
    applySourcesState(sources);
    if (options.forcePull !== false) {
      setState(prev => ({ ...prev, loading: true }));
    }
    if (sources.length > 0) {
      sessionStorage.setItem('widget_sources', JSON.stringify(sources));
    } else {
      sessionStorage.removeItem('widget_sources');
    }
    const removed = pruneStaleWidgetCaches(sources);
    removed.forEach((key) => {
      widgetInboxLogger.debug('Pruned stale widget cache entry', { key });
    });
    await pollAll(sources, {
      force: options.forcePull ?? true,
      reason: options.forcePull === false ? 'scheduled' : 'manual_refresh',
      showLoading: false,
    });
  }, [applySourcesState, discoverSources, pollAll]);

  const refreshWidget = useCallback(async (source: WidgetAppSource) => {
    await pollAll([source], { force: true, reason: 'manual_refresh', showLoading: true });
  }, [pollAll]);

  const setWidgetPullEnabled = useCallback((source: WidgetAppSource, enabled: boolean) => {
    const key = getWidgetSourceKey(source);
    const next = writeWidgetPullSettings(source, { enabled });
    settingsRef.current = {
      ...settingsRef.current,
      [key]: next,
    };
    setState(prev => ({
      ...prev,
      settings: {
        ...prev.settings,
        [key]: next,
      },
    }));
    if (enabled) {
      void pollAll([source], { force: true, reason: 'enabled' });
    }
  }, [pollAll]);

  const setWidgetPullInterval = useCallback((source: WidgetAppSource, intervalMs: number) => {
    const key = getWidgetSourceKey(source);
    const next = writeWidgetPullSettings(source, { intervalMs });
    settingsRef.current = {
      ...settingsRef.current,
      [key]: next,
    };
    setState(prev => ({
      ...prev,
      settings: {
        ...prev.settings,
        [key]: next,
      },
    }));
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    const cached = sessionStorage.getItem('widget_sources');
    if (cached) {
      try {
        const cachedSources: WidgetAppSource[] = JSON.parse(cached);
        if (cachedSources.length > 0) {
          applySourcesState(cachedSources);
          void pollAll(cachedSources, { force: false, reason: 'scheduled' });
        }
      } catch { /* ignore corrupt cache */ }
    }

    refresh({ forcePull: false }).then(() => {
      setState(prev => {
        if (prev.sources.length > 0) {
          sessionStorage.setItem('widget_sources', JSON.stringify(prev.sources));
        }
        return prev;
      });
    });

    pollTimerRef.current = setInterval(() => {
      if (!mountedRef.current) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      if (!activeRef.current) return;
      if (sourcesRef.current.length > 0) {
        void pollAll(sourcesRef.current, { force: false, reason: 'scheduled' });
      }
    }, 15_000);

    const handleSettingsChanged = () => {
      const sources = sourcesRef.current;
      if (sources.length === 0) return;
      const settings = readSettingsForSources(sources);
      settingsRef.current = settings;
      setState(prev => ({ ...prev, settings }));
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('ul-widget-pull-settings-changed', handleSettingsChanged);
    }

    return () => {
      mountedRef.current = false;
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      if (typeof window !== 'undefined') {
        window.removeEventListener('ul-widget-pull-settings-changed', handleSettingsChanged);
      }
    };
  }, [applySourcesState, pollAll, readSettingsForSources, refresh]);

  useEffect(() => {
    if (!active || sourcesRef.current.length === 0) return;
    void pollAll(sourcesRef.current, { force: false, reason: 'scheduled' });
  }, [active, pollAll]);

  return {
    ...state,
    getAppHtml,
    refresh,
    refreshWidget,
    setWidgetPullEnabled,
    setWidgetPullInterval,
  };
}
