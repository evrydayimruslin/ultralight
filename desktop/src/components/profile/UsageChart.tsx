// UsageChart — B12 usage time-series chart.
//
// Replaces the legacy 7-day strip in Profile → Balance with a real
// time-series chart sourced from GET /api/usage. Server aggregates the
// heavier windows (90d → weekly, 1y → monthly) so payload is bounded
// regardless of how long the user has been around.
//
// Ports BB_B12_Chart from handoff/mockups/batch-b.jsx. Owner-only —
// the public author profile (B7) deliberately does not show usage.
//
// Behaviour during the BE deploy gap: fetchUsageSeries returns null
// on 404 / 500; UsageChart falls back to a muted empty-state message
// that still surfaces the range selector so the user can re-try as BE
// rolls out.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchUsageSeries,
  type UsageAppInfo,
  type UsageRange,
  type UsageSeriesResponse,
} from '../../lib/api';
import { deriveGlyph, deriveTone } from '../ui/Glyph';
import { formatLightPrecise as formatLight } from '../../lib/format';
import StackedBars, {
  type StackedBarsBucket,
  type StackedBarsSegment,
} from './StackedBars';

const RANGES: { id: UsageRange; label: string; days: number }[] = [
  { id: '7d',  label: '7d',  days: 7 },
  { id: '30d', label: '30d', days: 30 },
  { id: '90d', label: '90d', days: 90 },
  { id: '1y',  label: '1y',  days: 365 },
];

export default function UsageChart() {
  const [range, setRange] = useState<UsageRange>('30d');
  const [data, setData] = useState<UsageSeriesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  // Fetch on range change. Loading state is a thin top-of-card hint;
  // the chart canvas keeps its previous rendering so the page doesn't
  // jump while the new window resolves.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchUsageSeries(range)
      .then((fresh) => {
        if (cancelled) return;
        setData(fresh);
        // Reset hover on range change so a stale index can't point
        // outside the new bucket count.
        setHoverIdx(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [range]);

  const rangeMeta = RANGES.find((r) => r.id === range)!;

  // Visible apps drive both the legend filter and the chart segments.
  // Hidden ones are excluded from the stacked totals so the visible
  // bars rescale to fill the canvas — matches the mockup spec.
  const apps: UsageAppInfo[] = data?.apps ?? [];
  const visibleApps = useMemo(
    () => apps.filter((a) => !hidden.has(a.id)),
    [apps, hidden],
  );

  const segments: StackedBarsSegment[] = useMemo(
    () =>
      visibleApps.map((a) => ({
        id: a.id,
        tone: a.tone || deriveTone(a.id),
      })),
    [visibleApps],
  );

  // Buckets with totals derived from visible apps only. We don't
  // mutate the BE payload; just filter the values dict per render.
  const buckets = useMemo<StackedBarsBucket[]>(() => {
    if (!data) return [];
    return data.buckets.map((b) => {
      const filtered: Record<string, number> = {};
      for (const a of visibleApps) {
        const v = b.values[a.id];
        if (typeof v === 'number') filtered[a.id] = v;
      }
      return { label: b.label, values: filtered };
    });
  }, [data, visibleApps]);

  const totals = useMemo(
    () =>
      buckets.map((b) =>
        visibleApps.reduce((sum, a) => sum + (b.values[a.id] ?? 0), 0),
      ),
    [buckets, visibleApps],
  );

  const visibleSpend = totals.reduce((s, x) => s + x, 0);
  const avgPerDay = rangeMeta.days > 0 ? visibleSpend / rangeMeta.days : 0;
  const deltaPct = data?.totals.deltaPct ?? 0;

  const toggleApp = useCallback((id: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Per-app table sorted by total spend over the visible window.
  // Hidden apps stay listed (greyed) so the toggle is reachable from
  // both the legend and the row.
  const perAppRows = useMemo(() => {
    if (!data) return [];
    return data.apps
      .map((a) => {
        const total = data.buckets.reduce((s, b) => s + (b.values[a.id] ?? 0), 0);
        const spark = data.buckets.map((b) => b.values[a.id] ?? 0);
        return { app: a, total, spark };
      })
      .sort((a, b) => b.total - a.total);
  }, [data]);

  const totalSpendAllApps = perAppRows.reduce((s, r) => s + r.total, 0);

  const hasData = data && data.buckets.length > 0 && totalSpendAllApps > 0;

  return (
    <div className="bg-ul-bg border border-ul-border rounded-card overflow-hidden">
      {/* Header — range caps + total + delta + range selector */}
      <div className="px-6 py-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-nano font-mono uppercase tracking-[0.06em] text-ul-text-muted mb-1">
            Usage · {rangeMeta.label}
          </div>
          <div className="flex items-baseline gap-3.5">
            <div className="text-display font-bold tracking-tight tabular-nums leading-none">
              ✦{visibleSpend.toFixed(3)}
            </div>
            {data && (
              <div
                className={`text-caption font-mono tabular-nums ${
                  deltaPct > 0 ? 'text-ul-error' : 'text-ul-success-strong'
                }`}
                title={`Prior ${rangeMeta.label}: ✦${data.totals.priorSpend.toFixed(3)}`}
              >
                {deltaPct > 0 ? '+' : ''}{deltaPct.toFixed(1)}% vs prior {rangeMeta.label}
              </div>
            )}
          </div>
          <div className="text-caption text-ul-text-secondary font-mono mt-1">
            avg ✦{avgPerDay.toFixed(4)}/day · {visibleApps.length} of {apps.length} apps shown
          </div>
        </div>

        {/* Range selector */}
        <div className="flex border border-ul-border rounded-md overflow-hidden">
          {RANGES.map((r, i) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setRange(r.id)}
              className={`px-3.5 py-1.5 text-caption font-mono uppercase tracking-wider cursor-pointer transition-colors border-none ${
                range === r.id
                  ? 'bg-ul-text text-white'
                  : 'bg-ul-bg text-ul-text-secondary hover:bg-ul-bg-hover'
              } ${i < RANGES.length - 1 ? 'border-r border-ul-border' : ''}`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Chart canvas + x-axis labels */}
      <div className="px-6 pb-4 relative">
        {hasData ? (
          <>
            <StackedBars
              buckets={buckets}
              segments={segments}
              gap={rangeMeta.days <= 30 ? 3 : 1}
              height={180}
              onHover={setHoverIdx}
              highlightIndex={hoverIdx}
            />
            {/* X-axis ticks — sparse for the longer windows. */}
            <div
              className="mt-1.5 flex"
              style={{ gap: rangeMeta.days <= 30 ? 3 : 1, padding: '0 4px' }}
            >
              {data!.buckets.map((b, i) => {
                const every =
                  data!.buckets.length > 30
                    ? Math.ceil(data!.buckets.length / 6)
                    : data!.buckets.length > 14
                      ? 4
                      : 1;
                const show = i % every === 0 || i === data!.buckets.length - 1;
                return (
                  <div
                    key={`${b.label}-${i}`}
                    className="flex-1 text-center text-nano font-mono text-ul-text-muted"
                  >
                    {show ? b.label : ''}
                  </div>
                );
              })}
            </div>

            {/* Hover tooltip — positioned over the chart top-right. */}
            {hoverIdx !== null && data && (
              <UsageTooltip
                bucket={data.buckets[hoverIdx]}
                apps={visibleApps}
              />
            )}
          </>
        ) : (
          <div
            className="flex items-end h-[180px] px-1"
            style={{
              borderBottom: '1px solid var(--ul-border, rgba(0,0,0,0.08))',
            }}
          >
            <div className="w-full text-center text-caption text-ul-text-muted pb-3">
              {loading
                ? 'Loading usage…'
                : `No usage in the last ${rangeMeta.label}.`}
            </div>
          </div>
        )}
      </div>

      {/* Legend — toggleable chips. */}
      {apps.length > 0 && (
        <div className="px-6 pb-4 flex flex-wrap gap-2">
          {apps.map((a) => {
            const off = hidden.has(a.id);
            const tone = a.tone || deriveTone(a.id);
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => toggleApp(a.id)}
                className={`inline-flex items-center gap-2 px-2.5 py-1.5 border border-ul-border rounded-md cursor-pointer text-caption text-ul-text ${
                  off ? 'bg-ul-bg opacity-50' : 'bg-ul-bg-raised'
                }`}
              >
                <span
                  className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                  style={{ background: tone }}
                />
                {a.name}
              </button>
            );
          })}
        </div>
      )}

      {/* Per-app table */}
      {perAppRows.length > 0 && (
        <div className="px-6 pb-6 pt-1">
          <div className="grid grid-cols-[40px_minmax(0,1fr)_60px_90px_80px] gap-3.5 px-2 py-2 border-b border-ul-border text-nano font-mono text-ul-text-muted uppercase tracking-[0.08em]">
            <span />
            <span>App</span>
            <span className="text-right">%</span>
            <span className="text-right">Spend</span>
            <span className="text-right">Trend</span>
          </div>
          {perAppRows.map((r, i) => {
            const off = hidden.has(r.app.id);
            const tone = r.app.tone || deriveTone(r.app.id);
            const glyph = r.app.glyph || deriveGlyph(r.app.name);
            const pct = totalSpendAllApps > 0 ? (r.total / totalSpendAllApps) * 100 : 0;
            return (
              <div
                key={r.app.id}
                className={`grid grid-cols-[40px_minmax(0,1fr)_60px_90px_80px] gap-3.5 items-center px-2 py-2.5 text-small ${
                  i < perAppRows.length - 1 ? 'border-b border-ul-border' : ''
                } ${off ? 'opacity-50' : ''}`}
              >
                <span
                  className="w-7 h-7 rounded-pill text-white inline-flex items-center justify-center font-mono font-bold text-nano"
                  style={{ background: tone, letterSpacing: '-0.02em' }}
                >
                  {glyph}
                </span>
                <div className="font-medium text-ul-text truncate">{r.app.name}</div>
                <div className="text-right font-mono text-micro text-ul-text-secondary tabular-nums">
                  {pct.toFixed(1)}%
                </div>
                <div className="text-right font-mono text-caption text-ul-text font-medium tabular-nums">
                  ✦{formatLight(r.total)}
                </div>
                <div className="text-right">
                  <MiniSparkline values={r.spark.slice(-Math.min(14, r.spark.length))} tone={tone} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────

function UsageTooltip({
  bucket,
  apps,
}: {
  bucket: { label: string; values: Record<string, number> };
  apps: UsageAppInfo[];
}) {
  const breakdown = apps
    .map((a) => ({ app: a, v: bucket.values[a.id] ?? 0 }))
    .filter((row) => row.v > 0)
    .sort((a, b) => b.v - a.v);
  if (breakdown.length === 0) return null;
  return (
    <div
      className="absolute top-2 right-6 bg-ul-text text-white rounded-md px-3 py-2 text-nano font-mono leading-relaxed pointer-events-none shadow-lg"
      style={{ minWidth: 160 }}
    >
      <div className="opacity-70 uppercase tracking-wider mb-1">{bucket.label}</div>
      {breakdown.map((row) => (
        <div key={row.app.id} className="flex items-center justify-between gap-3 tabular-nums">
          <span className="inline-flex items-center gap-1.5">
            <span
              className="w-1.5 h-1.5 rounded-sm"
              style={{ background: row.app.tone || '#fff' }}
            />
            {row.app.name}
          </span>
          <span>✦{row.v.toFixed(4)}</span>
        </div>
      ))}
    </div>
  );
}

function MiniSparkline({ values, tone }: { values: number[]; tone: string }) {
  if (values.length < 2) {
    return <span className="text-nano text-ul-text-muted">—</span>;
  }
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const w = 56;
  const h = 14;
  const dx = w / (values.length - 1);
  const points = values
    .map((v, i) => `${(i * dx).toFixed(1)},${(h - ((v - min) / range) * h).toFixed(1)}`)
    .join(' ');
  return (
    <svg width={w} height={h} aria-hidden="true" style={{ display: 'inline-block', verticalAlign: 'middle', overflow: 'visible' }}>
      <polyline
        points={points}
        fill="none"
        stroke={tone}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.85}
      />
    </svg>
  );
}
