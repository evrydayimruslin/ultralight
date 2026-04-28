// Spending approval modal — asks user to approve a marketplace skill charge.
// Follows the PermissionModal pattern: centered overlay, backdrop blur, action buttons.

import type { SpendingRequest } from '../hooks/usePermissions';
import { getAutoApproveLight } from '../lib/storage';

function formatLight(amount: number): string {
  const abs = Math.abs(amount);
  if (abs >= 1e6) return '✦' + (abs / 1e6).toFixed(2) + 'M';
  if (abs >= 5000) return '✦' + (abs / 1000).toFixed(1) + 'K';
  return '✦' + (abs % 1 === 0 ? String(abs) : abs.toFixed(2));
}

interface SpendingApprovalModalProps {
  request: SpendingRequest;
  onApprove: () => void;
  onDeny: () => void;
}

export default function SpendingApprovalModal({
  request,
  onApprove,
  onDeny,
}: SpendingApprovalModalProps) {
  const threshold = getAutoApproveLight();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={onDeny}
      />

      {/* Modal */}
      <div className="relative bg-white rounded-xl shadow-2xl border border-ul-border max-w-sm w-full mx-4 overflow-hidden">
        {/* Header */}
        <div className="px-5 pt-5 pb-3">
          <div className="flex items-center gap-2 mb-1">
            {/* Light icon */}
            <span className="text-amber-500 text-lg font-bold">✦</span>
            <h2 className="text-body font-semibold text-ul-text">
              Spending Approval
            </h2>
          </div>

          <p className="text-small text-ul-text-secondary mt-2">
            {request.description}
          </p>

          <div className="mt-3 flex items-center justify-between text-small">
            <span className="text-ul-text-muted">Cost:</span>
            <span className="font-mono font-semibold text-amber-600">
              {formatLight(request.priceLight)}
            </span>
          </div>

          <p className="text-caption text-ul-text-muted mt-2">
            Your auto-approve threshold is {formatLight(threshold)}.
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 px-5 py-4 bg-gray-50 border-t border-ul-border">
          <button
            onClick={onDeny}
            className="btn-ghost btn-sm text-small text-ul-text-muted hover:text-ul-error"
          >
            Deny
          </button>

          <div className="flex-1" />

          <button
            onClick={onApprove}
            className="px-4 py-1.5 rounded-lg bg-amber-500 text-white text-small font-medium hover:bg-amber-600 transition-colors"
          >
            Approve
          </button>
        </div>
      </div>
    </div>
  );
}
