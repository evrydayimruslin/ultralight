import { assert } from "https://deno.land/std@0.210.0/assert/assert.ts";
import { assertAlmostEquals } from "https://deno.land/std@0.210.0/assert/assert_almost_equals.ts";
import { assertEquals } from "https://deno.land/std@0.210.0/assert/assert_equals.ts";
import {
  calculateStorageAtRestCharge,
  processHostingBilling,
} from "./hosting-billing.ts";

const TEST_ENV = {
  SUPABASE_URL: "https://supabase.test",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
};

const USER_ID = "00000000-0000-0000-0000-000000000111";
const MIB = 1024 * 1024;
const GIB = 1024 * MIB;
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

let testQueue = Promise.resolve();

async function runSerial(fn: () => Promise<void>): Promise<void> {
  const run = testQueue.then(fn, fn);
  testQueue = run.catch(() => {});
  await run;
}

async function withMockedEnvAndFetch(
  handler: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>,
  fn: () => Promise<void>,
): Promise<void> {
  const globalWithEnv = globalThis as typeof globalThis & {
    __env?: Record<string, unknown>;
  };
  const previousEnv = globalWithEnv.__env;
  const previousFetch = globalThis.fetch;

  globalWithEnv.__env = {
    ...(previousEnv || {}),
    ...TEST_ENV,
  };
  globalThis.fetch = handler as typeof fetch;

  try {
    await fn();
  } finally {
    globalThis.fetch = previousFetch;
    globalWithEnv.__env = previousEnv;
  }
}

function billingConfigResponse(
  overrides: Record<string, unknown> = {},
): Response {
  return Response.json([{
    id: "singleton",
    version: 21,
    storage_free_bytes: 100 * MIB,
    storage_light_per_gb_month: 100,
    published_hosting_meter_enabled: false,
    ...overrides,
  }]);
}

Deno.test("storage billing math prorates GB-month over the free allowance", () => {
  const charge = calculateStorageAtRestCharge({
    combinedBytes: 200 * MIB,
    freeBytes: 100 * MIB,
    elapsedMs: MONTH_MS,
    storageLightPerGbMonth: 100,
  });

  assertEquals(charge.overageBytes, 100 * MIB);
  assertEquals(charge.storageGbMonths, (100 * MIB) / GIB);
  assertEquals(charge.amountLight, 9.765625);
});

Deno.test("storage billing debits exact storage-at-rest usage through cloud ledger", async () => {
  await runSerial(async () => {
    const calls: Array<
      { url: string; method: string; body: Record<string, unknown> }
    > = [];
    const lastBilledAt = new Date(Date.now() - MONTH_MS).toISOString();

    await withMockedEnvAndFetch(
      async (input, init) => {
        const url = String(input);
        const method = init?.method || "GET";
        const body = typeof init?.body === "string"
          ? JSON.parse(init.body)
          : {};
        calls.push({ url, method, body });

        if (url.includes("/platform_billing_config")) {
          return billingConfigResponse({
            version: 22,
            storage_light_per_gb_month: 125,
          });
        }

        if (url.includes("/rest/v1/users?or=")) {
          return Response.json([{
            id: USER_ID,
            balance_light: 100,
            hosting_last_billed_at: lastBilledAt,
            storage_used_bytes: 100 * MIB,
            data_storage_used_bytes: 50 * MIB,
            d1_storage_bytes: 10 * MIB,
            storage_limit_bytes: 100 * MIB,
          }]);
        }

        if (url.includes("/rest/v1/content?type=in.")) {
          return Response.json([]);
        }

        if (url.includes("/rest/v1/content?owner_id=eq.")) {
          return Response.json([
            { id: "content-1", type: "memory_md", size: MIB },
            { id: "content-2", type: "page", size: MIB },
          ]);
        }

        if (url.endsWith("/rest/v1/rpc/debit_cloud_usage")) {
          const amount = Number(body.p_amount_light);
          return Response.json([{
            event_id: "00000000-0000-0000-0000-000000000222",
            old_balance: 100,
            new_balance: 100 - amount,
            amount_debited: amount,
            deposit_debited: amount,
            earned_debited: 0,
          }]);
        }

        if (url.includes("/rest/v1/users?id=eq.") && method === "PATCH") {
          return new Response(null, { status: 204 });
        }

        if (url.endsWith("/rest/v1/billing_transactions")) {
          return new Response(null, { status: 204 });
        }

        throw new Error(`Unexpected fetch: ${method} ${url}`);
      },
      async () => {
        const result = await processHostingBilling();
        const debitCall = calls.find((call) =>
          call.url.endsWith("/rest/v1/rpc/debit_cloud_usage")
        );
        const txCall = calls.find((call) =>
          call.url.endsWith("/rest/v1/billing_transactions")
        );

        assertEquals(result.degraded, false);
        assertEquals(result.usersProcessed, 1);
        assert(debitCall);
        assertEquals(debitCall.body.p_resource, "storage_at_rest");
        assertEquals(debitCall.body.p_units, 62 * MIB);
        assertEquals(debitCall.body.p_billing_config_version, 22);
        assertEquals(
          (debitCall.body.p_metadata as Record<string, unknown>)
            .storage_light_per_gb_month,
          125,
        );
        assertEquals(
          (debitCall.body.p_metadata as Record<string, unknown>)
            .d1_storage_bytes,
          10 * MIB,
        );
        assertAlmostEquals(
          Number(debitCall.body.p_amount_light),
          Number(debitCall.body.p_cloud_units) * 125,
          1e-9,
        );
        assertAlmostEquals(
          result.totalChargedLight,
          Number(debitCall.body.p_amount_light),
          1e-9,
        );
        assert(txCall);
        assertEquals(txCall.body.category, "storage_at_rest");
        assertEquals(txCall.body.billing_config_version, 22);
        assertEquals(
          calls.some((call) => call.url.includes("/rpc/debit_light")),
          false,
        );
      },
    );
  });
});

Deno.test("storage billing advances clock without charging accounts under free tier", async () => {
  await runSerial(async () => {
    const calls: Array<
      { url: string; method: string; body: Record<string, unknown> }
    > = [];
    const lastBilledAt = new Date(Date.now() - MONTH_MS).toISOString();

    await withMockedEnvAndFetch(
      async (input, init) => {
        const url = String(input);
        const method = init?.method || "GET";
        const body = typeof init?.body === "string"
          ? JSON.parse(init.body)
          : {};
        calls.push({ url, method, body });

        if (url.includes("/platform_billing_config")) {
          return billingConfigResponse();
        }

        if (url.includes("/rest/v1/users?or=")) {
          return Response.json([{
            id: USER_ID,
            balance_light: 10,
            hosting_last_billed_at: lastBilledAt,
            storage_used_bytes: 40 * MIB,
            data_storage_used_bytes: 20 * MIB,
            d1_storage_bytes: 5 * MIB,
            storage_limit_bytes: 100 * MIB,
          }]);
        }

        if (url.includes("/rest/v1/content?type=in.")) {
          return Response.json([]);
        }

        if (url.includes("/rest/v1/content?owner_id=eq.")) {
          return Response.json([]);
        }

        if (url.includes("/rest/v1/users?id=eq.") && method === "PATCH") {
          return new Response(null, { status: 204 });
        }

        throw new Error(`Unexpected fetch: ${method} ${url}`);
      },
      async () => {
        const result = await processHostingBilling();
        const clockPatch = calls.find((call) =>
          call.url.includes("/rest/v1/users?id=eq.") && call.method === "PATCH"
        );

        assertEquals(result.usersProcessed, 1);
        assertEquals(result.totalChargedLight, 0);
        assert(clockPatch);
        assertEquals(
          calls.some((call) => call.url.includes("/rpc/debit_cloud_usage")),
          false,
        );
        assertEquals(
          calls.some((call) => call.url.includes("/rpc/debit_light")),
          false,
        );
      },
    );
  });
});

Deno.test("storage billing discovers content-only owners for reconciliation", async () => {
  await runSerial(async () => {
    const calls: Array<
      { url: string; method: string; body: Record<string, unknown> }
    > = [];
    const lastBilledAt = new Date(Date.now() - MONTH_MS).toISOString();

    await withMockedEnvAndFetch(
      async (input, init) => {
        const url = String(input);
        const method = init?.method || "GET";
        const body = typeof init?.body === "string"
          ? JSON.parse(init.body)
          : {};
        calls.push({ url, method, body });

        if (url.includes("/platform_billing_config")) {
          return billingConfigResponse();
        }

        if (url.includes("/rest/v1/users?or=")) {
          return Response.json([]);
        }

        if (url.includes("/rest/v1/content?type=in.")) {
          return Response.json([{ owner_id: USER_ID }]);
        }

        if (url.includes("/rest/v1/users?id=in.")) {
          return Response.json([{
            id: USER_ID,
            balance_light: 20,
            hosting_last_billed_at: lastBilledAt,
            storage_used_bytes: 0,
            data_storage_used_bytes: 0,
            d1_storage_bytes: 0,
            storage_limit_bytes: 100 * MIB,
          }]);
        }

        if (url.includes("/rest/v1/content?owner_id=eq.")) {
          return Response.json([
            { id: "content-1", type: "page", size: 150 * MIB },
          ]);
        }

        if (url.endsWith("/rest/v1/rpc/debit_cloud_usage")) {
          const amount = Number(body.p_amount_light);
          return Response.json([{
            event_id: "00000000-0000-0000-0000-000000000333",
            old_balance: 20,
            new_balance: 20 - amount,
            amount_debited: amount,
            deposit_debited: amount,
            earned_debited: 0,
          }]);
        }

        if (url.includes("/rest/v1/users?id=eq.") && method === "PATCH") {
          return new Response(null, { status: 204 });
        }

        if (url.endsWith("/rest/v1/billing_transactions")) {
          return new Response(null, { status: 204 });
        }

        throw new Error(`Unexpected fetch: ${method} ${url}`);
      },
      async () => {
        const result = await processHostingBilling();
        const debitCall = calls.find((call) =>
          call.url.endsWith("/rest/v1/rpc/debit_cloud_usage")
        );

        assertEquals(result.usersProcessed, 1);
        assert(debitCall);
        assertEquals(debitCall.body.p_units, 50 * MIB);
        assertEquals(
          (debitCall.body.p_metadata as Record<string, unknown>)
            .content_storage_bytes,
          150 * MIB,
        );
      },
    );
  });
});

Deno.test("storage billing suspends published content when overage has no balance", async () => {
  await runSerial(async () => {
    const calls: Array<
      { url: string; method: string; body: Record<string, unknown> }
    > = [];
    const lastBilledAt = new Date(Date.now() - MONTH_MS).toISOString();

    await withMockedEnvAndFetch(
      async (input, init) => {
        const url = String(input);
        const method = init?.method || "GET";
        const body = typeof init?.body === "string"
          ? JSON.parse(init.body)
          : {};
        calls.push({ url, method, body });

        if (url.includes("/platform_billing_config")) {
          return billingConfigResponse();
        }

        if (url.includes("/rest/v1/users?or=")) {
          return Response.json([{
            id: USER_ID,
            balance_light: 0,
            hosting_last_billed_at: lastBilledAt,
            storage_used_bytes: 200 * MIB,
            data_storage_used_bytes: 0,
            d1_storage_bytes: 0,
            storage_limit_bytes: 100 * MIB,
          }]);
        }

        if (url.includes("/rest/v1/content?type=in.")) {
          return Response.json([]);
        }

        if (url.includes("/rest/v1/content?owner_id=eq.") && method === "GET") {
          return Response.json([]);
        }

        if (
          (url.includes("/rest/v1/apps?owner_id=eq.") ||
            url.includes("/rest/v1/content?owner_id=eq.")) &&
          method === "PATCH"
        ) {
          return new Response(null, { status: 204 });
        }

        throw new Error(`Unexpected fetch: ${method} ${url}`);
      },
      async () => {
        const result = await processHostingBilling();

        assertEquals(result.usersSuspended, 1);
        assertEquals(result.totalChargedLight, 0);
        assertEquals(
          calls.some((call) => call.url.includes("/rpc/debit_cloud_usage")),
          false,
        );
        assertEquals(
          calls.filter((call) =>
            call.method === "PATCH" && call.body.hosting_suspended === true
          ).length,
          2,
        );
      },
    );
  });
});
