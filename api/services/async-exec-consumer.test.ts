// processExecMessage: the queue-facing half of the at-most-once contract.
// Load-bearing cases: retry is ONLY allowed before the claim succeeds; once
// a job is claimed, every path acks (a crashed execution may already have
// settled — re-running it would double side-effects and billing).

import { assert } from "https://deno.land/std@0.210.0/assert/assert.ts";
import { assertEquals } from "https://deno.land/std@0.210.0/assert/assert_equals.ts";

import { processExecMessage } from "./async-exec-consumer.ts";

const TEST_ENV = {
  SUPABASE_URL: "https://supabase.test",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
};

interface SeenRequest {
  method: string;
  url: URL;
  body: Record<string, unknown> | null;
}

async function withMockedDb<T>(
  handler: (url: URL, init: RequestInit | undefined) => Response,
  fn: () => Promise<T>,
): Promise<{ result: T; requests: SeenRequest[] }> {
  const previousEnv = globalThis.__env;
  const previousFetch = globalThis.fetch;
  const requests: SeenRequest[] = [];
  globalThis.__env = {
    ...(previousEnv || {}),
    ...TEST_ENV,
  } as typeof globalThis.__env;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    let body: Record<string, unknown> | null = null;
    try {
      body = init?.body ? JSON.parse(String(init.body)) : null;
    } catch {
      body = null;
    }
    requests.push({ method: init?.method ?? "GET", url, body });
    return Promise.resolve(handler(url, init));
  }) as typeof fetch;
  try {
    return { result: await fn(), requests };
  } finally {
    globalThis.__env = previousEnv;
    globalThis.fetch = previousFetch;
  }
}

Deno.test("consumer: malformed message acks without touching the database", async () => {
  const { result, requests } = await withMockedDb(
    () => new Response("[]", { status: 200 }),
    async () => ({
      missing: await processExecMessage({ nope: true }),
      nonObject: await processExecMessage("job-1"),
      nullBody: await processExecMessage(null),
    }),
  );
  assertEquals(result, { missing: "ack", nonObject: "ack", nullBody: "ack" });
  assertEquals(requests.length, 0);
});

Deno.test("consumer: claim infra failure → retry (nothing has executed)", async () => {
  const { result } = await withMockedDb(
    () => new Response("db down", { status: 500 }),
    () => processExecMessage({ jobId: "job-1" }),
  );
  assertEquals(result, "retry");
});

Deno.test("consumer: duplicate delivery (claim returns nothing) → ack, no execution", async () => {
  const { result, requests } = await withMockedDb(
    () => new Response("[]", { status: 200 }),
    () => processExecMessage({ jobId: "job-1" }),
  );
  assertEquals(result, "ack");
  // Only the claim PATCH — the execution pipeline never starts.
  assertEquals(requests.length, 1);
  assertEquals(requests[0].method, "PATCH");
  assertEquals(requests[0].url.searchParams.get("status"), "eq.queued");
});

Deno.test("consumer: claimed job whose Agent is gone → failed row, ack (never retry post-claim)", async () => {
  const claimedRow = {
    id: "job-7",
    app_id: "11111111-1111-4111-8111-111111111111",
    user_id: "22222222-2222-4222-8222-222222222222",
    owner_id: "22222222-2222-4222-8222-222222222222",
    function_name: "slow_fn",
    status: "running",
    args: {},
    caller_app_id: null,
    caller_grant_id: null,
    hop: null,
    execution_id: "33333333-3333-4333-8333-333333333333",
    meta: {},
  };
  const { result, requests } = await withMockedDb(
    (url, init) => {
      const method = init?.method ?? "GET";
      if (method === "PATCH" && url.searchParams.get("status") === "eq.queued") {
        return new Response(JSON.stringify([claimedRow]), { status: 200 });
      }
      if (method === "GET" && url.pathname.endsWith("/rest/v1/apps")) {
        // The Agent was deleted after the job was queued.
        return new Response("[]", { status: 200 });
      }
      return new Response("[]", { status: 200 });
    },
    () => processExecMessage({ jobId: "job-7" }),
  );
  assertEquals(result, "ack");
  const failPatch = requests.find((r) =>
    r.method === "PATCH" &&
    r.url.searchParams.get("status") === "in.(queued,running)"
  );
  assert(failPatch, "expected a guarded failJobIfActive PATCH");
  assertEquals(failPatch.body?.status, "failed");
  assertEquals(
    (failPatch.body?.error as { type?: string } | undefined)?.type,
    "AppNotFound",
  );
});
