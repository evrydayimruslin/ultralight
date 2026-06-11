import { assert } from "https://deno.land/std@0.210.0/assert/assert.ts";
import { assertEquals } from "https://deno.land/std@0.210.0/assert/assert_equals.ts";

import { completeJob } from "./async-jobs.ts";

const TEST_ENV = {
  SUPABASE_URL: "https://supabase.test",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
};

// Captured PATCH bodies, appended by the mocked fetch. Reading via an array
// avoids TS control-flow narrowing closures can't see through.
async function withMockedDb<T>(
  handler: (url: URL, init: RequestInit | undefined) => Response,
  fn: () => Promise<T>,
): Promise<T> {
  const previousEnv = globalThis.__env;
  const previousFetch = globalThis.fetch;
  globalThis.__env = {
    ...(previousEnv || {}),
    ...TEST_ENV,
  } as typeof globalThis.__env;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    return Promise.resolve(handler(url, init));
  }) as typeof fetch;
  try {
    return await fn();
  } finally {
    globalThis.__env = previousEnv;
    globalThis.fetch = previousFetch;
  }
}

Deno.test("completeJob: a successful execution writes status completed", async () => {
  const bodies: Record<string, unknown>[] = [];
  await withMockedDb(
    (url, init) => {
      assert(url.pathname.includes("/rest/v1/async_jobs"));
      bodies.push(JSON.parse(String(init?.body)));
      return new Response("[]", { status: 200 });
    },
    () =>
      completeJob("job-1", {
        success: true,
        result: { ok: true },
        logs: [],
        durationMs: 1200,
        aiCostLight: 0.4,
      }),
  );
  assert(bodies.length === 1);
  assertEquals(bodies[0].status, "completed");
  assertEquals(bodies[0].error, null);
  assertEquals(bodies[0].ai_cost_light, 0.4);
});

Deno.test("completeJob: a FAILED execution writes status failed with a {type,message} error", async () => {
  const bodies: Record<string, unknown>[] = [];
  await withMockedDb(
    (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response("[]", { status: 200 });
    },
    () =>
      completeJob("job-2", {
        success: false,
        // executeAppFunction passes result.error here on failure.
        result: { type: "AbortError", message: "Execution timed out" },
        logs: [{ level: "error", message: "boom" }],
        durationMs: 120_000,
        aiCostLight: 1.2,
      }),
  );
  assert(bodies.length === 1);
  assertEquals(bodies[0].status, "failed");
  assertEquals(bodies[0].result, null);
  assertEquals(bodies[0].error, {
    type: "AbortError",
    message: "Execution timed out",
  });
  // Spend that happened before the failure stays on the row.
  assertEquals(bodies[0].ai_cost_light, 1.2);
});

Deno.test("completeJob: failure with a non-object error payload still lands {type,message}", async () => {
  const bodies: Record<string, unknown>[] = [];
  await withMockedDb(
    (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response("[]", { status: 200 });
    },
    () =>
      completeJob("job-3", {
        success: false,
        result: null,
        logs: [],
        durationMs: 50,
        aiCostLight: 0,
      }),
  );
  assert(bodies.length === 1);
  assertEquals(bodies[0].status, "failed");
  assertEquals(bodies[0].error, {
    type: "ExecutionError",
    message: "Execution failed",
  });
});
