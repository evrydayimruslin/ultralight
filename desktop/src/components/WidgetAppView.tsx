// WidgetAppView — full-screen container for an MCP's HTML widget app.
// Loads the app_html in an iframe with a direct-call bridge SDK injected.
// The bridge makes HTTP calls directly to the MCP endpoint (no postMessage needed).

import { useRef } from 'react';
import type { WidgetAppSource } from '../hooks/useWidgetInbox';
import { getApiBase, getToken } from '../lib/storage';

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
    var prefixed = _appSlug + '_' + functionName;
    return fetch(_apiBase + '/mcp/' + _appUuid, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + _token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: crypto.randomUUID(),
        method: 'tools/call',
        params: { name: prefixed, arguments: args || {} }
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
      </div>

      {/* Widget App iframe */}
      <div className="flex-1 min-h-0">
        <iframe
          ref={iframeRef}
          srcDoc={preparedHtml}
          sandbox="allow-scripts allow-same-origin"
          className="w-full h-full border-0"
          title={`Widget: ${source.widgetName}`}
        />
      </div>
    </div>
  );
}
