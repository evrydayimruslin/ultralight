import { assert } from "https://deno.land/std@0.210.0/assert/assert.ts";
import { assertEquals } from "https://deno.land/std@0.210.0/assert/assert_equals.ts";
import {
  consumeDesktopOAuthSession,
  createDesktopOAuthSession,
  storeDesktopOAuthSessionToken,
} from "./desktop-oauth-sessions.ts";
import { decryptApiKey, encryptApiKey } from "./api-key-crypto.ts";

const TEST_ENV = {
  SUPABASE_URL: "https://supabase.test",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  BYOK_ENCRYPTION_KEY: "1234567890abcdef1234567890abcdef",
};

let testQueue = Promise.resolve();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

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

Deno.test("Desktop OAuth sessions: createDesktopOAuthSession persists durable session metadata", async () => {
  await runSerial(async () => {
    const calls: Array<{ method: string; url: string; body: Record<string, unknown> | null }> = [];

    await withMockedEnvAndFetch(async (input, init) => {
      const method = init?.method || "GET";
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      calls.push({ method, url, body });

      if (method === "POST") return new Response(null, { status: 201 });
      return new Response(null, { status: 204 });
    }, async () => {
      await createDesktopOAuthSession("session-1", "hashed-secret");
    });

    assertEquals(calls.length, 2);
    assertEquals(calls[0].method, "DELETE");
    assert(calls[0].url.includes("/rest/v1/desktop_oauth_sessions?expires_at=lte."));
    assertEquals(calls[1].method, "POST");
    assert(calls[1].url.includes("on_conflict=session_id"));
    assertEquals(calls[1].body?.session_id, "session-1");
    assertEquals(calls[1].body?.poll_secret_hash, "hashed-secret");
    assertEquals(calls[1].body?.access_token_encrypted, null);
    assertEquals(calls[1].body?.completed_at, null);
    assertEquals(typeof calls[1].body?.expires_at, "string");
  });
});

Deno.test("Desktop OAuth sessions: storeDesktopOAuthSessionToken encrypts at rest", async () => {
  await runSerial(async () => {
    let patchBody: Record<string, unknown> | null = null;

    await withMockedEnvAndFetch(async (_input, init) => {
      const method = init?.method || "GET";
      if (method === "PATCH") {
        patchBody = JSON.parse(String(init?.body));
        return jsonResponse([{ session_id: "session-1" }]);
      }

      return new Response(null, { status: 204 });
    }, async () => {
      const stored = await storeDesktopOAuthSessionToken("session-1", "sb-access-token");
      assertEquals(stored, true);

      assert(patchBody !== null);
      assertEquals(typeof patchBody?.completed_at, "string");
      assertEquals(
        await decryptApiKey(String(patchBody?.access_token_encrypted)),
        "sb-access-token",
      );
    });
  });
});

Deno.test("Desktop OAuth sessions: consumeDesktopOAuthSession requires matching poll secret for protected sessions", async () => {
  await runSerial(async () => {
    const expectedHash = await sha256Hex("desktop-secret");
    let deleteUrl = "";

    await withMockedEnvAndFetch(async (input, init) => {
      const method = init?.method || "GET";
      if (method === "DELETE") {
        deleteUrl = String(input);
        return jsonResponse([{
          access_token_encrypted: await encryptApiKey("sb-access-token"),
        }]);
      }

      return new Response(null, { status: 204 });
    }, async () => {
      const token = await consumeDesktopOAuthSession("session-1", "desktop-secret");
      assertEquals(token, "sb-access-token");
    });

    assert(deleteUrl.includes(`poll_secret_hash=eq.${expectedHash}`));
    assert(deleteUrl.includes("access_token_encrypted=not.is.null"));
  });
});

Deno.test("Desktop OAuth sessions: consumeDesktopOAuthSession supports legacy sessions without a poll secret", async () => {
  await runSerial(async () => {
    let deleteUrl = "";

    await withMockedEnvAndFetch(async (input, init) => {
      const method = init?.method || "GET";
      if (method === "DELETE") {
        deleteUrl = String(input);
        return jsonResponse([{
          access_token_encrypted: await encryptApiKey("legacy-access-token"),
        }]);
      }

      return new Response(null, { status: 204 });
    }, async () => {
      const token = await consumeDesktopOAuthSession("legacy-session");
      assertEquals(token, "legacy-access-token");
    });

    assert(deleteUrl.includes("poll_secret_hash=is.null"));
  });
});
