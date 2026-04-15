// WidgetWindow — standalone window for a widget app, opened via multiWindow.
// Reads WidgetAppSource from query params, token/apiBase from shared localStorage.
// Includes a refresh button to re-fetch the widget HTML from the MCP.

import { useState, useEffect, useRef, useCallback } from 'react';
import { getApiBase, getToken } from '../lib/storage';
import { executeAppMcpTool } from '../lib/api';
import { openWidgetWindow } from '../lib/multiWindow';
import type { WidgetAppSource } from '../hooks/useWidgetInbox';

/** Parse WidgetAppSource from current URL query params */
function parseSourceFromParams(): WidgetAppSource {
  const p = new URLSearchParams(window.location.search);
  return {
    appUuid: p.get('appUuid') || '',
    appSlug: p.get('appSlug') || '',
    appName: p.get('appName') || '',
    widgetName: p.get('widgetName') || '',
    uiFunction: p.get('uiFunction') || '',
    dataFunction: p.get('dataFunction') || '',
  };
}

/** Parse context from ctx_* query params */
function parseContextFromParams(): Record<string, string> {
  const p = new URLSearchParams(window.location.search);
  const ctx: Record<string, string> = {};
  p.forEach((v, k) => { if (k.startsWith('ctx_')) ctx[k.slice(4)] = v; });
  return ctx;
}

export default function WidgetWindow() {
  const source = useRef(parseSourceFromParams()).current;
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHtml = useCallback(async (bustCache = false) => {
    setLoading(true);
    setError(null);

    const cacheKey = `widget_app:${source.appUuid}:${source.widgetName}`;

    // Try localStorage cache first (unless busting)
    if (!bustCache) {
      try {
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          const { html: cachedHtml } = JSON.parse(cached);
          if (cachedHtml) {
            setHtml(cachedHtml);
            setLoading(false);
            return;
          }
        }
      } catch { /* ignore corrupt cache */ }
    }

    // Fetch fresh from MCP
    try {
      const prefixed = `${source.appSlug}_${source.uiFunction}`;
      const result = await executeAppMcpTool(source.appUuid, prefixed, {});
      if (result.isError) {
        setError('Failed to load widget');
        setLoading(false);
        return;
      }

      const text = result.content?.[0]?.text || '';
      const parsed = JSON.parse(text);
      const appHtml = parsed.app_html || null;

      if (appHtml) {
        localStorage.setItem(cacheKey, JSON.stringify({
          html: appHtml,
          version: parsed.version || '1',
          cachedAt: Date.now(),
        }));
        setHtml(appHtml);
      } else {
        setError('Widget returned no HTML');
      }
    } catch (e) {
      setError('Failed to fetch widget');
      console.error('[WidgetWindow] fetch error:', e);
    }
    setLoading(false);
  }, [source]);

  useEffect(() => { fetchHtml(); }, [fetchHtml]);

  // Build iframe srcDoc with bridge SDK injected
  const preparedHtml = (() => {
    if (!html) return null;

    const apiBase = getApiBase();
    const token = getToken();

    const bridgeSdk = `<script>
(function() {
  var _apiBase = ${JSON.stringify(apiBase)};
  var _token = ${JSON.stringify(token)};
  var _appUuid = ${JSON.stringify(source.appUuid)};
  var _appSlug = ${JSON.stringify(source.appSlug)};

  window.ulAction = function(functionName, args) {
    var isPlatform = functionName.indexOf('ultralight.') === 0 || functionName.indexOf('ul.') === 0;
    var toolName = isPlatform ? functionName : (_appSlug + '_' + functionName);
    var endpoint = isPlatform ? (_apiBase + '/mcp/platform') : (_apiBase + '/mcp/' + _appUuid);
    return fetch(endpoint, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + _token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: crypto.randomUUID(),
        method: 'tools/call',
        params: { name: toolName, arguments: args || {} }
      })
    })
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (data.error) throw new Error(data.error.message || 'MCP error');
      var text = data.result && data.result.content && data.result.content[0] && data.result.content[0].text;
      if (!text) return null;
      try { return JSON.parse(text); } catch(e) { return text; }
    });
  };

  // Open another widget in a new window
  window.ulOpenWidget = function(widgetName, context) {
    parent.postMessage({ type: 'ul-open-widget', widgetName: widgetName, context: context || {} }, '*');
  };

  // Inject context from parent (for widget-to-widget navigation)
  window.ulWidgetContext = ${JSON.stringify(parseContextFromParams())};
})();
</script>`;

    if (html.includes('<head>')) return html.replace('<head>', '<head>' + bridgeSdk);
    if (html.includes('<html>')) return html.replace('<html>', '<html><head>' + bridgeSdk + '</head>');
    return `<!DOCTYPE html><html><head><meta charset="utf-8">${bridgeSdk}</head><body>${html}</body></html>`;
  })();

  // Listen for widget-to-widget navigation requests from iframe
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'ul-open-widget' && e.data.widgetName) {
        const target = {
          appUuid: source.appUuid, appSlug: source.appSlug, appName: source.appName,
          widgetName: e.data.widgetName,
          uiFunction: `widget_${e.data.widgetName}_ui`,
          dataFunction: `widget_${e.data.widgetName}_data`,
        };
        openWidgetWindow(target, e.data.context);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [source]);

  return (
    <div className="flex flex-col h-screen bg-white">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-200 bg-white shrink-0"
           data-tauri-drag-region="true">
        <span className="text-sm font-medium text-gray-900 select-none">
          {source.appName}
        </span>
        <button
          onClick={() => fetchHtml(true)}
          disabled={loading}
          className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors disabled:opacity-40"
          title="Refresh widget"
        >
          <svg className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0">
        {error && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-500">
            <span className="text-sm">{error}</span>
            <button
              onClick={() => fetchHtml(true)}
              className="text-sm text-blue-600 hover:text-blue-800 underline"
            >
              Try again
            </button>
          </div>
        )}
        {preparedHtml && (
          <iframe
            ref={iframeRef}
            srcDoc={preparedHtml}
            sandbox="allow-scripts allow-same-origin"
            className="w-full h-full border-0"
            title={`Widget: ${source.widgetName}`}
          />
        )}
      </div>
    </div>
  );
}
