interface DesktopAsyncStateProps {
  kind: 'loading' | 'empty' | 'error';
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  className?: string;
  compact?: boolean;
}

function StateIcon({ kind }: { kind: DesktopAsyncStateProps['kind'] }) {
  if (kind === 'loading') {
    return <div className="w-5 h-5 rounded-full border-2 border-gray-300 border-t-gray-600 animate-spin" />;
  }

  if (kind === 'error') {
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="text-red-400">
        <circle cx="12" cy="12" r="9" />
        <path d="M9 9l6 6M15 9l-6 6" strokeLinecap="round" />
      </svg>
    );
  }

  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="text-gray-400">
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <path d="M8 10h8M8 14h5" strokeLinecap="round" />
    </svg>
  );
}

export default function DesktopAsyncState({
  kind,
  title,
  message,
  actionLabel,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
  className = '',
  compact = false,
}: DesktopAsyncStateProps) {
  const padding = compact ? 'px-4 py-6' : 'px-6 py-10';

  return (
    <div className={`flex h-full min-h-0 items-center justify-center ${padding} ${className}`.trim()}>
      <div className="flex max-w-sm flex-col items-center text-center">
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-gray-50">
          <StateIcon kind={kind} />
        </div>
        <h2 className="text-sm font-medium text-ul-text">{title}</h2>
        {message && (
          <p className="mt-1.5 text-caption leading-5 text-ul-text-muted">{message}</p>
        )}
        {(actionLabel || secondaryActionLabel) && (
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            {actionLabel && onAction && (
              <button onClick={onAction} className="btn-secondary btn-sm">
                {actionLabel}
              </button>
            )}
            {secondaryActionLabel && onSecondaryAction && (
              <button
                onClick={onSecondaryAction}
                className="rounded-lg px-3 py-1.5 text-small text-ul-text-muted transition-colors hover:text-ul-text"
              >
                {secondaryActionLabel}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
