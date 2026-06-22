// Buyer tax-location resolution for per-transaction sales tax.
//
// The rate depends on where the buyer is. We derive that from their current
// billing address (captured at top-up, source "wallet_funding"). Reading it on
// every paid call would add a Supabase round-trip to the hot path, so locations
// are cached per user with a short TTL — a billing address changes far less
// often than a buyer makes calls, and a stale location for a few minutes is
// acceptable for tax. The settlement path only calls this when a non-zero rate
// is actually configured (see `isSalesTaxConfigured`), so an empty rate table
// means this is never reached.

import { getCurrentBillingAddress } from "./billing-addresses.ts";
import type { SalesTaxLocation } from "./sales-tax.ts";

export interface BuyerTaxLocation {
  location: SalesTaxLocation;
  addressId: string;
  version: number;
}

interface CacheEntry {
  value: BuyerTaxLocation | null;
  expiresAt: number;
}

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, CacheEntry>();

/** Test seam: clear the in-memory location cache. */
export function _clearBuyerTaxLocationCache(): void {
  cache.clear();
}

/**
 * Resolve (and cache) the buyer's tax location. Returns null when the buyer has
 * no current billing address, or on any read error — tax then falls back to
 * `not_collecting` rather than failing the call.
 */
export async function resolveBuyerTaxLocation(
  userId: string,
): Promise<BuyerTaxLocation | null> {
  const now = Date.now();
  const cached = cache.get(userId);
  if (cached && cached.expiresAt > now) return cached.value;

  let value: BuyerTaxLocation | null = null;
  try {
    const profile = await getCurrentBillingAddress(userId);
    if (profile && profile.country) {
      value = {
        location: { country: profile.country, state: profile.state ?? null },
        addressId: profile.id,
        version: profile.version,
      };
    }
  } catch (err) {
    console.error("[SALES-TAX] Failed to resolve buyer tax location:", err);
    // Leave value null; don't cache failures for the full TTL so a transient
    // error self-heals quickly.
    cache.set(userId, { value: null, expiresAt: now + 30_000 });
    return null;
  }

  cache.set(userId, { value, expiresAt: now + CACHE_TTL_MS });
  return value;
}
