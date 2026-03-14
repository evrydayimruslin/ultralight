// Spending approval modal — asks user to approve a marketplace skill purchase.
// Follows the PermissionModal pattern: centered overlay, backdrop blur, action buttons.

import type { SpendingRequest } from '../hooks/usePermissions';
import { getAutoApproveCents } from '../lib/storage';

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
  const threshold = getAutoApproveCents();

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
            {/* Coin icon */}
            <svg
              className="w-5 h-5 text-amber-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <h2 className="text-body font-semibold text-ul-text">
              Purchase Approval
            </h2>
          </div>

          <p className="text-small text-ul-text-secondary mt-2">
            {request.description}
          </p>

          <div className="mt-3 flex items-center justify-between text-small">
            <span className="text-ul-text-muted">Cost:</span>
            <span className="font-mono font-semibold text-amber-600">
              ${(request.priceCents / 100).toFixed(2)}
            </span>
          </div>

          <p className="text-caption text-ul-text-muted mt-2">
            Your auto-approve threshold is ${(threshold / 100).toFixed(2)}.
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
