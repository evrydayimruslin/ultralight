// InChatWidget — renders an MCP widget iframe inline within a tool call card.
// Reuses the same bridge SDK pattern as WidgetAppView but sized for inline chat.
// The iframe auto-resizes its height based on content and supports full interactivity.

import { useRef, useEffect, useState, useCallback } from 'react';
import { getApiBase, getToken } from '../lib/storage';

interface InChatWidgetProps {
  appUuid: string;
  appSlug: string;
  widgetName: string;
  appHtml: string;
  /** The tool call result data to pass to the widget as initial data */
  initialData?: unknown;
  /** Maximum height before internal scrolling (default: 600px) */
  maxHeight?: number;
}

export default function InChatWidget({
  appUuid,
  appSlug,
  widgetName,
  appHtml,
  initialData,
  maxHeight = 600,
}: InChatWidgetProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(200); // Start at reasonable minimum
  const [loaded, setLoaded] = useState(false);

  // Build bridge SDK — same pattern as WidgetAppView
  const apiBase = getApiBase();
  const token = getToken();

  const bridgeSdk = `<script>
(function() {
  var _apiBase = ${JSON.stringify(apiBase)};
  var _token = ${JSON.stringify(token)};
  var _appUuid = ${JSON.stringify(appUuid)};
  var _appSlug = ${JSON.stringify(appSlug)};
  var _initialData = ${JSON.stringify(initialData || null)};

  // Bridge: call MCP functions from within the widget.
  // Sends unprefixed function names — the MCP endpoint accepts both
  // prefixed (slug_functionName) and unprefixed (functionName) formats.
  // When slug is available, prefix for backward compat; otherwise send unprefixed.
  window.ulAction = function(functionName, args) {
    var toolName = _appSlug ? (_appSlug + '_' + functionName) : functionName;
    return fetch(_apiBase + '/mcp/' + _appUuid, {
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

  // Expose initial data from the tool call result
  window.ulInitialData = _initialData;

  // Auto-resize: report height changes to parent
  function reportHeight() {
    var h = document.documentElement.scrollHeight || document.body.scrollHeight;
    parent.postMessage({ type: 'ul-widget-resize', height: h }, '*');
  }

  // Report height on load and on mutations
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      reportHeight();
      new MutationObserver(reportHeight).observe(document.body, {
        childList: true, subtree: true, attributes: true, characterData: true
      });
      new ResizeObserver(reportHeight).observe(document.body);
    });
  } else {
    reportHeight();
    new MutationObserver(reportHeight).observe(document.body, {
      childList: true, subtree: true, attributes: true, characterData: true
    });
    new ResizeObserver(reportHeight).observe(document.body);
  }

  // Signal ready
  parent.postMessage({ type: 'ul-widget-ready' }, '*');
})();
</script>`;

  // Inject bridge SDK into the HTML
  const preparedHtml = (() => {
    // Also inject a base style reset for consistent in-chat rendering
    const inChatStyles = `<style>
      html, body { margin: 0; padding: 0; overflow: hidden; font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
      body { padding: 12px 16px; }
    </style>`;

    if (appHtml.includes('<head>')) {
      return appHtml.replace('<head>', '<head>' + bridgeSdk + inChatStyles);
    }
    if (appHtml.includes('<html>')) {
      return appHtml.replace('<html>', '<html><head>' + bridgeSdk + inChatStyles + '</head>');
    }
    return `<!DOCTYPE html><html><head><meta charset="utf-8">${bridgeSdk}${inChatStyles}</head><body>${appHtml}</body></html>`;
  })();

  // Listen for height reports from iframe
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (!e.data || typeof e.data !== 'object') return;

      if (e.data.type === 'ul-widget-resize' && typeof e.data.height === 'number') {
        // Clamp between min and max
        const newHeight = Math.max(80, Math.min(e.data.height, maxHeight));
        setHeight(newHeight);
      }

      if (e.data.type === 'ul-widget-ready') {
        setLoaded(true);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [maxHeight]);

  // Send initial data to widget after it loads (via postMessage as backup)
  const handleIframeLoad = useCallback(() => {
    setLoaded(true);
  }, []);

  return (
    <div className="relative rounded-md overflow-hidden border border-gray-100 bg-white">
      {/* Loading overlay */}
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-50/80 z-10">
          <div className="w-4 h-4 rounded-full border-2 border-gray-300 border-t-gray-600 animate-spin" />
        </div>
      )}

      {/* Widget iframe */}
      <iframe
        ref={iframeRef}
        srcDoc={preparedHtml}
        sandbox="allow-scripts allow-same-origin"
        className="w-full border-0 transition-[height] duration-150"
        style={{ height: `${height}px` }}
        title={`Widget: ${widgetName}`}
        onLoad={handleIframeLoad}
      />
    </div>
  );
}
