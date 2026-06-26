import { assertEquals } from "https://deno.land/std@0.210.0/assert/assert_equals.ts";

import {
  getOrCreateStripeCustomerForUser,
  stripeCustomerExists,
} from "./stripe-customers.ts";

const SB_URL = "https://supabase.test";

interface Call {
  method: string;
  url: string;
}

async function withFetch(
  handler: (input: string | URL | Request, init?: RequestInit) => Response,
  fn: (calls: Call[]) => Promise<void>,
): Promise<void> {
  const globalWithEnv = globalThis as typeof globalThis & {
    __env?: Record<string, unknown>;
  };
  const previousEnv = globalWithEnv.__env;
  const previousFetch = globalThis.fetch;
  const calls: Call[] = [];
  globalWithEnv.__env = {
    ...(previousEnv || {}),
    SUPABASE_URL: SB_URL,
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  };
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    calls.push({ method: init?.method ?? "GET", url: String(input) });
    return Promise.resolve(handler(input, init));
  }) as typeof fetch;

  try {
    await fn(calls);
  } finally {
    globalThis.fetch = previousFetch;
    globalWithEnv.__env = previousEnv;
  }
}

function userRow(stripeCustomerId: string | null): Response {
  return Response.json([
    { stripe_customer_id: stripeCustomerId, email: "buyer@example.com" },
  ]);
}

Deno.test("getOrCreate: valid stored customer is reused, never recreated", async () => {
  await withFetch((input, init) => {
    const url = String(input);
    if (url.startsWith(`${SB_URL}/rest/v1/users`) && (init?.method ?? "GET") === "GET") {
      return userRow("cus_live_existing");
    }
    if (url === "https://api.stripe.com/v1/customers/cus_live_existing") {
      return Response.json({ id: "cus_live_existing", deleted: false });
    }
    throw new Error(`unexpected fetch: ${init?.method ?? "GET"} ${url}`);
  }, async (calls) => {
    const result = await getOrCreateStripeCustomerForUser("user-1", "sk_live_x");
    assertEquals(result.stripeCustomerId, "cus_live_existing");
    // No POST to create a customer should have happened.
    assertEquals(
      calls.some((c) =>
        c.method === "POST" && c.url === "https://api.stripe.com/v1/customers"
      ),
      false,
    );
  });
});

Deno.test("getOrCreate: stale (test-mode) customer is recreated and persisted", async () => {
  await withFetch((input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.startsWith(`${SB_URL}/rest/v1/users`) && method === "GET") {
      return userRow("cus_test_stale");
    }
    // Validation GET: live key does not know the test-mode customer.
    if (url === "https://api.stripe.com/v1/customers/cus_test_stale") {
      return new Response("{\"error\":{\"code\":\"resource_missing\"}}", {
        status: 404,
      });
    }
    // Recreate.
    if (url === "https://api.stripe.com/v1/customers" && method === "POST") {
      return Response.json({ id: "cus_live_new" });
    }
    // Persist the new id.
    if (url.startsWith(`${SB_URL}/rest/v1/users`) && method === "PATCH") {
      return new Response(null, { status: 204 });
    }
    throw new Error(`unexpected fetch: ${method} ${url}`);
  }, async (calls) => {
    const result = await getOrCreateStripeCustomerForUser("user-1", "sk_live_x");
    assertEquals(result.stripeCustomerId, "cus_live_new");
    // The new id must be written back to the user row.
    const patch = calls.find((c) =>
      c.method === "PATCH" && c.url.startsWith(`${SB_URL}/rest/v1/users`)
    );
    assertEquals(Boolean(patch), true);
  });
});

Deno.test("getOrCreate: transient validation error does NOT recreate (no duplicate customer)", async () => {
  await withFetch((input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.startsWith(`${SB_URL}/rest/v1/users`) && method === "GET") {
      return userRow("cus_live_existing");
    }
    // Stripe 500 (transient) on the validation GET.
    if (url === "https://api.stripe.com/v1/customers/cus_live_existing") {
      return new Response("upstream error", { status: 500 });
    }
    throw new Error(`unexpected fetch: ${method} ${url}`);
  }, async (calls) => {
    const result = await getOrCreateStripeCustomerForUser("user-1", "sk_live_x");
    // Keep the stored id; let the downstream call surface the real error.
    assertEquals(result.stripeCustomerId, "cus_live_existing");
    assertEquals(
      calls.some((c) =>
        c.method === "POST" && c.url === "https://api.stripe.com/v1/customers"
      ),
      false,
    );
  });
});

Deno.test("stripeCustomerExists: 404 false, deleted false, ok true", async () => {
  await withFetch((input) => {
    const url = String(input);
    if (url === "https://api.stripe.com/v1/customers/cus_missing") {
      return new Response("{}", { status: 404 });
    }
    if (url === "https://api.stripe.com/v1/customers/cus_deleted") {
      return Response.json({ id: "cus_deleted", deleted: true });
    }
    if (url === "https://api.stripe.com/v1/customers/cus_ok") {
      return Response.json({ id: "cus_ok" });
    }
    throw new Error(`unexpected fetch: ${url}`);
  }, async () => {
    assertEquals(await stripeCustomerExists("cus_missing", "sk_live_x"), false);
    assertEquals(await stripeCustomerExists("cus_deleted", "sk_live_x"), false);
    assertEquals(await stripeCustomerExists("cus_ok", "sk_live_x"), true);
  });
});
