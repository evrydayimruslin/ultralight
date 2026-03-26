// In-Chat Widget resolution — discovers widget mappings for connected apps
// and provides widget HTML + bridge config for inline rendering in tool call cards.

import { useState, useEffect, useCallback, useRef, createContext, useContext } from 'react';
import { executeAppMcpTool } from '../lib/api';
import { getToken, getApiBase } from '../lib/storage';

// ── Types ──

export interface WidgetMapping {
  appUuid: string;
  appSlug: string;
  widgetName: string;
  uiFunction: string;    // e.g. "widget_billing_ui"
  /** Which app functions map to this widget */
  mappedFunctions: string[];
}

export interface ResolvedWidget {
  appUuid: string;
  appSlug: string;
  widgetName: string;
  html: string;
}

interface InChatWidgetState {
  /** Widget mappings keyed by `${appUuid}:${functionName}` */
  mappings: Map<string, WidgetMapping>;
  /** Whether initial discovery has completed */
  ready: boolean;
}

// ── Context ──

interface InChatWidgetContextValue {
  /** Check if a function has a widget, and get its HTML if so */
  getWidgetForFunction: (appId: string, functionName: string) => Promise<ResolvedWidget | null>;
  /** Whether mappings have been discovered */
  ready: boolean;
}

export const InChatWidgetContext = createContext<InChatWidgetContextValue>({
  getWidgetForFunction: async () => null,
  ready: false,
});

export function useInChatWidgetContext() {
  return useContext(InChatWidgetContext);
}

// ── Hook ──

/**
 * Discovers widget-capable functions across connected apps and provides
 * widget resolution for ToolCallCard rendering.
 *
 * @param connectedAppIds Array of connected app UUIDs
 */
export function useInChatWidgets(connectedAppIds: string[]) {
  const [state, setState] = useState<InChatWidgetState>({
    mappings: new Map(),
    ready: false,
  });
  const mountedRef = useRef(true);
  const discoveredRef = useRef(new Set<string>());

  // Discover widget functions for a single app
  const discoverAppWidgets = useCallback(async (appUuid: string): Promise<WidgetMapping[]> => {
    const token = getToken();
    if (!token) return [];

    try {
      const base = getApiBase();
      const res = await fetch(`${base}/mcp/${appUuid}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: crypto.randomUUID(), method: 'tools/list', params: {} }),
      });
      const data = await res.json();
      const tools: Array<{ name: string; description?: string }> = data?.result?.tools || [];

      // Find widget UI functions: {slug}_widget_{name}_ui
      const uiTools = tools.filter(t => t.name.includes('_widget_') && t.name.endsWith('_ui'));
      const mappings: WidgetMapping[] = [];

      // Collect all non-widget tools
      const firstUiMatch = uiTools[0]?.name.match(/^(.+)_widget_(.+)_ui$/);
      const appSlugFromTools = firstUiMatch?.[1] || '';
      const nonWidgetTools = tools.filter(t =>
        !t.name.includes('_widget_') && t.name.startsWith(appSlugFromTools + '_')
      );
      const allFnNames = nonWidgetTools.map(t => t.name.replace(appSlugFromTools + '_', ''));
      const isMultiWidget = uiTools.length > 1;

      for (const uiTool of uiTools) {
        const match = uiTool.name.match(/^(.+)_widget_(.+)_ui$/);
        if (!match) continue;
        const [, slug, widgetName] = match;

        let mappedFunctions: string[];

        if (isMultiWidget) {
          // Multi-widget app: only map functions whose names share a
          // distinguishing keyword with the widget name.
          // We exclude keywords that appear in ALL widget names (e.g. "email"
          // in both "email_inbox" and "email_faqs") since they can't disambiguate.
          const allWidgetNames = uiTools.map(t => {
            const m = t.name.match(/^.+_widget_(.+)_ui$/);
            return m ? m[1] : '';
          });
          const allKeywords = allWidgetNames.flatMap(n => n.split('_').filter(k => k.length > 2));
          const keywordCounts = new Map<string, number>();
          for (const kw of allKeywords) {
            keywordCounts.set(kw, (keywordCounts.get(kw) || 0) + 1);
          }
          // Distinguishing keywords: appear in this widget but not in ALL widgets
          const widgetKeywords = widgetName.split('_').filter(k =>
            k.length > 2 && (keywordCounts.get(k) || 0) < allWidgetNames.length
          );

          if (widgetKeywords.length === 0) {
            // No distinguishing keywords — can't auto-map, skip this widget.
            // Requires explicit manifest mapping (widget field on functions).
            continue;
          }

          mappedFunctions = allFnNames.filter(fn => {
            const fnLower = fn.toLowerCase();
            return widgetKeywords.some(kw => fnLower.includes(kw));
          });
        } else {
          // Single-widget app: all functions map to the one widget
          mappedFunctions = allFnNames;
        }

        if (mappedFunctions.length > 0) {
          mappings.push({
            appUuid, appSlug: slug, widgetName,
            uiFunction: `widget_${widgetName}_ui`,
            mappedFunctions,
          });
        }
      }

      return mappings;
    } catch (e) {
      console.warn(`[InChatWidgets] Failed to discover widgets for ${appUuid}:`, e);
      return [];
    }
  }, []);

  // Discover all connected apps
  useEffect(() => {
    if (connectedAppIds.length === 0) {
      setState({ mappings: new Map(), ready: true });
      return;
    }

    mountedRef.current = true;

    const discover = async () => {
      const newMappings = new Map<string, WidgetMapping>();

      await Promise.all(
        connectedAppIds.map(async (appUuid) => {
          if (discoveredRef.current.has(appUuid)) return;
          discoveredRef.current.add(appUuid);

          const appMappings = await discoverAppWidgets(appUuid);
          for (const mapping of appMappings) {
            // Index by appUuid:functionName for fast lookup
            for (const fn of mapping.mappedFunctions) {
              newMappings.set(`${appUuid}:${fn}`, mapping);
            }
          }
        })
      );

      if (mountedRef.current) {
        setState(prev => {
          const merged = new Map(prev.mappings);
          for (const [key, val] of newMappings) {
            merged.set(key, val);
          }
          return { mappings: merged, ready: true };
        });
      }
    };

    discover();

    return () => { mountedRef.current = false; };
  }, [connectedAppIds, discoverAppWidgets]);

  // Get widget HTML (cached or fresh) for a specific function
  const getWidgetForFunction = useCallback(async (
    appId: string,
    functionName: string,
  ): Promise<ResolvedWidget | null> => {
    const mapping = state.mappings.get(`${appId}:${functionName}`);
    if (!mapping) return null;

    // Check localStorage cache
    const cacheKey = `widget_app:${mapping.appUuid}:${mapping.widgetName}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      try {
        const { html } = JSON.parse(cached);
        if (html) {
          return {
            appUuid: mapping.appUuid,
            appSlug: mapping.appSlug,
            widgetName: mapping.widgetName,
            html,
          };
        }
      } catch { /* cache corrupt, fetch fresh */ }
    }

    // Fetch fresh
    try {
      const prefixed = `${mapping.appSlug}_${mapping.uiFunction}`;
      const result = await executeAppMcpTool(mapping.appUuid, prefixed, {});
      if (result.isError) return null;

      const text = result.content?.[0]?.text || '';
      const parsed = JSON.parse(text);

      if (parsed.app_html) {
        // Cache it
        localStorage.setItem(cacheKey, JSON.stringify({
          html: parsed.app_html,
          version: parsed.version || '1',
          cachedAt: Date.now(),
        }));

        return {
          appUuid: mapping.appUuid,
          appSlug: mapping.appSlug,
          widgetName: mapping.widgetName,
          html: parsed.app_html,
        };
      }

      return null;
    } catch {
      return null;
    }
  }, [state.mappings]);

  return {
    getWidgetForFunction,
    ready: state.ready,
    mappings: state.mappings,
  };
}
