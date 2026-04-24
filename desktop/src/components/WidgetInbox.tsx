// WidgetInbox — compact widget surface for any view that wants the
// widget inbox model without the full HomeView inline-widget experience.

import { useWidgetInbox } from '../hooks/useWidgetInbox';
import WidgetHomescreen from './WidgetHomescreen';
import { openWidgetWindow } from '../lib/multiWindow';
import DesktopAsyncState from './DesktopAsyncState';

export default function WidgetInbox() {
  const { sources, metas, loading, refresh } = useWidgetInbox();

  if (loading && sources.length === 0) {
    return (
      <DesktopAsyncState
        kind="loading"
        title="Loading widgets"
        message="Checking your connected widget apps and live badge counts."
        compact
      />
    );
  }

  const hasVisibleWidgets = sources.some((source) => metas[`${source.appUuid}:${source.widgetName}`]);
  if (!hasVisibleWidgets) {
    return (
      <DesktopAsyncState
        kind="empty"
        title="No widgets yet"
        message={sources.length > 0
          ? 'Your widget apps are connected, but none are showing live activity right now.'
          : 'Connect or open an app with widget surfaces to see live inbox tiles here.'}
        actionLabel="Refresh"
        onAction={() => {
          void refresh();
        }}
        compact
      />
    );
  }

  return (
    <div className="space-y-4">
      <WidgetHomescreen
        sources={sources}
        metas={metas}
        loading={loading}
        onOpenWidget={(source) => {
          void openWidgetWindow(source);
        }}
      />

      <div className="flex justify-center pt-1">
        <button
          onClick={() => {
            void refresh();
          }}
          disabled={loading}
          className="text-caption text-ul-text-muted hover:text-ul-text transition-colors disabled:opacity-50"
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
    </div>
  );
}
