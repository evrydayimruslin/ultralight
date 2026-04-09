// Auth gate — Google OAuth (primary) + manual API token entry (fallback).
// OAuth flow: opens system browser → user signs in with Google → desktop polls for token.

import { useState, useRef, useCallback } from 'react';
import { setToken as storeToken, getApiBase } from '../lib/storage';

interface AuthGateProps {
  onAuthenticated: () => void;
}

type AuthMode = 'choose' | 'oauth-polling' | 'token';

export default function AuthGate({ onAuthenticated }: AuthGateProps) {
  const [mode, setMode] = useState<AuthMode>('choose');
  const [token, setTokenInput] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sessionRef = useRef<string>('');

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  // ── Google OAuth flow ──
  const startOAuth = useCallback(() => {
    const sessionId = crypto.randomUUID();
    sessionRef.current = sessionId;
    const base = getApiBase();

    // Open system browser for Google OAuth
    window.open(`${base}/auth/login?desktop_session=${sessionId}`, '_blank');

    setMode('oauth-polling');
    setError('');
    setLoading(true);

    // Poll for token every 2 seconds, timeout after 5 minutes
    const startTime = Date.now();
    pollRef.current = setInterval(async () => {
      // Timeout after 5 minutes
      if (Date.now() - startTime > 5 * 60 * 1000) {
        stopPolling();
        setLoading(false);
        setError('Sign-in timed out. Please try again.');
        setMode('choose');
        return;
      }

      try {
        const res = await fetch(`${base}/auth/desktop-poll?session_id=${sessionId}`);
        const data = await res.json();

        if (data.status === 'complete' && data.token) {
          stopPolling();
          storeToken(data.token);
          onAuthenticated();
        }
      } catch {
        // Network error — keep polling
      }
    }, 2000);
  }, [onAuthenticated, stopPolling]);

  const cancelOAuth = useCallback(() => {
    stopPolling();
    setLoading(false);
    setError('');
    setMode('choose');
  }, [stopPolling]);

  // ── Manual token flow ──
  const handleTokenSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = token.trim();

    if (!trimmed) {
      setError('Token is required');
      return;
    }
    if (!trimmed.startsWith('ul_')) {
      setError('Token must start with ul_');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const base = getApiBase();
      const res = await fetch(`${base}/debug/auth-test`, {
        headers: { 'Authorization': `Bearer ${trimmed}` },
      });
      const data = await res.json();

      if (!data.ok) {
        const failedStep = data.steps?.find((s: { ok: boolean }) => !s.ok);
        const detail = failedStep ? ` (${failedStep.result})` : '';
        setError(`Invalid token${detail}. Check your API key at ultralight.dev`);
        setLoading(false);
        return;
      }

      storeToken(trimmed);
      onAuthenticated();
    } catch {
      // Network error — store anyway, they might be offline temporarily
      storeToken(trimmed);
      onAuthenticated();
    }
  };

  return (
    <div className="flex items-center justify-center h-full bg-white">
      <div className="w-full max-w-sm px-6">
        {/* Logo / Title */}
        <div className="text-center mb-10">
          <h1 className="text-h2 text-ul-text tracking-tight">
            Ultralight
          </h1>
          <p className="text-small text-ul-text-muted mt-2">
            {mode === 'oauth-polling'
              ? 'Complete sign-in in your browser'
              : mode === 'token'
                ? 'Enter your API token'
                : 'Sign in to get started'}
          </p>
        </div>

        {/* ── Main sign-in options ── */}
        {mode === 'choose' && (
          <div className="space-y-3">
            <button
              onClick={startOAuth}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24">
                <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
                <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Sign in with Google
            </button>

            <div className="relative flex items-center gap-3 my-4">
              <div className="flex-1 h-px bg-ul-border" />
              <span className="text-caption text-ul-text-muted">or</span>
              <div className="flex-1 h-px bg-ul-border" />
            </div>

            <button
              onClick={() => setMode('token')}
              className="btn-secondary w-full"
            >
              Enter API token manually
            </button>
          </div>
        )}

        {/* ── OAuth polling state ── */}
        {mode === 'oauth-polling' && (
          <div className="text-center space-y-4">
            <div className="mx-auto w-8 h-8 border-2 border-ul-border border-t-ul-text rounded-full animate-spin" />
            <p className="text-small text-ul-text-secondary">
              Waiting for sign-in to complete in your browser...
            </p>
            {error && <p className="text-small text-ul-error">{error}</p>}
            <button
              onClick={cancelOAuth}
              className="text-small text-ul-text-muted underline cursor-pointer"
            >
              Cancel
            </button>
          </div>
        )}

        {/* ── Manual token entry ── */}
        {mode === 'token' && (
          <>
            <form onSubmit={handleTokenSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="token"
                  className="block text-caption text-ul-text-secondary mb-1.5"
                >
                  API Token
                </label>
                <input
                  id="token"
                  type="password"
                  value={token}
                  onChange={e => {
                    setTokenInput(e.target.value);
                    setError('');
                  }}
                  placeholder="ul_..."
                  className="input"
                  autoFocus
                  disabled={loading}
                />
              </div>

              {error && (
                <p className="text-small text-ul-error">{error}</p>
              )}

              <button
                type="submit"
                disabled={loading || !token.trim()}
                className="btn-primary w-full disabled:opacity-40"
              >
                {loading ? 'Connecting...' : 'Connect'}
              </button>
            </form>

            <button
              onClick={() => { setMode('choose'); setError(''); }}
              className="text-small text-ul-text-muted underline cursor-pointer block mx-auto mt-4"
            >
              Back to sign-in options
            </button>
          </>
        )}

        {/* Help text */}
        {mode === 'choose' && (
          <p className="text-caption text-ul-text-muted text-center mt-6">
            Get your token at{' '}
            <span className="text-ul-text underline cursor-pointer">
              ultralight.dev/settings
            </span>
          </p>
        )}
      </div>
    </div>
  );
}
