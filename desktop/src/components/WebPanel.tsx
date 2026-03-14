// WebPanel — iframe wrapper for embedding web app pages (Library, Marketplace, Wallet, Settings).
// Passes auth token via query param and shows loading/error states.

import { useState, useMemo, useCallback, useRef } from 'react';
import { getToken, getApiBase } from '../lib/storage';

interface WebPanelProps {
  /** Path appended to API base, e.g. '/dash', '/marketplace' */
  path: string;
  /** Title shown in the header bar */
  title: string;
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
}

export default function WebPanel({ path, title, sidebarOpen, onToggleSidebar }: WebPanelProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const src = useMemo(() => {
    const base = getApiBase();
    const token = getToken();
    const url = new URL(path, base);
    if (token) url.searchParams.set('token', token);
    url.searchParams.set('embed', '1');
    return url.toString();
  }, [path, retryKey]);

  const handleRetry = useCallback(() => {
    setError(false);
    setLoading(true);
    setRetryKey(k => k + 1);
  }, []);

  return (
    <div className="flex-1 flex flex-col h-full bg-white min-w-0">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 h-nav border-b border-ul-border flex-shrink-0">
        <div className="flex items-center gap-3">
          {!sidebarOpen && (
            <button
              onClick={onToggleSidebar}
              className="p-1 rounded hover:bg-gray-100 text-ul-text-secondary"
              title="Open sidebar"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <line x1="3" y1="5" x2="15" y2="5" />
                <line x1="3" y1="9" x2="15" y2="9" />
                <line x1="3" y1="13" x2="15" y2="13" />
              </svg>
            </button>
          )}
          <h1 className="text-h3 text-ul-text tracking-tight">{title}</h1>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 relative min-h-0">
        {loading && !error && (
          <div className="absolute inset-0 flex items-center justify-center bg-white z-10">
            <p className="text-body text-ul-text-muted">Loading {title}...</p>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-white gap-3 z-10">
            <p className="text-body text-ul-text-muted">Failed to load {title}.</p>
            <button onClick={handleRetry} className="btn-secondary btn-sm">
              Retry
            </button>
          </div>
        )}
        <iframe
          key={retryKey}
          ref={iframeRef}
          src={src}
          onLoad={() => setLoading(false)}
          onError={() => { setLoading(false); setError(true); }}
          className={`w-full h-full border-0 ${loading || error ? 'invisible' : ''}`}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          title={title}
        />
      </div>
    </div>
  );
}
