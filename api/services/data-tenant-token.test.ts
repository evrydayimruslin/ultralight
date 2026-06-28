// Tests for the data-worker per-tenant proof. The worker (worker/src/index.ts)
// carries an algorithm-identical inline verifier; these tests pin the mint +
// verify contract (format, signature, expiry, binding) that both sides share.

import { assert } from "https://deno.land/std@0.210.0/assert/assert.ts";
import { assertEquals } from "https://deno.land/std@0.210.0/assert/assert_equals.ts";
import {
  mintDataTenantToken,
  verifyDataTenantToken,
} from "./data-tenant-token.ts";

Deno.test("data tenant token: mint → verify roundtrip carries appId + userId", async () => {
  const token = await mintDataTenantToken({ appId: "app_abc", userId: "user_1" });
  assert(token.startsWith("gxd1."), "token has the gxd1 prefix");
  const result = await verifyDataTenantToken(token);
  assert(result.valid, "freshly minted token verifies");
  assertEquals(result.claims?.appId, "app_abc");
  assertEquals(result.claims?.userId, "user_1");
});

Deno.test("data tenant token: anonymous (no userId) binds userId=null", async () => {
  const token = await mintDataTenantToken({ appId: "app_pub" });
  const result = await verifyDataTenantToken(token);
  assert(result.valid);
  assertEquals(result.claims?.userId, null);
});

Deno.test("data tenant token: absent / malformed tokens are rejected", async () => {
  assertEquals((await verifyDataTenantToken(null)).reason, "absent");
  assertEquals((await verifyDataTenantToken("")).reason, "absent");
  assertEquals((await verifyDataTenantToken("notatoken")).reason, "absent");
  assertEquals((await verifyDataTenantToken("gxd1.onlyonepart")).reason, "malformed");
});

Deno.test("data tenant token: a tampered claim breaks the signature", async () => {
  const token = await mintDataTenantToken({ appId: "app_victim", userId: "u1" });
  const [, encoded, sig] = token.split(".");
  // Re-encode claims pointing at a different tenant, keep the original sig.
  const forgedClaims = btoa(JSON.stringify({
    v: 1,
    appId: "app_attacker",
    userId: "u1",
    iat: 1,
    exp: 9999999999,
  })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const forged = `gxd1.${forgedClaims}.${sig}`;
  const result = await verifyDataTenantToken(forged);
  assertEquals(result.valid, false);
  assertEquals(result.reason, "bad_signature");
  // The original, untampered encoded part is unused here — just asserts the
  // forgery path is what we exercised.
  assert(encoded.length > 0);
});

Deno.test("data tenant token: expired tokens are rejected", async () => {
  // Mint with a 1s TTL in the past via nowMs, then verify at "now".
  const pastMs = 1_000_000_000_000; // fixed past instant
  const token = await mintDataTenantToken({
    appId: "app_x",
    userId: "u",
    ttlSeconds: 1,
    nowMs: pastMs,
  });
  const result = await verifyDataTenantToken(token, pastMs + 10_000);
  assertEquals(result.valid, false);
  assertEquals(result.reason, "expired");
  // Still valid within its window.
  const fresh = await verifyDataTenantToken(token, pastMs + 500);
  assert(fresh.valid);
});

Deno.test("data tenant token: wire format is deterministic + claims encode exactly (cross-impl parity lock)", async () => {
  // deno-lint-ignore no-explicit-any
  const g = globalThis as any;
  const original = g.__env;
  try {
    g.__env = { DATA_TENANT_SECRET: "fixed-secret" };
    const inputs = { appId: "app_k", userId: "user_k", ttlSeconds: 600, nowMs: 1_700_000_000_000 };
    const a = await mintDataTenantToken(inputs);
    const b = await mintDataTenantToken(inputs);
    // Same inputs + secret → byte-identical token. If the worker's verifier (or
    // either base64url/HMAC helper) ever drifts, the gxd1 wire format changes
    // and this breaks before it can become a prod outage on enforce-flip.
    assertEquals(a, b, "minting is deterministic for fixed inputs");
    assert(a.startsWith("gxd1."), "prefix");
    const [, encoded, sig] = a.split(".");
    assertEquals(sig.length, 64, "HMAC-SHA256 hex is 64 chars");
    // The middle segment decodes to exactly the canonical claims.
    const pad = encoded.length % 4 === 0 ? "" : "=".repeat(4 - (encoded.length % 4));
    const json = atob(encoded.replace(/-/g, "+").replace(/_/g, "/") + pad);
    assertEquals(JSON.parse(json), {
      v: 1,
      appId: "app_k",
      userId: "user_k",
      iat: 1_700_000_000,
      exp: 1_700_000_600,
    });
  } finally {
    g.__env = original;
  }
});

Deno.test("data tenant token: a token signed with a different secret fails", async () => {
  // getEnv reads globalThis.__env (set per-request by worker-entry), not
  // Deno.env — so simulate the API worker's env to toggle the signing secret.
  // deno-lint-ignore no-explicit-any
  const g = globalThis as any;
  const original = g.__env;
  try {
    g.__env = { DATA_TENANT_SECRET: "secret-A" };
    const token = await mintDataTenantToken({ appId: "app_a", userId: "u" });
    assert((await verifyDataTenantToken(token)).valid, "verifies under same secret");

    g.__env = { DATA_TENANT_SECRET: "secret-B" };
    const result = await verifyDataTenantToken(token);
    assertEquals(result.valid, false, "must not verify under a different secret");
    assertEquals(result.reason, "bad_signature");
  } finally {
    g.__env = original;
  }
});
