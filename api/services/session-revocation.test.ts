import { assertEquals } from "https://deno.land/std@0.210.0/assert/assert_equals.ts";
import { assertRejects } from "https://deno.land/std@0.210.0/assert/assert_rejects.ts";

import { revokeSupabaseSession } from "./session-revocation.ts";

const TEST_ENV = {
  SUPABASE_URL: "https://supabase.test",
  SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
};

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

Deno.test("session revocation: posts local logout to Supabase with bearer auth", async () => {
  await runSerial(async () => {
    let capturedUrl = "";
    let capturedAuth = "";
    let capturedApiKey = "";

    await withMockedEnvAndFetch(async (input, init) => {
      capturedUrl = String(input);
      capturedAuth = String((init?.headers as Record<string, string>).Authorization);
      capturedApiKey = String((init?.headers as Record<string, string>).apikey);
      return new Response(null, { status: 200 });
    }, async () => {
      const result = await revokeSupabaseSession("jwt-token", "local");
      assertEquals(result.revoked, true);
      assertEquals(result.ignored, false);
      assertEquals(capturedUrl, "https://supabase.test/auth/v1/logout?scope=local");
      assertEquals(capturedAuth, "Bearer jwt-token");
      assertEquals(capturedApiKey, "anon-key");
    });
  });
});

Deno.test("session revocation: missing token is ignored without calling Supabase", async () => {
  await runSerial(async () => {
    let fetchCalled = false;

    await withMockedEnvAndFetch(async () => {
      fetchCalled = true;
      return new Response(null, { status: 200 });
    }, async () => {
      const result = await revokeSupabaseSession("", "local");
      assertEquals(result.revoked, false);
      assertEquals(result.ignored, true);
      assertEquals(result.status, null);
      assertEquals(fetchCalled, false);
    });
  });
});

Deno.test("session revocation: expected auth errors are ignored", async () => {
  await runSerial(async () => {
    await withMockedEnvAndFetch(
      async () => new Response(null, { status: 401 }),
      async () => {
        const result = await revokeSupabaseSession("jwt-token", "local");
        assertEquals(result.revoked, false);
        assertEquals(result.ignored, true);
        assertEquals(result.status, 401);
      },
    );
  });
});

Deno.test("session revocation: unexpected failures bubble up", async () => {
  await runSerial(async () => {
    await withMockedEnvAndFetch(
      async () => new Response("boom", { status: 500 }),
      async () => {
        await assertRejects(
          () => revokeSupabaseSession("jwt-token", "local"),
          Error,
          "Supabase sign-out failed (500)",
        );
      },
    );
  });
});
