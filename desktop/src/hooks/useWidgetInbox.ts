// Widget Inbox — polls user's library apps for widget data.
// Discovers widget-capable apps by scanning the library via platform MCP,
// probes each app for widget_* functions, and polls them periodically.
// No Tauri dependency — works via HTTP to the platform API.

import { useState, useEffect, useCallback, useRef } from 'react';
import { executeMcpTool } from '../lib/api';
import type { WidgetData, WidgetAction } from '../../../shared/types/index';

// ── Types ──

export interface WidgetSource {
  appId: string;
  appName: string;
  widgetFunction: string;
}

export interface WidgetInboxState {
  sources: WidgetSource[];
  data: Record<string, WidgetData>;
  loading: boolean;
  totalBadge: number;
  lastPoll: number;
}

// Well-known widget function names that MCPs can export
const WIDGET_FUNCTIONS = ['widget_approval_queue', 'widget_inbox', 'widget_alerts', 'widget_tasks'];

// ── Hook ──

export function useWidgetInbox() {
  const [state, setState] = useState<WidgetInboxState>({
    sources: [],
    data: {},
    loading: true,
    totalBadge: 0,
    lastPoll: 0,
  });
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  // Discover widget sources from user's library
  const discoverSources = useCallback(async (): Promise<WidgetSource[]> => {
    const sources: WidgetSource[] = [];

    try {
      // Get library via platform MCP
      const libraryResult = await executeMcpTool('ul.discover', { scope: 'library' });
      const libraryText = libraryResult.content.map((c: any) => c.text).join('');
      const library = JSON.parse(libraryText);
      const markdown = library.library || '';

      // Parse app names, IDs, and function lists from library markdown
      // Format: ## app-name\n...\n- widget_approval_queue(args): ...\nDashboard: /http/{uuid}/ui
      const sections = markdown.split(/^## /m).filter(Boolean);

      for (const section of sections) {
        const lines = section.split('\n');
        const name = lines[0]?.trim();
        if (!name) continue;

        // Check if this app exports any widget_* function (from the markdown listing)
        const exportedWidgetFn = WIDGET_FUNCTIONS.find(fn => section.includes('- ' + fn + '('));
        if (!exportedWidgetFn) continue; // Skip apps without widget functions — no probe needed

        // Find UUID in dashboard URL or MCP endpoint
        const uuidMatch = section.match(/\/(?:http|mcp)\/([a-f0-9-]{36})/);
        if (!uuidMatch) continue;

        sources.push({ appId: uuidMatch[1], appName: name, widgetFunction: exportedWidgetFn });
      }
    } catch (e) {
      console.error('[WidgetInbox] Discovery error:', e);
    }

    return sources;
  }, []);

  // Poll a single widget source
  const pollWidget = useCallback(async (source: WidgetSource): Promise<WidgetData | null> => {
    try {
      const result = await executeMcpTool('ul.call', {
        app_id: source.appId,
        function_name: source.widgetFunction,
        args: {},
      });

      if (result.isError) return null;

      const text = result.content.map((c: any) => c.text).join('');
      const parsed = JSON.parse(text);
      const data = parsed.result || parsed;

      if (typeof data.badge_count === 'number' && Array.isArray(data.items)) {
        return data as WidgetData;
      }
      return null;
    } catch {
      return null;
    }
  }, []);

  // Poll all sources
  const pollAll = useCallback(async (sources: WidgetSource[]) => {
    if (sources.length === 0) {
      if (mountedRef.current) {
        setState(prev => ({ ...prev, loading: false, data: {}, totalBadge: 0, lastPoll: Date.now() }));
      }
      return;
    }

    const newData: Record<string, WidgetData> = {};
    let totalBadge = 0;

    await Promise.all(
      sources.map(async (source) => {
        const key = source.appId + ':' + source.widgetFunction;
        const data = await pollWidget(source);
        if (data) {
          newData[key] = data;
          totalBadge += data.badge_count;
        }
      })
    );

    if (mountedRef.current) {
      setState(prev => ({ ...prev, data: newData, totalBadge, loading: false, lastPoll: Date.now() }));
    }
  }, [pollWidget]);

  // Execute a widget action
  const executeAction = useCallback(async (
    appId: string,
    action: WidgetAction,
    editedValue?: string,
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const args = { ...action.args };
      if (editedValue !== undefined) {
        for (const [key, val] of Object.entries(args)) {
          if (val === '{{edited_value}}') args[key] = editedValue;
        }
      }

      const result = await executeMcpTool('ul.call', {
        app_id: appId,
        function_name: action.tool,
        args,
      });

      // Re-poll after action
      if (mountedRef.current) pollAll(state.sources);

      return { success: !result.isError };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }, [state.sources, pollAll]);

  // Refresh
  const refresh = useCallback(async () => {
    if (!mountedRef.current) return;
    setState(prev => ({ ...prev, loading: true }));

    const sources = await discoverSources();
    if (!mountedRef.current) return;

    setState(prev => ({ ...prev, sources }));
    await pollAll(sources);
  }, [discoverSources, pollAll]);

  // Initial discovery + polling
  useEffect(() => {
    mountedRef.current = true;
    refresh();

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

  return { ...state, executeAction, refresh };
}
