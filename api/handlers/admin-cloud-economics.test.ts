import { assertEquals } from "https://deno.land/std@0.210.0/assert/assert_equals.ts";
import { invalidateBillingConfigCache } from "../services/billing-config.ts";

import { handleAdmin } from "./admin.ts";

interface AdminCloudEconomicsTestResponse {
  success: boolean;
  billing_config: { platform_fee_rate: number };
  cloud_usage: {
    total_events: number;
    total_cloud_units: number;
    total_light: number;
    by_resource: Record<string, { cloud_units: number; units: number }>;
  };
  call_receipts: {
    total: number;
    app_charge_light: number;
    infra_light: number;
    total_light: number;
    platform_fee_light: number;
    developer_net_light: number;
  };
  policy: { cloud_unit_rate: string };
}

const TEST_ENV = {
  SUPABASE_URL: "https://supabase.test",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
};

async function withAdminMocks<T>(fn: () => Promise<T>): Promise<T> {
  // Billing config is cached in-isolate (60s); each test mocks its own
  // config, so the cache must not carry state across tests/files.
  invalidateBillingConfigCache();
  const previousFetch = globalThis.fetch;
  const previousEnv = globalThis.__env;
  globalThis.__env = {
    ...(previousEnv || {}),
    ...TEST_ENV,
  } as typeof globalThis.__env;

  globalThis.fetch = (async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/rest/v1/platform_billing_config") {
      return Response.json([{
        id: "singleton",
        version: 25,
        platform_fee_rate: 0.15,
        cloud_unit_light_per_1k: 1,
        worker_ms_per_cloud_unit: 250,
        d1_read_rows_per_cloud_unit: 100,
        d1_write_rows_per_cloud_unit: 1,
        r2_ops_per_cloud_unit: 1,
        kv_ops_per_cloud_unit: 1,
        widget_pulls_per_cloud_unit: 1,
        storage_free_bytes: 104857600,
        storage_light_per_gb_month: 100,
      }]);
    }
    if (url.pathname === "/rest/v1/cloud_usage_events") {
      return Response.json([
        {
          id: "event-worker",
          created_at: "2026-05-05T12:00:00Z",
          payer_user_id: "user-1",
          sponsor_user_id: null,
          caller_user_id: "user-1",
          owner_user_id: "owner-1",
          app_id: "app-1",
          function_name: "search",
          receipt_id: "receipt-1",
          source: "tools/call",
          resource: "worker_execution",
          units: 300,
          cloud_units: 2,
          amount_light: 0.002,
          billing_config_version: 25,
        },
        {
          id: "event-r2",
          created_at: "2026-05-05T12:00:01Z",
          payer_user_id: "user-1",
          sponsor_user_id: null,
          caller_user_id: "user-1",
          owner_user_id: "owner-1",
          app_id: "app-1",
          function_name: "search",
          receipt_id: "receipt-1",
          source: "tools/call",
          resource: "r2_operation",
          units: 1,
          cloud_units: 1,
          amount_light: 0.001,
          billing_config_version: 25,
        },
      ]);
    }
    if (url.pathname === "/rest/v1/mcp_call_logs") {
      return Response.json([{
        id: "receipt-1",
        created_at: "2026-05-05T12:00:02Z",
        app_id: "app-1",
        app_name: "Receipt App",
        method: "tools/call",
        source: "direct",
        success: true,
        call_charge_light: 10,
        app_price_light: 10,
        app_charge_light: 10,
        infra_charge_light: 0.002,
        platform_fee_light: 1.5,
        developer_net_light: 8.5,
        cloud_units: 2,
        cloud_charge_light: 0.002,
        cloud_owner_sponsored: false,
        free_call: false,
      }]);
    }
    return Response.json([]);
  }) as typeof fetch;

  try {
    return await fn();
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.__env = previousEnv;
  }
}

Deno.test("admin cloud economics: summarizes cloud usage and call receipt economics", async () => {
  await withAdminMocks(async () => {
    const response = await handleAdmin(
      new Request("https://example.com/api/admin/cloud-economics?days=7", {
        headers: { Authorization: "Bearer service-role-key" },
      }),
    );
    assertEquals(response.status, 200);
    const body = await response.json() as AdminCloudEconomicsTestResponse;

    assertEquals(body.success, true);
    assertEquals(body.billing_config.platform_fee_rate, 0.15);
    assertEquals(body.cloud_usage.total_events, 2);
    assertEquals(body.cloud_usage.total_cloud_units, 3);
    assertEquals(body.cloud_usage.total_light, 0.003);
    assertEquals(body.cloud_usage.by_resource.worker_execution.cloud_units, 2);
    assertEquals(body.cloud_usage.by_resource.r2_operation.units, 1);
    assertEquals(body.call_receipts.total, 1);
    assertEquals(body.call_receipts.app_charge_light, 10);
    assertEquals(body.call_receipts.infra_light, 0.003);
    assertEquals(body.call_receipts.total_light, 10.003);
    assertEquals(body.call_receipts.platform_fee_light, 1.5);
    assertEquals(body.call_receipts.developer_net_light, 8.5);
    assertEquals(body.policy.cloud_unit_rate, "✦1 / 1,000 cloud units");
  });
});
