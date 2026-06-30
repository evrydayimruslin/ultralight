// Trust-weighted discovery ranking (Phase 4).
//
// Folds the four earned trust signals into a single bounded score that nudges
// discovery order WITHOUT overriding relevance: the final composite keeps
// similarity at 0.7, and the trust term contributes in [-TRUST_WEIGHT, +TRUST_WEIGHT]
// (plus a small cold-start lift, max delta +0.15), so trust orders comparably-
// relevant Agents rather than burying a strong semantic match. Good signals
// boost; red health / negative flags demote.

import { getEnv } from "../lib/env.ts";
import { emptyHealth, getAppHealth } from "./app-health.ts";
import type { HealthWindows } from "../../shared/types/index.ts";

// Publisher verification is treated as stale (=> unverified) past this age, the
// same window the trust card uses.
const PUBLISHER_VERIFIED_MAX_AGE_MS = 48 * 60 * 60 * 1000;

// Trust-block weights (positive side sums to 1.0; health/flags can go negative).
const W_PUBLISHER = 0.35;
const W_HEALTH = 0.30;
const W_OPEN_VERIFIED = 0.20;
const W_FLAG = 0.15;
// Below this total flag weight a flag_ratio is too thin to trust => 0 influence.
const MIN_FLAG_WEIGHT = 2;
// How much the whole (in [-1,1]) trust block can move the composite. Small, so
// similarity (0.7) stays dominant — trust orders ties, never overrides relevance.
const TRUST_WEIGHT = 0.12;
// Cold start: a brand-new Agent has no health/flags/verified-reads, so trust
// would entrench incumbents. Give low-traffic Agents a tiny exploration lift.
const COLD_START_RUNS = 25;
const COLD_START_BONUS = 0.03;

export interface TrustSignals {
  publisher_verified: boolean;
  open_code: boolean;
  health: HealthWindows;
  verified_reads: number;
  // Weighted positive share in [0,1], or null when there are too few flags.
  flag_ratio: number | null;
}

export interface RankableApp {
  id: string;
  owner_id?: string | null;
  download_access?: string | null;
}

function healthScore(h: HealthWindows): number {
  // Prefer the freshest window that has a verdict: a now-broken Agent (24h red)
  // must not read healthy on a stale 7d green.
  if (h["24h"] === "green") return 1;
  if (h["24h"] === "red") return -1;
  if (h["7d"] === "green") return 1;
  if (h["7d"] === "red") return -1;
  return 0;
}

// The bounded trust score in [-1, 1]. Conservative: absent signals contribute 0,
// so an unknown Agent is neither boosted nor penalised.
export function computeTrustScore(s: TrustSignals): number {
  const flagScore = s.flag_ratio === null ? 0 : (s.flag_ratio - 0.5) * 2; // [-1,1]
  const raw = W_PUBLISHER * (s.publisher_verified ? 1 : 0) +
    W_HEALTH * healthScore(s.health) +
    W_OPEN_VERIFIED * (s.open_code && s.verified_reads >= 1 ? 1 : 0) +
    W_FLAG * flagScore;
  return Math.max(-1, Math.min(1, raw));
}

// The additive delta applied to a candidate's composite score: the trust term
// in [-TRUST_WEIGHT, +TRUST_WEIGHT], plus a small cold-start exploration lift for
// low-traffic Agents — gated on a NON-negative score so it can never cancel a
// red-health / negatively-flagged Agent's demotion (max delta = +0.15).
export function trustRankDelta(s: TrustSignals, runs30d: number): number {
  const score = computeTrustScore(s);
  const cold = (runs30d < COLD_START_RUNS && score >= 0) ? COLD_START_BONUS : 0;
  return score * TRUST_WEIGHT + cold;
}

function emptySignals(): TrustSignals {
  return {
    publisher_verified: false,
    open_code: false,
    health: emptyHealth(),
    verified_reads: 0,
    flag_ratio: null,
  };
}

interface AggregateRow {
  app_id: string;
  verifier_count: number;
  flag_pos_weight: number;
  flag_total_weight: number;
}

// Batch-aggregate every trust signal for a set of candidate apps in a bounded
// number of round-trips (1 health view read + 1 owners read + 1 RPC), so this
// is safe to call once per discovery fan-out. Failure of any source degrades
// that signal to its conservative default rather than blocking discovery.
export async function aggregateTrustSignals(
  apps: RankableApp[],
): Promise<Map<string, TrustSignals>> {
  const out = new Map<string, TrustSignals>();
  for (const a of apps) out.set(a.id, emptySignals());
  if (apps.length === 0) return out;

  const url = getEnv("SUPABASE_URL");
  const key = getEnv("SUPABASE_SERVICE_ROLE_KEY");

  const appIds = [...new Set(apps.map((a) => a.id).filter(Boolean))];
  const ownerIds = [...new Set(apps.map((a) => a.owner_id).filter(Boolean))] as string[];

  // open_code is free (already on the row).
  for (const a of apps) {
    const s = out.get(a.id)!;
    s.open_code = a.download_access === "public";
  }

  const [healthMap, verifiedOwners, aggregates] = await Promise.all([
    getAppHealth(appIds),
    fetchVerifiedOwners(url, key, ownerIds),
    fetchAggregates(url, key, appIds),
  ]);

  for (const a of apps) {
    const s = out.get(a.id)!;
    s.health = healthMap.get(a.id) ?? emptyHealth();
    s.publisher_verified = a.owner_id ? verifiedOwners.has(a.owner_id) : false;
    const agg = aggregates.get(a.id);
    if (agg) {
      s.verified_reads = agg.verifier_count;
      s.flag_ratio = agg.flag_total_weight >= MIN_FLAG_WEIGHT
        ? agg.flag_pos_weight / agg.flag_total_weight
        : null;
    }
  }
  return out;
}

async function fetchVerifiedOwners(
  url: string | undefined,
  key: string | undefined,
  ownerIds: string[],
): Promise<Set<string>> {
  const verified = new Set<string>();
  if (!url || !key || ownerIds.length === 0) return verified;
  try {
    const ids = ownerIds.map((id) => encodeURIComponent(id)).join(",");
    const res = await fetch(
      `${url}/rest/v1/users?id=in.(${ids})&select=id,stripe_connect_verified,stripe_connect_synced_at`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } },
    );
    if (!res.ok) return verified;
    const rows = await res.json() as Array<{
      id: string;
      stripe_connect_verified: boolean | null;
      stripe_connect_synced_at: string | null;
    }>;
    for (const row of rows) {
      if (row.stripe_connect_verified !== true) continue;
      const syncedAt = row.stripe_connect_synced_at ? Date.parse(row.stripe_connect_synced_at) : NaN;
      if (Number.isFinite(syncedAt) && Date.now() - syncedAt <= PUBLISHER_VERIFIED_MAX_AGE_MS) {
        verified.add(row.id);
      }
    }
  } catch {
    // degrade to "none verified"
  }
  return verified;
}

async function fetchAggregates(
  url: string | undefined,
  key: string | undefined,
  appIds: string[],
): Promise<Map<string, AggregateRow>> {
  const map = new Map<string, AggregateRow>();
  if (!url || !key || appIds.length === 0) return map;
  try {
    const res = await fetch(`${url}/rest/v1/rpc/get_app_trust_aggregates`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_app_ids: appIds }),
    });
    if (!res.ok) return map;
    const rows = await res.json() as AggregateRow[];
    for (const row of rows) {
      if (row?.app_id) map.set(row.app_id, row);
    }
  } catch {
    // degrade to "no aggregates"
  }
  return map;
}

// Agent-readable trust summary injected into the discovery payload.
export interface TrustSummary {
  score: number;
  publisher_verified: boolean;
  open_code: boolean;
  health: HealthWindows;
  verified_reads: number;
  flag_ratio: number | null;
}

export function trustSummary(s: TrustSignals): TrustSummary {
  return {
    score: Math.round(((computeTrustScore(s) + 1) / 2) * 1000) / 1000, // 0..1 for readability
    publisher_verified: s.publisher_verified,
    open_code: s.open_code,
    health: s.health,
    verified_reads: s.verified_reads,
    flag_ratio: s.flag_ratio === null ? null : Math.round(s.flag_ratio * 1000) / 1000,
  };
}
