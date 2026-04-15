// InChatWidget — renders an MCP widget iframe inline in the conversation.
// Injects the ulAction bridge SDK so the widget can call MCP functions.
// Auto-resizes height based on iframe content.

import { useRef, useEffect, useState, useCallback } from 'react';
import { getApiBase, getToken } from '../lib/storage';

interface InChatWidgetProps {
  appUuid: string;
  appSlug: string;
  widgetName: string;
  appHtml: string;
  /** Maximum height before internal scrolling (default: 600px) */
  maxHeight?: number;
}

export default function InChatWidget({
  appUuid,
  appSlug,
  widgetName,
  appHtml,
  maxHeight = 2000,
}: InChatWidgetProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(300);
  const [loaded, setLoaded] = useState(false);

  const apiBase = getApiBase();
  const token = getToken();

  const bridgeSdk = `<script>
(function() {
  var _apiBase = ${JSON.stringify(apiBase)};
  var _token = ${JSON.stringify(token)};
  var _appUuid = ${JSON.stringify(appUuid)};
  var _appSlug = ${JSON.stringify(appSlug)};

  // Bridge: call MCP functions from within the widget.
  // Sends unprefixed function names when slug is empty.
  window.ulAction = function(functionName, args) {
    var isPlatform = functionName.indexOf('ultralight.') === 0 || functionName.indexOf('ul.') === 0;
    var toolName = isPlatform ? functionName : (_appSlug ? (_appSlug + '_' + functionName) : functionName);
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

  // Override dashboard-style height:100% and overflow:hidden for inline rendering.
  // Widgets are designed for full-screen dashboard but need to auto-size in chat.
  var styleOverride = document.createElement('style');
  styleOverride.textContent = 'html, body { height: auto !important; overflow: visible !important; }';
  (document.head || document.documentElement).appendChild(styleOverride);

  // Auto-resize: report height changes to parent
  function reportHeight() {
    // Measure actual content height — get the bounding rect of all children
    var h = 0;
    var children = document.body.children;
    for (var i = 0; i < children.length; i++) {
      var rect = children[i].getBoundingClientRect();
      var bottom = rect.top + rect.height;
      if (bottom > h) h = bottom;
    }
    // Fallback to scrollHeight if bounding rect gives 0
    if (h < 50) h = document.body.scrollHeight;
    // Add padding
    h += 24;
    parent.postMessage({ type: 'ul-widget-resize', height: Math.ceil(h), id: _appUuid }, '*');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      setTimeout(reportHeight, 100);
      new MutationObserver(function() { setTimeout(reportHeight, 50); }).observe(document.body, {
        childList: true, subtree: true, attributes: true, characterData: true
      });
      new ResizeObserver(function() { setTimeout(reportHeight, 50); }).observe(document.body);
    });
  } else {
    setTimeout(reportHeight, 100);
    new MutationObserver(function() { setTimeout(reportHeight, 50); }).observe(document.body, {
      childList: true, subtree: true, attributes: true, characterData: true
    });
    new ResizeObserver(function() { setTimeout(reportHeight, 50); }).observe(document.body);
  }

  parent.postMessage({ type: 'ul-widget-ready', id: _appUuid }, '*');
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

  // Listen for height reports from iframe
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (!e.data || typeof e.data !== 'object') return;
      if (e.data.type === 'ul-widget-resize' && typeof e.data.height === 'number') {
        const newHeight = Math.max(120, Math.min(e.data.height, maxHeight));
        setHeight(newHeight);
      }
      if (e.data.type === 'ul-widget-ready') {
        setLoaded(true);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [maxHeight]);

  const handleIframeLoad = useCallback(() => {
    setLoaded(true);
  }, []);

  return (
    <div className="relative rounded-lg overflow-hidden border border-gray-200 bg-white shadow-sm">
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
        className="w-full border-0 transition-[height] duration-200"
        style={{ height: `${height}px` }}
        title={`Widget: ${widgetName}`}
        onLoad={handleIframeLoad}
      />
    </div>
  );
}
