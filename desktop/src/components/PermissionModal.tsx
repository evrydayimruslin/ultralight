// Permission modal — centered overlay asking user to approve a tool call.
// Shows tool name, description, args, and Allow / Always Allow / Deny buttons.

import type { PermissionRequest } from '../hooks/usePermissions';

interface PermissionModalProps {
  request: PermissionRequest;
  onAllow: () => void;
  onAlwaysAllow: () => void;
  onDeny: () => void;
}

export default function PermissionModal({
  request,
  onAllow,
  onAlwaysAllow,
  onDeny,
}: PermissionModalProps) {
  // Format args for display
  let argsDisplay: string;
  try {
    argsDisplay = JSON.stringify(request.args, null, 2);
  } catch {
    argsDisplay = String(request.args);
  }

  const riskColors = {
    safe: 'text-ul-success',
    moderate: 'text-amber-600',
    high: 'text-ul-error',
  };

  const riskLabels = {
    safe: 'Read-only',
    moderate: 'File modification',
    high: 'Command execution',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={onDeny}
      />

      {/* Modal */}
      <div className="relative bg-white rounded-xl shadow-2xl border border-ul-border max-w-lg w-full mx-4 overflow-hidden">
        {/* Header */}
        <div className="px-5 pt-5 pb-3">
          <div className="flex items-center gap-2 mb-1">
            {/* Shield icon */}
            <svg
              className={`w-5 h-5 ${riskColors[request.risk]}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"
              />
            </svg>
            <h2 className="text-body font-semibold text-ul-text">
              Permission Required
            </h2>
            <span className={`text-caption ${riskColors[request.risk]}`}>
              {riskLabels[request.risk]}
            </span>
          </div>

          <p className="text-small text-ul-text-secondary mt-2">
            {request.description}
          </p>
        </div>

        {/* Args detail */}
        <div className="px-5 pb-3">
          <details className="group">
            <summary className="text-caption text-ul-text-muted cursor-pointer hover:text-ul-text-secondary select-none">
              Show details
            </summary>
            <pre className="mt-2 text-caption font-mono bg-ul-bg-raised rounded-lg p-3 overflow-x-auto whitespace-pre-wrap max-h-48 overflow-y-auto border border-ul-border">
              {argsDisplay}
            </pre>
          </details>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 px-5 py-4 bg-ul-bg-subtle border-t border-ul-border">
          <button
            onClick={onDeny}
            className="btn-ghost btn-sm text-small text-ul-text-muted hover:text-ul-error"
          >
            Deny
          </button>

          <div className="flex-1" />

          <button
            onClick={onAlwaysAllow}
            className="btn-ghost btn-sm text-small text-ul-text-secondary"
            title={`Always allow "${request.toolName}" for this session`}
          >
            Always Allow
          </button>

          <button
            onClick={onAllow}
            className="px-4 py-1.5 rounded-lg bg-ul-text text-white text-small font-medium hover:bg-ul-text/90 transition-colors"
          >
            Allow
          </button>
        </div>
      </div>
    </div>
  );
}
