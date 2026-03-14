// TopToolbar — thin title bar toolbar with sidebar toggle and back/forward navigation.
// Sits above the sidebar + content layout. Serves as macOS window drag region.

interface TopToolbarProps {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  canGoBack: boolean;
  canGoForward: boolean;
  onGoBack: () => void;
  onGoForward: () => void;
}

export default function TopToolbar({
  sidebarOpen,
  onToggleSidebar,
  canGoBack,
  canGoForward,
  onGoBack,
  onGoForward,
}: TopToolbarProps) {
  return (
    <div
      className="flex items-center h-[38px] bg-gray-50 border-b border-ul-border flex-shrink-0"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* Spacer for macOS traffic lights */}
      <div className="w-[70px] flex-shrink-0" />

      {/* Toolbar buttons */}
      <div
        className="flex items-center gap-0.5"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {/* Sidebar toggle */}
        <button
          onClick={onToggleSidebar}
          className={`p-1.5 rounded hover:bg-ul-bg-hover transition-colors ${
            sidebarOpen ? 'text-ul-text-secondary' : 'text-ul-text-muted'
          }`}
          title={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
            stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="2.5" width="12" height="11" rx="2" />
            <line x1="6" y1="2.5" x2="6" y2="13.5" />
          </svg>
        </button>

        {/* Back */}
        <button
          onClick={onGoBack}
          disabled={!canGoBack}
          className={`p-1.5 rounded transition-colors ${
            canGoBack
              ? 'text-ul-text-secondary hover:bg-ul-bg-hover hover:text-ul-text'
              : 'text-ul-text-muted opacity-30 cursor-default'
          }`}
          title="Go back"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
            stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 3L5 8L10 13" />
          </svg>
        </button>

        {/* Forward */}
        <button
          onClick={onGoForward}
          disabled={!canGoForward}
          className={`p-1.5 rounded transition-colors ${
            canGoForward
              ? 'text-ul-text-secondary hover:bg-ul-bg-hover hover:text-ul-text'
              : 'text-ul-text-muted opacity-30 cursor-default'
          }`}
          title="Go forward"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
            stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 3L11 8L6 13" />
          </svg>
        </button>
      </div>
    </div>
  );
}
