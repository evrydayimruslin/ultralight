// Spark — the Ultralight brand glyph (8-sided star).
// Custom-drawn; lucide-react does not ship an equivalent.
// Ported from handoff/mockups/primitives.jsx.

interface SparkProps {
  size?: number;
  color?: string;
}

export default function Spark({ size = 16, color = 'currentColor' }: SparkProps) {
  const r = 8;
  const k = 0.28;
  const cx = 12;
  const cy = 12;
  const points = [
    [cx, cy - r],
    [cx + r * k, cy - r * k],
    [cx + r, cy],
    [cx + r * k, cy + r * k],
    [cx, cy + r],
    [cx - r * k, cy + r * k],
    [cx - r, cy],
    [cx - r * k, cy - r * k],
  ]
    .map((p) => p.join(','))
    .join(' ');

  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <polygon points={points} fill={color} />
    </svg>
  );
}
