// WidgetHomescreen — grid of widget tiles for the Activity tab.
// Each tile shows an icon, title, badge count, and MCP source.
// Clicking a tile opens the widget's full-screen HTML app.

import type { WidgetMeta } from '../../../shared/contracts/widget.ts';
import { openWidgetWindow } from '../lib/multiWindow';
import type { WidgetAppSource } from '../lib/widgetRuntime';

interface WidgetHomescreenProps {
  sources: WidgetAppSource[];
  metas: Record<string, WidgetMeta>;
  loading: boolean;
  onOpenWidget: (source: WidgetAppSource) => void;
}

export default function WidgetHomescreen({ sources, metas, loading, onOpenWidget }: WidgetHomescreenProps) {
  // Build tiles from sources + metas
  const tiles = sources
    .map(source => {
      const key = `${source.appUuid}:${source.widgetName}`;
      const meta = metas[key];
      return { source, meta };
    })
    .filter(t => t.meta);

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
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 p-6">
      {tiles.map(({ source, meta }) => (
        <button
          key={`${source.appUuid}:${source.widgetName}`}
          onClick={() => onOpenWidget(source)}
          className="relative flex flex-col items-center justify-center gap-2 p-5 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 hover:border-gray-300 hover:shadow-sm transition-all cursor-pointer text-center group"
        >
          {/* Pop-out button (top-left, visible on hover) */}
          <span
            role="button"
            tabIndex={-1}
            onClick={(e) => { e.stopPropagation(); openWidgetWindow(source); }}
            className="absolute top-2 left-2 opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-gray-200 transition-all text-gray-400 hover:text-gray-700"
            title="Open in new window"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </span>

          {/* Badge */}
          {meta!.badge_count > 0 && (
            <span className="absolute top-2 right-2 min-w-[20px] h-5 flex items-center justify-center text-[11px] font-semibold bg-red-500 text-white rounded-full px-1.5">
              {meta!.badge_count}
            </span>
          )}

          {/* Icon */}
          <span className="text-3xl leading-none group-hover:scale-110 transition-transform">
            {meta!.icon || '📦'}
          </span>

          {/* Title */}
          <span className="text-sm font-medium text-gray-900 truncate max-w-full">
            {meta!.title}
          </span>

          {/* Source */}
          <span className="text-[11px] text-gray-400 truncate max-w-full">
            {source.appName}
          </span>
        </button>
      ))}
    </div>
  );
}
