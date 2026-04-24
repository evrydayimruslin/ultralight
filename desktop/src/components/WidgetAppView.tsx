// WidgetAppView — full-screen container for an MCP's HTML widget app.
// Loads the app_html in an iframe with the shared widget bridge injected.
// The bridge makes MCP calls directly and uses postMessage for widget-to-widget navigation.

import { useRef, useEffect, useState } from 'react';
import { getApiBase, getToken } from '../lib/storage';
import { openWidgetWindow } from '../lib/multiWindow';
import {
  buildWidgetNavigationTarget,
  buildWidgetSrcDoc,
  type WidgetAppSource,
} from '../lib/widgetRuntime';
import { createDesktopLogger } from '../lib/logging';
import DesktopAsyncState from './DesktopAsyncState';

interface WidgetAppViewProps {
  source: WidgetAppSource;
  appHtml: string;
  onBack: () => void;
}

const widgetAppLogger = createDesktopLogger('WidgetAppView');

export default function WidgetAppView({ source, appHtml, onBack }: WidgetAppViewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [iframeError, setIframeError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const apiBase = getApiBase();
  const token = getToken();

  const preparedHtml = buildWidgetSrcDoc({
    appHtml,
    appUuid: source.appUuid,
    appSlug: source.appSlug,
    widgetName: source.widgetName,
    apiBase,
    token,
  });

  // Listen for widget-to-widget navigation requests
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'ul-open-widget' && e.data.widgetName) {
        const target = buildWidgetNavigationTarget(source, e.data.widgetName);
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
        {!appHtml.trim() ? (
          <DesktopAsyncState
            kind="empty"
            title="No widget UI returned"
            message="This widget is connected, but it has not published a visual surface yet."
          />
        ) : iframeError ? (
          <DesktopAsyncState
            kind="error"
            title="Widget view unavailable"
            message="The widget shell could not finish loading."
            actionLabel="Retry"
            onAction={() => {
              setIframeError(false);
              setReloadKey((value) => value + 1);
            }}
          />
        ) : (
          <iframe
            key={reloadKey}
            ref={iframeRef}
            srcDoc={preparedHtml}
            sandbox="allow-scripts allow-same-origin"
            className="w-full h-full border-0"
            title={`Widget: ${source.widgetName}`}
            onError={() => {
              setIframeError(true);
              widgetAppLogger.error('Widget iframe error', {
                widgetName: source.widgetName,
                appUuid: source.appUuid,
              });
            }}
          />
        )}
      </div>
    </div>
  );
}
