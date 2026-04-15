// Widget Inbox — discovers widget apps, polls for meta (badges),
// caches HTML apps, and routes postMessage bridge calls.

import { useState, useEffect, useCallback, useRef } from 'react';
import { executeMcpTool, executeAppMcpTool } from '../lib/api';
import { getToken, getApiBase } from '../lib/storage';
import type { WidgetMeta, WidgetAppResponse } from '../../../shared/types/index';

// ── Types ──

export interface WidgetAppSource {
  appUuid: string;
  appName: string;
  appSlug: string;
  widgetName: string;     // e.g. "email_inbox"
  uiFunction: string;     // e.g. "widget_email_inbox_ui"
  dataFunction: string;   // e.g. "widget_email_inbox_data"
}

export interface WidgetInboxState {
  sources: WidgetAppSource[];
  metas: Record<string, WidgetMeta>;   // keyed by appUuid:widgetName
  loading: boolean;
  totalBadge: number;
  lastPoll: number;
}

// Legacy widget function names (backward compat)
const LEGACY_WIDGET_FUNCTIONS = ['widget_approval_queue', 'widget_inbox', 'widget_alerts', 'widget_tasks'];

// ── Hook ──

export function useWidgetInbox() {
  const [state, setState] = useState<WidgetInboxState>({
    sources: [],
    metas: {},
    loading: true,
    totalBadge: 0,
    lastPoll: 0,
  });
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  // Discover widget-capable apps from user's library
  const discoverSources = useCallback(async (): Promise<WidgetAppSource[]> => {
    const sources: WidgetAppSource[] = [];
    const token = getToken();
    if (!token) return sources;

    try {
      console.log('[WidgetInbox] Starting discovery...');
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

        // Get tools list from the app's MCP endpoint
        let tools: any[] = [];
        let appSlug = '';
        try {
          const base = getApiBase();
          const res = await fetch(`${base}/mcp/${appUuid}`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: crypto.randomUUID(), method: 'tools/list', params: {} }),
          });
          const data = await res.json();
          tools = data?.result?.tools || [];
        } catch { continue; }

        // Look for new-style widget_*_ui functions
        const uiTools = tools.filter((t: any) => t.name.includes('_widget_') && t.name.endsWith('_ui'));
        for (const uiTool of uiTools) {
          // Extract slug and widget name: "{slug}_widget_{name}_ui"
          const match = uiTool.name.match(/^(.+)_widget_(.+)_ui$/);
          if (!match) continue;
          const [, slug, widgetName] = match;
          appSlug = slug;
          sources.push({
            appUuid, appName: name, appSlug: slug,
            widgetName,
            uiFunction: `widget_${widgetName}_ui`,
            dataFunction: `widget_${widgetName}_data`,
          });
        }

        // Fallback: legacy widget functions (widget_approval_queue etc.)
        if (uiTools.length === 0) {
          for (const fn of LEGACY_WIDGET_FUNCTIONS) {
            const legacyTool = tools.find((t: any) => t.name.endsWith('_' + fn));
            if (legacyTool) {
              const slug = legacyTool.name.replace('_' + fn, '');
              sources.push({
                appUuid, appName: name, appSlug: slug,
                widgetName: fn.replace('widget_', ''),
                uiFunction: fn,    // legacy: same function returns both ui + data
                dataFunction: fn,
              });
            }
          }
        }
      }

      // Deduplicate: if multiple apps share the same name + widget, keep the last (most recent)
      const seen = new Map<string, number>();
      sources.forEach((s, i) => seen.set(`${s.appName}:${s.widgetName}`, i));
      const deduped = sources.filter((s, i) => seen.get(`${s.appName}:${s.widgetName}`) === i);
      if (deduped.length < sources.length) {
        console.log(`[WidgetInbox] Deduped ${sources.length - deduped.length} duplicate widget(s)`);
      }

      console.log(`[WidgetInbox] Discovery: ${deduped.length} widget(s)`);
      return deduped;
    } catch (e) {
      console.error('[WidgetInbox] Discovery error:', e);
    }
    return sources;
  }, []);

  // Poll a source for meta (badge count) — lightweight, no app_html
  const pollMeta = useCallback(async (source: WidgetAppSource): Promise<WidgetMeta | null> => {
    try {
      const prefixed = `${source.appSlug}_${source.uiFunction}`;
      const result = await executeAppMcpTool(source.appUuid, prefixed, {});
      if (result.isError) return null;

      const text = result.content?.[0]?.text || '';
      const parsed = JSON.parse(text);

      // New-style: { meta: { title, icon, badge_count }, app_html, version }
      if (parsed.meta) {
        // Always update cache when fresh app_html is available
        const cacheKey = `widget_app:${source.appUuid}:${source.widgetName}`;
        if (parsed.app_html) {
          localStorage.setItem(cacheKey, JSON.stringify({
            html: parsed.app_html,
            version: parsed.version || '1',
            cachedAt: Date.now(),
          }));
        }
        return parsed.meta;
      }

      // Legacy: { badge_count, items }
      if (typeof parsed.badge_count === 'number') {
        return { title: source.appName, icon: '📦', badge_count: parsed.badge_count };
      }

      return null;
    } catch {
      return null;
    }
  }, []);

  // Poll all sources for meta
  const pollAll = useCallback(async (sources: WidgetAppSource[]) => {
    if (sources.length === 0) {
      if (mountedRef.current) {
        setState(prev => ({ ...prev, loading: false, metas: {}, totalBadge: 0, lastPoll: Date.now() }));
      }
      return;
    }

    const newMetas: Record<string, WidgetMeta> = {};
    let totalBadge = 0;

    await Promise.all(
      sources.map(async (source) => {
        const key = `${source.appUuid}:${source.widgetName}`;
        const meta = await pollMeta(source);
        if (meta) {
          newMetas[key] = meta;
          totalBadge += meta.badge_count;
        }
      })
    );

    if (mountedRef.current) {
      setState(prev => ({ ...prev, metas: newMetas, totalBadge, loading: false, lastPoll: Date.now() }));
    }
  }, [pollMeta]);

  // Get cached app HTML (or fetch fresh)
  const getAppHtml = useCallback(async (source: WidgetAppSource): Promise<string | null> => {
    const cacheKey = `widget_app:${source.appUuid}:${source.widgetName}`;
    const cached = localStorage.getItem(cacheKey);

    if (cached) {
      const { html } = JSON.parse(cached);
      if (html) return html;
    }

    // Fetch fresh
    try {
      const prefixed = `${source.appSlug}_${source.uiFunction}`;
      const result = await executeAppMcpTool(source.appUuid, prefixed, {});
      if (result.isError) return null;

      const text = result.content?.[0]?.text || '';
      const parsed = JSON.parse(text);

      if (parsed.app_html) {
        localStorage.setItem(cacheKey, JSON.stringify({
          html: parsed.app_html,
          version: parsed.version || '1',
          cachedAt: Date.now(),
        }));
        return parsed.app_html;
      }

      // Legacy: no app_html, return null (will render old-style)
      return null;
    } catch {
      return null;
    }
  }, []);

  // Route a bridge call from the widget iframe to the MCP
  const executeBridgeCall = useCallback(async (
    appUuid: string,
    appSlug: string,
    functionName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> => {
    const prefixed = `${appSlug}_${functionName}`;
    console.log(`[WidgetBridge] ${prefixed}`, args);
    const result = await executeAppMcpTool(appUuid, prefixed, args);
    const text = result.content?.[0]?.text || '';
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text, isError: result.isError };
    }
  }, []);

  // Prune orphaned widget caches for app UUIDs that no longer appear in sources
  const pruneStaleWidgetCaches = useCallback((freshSources: WidgetAppSource[]) => {
    const freshKeys = new Set(freshSources.map(s => `widget_app:${s.appUuid}:${s.widgetName}`));
    // Scan localStorage for stale widget_app:* entries
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith('widget_app:') && !freshKeys.has(key)) {
        console.log(`[WidgetInbox] Pruning stale cache: ${key}`);
        localStorage.removeItem(key);
      }
    }
  }, []);

  // Refresh everything
  const refresh = useCallback(async () => {
    if (!mountedRef.current) return;
    setState(prev => ({ ...prev, loading: true }));
    const sources = await discoverSources();
    if (!mountedRef.current) return;
    setState(prev => ({ ...prev, sources }));
    // Update sessionStorage cache (or clear if no sources left)
    if (sources.length > 0) {
      sessionStorage.setItem('widget_sources', JSON.stringify(sources));
    } else {
      sessionStorage.removeItem('widget_sources');
    }
    // Clean up caches for deleted/removed apps
    pruneStaleWidgetCaches(sources);
    await pollAll(sources);
  }, [discoverSources, pollAll, pruneStaleWidgetCaches]);

  // Initial discovery + polling — use sessionStorage cache for instant remounts
  useEffect(() => {
    mountedRef.current = true;

    // Try to restore cached sources for instant render
    const cached = sessionStorage.getItem('widget_sources');
    if (cached) {
      try {
        const cachedSources: WidgetAppSource[] = JSON.parse(cached);
        if (cachedSources.length > 0) {
          setState(prev => ({ ...prev, sources: cachedSources }));
          // Poll immediately with cached sources (fast — no discovery needed)
          pollAll(cachedSources);
        }
      } catch { /* ignore corrupt cache */ }
    }

    // Full refresh in background (updates sources if library changed)
    refresh().then(() => {
      // Cache discovered sources for next mount
      setState(prev => {
        if (prev.sources.length > 0) {
          sessionStorage.setItem('widget_sources', JSON.stringify(prev.sources));
        }
        return prev;
      });
    });

    pollTimerRef.current = setInterval(() => {
      if (mountedRef.current) {
        setState(prev => {
          if (prev.sources.length > 0) pollAll(prev.sources);
          return prev;
        });
      }
    }, 30_000);

    return () => {
      mountedRef.current = false;
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, []);

  return { ...state, getAppHtml, executeBridgeCall, refresh };
}
