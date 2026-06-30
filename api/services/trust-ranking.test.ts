// Trust-weighted ranking (Phase 4) tests. Proves the score is bounded and
// conservative (unknown => 0, red health / negative flags demote, good signals
// boost), cold-start lifts newcomers, and the batch aggregation assembles every
// signal from its source.

import { assert } from "https://deno.land/std@0.210.0/assert/assert.ts";
import { assertEquals } from "https://deno.land/std@0.210.0/assert/assert_equals.ts";
import {
  aggregateTrustSignals,
  computeTrustScore,
  type TrustSignals,
  trustRankDelta,
} from "./trust-ranking.ts";
import type { HealthWindows } from "../../shared/types/index.ts";

const H = (over: Partial<HealthWindows> = {}): HealthWindows => ({
  "1h": "no_data",
  "24h": "no_data",
  "7d": "no_data",
  "30d": "no_data",
  ...over,
});

function sig(over: Partial<TrustSignals> = {}): TrustSignals {
  return {
    publisher_verified: false,
    open_code: false,
    health: H(),
    verified_reads: 0,
    flag_ratio: null,
    ...over,
  };
}

Deno.test("score: unknown Agent is neutral (0)", () => {
  assertEquals(computeTrustScore(sig()), 0);
});

Deno.test("score: full trust is strongly positive, red health / negative flags demote", () => {
  const full = computeTrustScore(sig({
    publisher_verified: true,
    open_code: true,
    verified_reads: 3,
    health: H({ "7d": "green", "24h": "green" }),
    flag_ratio: 1,
  }));
  assert(full > 0.9, `full trust should be ~1, got ${full}`);

  const red = computeTrustScore(sig({ health: H({ "24h": "red" }) }));
  assert(red < 0, `red health should demote, got ${red}`);

  const badFlags = computeTrustScore(sig({ flag_ratio: 0 }));
  assert(badFlags < 0, `all-negative flags should demote, got ${badFlags}`);
});

Deno.test("score: freshest window wins — a now-broken Agent (24h red) is not healthy on stale 7d green", () => {
  const nowBroken = computeTrustScore(sig({ health: H({ "7d": "green", "24h": "red" }) }));
  assert(nowBroken < 0, `24h red should override 7d green, got ${nowBroken}`);
});

Deno.test("delta: cold-start does NOT cancel a red-health newcomer's demotion", () => {
  // A low-traffic Agent with red health has a negative score, so it gets no
  // cold-start lift — the demotion stands.
  const d = trustRankDelta(sig({ health: H({ "24h": "red" }) }), 5);
  assert(d < 0, `red-health newcomer must stay demoted, got ${d}`);
});

Deno.test("score: open code only counts when independently verified", () => {
  const openOnly = computeTrustScore(sig({ open_code: true, verified_reads: 0 }));
  assertEquals(openOnly, 0); // downloadable but unverified => no credit
  const openVerified = computeTrustScore(sig({ open_code: true, verified_reads: 1 }));
  assert(openVerified > 0);
});

Deno.test("delta: bounded, similarity stays dominant; cold-start lifts newcomers", () => {
  // Full trust moves the score by at most TRUST_WEIGHT (0.12) — far below the
  // 0.7 similarity weight, so trust can't override relevance.
  const full = sig({
    publisher_verified: true,
    open_code: true,
    verified_reads: 3,
    health: H({ "7d": "green" }),
    flag_ratio: 1,
  });
  const delta = trustRankDelta(full, 1000);
  assert(delta > 0 && delta <= 0.12 + 1e-9, `delta should be <=0.12, got ${delta}`);

  // A brand-new untrusted Agent gets the small cold-start lift, not 0.
  assertEquals(trustRankDelta(sig(), 5), 0.03);
  // An established untrusted Agent gets nothing.
  assertEquals(trustRankDelta(sig(), 1000), 0);
});

Deno.test("aggregate: assembles publisher/health/open/verified-reads/flags per app", async () => {
  // deno-lint-ignore no-explicit-any
  const g = globalThis as any;
  const prevEnv = g.__env;
  const prevFetch = globalThis.fetch;
  g.__env = { SUPABASE_URL: "https://db.example", SUPABASE_SERVICE_ROLE_KEY: "k" };
  const recent = new Date(Date.now() - 3600_000).toISOString();
  globalThis.fetch = ((url: string) => {
    const u = String(url);
    if (u.includes("/app_health_windows")) {
      return Promise.resolve(new Response(JSON.stringify([
        { app_id: "a", calls_24h: 10, ok_24h: 10, payers_24h: 3, calls_1h: 0, ok_1h: 0, payers_1h: 0, calls_7d: 0, ok_7d: 0, payers_7d: 0, calls_30d: 0, ok_30d: 0, payers_30d: 0 },
      ]), { status: 200 }));
    }
    if (u.includes("/users?")) {
      return Promise.resolve(new Response(JSON.stringify([
        { id: "o1", stripe_connect_verified: true, stripe_connect_synced_at: recent },
      ]), { status: 200 }));
    }
    if (u.includes("/rpc/get_app_trust_aggregates")) {
      return Promise.resolve(new Response(JSON.stringify([
        { app_id: "a", verifier_count: 2, flag_pos_weight: 3, flag_total_weight: 4 },
      ]), { status: 200 }));
    }
    return Promise.resolve(new Response("[]", { status: 200 }));
  }) as typeof globalThis.fetch;
  try {
    const map = await aggregateTrustSignals([
      { id: "a", owner_id: "o1", download_access: "public" },
      { id: "b", owner_id: "o2", download_access: "owner" },
    ]);
    const a = map.get("a")!;
    assertEquals(a.publisher_verified, true);
    assertEquals(a.open_code, true);
    assertEquals(a.health["24h"], "green");
    assertEquals(a.verified_reads, 2);
    assertEquals(a.flag_ratio, 0.75);
    // b: no signals -> conservative defaults
    const b = map.get("b")!;
    assertEquals(b.publisher_verified, false);
    assertEquals(b.open_code, false);
    assertEquals(b.verified_reads, 0);
    assertEquals(b.flag_ratio, null);
  } finally {
    g.__env = prevEnv;
    globalThis.fetch = prevFetch;
  }
});
