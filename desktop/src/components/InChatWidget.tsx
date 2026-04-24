// InChatWidget — renders an MCP widget iframe inline in the conversation.
// Injects the ulAction bridge SDK so the widget can call MCP functions.
// Auto-resizes height based on iframe content.

import { useRef, useEffect, useState, useCallback } from 'react';
import { getApiBase, getToken } from '../lib/storage';
import { openWidgetWindow } from '../lib/multiWindow';
import { buildWidgetNavigationTarget, buildWidgetSrcDoc } from '../lib/widgetRuntime';

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

  const preparedHtml = buildWidgetSrcDoc({
    appHtml,
    appUuid,
    appSlug,
    widgetName,
    apiBase,
    token,
    inlineResize: true,
  });

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
      if (e.data.type === 'ul-open-widget' && e.data.widgetName) {
        openWidgetWindow(buildWidgetNavigationTarget({
          appUuid,
          appSlug,
          appName: widgetName,
          widgetName,
          uiFunction: `widget_${widgetName}_ui`,
          dataFunction: `widget_${widgetName}_data`,
        }, e.data.widgetName), e.data.context);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [appSlug, appUuid, maxHeight, widgetName]);

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
