import { assertEquals } from "https://deno.land/std@0.210.0/assert/assert_equals.ts";
import { assertStringIncludes } from "https://deno.land/std@0.210.0/assert/assert_string_includes.ts";
import { runOriginalityCheck } from "./originality.ts";

const TEST_ENV = {
  SUPABASE_URL: "https://supabase.test",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
};

async function withMockedEnvAndFetch(
  env: Record<string, unknown>,
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
    ...env,
  };
  globalThis.fetch = handler as typeof fetch;

  try {
    await fn();
  } finally {
    globalThis.fetch = previousFetch;
    globalWithEnv.__env = previousEnv;
  }
}

const FILES = [{
  name: "index.ts",
  content: "export function hello() { return 'world'; }",
}];

Deno.test("runOriginalityCheck fails closed when fingerprint lookup is unavailable in strict mode", async () => {
  await withMockedEnvAndFetch(
    TEST_ENV,
    async () => new Response("db unavailable", { status: 503 }),
    async () => {
      const result = await runOriginalityCheck(
        "user_1",
        "app_1",
        FILES,
        [0.1, 0.2, 0.3],
        { mode: "fail_closed" },
      );

      assertEquals(result.passed, false);
      assertEquals(result.status, "service_unavailable");
      assertStringIncludes(result.reason || "", "Originality check unavailable");
    },
  );
});

Deno.test("runOriginalityCheck can stay best-effort when fingerprint lookup is unavailable", async () => {
  await withMockedEnvAndFetch(
    TEST_ENV,
    async () => new Response("db unavailable", { status: 503 }),
    async () => {
      const result = await runOriginalityCheck(
        "user_2",
        "app_2",
        FILES,
        [0.1, 0.2, 0.3],
        { mode: "best_effort" },
      );

      assertEquals(result.passed, true);
      assertEquals(result.status, "passed");
    },
  );
});

Deno.test("runOriginalityCheck fails closed when no embedding service is available in strict mode", async () => {
  await withMockedEnvAndFetch(
    TEST_ENV,
    async (input) => {
      const url = String(input);
      if (url.includes("/rest/v1/apps?")) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/rpc/check_seller_relist")) {
        return new Response("false", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    },
    async () => {
      const result = await runOriginalityCheck(
        "user_3",
        "app_3",
        FILES,
        undefined,
        { mode: "fail_closed" },
      );

      assertEquals(result.passed, false);
      assertEquals(result.status, "service_unavailable");
      assertStringIncludes(result.reason || "", "Embedding service is not available");
    },
  );
});
