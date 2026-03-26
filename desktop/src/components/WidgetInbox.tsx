// WidgetInbox — renders all MCP widget items grouped by source.
// Sits at the top of the Activity tab, above the existing event log.

import { useWidgetInbox } from '../hooks/useWidgetInbox';
import WidgetCard from './WidgetCard';

export default function WidgetInbox() {
  const { sources, data, loading, executeAction, refresh } = useWidgetInbox();

  // Group widget data by source
  const groups = sources
    .map(source => {
      const key = source.appUuid + ':' + source.widgetFunction;
      const widgetData = data[key];
      return { source, data: widgetData };
    })
    .filter(g => g.data && g.data.items.length > 0);

  if (loading && groups.length === 0) {
    return (
      <div className="text-center py-8">
        <div className="inline-block w-5 h-5 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
        <p className="text-caption text-ul-text-muted mt-2">Checking for pending items…</p>
      </div>
    );
  }

  if (groups.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      {groups.map(({ source, data: widgetData }) => (
        <div key={source.appUuid + ':' + source.widgetFunction}>
          {/* Source header */}
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="text-small font-medium text-ul-text">Email Approvals</span>
              <span className="text-caption text-ul-text-muted">via {source.appName}</span>
            </div>
            {widgetData!.badge_count > 0 && (
              <span className="text-[11px] font-medium bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                {widgetData!.badge_count} pending
              </span>
            )}
          </div>

          {/* Widget items */}
          <div className="space-y-2">
            {widgetData!.items.map(item => (
              <WidgetCard
                key={item.id}
                item={item}
                appId={source.appUuid}
                onAction={executeAction}
              />
            ))}
          </div>
        </div>
      ))}

      {/* Refresh button */}
      <div className="flex justify-center pt-1">
        <button
          onClick={refresh}
          disabled={loading}
          className="text-caption text-ul-text-muted hover:text-ul-text transition-colors disabled:opacity-50"
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
    </div>
  );
}
