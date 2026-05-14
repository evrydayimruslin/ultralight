// Shared formatting helpers for the Light economy + marketplace surfaces.
//
// Replaces the 11+ copy-paste `formatLight` / `formatLightAmount` /
// `formatLightBalance` functions that accumulated during the premium-UI
// port. Three named exports cover the recurring display contexts:
//
//   formatLightCompact  — "✦12.5K", "✦1.20M" style for balance/cost badges
//                          where horizontal space matters (BalanceIndicator,
//                          SpendingSettings, SpendingApprovalModal, etc.).
//
//   formatLightPrecise  — "12,402" / "12.5k" / "0.084" style without the ✦
//                          prefix, for tabular cell content (Marketplace
//                          listing prices, ProfileView earnings rows).
//
//   formatLightWhole    — "1,234" / "1.20M" style for round-number Light
//                          amounts in flows where decimals never apply
//                          (AddLightModal $→Light preview, WithdrawModal).
//
// Author-handle fallback lives here too because the marketplace+tool detail
// surfaces all guess a handle from the app slug when the BE doesn't ship
// one. Centralizing the rule means a future `author_handle` BE field needs
// to flip one helper rather than three call sites.

/**
 * Compact "✦" badge style. Negative numbers fold to absolute (sign dropped
 * — the surrounding label conveys direction). Used inside cost pills and
 * balance chips where the abbreviation is preferable to a long decimal.
 */
export function formatLightCompact(amount: number): string {
  const abs = Math.abs(amount);
  if (abs >= 1_000_000) return '✦' + (abs / 1_000_000).toFixed(2) + 'M';
  if (abs >= 5_000) return '✦' + (abs / 1_000).toFixed(1) + 'K';
  return '✦' + (abs % 1 === 0 ? String(abs) : abs.toFixed(2));
}

/**
 * Precise display without a unit prefix (the caller renders ✦ separately).
 * Null/undefined → an em-dash placeholder. Decimal places default to 3
 * (the canonical precision Light is metered at) and collapse to integer
 * with a `k` suffix at the >=1k boundary when `decimals=0`.
 */
export function formatLightPrecise(
  n: number | undefined | null,
  decimals = 3,
): string {
  if (n === undefined || n === null) return '—';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000 && decimals === 0) return `${(n / 1_000).toFixed(1)}k`;
  if (Number.isInteger(n)) return n.toLocaleString();
  return n.toFixed(decimals);
}

/**
 * Whole-number display for top-up + payout flows. Anything under 1M renders
 * via `toLocaleString` so 12_500 → "12,500"; above that the M abbreviation
 * kicks in. No ✦ prefix; callers compose with their own glyph.
 */
export function formatLightWhole(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  return n.toLocaleString();
}

/**
 * The display handle for an app's author. Order of preference:
 *   1. An explicit `author_handle` from the BE (not yet shipped — tracked
 *      as DESIGN-FOLLOWUPS B).
 *   2. The app's `slug` (Marketplace surfaces truncate at the first dash
 *      to drop the auto-generated suffix; ToolDetailView shows the full
 *      slug because it has the screen real estate).
 *   3. A caller-provided fallback (e.g. `"author"` or `"owner"`).
 *
 * Returns the handle WITHOUT the `@` prefix so callers can compose:
 *   `<span>@{formatAuthorHandle(app)}</span>`.
 */
export function formatAuthorHandle(
  app: { author_handle?: string | null; slug?: string | null } | null | undefined,
  options: { truncateAtDash?: boolean; fallback?: string } = {},
): string {
  const { truncateAtDash = false, fallback = 'author' } = options;
  if (!app) return fallback;
  if (app.author_handle && app.author_handle.length > 0) return app.author_handle;
  if (app.slug && app.slug.length > 0) {
    return truncateAtDash ? app.slug.split('-')[0] || fallback : app.slug;
  }
  return fallback;
}
