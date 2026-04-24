import { assertEquals } from "https://deno.land/std@0.210.0/assert/assert_equals.ts";
import {
  checkD1BalanceWithOptions,
  checkD1FreeTierWithOptions,
} from "./d1-metering.ts";

const TEST_ENV = {
  SUPABASE_URL: "https://supabase.test",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
};

async function withMockedEnvAndFetch(
  handler: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>,
  fn: () => Promise<void>,
): Promise<void> {
  const globalWithEnv = globalThis as typeof globalThis & { __env?: Record<string, unknown> };
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

Deno.test("D1 free-tier checks can fail closed when the backend is unavailable", async () => {
  await withMockedEnvAndFetch(
    async () => new Response("rpc unavailable", { status: 503 }),
    async () => {
      const result = await checkD1FreeTierWithOptions("user-1", {
        mode: "fail_closed",
        resource: "D1 free tier",
      });

      assertEquals(result.allowed, false);
      assertEquals(result.reason, "service_unavailable");
      assertEquals(result.withinFreeTier, false);
    },
  );
});

Deno.test("D1 balance checks stay fail-open by default for legacy callers", async () => {
  await withMockedEnvAndFetch(
    async () => new Response("rpc unavailable", { status: 503 }),
    async () => {
      const result = await checkD1BalanceWithOptions("user-2", {
        mode: "fail_open",
        resource: "D1 balance",
      });

      assertEquals(result.allowed, true);
      assertEquals(result.reason, "service_unavailable");
    },
  );
});
