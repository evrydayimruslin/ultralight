// Auth gate — ul_ API token entry.
// Users authenticate with their Ultralight platform token.

import { useState } from 'react';
import { setToken as storeToken } from '../lib/storage';

interface AuthGateProps {
  onAuthenticated: () => void;
}

export default function AuthGate({ onAuthenticated }: AuthGateProps) {
  const [token, setTokenInput] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
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

    // Validate token against the server
    try {
      const base = 'https://ultralight-api.rgn4jz429m.workers.dev';
      const res = await fetch(`${base}/debug/auth-test`, {
        headers: { 'Authorization': `Bearer ${trimmed}` },
      });

      const data = await res.json();

      if (!data.ok) {
        // Show diagnostic details if available
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
            Sign in with your API token
          </p>
        </div>

        {/* Token Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
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

        {/* Help text */}
        <p className="text-caption text-ul-text-muted text-center mt-6">
          Get your token at{' '}
          <span className="text-ul-text underline cursor-pointer">
            ultralight.dev/settings
          </span>
        </p>
      </div>
    </div>
  );
}
