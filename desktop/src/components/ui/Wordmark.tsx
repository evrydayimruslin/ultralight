// Wordmark — Spark glyph + "Galactic" type lockup.
// Ported from handoff/mockups/primitives.jsx.

import Spark from './Spark';

interface WordmarkProps {
  fontSize?: number;
  color?: string;
}

export default function Wordmark({ fontSize = 15, color = 'currentColor' }: WordmarkProps) {
  return (
    <span className="inline-flex items-center gap-2">
      <Spark size={Math.round(fontSize * 1.1)} color={color} />
      <span
        className="font-bold leading-none tracking-[-0.03em]"
        style={{ fontSize, color }}
      >
        Galactic
      </span>
    </span>
  );
}
