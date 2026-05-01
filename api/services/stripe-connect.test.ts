import { assertEquals } from "https://deno.land/std@0.210.0/assert/assert_equals.ts";

import { createPayout, createTransfer } from "./stripe-connect.ts";

async function withStripeFetch(
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

Deno.test("stripe connect: transfer requests include idempotency key and metadata", async () => {
  await withStripeFetch((input, init) => {
    assertEquals(String(input), "https://api.stripe.com/v1/transfers");
    assertEquals(init?.method, "POST");
    const headers = init?.headers as Record<string, string>;
    assertEquals(headers["Idempotency-Key"], "transfer-key");
    const body = new URLSearchParams(String(init?.body));
    assertEquals(body.get("amount"), "1234");
    assertEquals(body.get("currency"), "usd");
    assertEquals(body.get("destination"), "acct_123");
    assertEquals(body.get("metadata[payout_id]"), "payout_123");
    return Response.json({ id: "tr_123", amount: 1234 });
  }, async () => {
    const result = await createTransfer(
      1234,
      "acct_123",
      { payout_id: "payout_123" },
      { idempotencyKey: "transfer-key" },
    );
    assertEquals(result.transfer_id, "tr_123");
    assertEquals(result.amount_cents, 1234);
  });
});

Deno.test("stripe connect: payout requests include connected account and idempotency key", async () => {
  await withStripeFetch((_input, init) => {
    assertEquals(init?.method, "POST");
    const headers = init?.headers as Record<string, string>;
    assertEquals(headers["Stripe-Account"], "acct_123");
    assertEquals(headers["Idempotency-Key"], "payout-key");
    const body = new URLSearchParams(String(init?.body));
    assertEquals(body.get("amount"), "1200");
    assertEquals(body.get("currency"), "usd");
    assertEquals(body.get("metadata[payout_id]"), "payout_123");
    return Response.json({ id: "po_123", amount: 1200 });
  }, async () => {
    const result = await createPayout(1200, "acct_123", {
      idempotencyKey: "payout-key",
      metadata: { payout_id: "payout_123" },
    });
    assertEquals(result.payout_id, "po_123");
    assertEquals(result.amount_cents, 1200);
  });
});
