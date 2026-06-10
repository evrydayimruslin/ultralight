import { assertEquals } from "https://deno.land/std@0.210.0/assert/assert_equals.ts";
import { assert } from "https://deno.land/std@0.210.0/assert/assert.ts";

import { processHeldPayouts } from "./payout-processor.ts";

async function withProcessorFetch(
  handler: (input: string | URL | Request, init?: RequestInit) => Response,
  fn: () => Promise<void>,
): Promise<void> {
  const globalWithEnv = globalThis as typeof globalThis & {
    __env?: Record<string, unknown>;
  };
  const previousEnv = globalWithEnv.__env;
  const previousFetch = globalThis.fetch;

  globalWithEnv.__env = {
    ...(previousEnv || {}),
    SUPABASE_URL: "https://supabase.test",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    STRIPE_SECRET_KEY: "sk_test_123",
  };
  globalThis.fetch = ((input, init) =>
    Promise.resolve(handler(input, init))) as typeof fetch;

  try {
    await fn();
  } finally {
    globalThis.fetch = previousFetch;
    globalWithEnv.__env = previousEnv;
  }
}

Deno.test("payout processor transfers and pays out net proceeds after fee estimate", async () => {
  const patches: Array<Record<string, unknown>> = [];
  const stripeAmounts: number[] = [];

  await withProcessorFetch((input, init) => {
    const url = String(input);

    if (url.includes("/rest/v1/rpc/get_releasable_payouts")) {
      return Response.json([{
        id: "payout_123",
        user_id: "user_123",
        amount_light: 5000,
        gross_cents: 5000,
        fee_estimate_cents: 38,
        stripe_fee_cents: 38,
        net_cents: 4962,
        created_at: "2026-05-05T00:00:00.000Z",
        release_at: "2026-05-05T00:00:00.000Z",
        light_per_usd_snapshot: 100,
        payout_run_id: null,
        scheduled_payout_date: "2026-05-05",
        payout_cutoff_at: "2026-04-14T00:00:00.000Z",
        payout_policy_version: 1,
        stripe_transfer_id: null,
        stripe_payout_id: null,
        stripe_transfer_status: "not_started",
        stripe_payout_status: "not_started",
        stripe_transfer_attempts: 0,
        stripe_payout_attempts: 0,
        stripe_transfer_idempotency_key: null,
        stripe_payout_idempotency_key: null,
      }]);
    }

    if (url.includes("/rest/v1/rpc/mark_payout_releasing")) {
      return Response.json(true);
    }

    if (url.includes("/rest/v1/users?id=eq.user_123")) {
      return Response.json([{
        stripe_connect_account_id: "acct_123",
        stripe_connect_payouts_enabled: true,
      }]);
    }

    if (url.includes("/rest/v1/payouts?id=eq.payout_123")) {
      patches.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(null, { status: 204 });
    }

    if (url === "https://api.stripe.com/v1/transfers") {
      const body = new URLSearchParams(String(init?.body));
      assertEquals(body.get("amount"), "4962");
      assertEquals(body.get("metadata[gross_cents]"), "5000");
      assertEquals(body.get("metadata[fee_estimate_cents]"), "38");
      assertEquals(body.get("metadata[net_cents]"), "4962");
      stripeAmounts.push(Number(body.get("amount")));
      return Response.json({ id: "tr_123", amount: 4962 });
    }

    if (url === "https://api.stripe.com/v1/payouts") {
      const headers = init?.headers as Record<string, string>;
      assertEquals(headers["Stripe-Account"], "acct_123");
      const body = new URLSearchParams(String(init?.body));
      assertEquals(body.get("amount"), "4962");
      assertEquals(body.get("metadata[stripe_transfer_id]"), "tr_123");
      stripeAmounts.push(Number(body.get("amount")));
      return Response.json({ id: "po_123", amount: 4962 });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  }, async () => {
    const result = await processHeldPayouts({ limit: 1 });

    assertEquals(result.processed, 1);
    assertEquals(result.succeeded, 1);
    assertEquals(result.failed, 0);
    assertEquals(stripeAmounts, [4962, 4962]);
    assert(
      patches.some((patch) =>
        patch.gross_cents === 5000 &&
        patch.fee_estimate_cents === 38 &&
        patch.net_cents === 4962
      ),
    );
    assert(
      patches.some((patch) => patch.stripe_transfer_amount_cents === 4962),
    );
    assert(
      patches.some((patch) =>
        patch.stripe_payout_amount_cents === 4962 &&
        patch.stripe_payout_id === "po_123"
      ),
    );
  });
});
