// Spending settings — compact inline widget for auto-approve threshold.
// Placed on the Settings page header. Persists to localStorage.

import { useState, useEffect } from 'react';
import { getAutoApproveLight, setAutoApproveLight } from '../lib/storage';
import { fetchBalance } from '../lib/api';

function formatLight(amount: number): string {
  const abs = Math.abs(amount);
  if (abs >= 1e6) return '✦' + (abs / 1e6).toFixed(2) + 'M';
  if (abs >= 5000) return '✦' + (abs / 1000).toFixed(1) + 'K';
  return '✦' + (abs % 1 === 0 ? String(abs) : abs.toFixed(2));
}

export default function SpendingSettings() {
  const [threshold, setThreshold] = useState(getAutoApproveLight());
  const [balance, setBalance] = useState<number | null>(null);

  useEffect(() => {
    fetchBalance().then(b => setBalance(b));
  }, []);

  const handleChange = (value: number) => {
    const maxLight = balance ? Math.min(balance, 8000) : 8000;
    const clamped = Math.max(0, Math.min(value, maxLight));
    setThreshold(clamped);
    setAutoApproveLight(clamped);
  };

  return (
    <div className="flex items-center gap-2">
      <label className="text-caption text-ul-text-muted whitespace-nowrap">
        Auto-approve under
      </label>
      <div className="flex items-center gap-0.5">
        <span className="text-caption text-ul-text-muted">✦</span>
        <input
          type="number"
          step="1"
          min="0"
          max={balance ? balance : 8000}
          value={threshold}
          onChange={e => handleChange(parseFloat(e.target.value || '0'))}
          className="w-16 text-caption text-center rounded border border-ul-border px-1 py-0.5 bg-white focus:outline-none focus:border-ul-border-focus"
        />
      </div>
      {balance !== null && (
        <span className="text-caption text-ul-text-muted">
          bal: {formatLight(balance)}
        </span>
      )}
    </div>
  );
}
