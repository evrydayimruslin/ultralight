// WebPanel — iframe wrapper for embedding web app pages (Library, Marketplace, Wallet, Settings).
// Uses a short-lived bridge token for desktop embed auth and shows loading/error states.

import { useState, useEffect, useCallback, useRef } from 'react';
import { buildDesktopEmbedUrl, requestDesktopEmbedBridgeToken } from '../lib/auth';
import { ensureApiBaseAvailable, getToken } from '../lib/storage';
import DesktopAsyncState from './DesktopAsyncState';
import { createDesktopLogger } from '../lib/logging';

interface WebPanelProps {
  /** Path appended to API base, e.g. '/dash', '/marketplace' */
  path: string;
  /** Title shown in the header bar */
  title: string;
  /** Optional extra content rendered in the header bar */
  headerExtra?: React.ReactNode;
}

const webPanelLogger = createDesktopLogger('WebPanel');

export default function WebPanel({ path, title, headerExtra }: WebPanelProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [src, setSrc] = useState('');
  const [retryKey, setRetryKey] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadEmbed() {
      setLoading(true);
      setError(null);
      setSrc('');

      try {
        const base = await ensureApiBaseAvailable();
        const token = getToken();
        const cacheKey = Date.now();
        const bridgeToken = token
          ? (await requestDesktopEmbedBridgeToken(base, token)).bridgeToken
          : null;
        const nextSrc = buildDesktopEmbedUrl(base, path, bridgeToken, cacheKey);
        if (!cancelled) {
          setSrc(nextSrc);
        }
      } catch (err) {
        webPanelLogger.error('Failed to establish secure embed session', { error: err, path });
        if (!cancelled) {
          setError('Could not establish a secure session for this panel.');
          setLoading(false);
        }
      }
    }

    void loadEmbed();
    return () => {
      cancelled = true;
    };
  }, [path, retryKey]);

  const handleRetry = useCallback(() => {
    setError(null);
    setLoading(true);
    setRetryKey(k => k + 1);
  }, []);

  return (
    <div className="flex-1 flex flex-col h-full bg-white min-w-0">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 h-nav flex-shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-h3 text-ul-text tracking-tight">{title}</h1>
        </div>
        {headerExtra && <div className="flex items-center gap-3">{headerExtra}</div>}
      </div>

      {/* Content */}
      <div className="flex-1 relative min-h-0">
        {loading && !error && (
          <div className="absolute inset-0 z-10 bg-white">
            <DesktopAsyncState
              kind="loading"
              title={`Loading ${title}`}
              message="Preparing a secure embedded session."
            />
          </div>
        )}
        {error && (
          <div className="absolute inset-0 z-10 bg-white">
            <DesktopAsyncState
              kind="error"
              title={`${title} is unavailable`}
              message={error}
              actionLabel="Retry"
              onAction={handleRetry}
            />
          </div>
        )}
        <iframe
          key={src || String(retryKey)}
          ref={iframeRef}
          src={src}
          onLoad={() => setLoading(false)}
          onError={() => {
            setLoading(false);
            setError(`Could not load ${title}.`);
          }}
          className={`w-full h-full border-0 ${loading || error ? 'invisible' : ''}`}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          title={title}
        />
      </div>
    </div>
  );
}
