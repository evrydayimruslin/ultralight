// WidgetHomescreen — grid of widget tiles for the Activity tab.
// Each tile shows an icon, title, badge count, and MCP source.
// Clicking a tile opens the widget's full-screen HTML app.

import type { WidgetMeta } from '../../../shared/contracts/widget.ts';
import { openWidgetWindow } from '../lib/multiWindow';
import {
  estimateWidgetPullCost,
  getWidgetSourceKey,
  readWidgetPullSettings,
  WIDGET_PULL_INTERVAL_OPTIONS,
  type WidgetAppSource,
  type WidgetPullSettings,
} from '../lib/widgetRuntime';

interface WidgetHomescreenProps {
  sources: WidgetAppSource[];
  metas: Record<string, WidgetMeta>;
  settings: Record<string, WidgetPullSettings>;
  loading: boolean;
  onOpenWidget: (source: WidgetAppSource) => void;
  onSetWidgetPullEnabled: (source: WidgetAppSource, enabled: boolean) => void;
  onSetWidgetPullInterval: (source: WidgetAppSource, intervalMs: number) => void;
  onRefreshWidget: (source: WidgetAppSource) => void;
}

function formatLastPulled(timestamp: number | null): string {
  if (!timestamp) return 'Never';
  const elapsedMs = Date.now() - timestamp;
  if (elapsedMs < 60_000) return 'Just now';
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(timestamp).toLocaleDateString();
}

function fallbackMeta(source: WidgetAppSource): WidgetMeta {
  return {
    title: source.widgetName.replace(/^widget_/, '').replace(/_/g, ' '),
    icon: '📦',
    badge_count: 0,
  };
}

export default function WidgetHomescreen({
  sources,
  metas,
  settings,
  loading,
  onOpenWidget,
  onSetWidgetPullEnabled,
  onSetWidgetPullInterval,
  onRefreshWidget,
}: WidgetHomescreenProps) {
  const tiles = sources.map(source => {
    const key = getWidgetSourceKey(source);
    return {
      key,
      source,
      meta: metas[key] ?? fallbackMeta(source),
      settings: settings[key] ?? readWidgetPullSettings(source),
    };
  });

  if (loading && tiles.length === 0) {
    return (
      <div className="grid grid-cols-3 gap-4 p-6">
        {[1, 2, 3].map(i => (
          <div key={i} className="animate-pulse rounded-xl bg-gray-100 h-28" />
        ))}
      </div>
    );
  }

  if (tiles.length === 0) {
    return null;
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 p-6">
      {tiles.map(({ key, source, meta, settings: widgetSettings }) => {
        const estimate = estimateWidgetPullCost(widgetSettings);

        return (
          <div
            key={key}
            className="relative rounded-lg border border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm transition-all group"
          >
            <div className="flex items-center gap-2 p-4 rounded-t-lg hover:bg-gray-50 transition-colors">
              <button
                type="button"
                onClick={() => onOpenWidget(source)}
                className="min-w-0 flex flex-1 items-center gap-3 text-left"
              >
                <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-gray-50 text-2xl leading-none">
                  {meta.icon || '📦'}
                  {meta.badge_count > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 min-w-[20px] h-5 flex items-center justify-center text-[11px] font-semibold bg-red-500 text-white rounded-full px-1.5">
                      {meta.badge_count}
                    </span>
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-gray-900 truncate">
                    {meta.title}
                  </span>
                  <span className="block text-[11px] text-gray-400 truncate">
                    {source.appName}
                  </span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => openWidgetWindow(source)}
                className="opacity-0 group-hover:opacity-100 p-1.5 rounded-md hover:bg-gray-200 transition-all text-gray-400 hover:text-gray-700"
                title="Open in new window"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </button>
            </div>

            <div className="border-t border-gray-100 px-4 py-3 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <label className="inline-flex items-center gap-2 text-xs text-gray-600">
                  <input
                    type="checkbox"
                    checked={widgetSettings.enabled}
                    onChange={(e) => onSetWidgetPullEnabled(source, e.currentTarget.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-900"
                  />
                  Auto
                </label>
                <div className="flex items-center gap-2">
                  <select
                    value={widgetSettings.intervalMs}
                    onChange={(e) => onSetWidgetPullInterval(source, Number(e.currentTarget.value))}
                    disabled={!widgetSettings.enabled}
                    className="h-8 rounded-md border border-gray-200 bg-white px-2 text-xs text-gray-700 disabled:opacity-45"
                    title="Pull interval"
                  >
                    {WIDGET_PULL_INTERVAL_OPTIONS.map(option => (
                      <option key={option.valueMs} value={option.valueMs}>{option.label}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => onRefreshWidget(source)}
                    disabled={loading}
                    className="h-8 w-8 inline-flex items-center justify-center rounded-md border border-gray-200 text-gray-500 hover:text-gray-900 hover:bg-gray-50 disabled:opacity-45"
                    title="Pull now"
                  >
                    <svg className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-[11px] text-gray-500">
                <span className="truncate">
                  {estimate.monthlyPulls.toLocaleString()} pulls/mo
                </span>
                <span className="text-right truncate">
                  {estimate.monthlyLight.toFixed(3)} Light/mo
                </span>
                <span className="truncate">
                  Last {formatLastPulled(widgetSettings.lastPulledAt)}
                </span>
                <span className="text-right truncate">
                  {widgetSettings.pullCount.toLocaleString()} pulls
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
