// Widget Inbox — polls connected MCPs for widget data and aggregates into an inbox.
// MCP servers declare widgets in their manifest. This hook discovers them via
// agents' connected_apps configs, polls the data_tool functions, and exposes
// the results + actions for the Activity tab.

import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { executeMcpTool } from '../lib/api';
import type { WidgetDeclaration, WidgetData, WidgetAction } from '../../../shared/types/index';

// ── Types ──

export interface WidgetSource {
  appId: string;
  appName: string;
  widget: WidgetDeclaration;
}

export interface WidgetInboxState {
  sources: WidgetSource[];
  data: Record<string, WidgetData>;
  loading: boolean;
  totalBadge: number;
  lastPoll: number;
}

// ── Hook ──

export function useWidgetInbox() {
  const [state, setState] = useState<WidgetInboxState>({
    sources: [],
    data: {},
    loading: false,
    totalBadge: 0,
    lastPoll: 0,
  });
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  // Discover widget sources from all agents' connected apps
  const discoverSources = useCallback(async (): Promise<WidgetSource[]> => {
    try {
      const agents: any[] = await invoke('db_list_agents', {});
      const seen = new Set<string>();
      const sources: WidgetSource[] = [];

      for (const agent of agents) {
        if (!agent.connected_apps) continue;

        let config: Record<string, any>;
        try {
          const parsed = JSON.parse(agent.connected_apps);
          config = parsed.apps || parsed;
        } catch {
          continue;
        }

        for (const [appId, appConfig] of Object.entries(config)) {
          if (seen.has(appId)) continue;

          // Inspect app manifest for widget declarations
          try {
            const result = await executeMcpTool('ul.discover', { scope: 'inspect', app_id: appId });
            const inspected = JSON.parse(result.content.map(c => c.text).join(''));
            const manifest = inspected.manifest
              ? (typeof inspected.manifest === 'string' ? JSON.parse(inspected.manifest) : inspected.manifest)
              : inspected.app?.manifest;

            if (manifest?.widgets && Array.isArray(manifest.widgets)) {
              for (const widget of manifest.widgets) {
                sources.push({
                  appId,
                  appName: (appConfig as any).name || inspected.app?.name || appId,
                  widget: widget as WidgetDeclaration,
                });
              }
              seen.add(appId);
            }
          } catch {
            // App inspection failed, skip
          }
        }
      }

      return sources;
    } catch {
      return [];
    }
  }, []);

  // Poll a single widget source for data
  const pollWidget = useCallback(async (source: WidgetSource): Promise<WidgetData | null> => {
    try {
      const result = await executeMcpTool('ul.call', {
        app_id: source.appId,
        function_name: source.widget.data_tool,
        args: {},
      });

      const text = result.content.map(c => c.text).join('');
      const data = JSON.parse(text);
      return data as WidgetData;
    } catch {
      return null;
    }
  }, []);

  // Poll all widget sources
  const pollAll = useCallback(async (sources: WidgetSource[]) => {
    if (sources.length === 0) return;

    const newData: Record<string, WidgetData> = {};
    let totalBadge = 0;

    await Promise.all(
      sources.map(async (source) => {
        const key = source.appId + ':' + source.widget.id;
        const data = await pollWidget(source);
        if (data) {
          newData[key] = data;
          totalBadge += data.badge_count;
        }
      })
    );

    if (mountedRef.current) {
      setState(prev => ({
        ...prev,
        data: newData,
        totalBadge,
        loading: false,
        lastPoll: Date.now(),
      }));
    }
  }, [pollWidget]);

  // Execute a widget action (approve, reject, etc.)
  const executeAction = useCallback(async (
    appId: string,
    action: WidgetAction,
    editedValue?: string,
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      // Replace {{edited_value}} placeholder in args
      const args = { ...action.args };
      if (editedValue !== undefined) {
        for (const [key, val] of Object.entries(args)) {
          if (val === '{{edited_value}}') {
            args[key] = editedValue;
          }
        }
      }

      const result = await executeMcpTool('ul.call', {
        app_id: appId,
        function_name: action.tool,
        args,
      });

      // Re-poll after action to refresh the inbox
      if (mountedRef.current) {
        pollAll(state.sources);
      }

      return { success: !result.isError };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }, [state.sources, pollAll]);

  // Refresh — re-discover and re-poll
  const refresh = useCallback(async () => {
    if (!mountedRef.current) return;
    setState(prev => ({ ...prev, loading: true }));

    const sources = await discoverSources();
    if (!mountedRef.current) return;

    setState(prev => ({ ...prev, sources }));
    await pollAll(sources);
  }, [discoverSources, pollAll]);

  // Initial discovery + polling setup
  useEffect(() => {
    mountedRef.current = true;

    // Initial load
    refresh();

    // Set up polling (default 30s)
    pollTimerRef.current = setInterval(() => {
      if (mountedRef.current) {
        // Re-poll existing sources (don't re-discover every time)
        setState(prev => {
          if (prev.sources.length > 0) {
            pollAll(prev.sources);
          }
          return prev;
        });
      }
    }, 30_000);

    return () => {
      mountedRef.current = false;
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
      }
    };
  }, []);

  return {
    ...state,
    executeAction,
    refresh,
  };
}
