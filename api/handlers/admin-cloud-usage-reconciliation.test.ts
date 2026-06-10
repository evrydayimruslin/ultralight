import { assertEquals } from "https://deno.land/std@0.210.0/assert/assert_equals.ts";

import { handleAdmin } from "./admin.ts";

interface AdminCloudUsageReconciliationTestResponse {
  success: boolean;
  period_days: number;
  sample_limit: number;
  scan_limit: number;
  metrics: {
    holds_created: number;
    events_recorded: number;
  };
}

const TEST_ENV = {
  SUPABASE_URL: "https://supabase.test",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
};

Deno.test("admin cloud usage reconciliation: returns read-only drift report", async () => {
  const previousFetch = globalThis.fetch;
  const previousEnv = globalThis.__env;
  globalThis.__env = {
    ...(previousEnv || {}),
    ...TEST_ENV,
  } as typeof globalThis.__env;

  globalThis.fetch = (async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/rest/v1/cloud_usage_holds") {
      return Response.json([]);
    }
    if (url.pathname === "/rest/v1/cloud_usage_events") {
      return Response.json([]);
    }
    throw new Error(`Unexpected fetch: ${url.toString()}`);
  }) as typeof fetch;

  try {
    const response = await handleAdmin(
      new Request(
        "https://example.com/api/admin/cloud-usage/reconciliation?days=3&limit=2&scan_limit=10",
        { headers: { Authorization: "Bearer service-role-key" } },
      ),
    );
    assertEquals(response.status, 200);
    const body = await response
      .json() as AdminCloudUsageReconciliationTestResponse;
    assertEquals(body.success, true);
    assertEquals(body.period_days, 3);
    assertEquals(body.sample_limit, 2);
    assertEquals(body.scan_limit, 10);
    assertEquals(body.metrics.holds_created, 0);
    assertEquals(body.metrics.events_recorded, 0);
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.__env = previousEnv;
  }
});
