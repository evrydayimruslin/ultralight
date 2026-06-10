import { assertEquals } from "https://deno.land/std@0.210.0/assert/assert_equals.ts";
import { assertRejects } from "https://deno.land/std@0.210.0/assert/assert_rejects.ts";
import { CloudUsageRpcError } from "./cloud-usage.ts";
import { createD1DataService } from "./d1-data.ts";

const TEST_ENV = {
  CF_ACCOUNT_ID: "cf-account",
  CF_API_TOKEN: "cf-token",
  SUPABASE_URL: "https://supabase.example",
  SUPABASE_SERVICE_ROLE_KEY: "service-role",
};

async function withMockedEnv<T>(fn: () => Promise<T>): Promise<T> {
  const previousEnv = globalThis.__env;
  globalThis.__env = {
    ...(previousEnv || {}),
    ...TEST_ENV,
  } as typeof globalThis.__env;

  try {
    return await fn();
  } finally {
    globalThis.__env = previousEnv;
  }
}

Deno.test("D1 data service debits read and write rows after successful queries", async () => {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];

  await withMockedEnv(async () => {
    const fetchFn = ((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
        ? input.toString()
        : input.url;
      const body = init?.body && typeof init.body === "string"
        ? JSON.parse(init.body)
        : {};
      calls.push({ url, body });

      if (url.includes("/d1/database/db-1/query")) {
        return Promise.resolve(Response.json({
          success: true,
          errors: [],
          result: [{
            success: true,
            results: [{ id: "row-1" }],
            meta: {
              changes: 2,
              last_row_id: 12,
              duration: 1,
              rows_read: 125,
              rows_written: 2,
            },
          }],
        }));
      }

      if (url.endsWith("/rpc/debit_cloud_usage")) {
        return Promise.resolve(Response.json([{
          event_id: crypto.randomUUID(),
          old_balance: 10,
          new_balance: 9,
          amount_debited: Number(body.p_amount_light),
          deposit_debited: Number(body.p_amount_light),
          earned_debited: 0,
        }]));
      }

      return Promise.resolve(new Response("unexpected", { status: 500 }));
    }) as typeof fetch;

    const d1 = createD1DataService("app-1", "db-1", {
      operationMetering: {
        payerUserId: "00000000-0000-0000-0000-000000000101",
        callerUserId: "00000000-0000-0000-0000-000000000102",
        ownerUserId: "00000000-0000-0000-0000-000000000103",
        appId: "00000000-0000-0000-0000-000000000201",
        functionName: "save",
        receiptId: "receipt-d1-data",
        source: "run",
      },
      operationBillingConfig: {
        version: 11,
        cloudUnitLightPer1k: 1,
        d1ReadRowsPerCloudUnit: 100,
        d1WriteRowsPerCloudUnit: 1,
      },
      fetchFn,
    });

    const result = await d1.run(
      "update items set value = ? where user_id = ?",
      [
        "next",
        "user-1",
      ],
    );

    assertEquals(result.meta.rows_read, 125);
    assertEquals(result.meta.rows_written, 2);
    const debits = calls.filter((call) =>
      call.url.endsWith("/rpc/debit_cloud_usage")
    );
    assertEquals(debits.map((call) => call.body.p_resource), [
      "d1_read",
      "d1_write",
    ]);
    assertEquals(debits[0].body.p_cloud_units, 2);
    assertEquals(debits[0].body.p_amount_light, 0.002);
    assertEquals(debits[1].body.p_cloud_units, 2);
    assertEquals(debits[1].body.p_amount_light, 0.002);
    assertEquals(debits[0].body.p_metadata.service, "D1DataService");
    assertEquals(debits[0].body.p_metadata.sql_operation, "update");
  });
});

Deno.test("D1 data service surfaces debit failures after the D1 query reports usage", async () => {
  await withMockedEnv(async () => {
    const fetchFn = ((input: string | URL | Request) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
        ? input.toString()
        : input.url;

      if (url.includes("/d1/database/db-1/query")) {
        return Promise.resolve(Response.json({
          success: true,
          errors: [],
          result: [{
            success: true,
            results: [],
            meta: {
              changes: 0,
              last_row_id: 0,
              duration: 1,
              rows_read: 1,
              rows_written: 0,
            },
          }],
        }));
      }

      return Promise.resolve(
        new Response("Insufficient available balance", { status: 400 }),
      );
    }) as typeof fetch;

    const d1 = createD1DataService("app-1", "db-1", {
      operationMetering: {
        payerUserId: "00000000-0000-0000-0000-000000000101",
        source: "run",
      },
      fetchFn,
    });

    await assertRejects(
      () => d1.all("select * from items where user_id = ?", ["user-1"]),
      CloudUsageRpcError,
    );
  });
});
