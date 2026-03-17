// Spending settings — compact inline widget for auto-approve threshold.
// Placed on the Settings page header. Persists to localStorage.

import { useState, useEffect } from 'react';
import { getAutoApproveCents, setAutoApproveCents } from '../lib/storage';
import { fetchBalance } from '../lib/api';

export default function SpendingSettings() {
  const [threshold, setThreshold] = useState(getAutoApproveCents());
  const [balance, setBalance] = useState<number | null>(null);

  useEffect(() => {
    fetchBalance().then(b => setBalance(b));
  }, []);

  const handleChange = (value: number) => {
    const maxCents = balance ? Math.min(balance, 1000) : 1000;
    const clamped = Math.max(0, Math.min(value, maxCents));
    setThreshold(clamped);
    setAutoApproveCents(clamped);
  };

  return (
    <div className="flex items-center gap-2">
      <label className="text-caption text-ul-text-muted whitespace-nowrap">
        Auto-approve under
      </label>
      <div className="flex items-center gap-0.5">
        <span className="text-caption text-ul-text-muted">$</span>
        <input
          type="number"
          step="0.05"
          min="0"
          max={balance ? (balance / 100) : 10}
          value={(threshold / 100).toFixed(2)}
          onChange={e => handleChange(Math.round(parseFloat(e.target.value || '0') * 100))}
          className="w-16 text-caption text-center rounded border border-ul-border px-1 py-0.5 bg-white focus:outline-none focus:border-ul-border-focus"
        />
      </div>
      {balance !== null && (
        <span className="text-caption text-ul-text-muted">
          bal: ${(balance / 100).toFixed(2)}
        </span>
      )}
    </div>
  );
}
