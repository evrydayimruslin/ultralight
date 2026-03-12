// Balance indicator — shows current wallet balance in the header.

import { useState, useEffect } from 'react';
import { fetchBalance } from '../lib/api';

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

  const dollars = (balance / 100).toFixed(2);
  const isLow = balance < 100;

  return (
    <button
      onClick={refresh}
      className="btn-ghost btn-sm text-caption"
      title="Click to refresh balance"
    >
      <span className={isLow ? 'text-ul-warning' : 'text-ul-text-secondary'}>
        ${dollars}
      </span>
    </button>
  );
}
