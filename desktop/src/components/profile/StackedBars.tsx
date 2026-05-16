// StackedBars — flex-based stacked vertical bar chart.
//
// Ports the chart shape from BB_B12_Chart in handoff/mockups/batch-b.jsx.
// No charting library, no SVG — every bar is a flexbox column where each
// segment is a div sized by percent of the column's total. The top
// segment rounds 2px; lower segments are square. This keeps the chart
// crisp at every zoom and avoids a dep.
//
// Hovering a bucket fires onHover with the bucket index so the parent
// can render the per-app tooltip in its own DOM (we don't position
// tooltips here — the parent owns the layout context).

import type { CSSProperties } from 'react';

export interface StackedBarsBucket {
  label: string;
  values: Record<string, number>;
}

export interface StackedBarsSegment {
  id: string;
  tone: string;
}

interface StackedBarsProps {
  buckets: StackedBarsBucket[];
  /** Segment definitions in stack order. Bottom-of-stack first. */
  segments: StackedBarsSegment[];
  /** Bars get tighter inter-bar gap when buckets > 30 (matches mockup
   *  cadence on the 90d / 1y views). */
  gap?: number;
  /** Pixel height of the chart canvas. Defaults to 180. */
  height?: number;
  /** Optional hover callback — receives the bucket index or null. */
  onHover?: (index: number | null) => void;
  /** Index of the bucket whose stack should render slightly stronger
   *  (paired with the tooltip). */
  highlightIndex?: number | null;
  className?: string;
  style?: CSSProperties;
}

export default function StackedBars({
  buckets,
  segments,
  gap = 3,
  height = 180,
  onHover,
  highlightIndex = null,
  className,
  style,
}: StackedBarsProps) {
  // Compute per-bucket totals so each column's segments scale to a
  // shared max. Empty-chart guard prevents a divide-by-zero when the
  // user is staring at a fresh account.
  const totals = buckets.map((b) =>
    segments.reduce((sum, s) => sum + (b.values[s.id] ?? 0), 0),
  );
  const maxTotal = Math.max(...totals, 0.001);

  return (
    <div
      className={className}
      style={{
        display: 'flex',
        gap,
        alignItems: 'flex-end',
        height,
        padding: '0 4px',
        ...style,
      }}
      onMouseLeave={() => onHover?.(null)}
    >
      {buckets.map((bucket, i) => {
        const highlighted = highlightIndex === i;
        const bucketTotal = totals[i];
        return (
          <div
            key={`${bucket.label}-${i}`}
            onMouseEnter={() => onHover?.(i)}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column-reverse',
              height: '100%',
              minWidth: 0,
              opacity: highlightIndex !== null && !highlighted ? 0.55 : 1,
              transition: 'opacity 120ms ease',
            }}
            // Native title gives keyboard / touch parity for the tooltip;
            // the visual tooltip lives in the parent and reads from
            // onHover.
            title={`${bucket.label} · ✦${bucketTotal.toFixed(3)}`}
          >
            {segments.map((seg, j) => {
              const v = bucket.values[seg.id] ?? 0;
              if (v <= 0) return null;
              const heightPct = (v / maxTotal) * 100;
              const isTopSegment = j === segments.length - 1;
              return (
                <div
                  key={seg.id}
                  style={{
                    height: `${heightPct}%`,
                    background: seg.tone,
                    borderTopLeftRadius: isTopSegment ? 2 : 0,
                    borderTopRightRadius: isTopSegment ? 2 : 0,
                    opacity: 0.9,
                  }}
                />
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
