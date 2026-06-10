// Context window usage indicator — thin progress bar showing % of context used.

interface ContextIndicatorProps {
  /** Current token count */
  tokenCount: number;
  /** Total context window size */
  contextWindow: number;
}

export default function ContextIndicator({
  tokenCount,
  contextWindow,
}: ContextIndicatorProps) {
  if (tokenCount === 0) return null;

  const percentage = Math.min((tokenCount / contextWindow) * 100, 100);
  const displayTokens = tokenCount > 1000
    ? `${(tokenCount / 1000).toFixed(1)}k`
    : String(tokenCount);
  const displayWindow = contextWindow > 1000
    ? `${(contextWindow / 1000).toFixed(0)}k`
    : String(contextWindow);

  // Color based on usage
  let barColor = 'bg-emerald-400';
  if (percentage > 70) barColor = 'bg-amber-400';
  if (percentage > 90) barColor = 'bg-red-400';

  return (
    <div
      className="flex items-center gap-1.5"
      title={`Context: ${displayTokens} / ${displayWindow} tokens (${percentage.toFixed(0)}%)`}
    >
      <div className="w-16 h-1.5 bg-ul-border rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${barColor}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <span className="text-caption text-ul-text-muted tabular-nums">
        {percentage.toFixed(0)}%
      </span>
    </div>
  );
}
