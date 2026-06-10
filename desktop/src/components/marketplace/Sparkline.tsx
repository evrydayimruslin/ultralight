// Sparkline — tiny inline-SVG line chart for the marketplace tiles.
//
// Mirrors the mockup's `fmtSpark` helper from
// handoff/mockups/market-data.jsx: connects N points across a fixed
// viewBox, normalised to the data's min/max so even a flat trend
// has visible variance.
//
// Used by MarketplaceView's TrendingCard + FeaturedHero + Billboard
// rows when B10's `sparkline` field is present on the result. Renders
// nothing when there are <2 points.

interface SparklineProps {
  /** Daily run counts, oldest first. Length expected to be 7 but the
   *  component handles any length >= 2. */
  values: number[];
  /** SVG width in CSS pixels. Default fits the trending card column. */
  width?: number;
  /** SVG height. Default leaves room for the badge below it. */
  height?: number;
  /** Stroke color; defaults to currentColor so callers tint via Tailwind
   *  text-* classes on the wrapper. */
  color?: string;
  /** Stroke width — 1.5 reads at 24px tall; bump for larger surfaces. */
  strokeWidth?: number;
}

export default function Sparkline({
  values,
  width = 56,
  height = 16,
  color = 'currentColor',
  strokeWidth = 1.5,
}: SparklineProps) {
  if (!values || values.length < 2) return null;

  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const dx = width / (values.length - 1);

  const points = values
    .map((v, i) => {
      const x = (i * dx).toFixed(1);
      const y = (height - ((v - min) / range) * height).toFixed(1);
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      style={{ display: 'block', overflow: 'visible' }}
    >
      <polyline
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}
