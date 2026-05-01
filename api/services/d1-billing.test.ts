import { assertEquals } from "https://deno.land/std@0.210.0/assert/assert_equals.ts";
import { assert } from "https://deno.land/std@0.210.0/assert/assert.ts";
import { chargeD1Overage } from "./d1-billing.ts";

Deno.test("D1 billing charges overage through debit_light instead of direct balance patch", async () => {
  const previousFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string; body: unknown }> = [];

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.toString()
      : input.url;
    const method = init?.method || "GET";
    const body = init?.body && typeof init.body === "string"
      ? JSON.parse(init.body)
      : null;
    calls.push({ url, method, body });

    if (url.includes("/rest/v1/users?")) {
      return new Response(JSON.stringify([{
        id: "user-d1",
        balance_light: 10,
        d1_rows_read_total: 52_000,
        d1_rows_written_total: 12_000,
        d1_storage_bytes: 1024,
      }]), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    if (url.includes("/rest/v1/rpc/debit_light")) {
      return new Response(JSON.stringify([{
        old_balance: 10,
        new_balance: 9.88,
        was_depleted: false,
        amount_debited: 0.12,
      }]), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    return new Response("unexpected request", { status: 500 });
  }) as typeof fetch;

  try {
    await chargeD1Overage("https://supabase.test", "service-role-key");

    const debit = calls.find((call) => call.url.includes("/rpc/debit_light"));
    assert(debit);
    assertEquals(debit.method, "POST");
    assertEquals((debit.body as { p_user_id?: string }).p_user_id, "user-d1");
    assertEquals((debit.body as { p_reason?: string }).p_reason, "d1_overage");
    assertEquals((debit.body as { p_allow_partial?: boolean }).p_allow_partial, true);
    assertEquals(
      (debit.body as { p_metadata?: { overage_reads?: number } }).p_metadata?.overage_reads,
      2_000,
    );
    assertEquals(calls.some((call) => call.url.includes("/rest/v1/users?id=")), false);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
