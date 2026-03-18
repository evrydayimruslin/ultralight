// Balance indicator — shows current wallet balance in the header.

import { useState, useEffect } from 'react';
import { fetchBalance } from '../lib/api';

function formatLight(amount: number): string {
  const abs = Math.abs(amount);
  if (abs >= 1e6) return '✦' + (abs / 1e6).toFixed(2) + 'M';
  if (abs >= 5000) return '✦' + (abs / 1000).toFixed(1) + 'K';
  return '✦' + (abs % 1 === 0 ? String(abs) : abs.toFixed(2));
}

export default function BalanceIndicator() {
  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = () => {
    setLoading(true);
    fetchBalance()
      .then(b => setBalance(b))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 60_000);
    return () => clearInterval(interval);
  }, []);

  if (loading && balance === null) {
    return (
      <span className="text-caption text-ul-text-muted">
        Balance: ...
      </span>
    );
  }

  if (balance === null) {
    return null;
  }

  const isLow = balance < 800;

  return (
    <button
      onClick={refresh}
      className="btn-ghost btn-sm text-caption"
      title="Click to refresh balance"
    >
      <span className={isLow ? 'text-ul-warning' : 'text-ul-text-secondary'}>
        {formatLight(balance)}
      </span>
    </button>
  );
}
