// WidgetAppView — full-screen container for an MCP's HTML widget app.
// Loads the app_html in an iframe with a direct-call bridge SDK injected.
// The bridge makes HTTP calls directly to the MCP endpoint (no postMessage needed).

import { useRef, useEffect } from 'react';
import type { WidgetAppSource } from '../hooks/useWidgetInbox';
import { getApiBase, getToken } from '../lib/storage';
import { openWidgetWindow } from '../lib/multiWindow';

interface WidgetAppViewProps {
  source: WidgetAppSource;
  appHtml: string;
  onBack: () => void;
  onBridgeCall: (appUuid: string, slug: string, fn: string, args: Record<string, unknown>) => Promise<unknown>;
}

export default function WidgetAppView({ source, appHtml, onBack }: WidgetAppViewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Build bridge SDK that calls the MCP endpoint directly via fetch
  const apiBase = getApiBase();
  const token = getToken();

  const bridgeSdk = `<script>
(function() {
  var _apiBase = ${JSON.stringify(apiBase)};
  var _token = ${JSON.stringify(token)};
  var _appUuid = ${JSON.stringify(source.appUuid)};
  var _appSlug = ${JSON.stringify(source.appSlug)};

  window.ulAction = function(functionName, args) {
    // Platform tools (ultralight.* / ul.*) — route to platform endpoint, no slug prefix
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
})();
</script>`;

  // Inject bridge SDK into the HTML
  const preparedHtml = (() => {
    if (appHtml.includes('<head>')) {
      return appHtml.replace('<head>', '<head>' + bridgeSdk);
    }
    if (appHtml.includes('<html>')) {
      return appHtml.replace('<html>', '<html><head>' + bridgeSdk + '</head>');
    }
    return `<!DOCTYPE html><html><head><meta charset="utf-8">${bridgeSdk}</head><body>${appHtml}</body></html>`;
  })();

  // Listen for widget-to-widget navigation requests
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
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 bg-white shrink-0">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </button>
        <span className="text-sm font-medium text-gray-900">
          {source.appName}
        </span>
        <button
          onClick={() => openWidgetWindow(source)}
          className="ml-auto flex items-center gap-1 text-xs text-gray-400 hover:text-gray-700 transition-colors"
          title="Open in new window"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </button>
      </div>

      {/* Widget App iframe */}
      <div className="flex-1 min-h-0">
        <iframe
          ref={iframeRef}
          srcDoc={preparedHtml}
          sandbox="allow-scripts allow-same-origin"
          className="w-full h-full border-0"
          title={`Widget: ${source.widgetName}`}
          onError={() => console.error(`[WidgetAppView] iframe error: ${source.widgetName}`)}
        />
      </div>
    </div>
  );
}
