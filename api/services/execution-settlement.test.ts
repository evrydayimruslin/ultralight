import { assertEquals } from "https://deno.land/std@0.210.0/assert/assert_equals.ts";
import { assert } from "https://deno.land/std@0.210.0/assert/assert.ts";
import {
  buildExecutionTelemetry,
  logExecutionResult,
  settleCallerAppCharge,
} from "./execution-settlement.ts";

const TEST_ENV = {
  SUPABASE_URL: "https://supabase.test",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
};

async function withMockedEnv<T>(fn: () => Promise<T> | T): Promise<T> {
  const globalWithEnv = globalThis as typeof globalThis & { __env?: Record<string, unknown> };
  const previousEnv = globalWithEnv.__env;
  globalWithEnv.__env = {
    ...(previousEnv || {}),
    ...TEST_ENV,
  };

  try {
    return await fn();
  } finally {
    globalWithEnv.__env = previousEnv;
  }
}

function createTestApp(pricingConfig?: Record<string, unknown>) {
  return {
    id: "app_123",
    owner_id: "owner_123",
    slug: "test-app",
    name: "Test App",
    hosting_suspended: false,
    pricing_config: pricingConfig || null,
  } as any;
}

Deno.test("settleCallerAppCharge skips transfer when the call is still within the free tier", async () => {
  await withMockedEnv(async () => {
    const calls: string[] = [];
    const result = await settleCallerAppCharge({
      app: createTestApp({ default_price_light: 5, default_free_calls: 1 }),
      userId: "user_123",
      functionName: "search",
      inputArgs: { query: "hello" },
      successful: true,
    }, {
      fetchFn: async (input, init) => {
        const url = String(input);
        calls.push(url);
        if (url.includes("/rpc/increment_caller_usage")) {
          return new Response(JSON.stringify([{ call_count: 1 }]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      },
    });

    assertEquals(result.chargedLight, 0);
    assertEquals(result.insufficientBalance, false);
    assertEquals(calls.some(url => url.includes("/rpc/transfer_light")), false);
  });
});

Deno.test("settleCallerAppCharge reports insufficient balance when transfer RPC returns no rows", async () => {
  await withMockedEnv(async () => {
    const result = await settleCallerAppCharge({
      app: createTestApp({ default_price_light: 7 }),
      userId: "user_456",
      functionName: "search",
      inputArgs: { query: "world" },
      successful: true,
    }, {
      fetchFn: async (input, init) => {
        const url = String(input);
        if (url.includes("/rpc/transfer_light")) {
          const body = JSON.parse(String(init?.body));
          assertEquals(body.p_reason, "tool_call");
          assertEquals(body.p_app_id, "app_123");
          assertEquals(body.p_function_name, "search");
          return new Response(JSON.stringify([]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      },
    });

    assertEquals(result.chargedLight, 0);
    assertEquals(result.insufficientBalance, true);
  });
});

Deno.test("logExecutionResult records computed telemetry alongside the provided context", () => {
  let logged: Record<string, unknown> | null = null;
  logExecutionResult({
    userId: "user_789",
    appId: "app_123",
    appName: "Test App",
    functionName: "search",
    method: "tools/call",
    success: true,
    durationMs: 150,
    outputResult: { ok: true, value: 42 },
    callChargeLight: 3,
  }, {
    logMcpCallFn: (entry) => {
      logged = entry as unknown as Record<string, unknown>;
    },
  });

  assert(logged !== null);
  assertEquals(logged?.callChargeLight, 3);
  assertEquals(logged?.method, "tools/call");
  assert(typeof logged?.responseSizeBytes === "number");
  assert((logged?.responseSizeBytes as number) > 0);
  assert(typeof logged?.executionCostEstimateLight === "number");
});

Deno.test("buildExecutionTelemetry estimates size and cost from the serialized result", () => {
  const telemetry = buildExecutionTelemetry({ ok: true, items: [1, 2, 3] }, 250);

  assert(telemetry.responseSizeBytes > 0);
  assert(telemetry.executionCostEstimateLight > 0);
});
