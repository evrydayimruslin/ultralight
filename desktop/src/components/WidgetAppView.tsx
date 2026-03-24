// WidgetAppView — full-screen container for an MCP's HTML widget app.
// Loads the app_html in an iframe with a postMessage bridge injected.
// The bridge routes ulAction() calls to the MCP endpoint via the desktop.

import { useEffect, useRef, useCallback } from 'react';
import type { WidgetAppSource } from '../hooks/useWidgetInbox';

interface WidgetAppViewProps {
  source: WidgetAppSource;
  appHtml: string;
  onBack: () => void;
  onBridgeCall: (appUuid: string, slug: string, fn: string, args: Record<string, unknown>) => Promise<unknown>;
}

// Bridge SDK script — injected into the iframe's HTML.
// Provides window.ulAction(functionName, args) → Promise<result>
const BRIDGE_SDK = `<script>
(function() {
  window.ulAction = function(functionName, args) {
    return new Promise(function(resolve, reject) {
      var id = crypto.randomUUID();
      function handler(e) {
        if (e.data && e.data.type === 'ul_widget_result' && e.data.id === id) {
          window.removeEventListener('message', handler);
          if (e.data.error) reject(new Error(e.data.error));
          else resolve(e.data.result);
        }
      }
      window.addEventListener('message', handler);
      window.parent.postMessage({
        type: 'ul_widget_action',
        id: id,
        function: functionName,
        args: args || {}
      }, '*');
    });
  };

  // Notify parent that bridge is ready
  window.parent.postMessage({ type: 'ul_widget_ready' }, '*');
})();
</script>`;

export default function WidgetAppView({ source, appHtml, onBack, onBridgeCall }: WidgetAppViewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Inject bridge SDK into the HTML
  const preparedHtml = (() => {
    // Insert bridge script after <head> or at the start
    if (appHtml.includes('<head>')) {
      return appHtml.replace('<head>', '<head>' + BRIDGE_SDK);
    }
    if (appHtml.includes('<html>')) {
      return appHtml.replace('<html>', '<html><head>' + BRIDGE_SDK + '</head>');
    }
    // No head tag — wrap it
    return `<!DOCTYPE html><html><head><meta charset="utf-8">${BRIDGE_SDK}</head><body>${appHtml}</body></html>`;
  })();

  // Listen for postMessage from iframe
  const handleMessage = useCallback(async (event: MessageEvent) => {
    const data = event.data;
    if (!data || data.type !== 'ul_widget_action') return;

    const { id, function: fn, args } = data;
    if (!id || !fn) return;

    try {
      const result = await onBridgeCall(source.appUuid, source.appSlug, fn, args || {});

      // Send result back to iframe
      iframeRef.current?.contentWindow?.postMessage({
        type: 'ul_widget_result',
        id,
        result,
      }, '*');
    } catch (err) {
      iframeRef.current?.contentWindow?.postMessage({
        type: 'ul_widget_result',
        id,
        result: null,
        error: err instanceof Error ? err.message : String(err),
      }, '*');
    }
  }, [source, onBridgeCall]);

  useEffect(() => {
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [handleMessage]);

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
