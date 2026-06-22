// Per-transaction sales tax (consumption-time).
//
// Tax is charged on each *monetized* agent-call — the app charge the buyer pays
// the seller — at the rate for the buyer's billing location, in fractional
// Light (no sub-cent floor). This replaces the old accrual/balance-trigger model
// (which was never wired into production): there is no "charge tax in lumps when
// the balance dips" anymore; every taxable receipt carries its own tax line.
//
// D0 decision: the rate comes from a MANUAL rate table (below), not Stripe Tax.

export interface SalesTaxLocation {
  /** ISO 3166-1 alpha-2 country code. Compared case-insensitively. */
  country: string;
  /** Subdivision code (e.g. a US state like "CA") where sub-national rates apply. */
  state?: string | null;
}

interface JurisdictionRates {
  /** Rate (basis points) for the country when no subdivision entry matches. */
  default?: number;
  /** Per-subdivision overrides, keyed by uppercased subdivision code. */
  states?: Record<string, number>;
}

// ============================================================================
// MANUAL SALES-TAX RATE TABLE  —  edit this to turn collection on.
// ============================================================================
// Rates are in BASIS POINTS: 725 = 7.25%, 2000 = 20%.
//
// The platform only collects sales tax where it is registered, so EVERY
// jurisdiction defaults to 0 (`not_collecting`) until a rate is added here.
// Adding a non-zero rate is the single switch that turns on collection for that
// location — the rest of the pipeline (compute, buyer debit, receipt, ledger
// display) is already live. With this table empty, the tax path is inert: no
// balance is read or debited on the hot path (see `isSalesTaxConfigured`).
//
// Example — replace with your real registrations:
//   US: { states: { CA: 825, NY: 800 } },   // collect in CA and NY only
//   GB: { default: 2000 },                   // UK VAT, country-wide
const SALES_TAX_RATE_TABLE: Record<string, JurisdictionRates> = {
  // Add registered jurisdictions here. Examples above. Empty = not collecting
  // anywhere (safe default until the business configures its nexus).
};
// ============================================================================

// Active table — the shipped table by default. Overridable in tests only.
let activeRateTable: Record<string, JurisdictionRates> = SALES_TAX_RATE_TABLE;

/** Test seam: override the rate table. Pass no arg to reset to the shipped one. */
export function __setSalesTaxRateTableForTest(
  table?: Record<string, JurisdictionRates>,
): void {
  activeRateTable = table ?? SALES_TAX_RATE_TABLE;
}

function normalizeBps(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

/**
 * Resolve the sales-tax rate (basis points) for a buyer location from the
 * manual table. Returns 0 for unknown/unconfigured locations.
 */
export function resolveSalesTaxRateBps(
  location: SalesTaxLocation | null | undefined,
): number {
  const country = location?.country?.trim().toUpperCase();
  if (!country) return 0;
  const entry = activeRateTable[country];
  if (!entry) return 0;
  const state = location?.state?.trim().toUpperCase();
  if (state && entry.states && state in entry.states) {
    return normalizeBps(entry.states[state]);
  }
  return normalizeBps(entry.default);
}

/**
 * Compute the tax amount (fractional Light) for a taxable amount at a rate.
 * No sub-cent floor — Light is a fractional double-precision unit.
 */
export function computeSalesTaxLight(
  taxableAmountLight: number,
  rateBps: number,
): number {
  const taxable = Math.max(0, taxableAmountLight || 0);
  const rate = normalizeBps(rateBps);
  if (taxable <= 0 || rate <= 0) return 0;
  return taxable * rate / 10_000;
}

/**
 * Whether any non-zero rate is configured. When false the whole tax path is a
 * no-op and the settlement hot path skips the buyer billing-address read — so
 * an empty table costs nothing and changes no behavior.
 */
export function isSalesTaxConfigured(): boolean {
  for (const entry of Object.values(activeRateTable)) {
    if (normalizeBps(entry.default) > 0) return true;
    for (const rate of Object.values(entry.states ?? {})) {
      if (normalizeBps(rate) > 0) return true;
    }
  }
  return false;
}
