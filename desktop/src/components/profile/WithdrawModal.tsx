// WithdrawModal — seller-side payout request.
//
// Takes a ✦Light amount and posts to /api/user/connect/withdraw. The BE
// creates a `payouts` row with status='held'; the background processor
// releases on the configured monthly schedule. The modal surfaces the
// estimated arrival + fee breakdown returned by the BE.

import { useState } from 'react';
import { X } from 'lucide-react';
import { requestPayoutWithdrawal, type ConnectStatus } from '../../lib/api';
import { formatLightWhole as formatLight } from '../../lib/format';
import Modal from '../ui/Modal';

interface WithdrawModalProps {
  connect: ConnectStatus | null;
  withdrawableLight: number;
  onClose: () => void;
  onSuccess?: () => void;
}


export default function WithdrawModal({
  connect,
  withdrawableLight,
  onClose,
  onSuccess,
}: WithdrawModalProps) {
  const [amount, setAmount] = useState<number>(withdrawableLight);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<null | {
    payoutId?: string;
    estimatedArrival?: string;
    scheduledDate?: string;
  }>(null);

  const validAmount = amount > 0 && amount <= withdrawableLight;

  const onSubmit = async () => {
    if (!validAmount || submitting) return;
    setSubmitting(true);
    setError(null);
    const res = await requestPayoutWithdrawal({
      amountLight: amount,
      termsAccepted: true,
    });
    if (!res.ok) {
      setError(res.errorMessage || 'Failed to request payout.');
      setSubmitting(false);
      return;
    }
    setResult({
      payoutId: res.payout_id,
      estimatedArrival: res.estimated_arrival,
      scheduledDate: res.payout_schedule?.scheduled_date,
    });
    onSuccess?.();
    setSubmitting(false);
  };

  return (
    <Modal onClose={onClose} surface="plain" radius="xl" maxWidth="md" maxHeight="auto">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 w-8 h-8 rounded-full text-ul-text-muted hover:bg-ul-bg-hover flex items-center justify-center cursor-pointer z-10"
          title="Close"
        >
          <X className="w-4 h-4" strokeWidth={1.5} />
        </button>

        {result ? (
          <div className="p-7">
            <div className="text-h3 font-bold tracking-tight text-ul-text mb-2">
              Payout requested
            </div>
            <div className="text-small text-ul-text-secondary leading-relaxed mb-5">
              ✦{formatLight(amount)} is reserved for payout to your connected
              bank.
              {result.scheduledDate
                ? ` Scheduled release: ${new Date(result.scheduledDate).toLocaleDateString()}.`
                : ' Held until the next monthly release.'}
              {result.estimatedArrival
                ? ` Expected arrival: ${new Date(result.estimatedArrival).toLocaleDateString()}.`
                : ''}
            </div>
            {result.payoutId && (
              <div className="text-nano font-mono text-ul-text-muted mb-5">
                Payout ID: {result.payoutId}
              </div>
            )}
            <button
              type="button"
              onClick={onClose}
              className="bg-ul-text text-white border-none px-4 py-2.5 rounded-md text-caption font-medium cursor-pointer hover:bg-ul-accent-hover"
            >
              Done
            </button>
          </div>
        ) : (
          <div className="p-7">
            <div className="text-h3 font-bold tracking-tight text-ul-text mb-1">
              Withdraw earnings
            </div>
            <div className="text-caption text-ul-text-secondary leading-relaxed mb-5">
              Move ✦Light from your earnings to your connected bank.
              {connect?.country && ` Bank account: ${connect.country}.`} Payouts
              release on a monthly schedule.
            </div>

            <div className="mb-4">
              <label className="text-micro font-mono text-ul-text-muted uppercase tracking-widest block mb-2">
                Amount
              </label>
              <div className="flex items-center gap-2 border border-ul-border rounded-md px-3 py-2.5 bg-ul-bg">
                <span className="text-h3 font-mono">✦</span>
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(Math.max(0, Number(e.target.value) || 0))}
                  min={1}
                  step={1}
                  className="flex-1 border-none outline-none text-h3 font-mono font-bold tabular-nums bg-transparent"
                />
                <button
                  type="button"
                  onClick={() => setAmount(withdrawableLight)}
                  className="text-nano font-mono text-ul-text-secondary bg-transparent border-none cursor-pointer underline hover:text-ul-text"
                >
                  Max
                </button>
              </div>
              <div className="text-nano font-mono text-ul-text-muted mt-2">
                Available ✦{formatLight(withdrawableLight)}
              </div>
            </div>

            {!validAmount && amount > 0 && (
              <div className="mb-3 px-3 py-2 border border-ul-error/30 bg-ul-error-soft rounded-md text-caption text-ul-error">
                Amount must be between ✦1 and ✦{formatLight(withdrawableLight)}.
              </div>
            )}

            {error && (
              <div className="mb-3 px-3 py-2 border border-ul-error/30 bg-ul-error-soft rounded-md text-caption text-ul-error">
                {error}
              </div>
            )}

            <div className="bg-ul-bg-raised border border-ul-border rounded-md p-3 mb-5 text-caption leading-relaxed text-ul-text-secondary">
              Stripe fees apply (~0.25% + $0.25 cross-border). Final fee
              breakdown surfaces in the payout history after release.
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="flex-1 bg-ul-bg text-ul-text border border-ul-border px-3 py-3 rounded-md text-caption font-medium cursor-pointer hover:bg-ul-bg-hover disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void onSubmit()}
                disabled={!validAmount || submitting}
                className="flex-[1.5] bg-ul-text text-white border-none px-3 py-3 rounded-md text-body font-medium cursor-pointer hover:bg-ul-accent-hover disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {submitting ? 'Requesting…' : `Request payout · ✦${formatLight(amount)}`}
              </button>
            </div>
          </div>
        )}
    </Modal>
  );
}
