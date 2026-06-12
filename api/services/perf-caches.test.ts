// PR5 hot-path caches — these tests ARE the round-trip measurement: each one
// pins how many network calls a hot path is allowed to make in the steady
// state, so a regression that re-adds a per-request read fails loudly.

import { assert } from "https://deno.land/std@0.210.0/assert/assert.ts";
import { assertEquals } from "https://deno.land/std@0.210.0/assert/assert_equals.ts";

import {
  getBillingConfig,
  invalidateBillingConfigCache,
} from "./billing-config.ts";
import { authenticateRequest } from "./request-auth.ts";
import { getUserFromToken, revokeToken } from "./tokens.ts";
import { rebuildEntityIndex } from "./entity-index.ts";

const TEST_ENV = {
  SUPABASE_URL: "https://supabase.test",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
};

interface SeenRequest {
  method: string;
  url: URL;
}

async function withMockedFetch<T>(
  handler: (url: URL, init: RequestInit | undefined) => Response | null,
  fn: () => Promise<T>,
  envExtras: Record<string, unknown> = {},
): Promise<{ result: T; requests: SeenRequest[] }> {
  const previousEnv = globalThis.__env;
  const previousFetch = globalThis.fetch;
  const requests: SeenRequest[] = [];
  globalThis.__env = {
    ...(previousEnv || {}),
    ...TEST_ENV,
    ...envExtras,
  } as typeof globalThis.__env;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(
      input instanceof Request ? input.url : String(input),
    );
    const method = input instanceof Request
      ? input.method
      : (init?.method ?? "GET");
    requests.push({ method, url });
    const response = handler(url, init);
    return Promise.resolve(response ?? new Response("[]", { status: 200 }));
  }) as typeof fetch;
  try {
    return { result: await fn(), requests };
  } finally {
    globalThis.__env = previousEnv;
    globalThis.fetch = previousFetch;
  }
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ── billing-config cache ────────────────────────────────────────────────────

const BILLING_ROW = { id: "singleton", version: 3, platform_fee_rate: 0.1 };

Deno.test("billing config: one fetch serves repeated reads within the TTL", async () => {
  invalidateBillingConfigCache();
  const { requests } = await withMockedFetch(
    () => jsonResponse([BILLING_ROW]),
    async () => {
      const first = await getBillingConfig();
      const second = await getBillingConfig();
      assertEquals(first.version, 3);
      assertEquals(second.version, 3);
    },
  );
  assertEquals(requests.length, 1);
  invalidateBillingConfigCache();
});

Deno.test("billing config: callers cannot poison the shared cache", async () => {
  invalidateBillingConfigCache();
  await withMockedFetch(
    () => jsonResponse([BILLING_ROW]),
    async () => {
      const first = await getBillingConfig();
      (first as { platformFeeRate: number }).platformFeeRate = 0.99;
      const second = await getBillingConfig();
      assert(second.platformFeeRate !== 0.99);
    },
  );
  invalidateBillingConfigCache();
});

Deno.test("billing config: invalidation forces a fresh read (admin update hook)", async () => {
  invalidateBillingConfigCache();
  const { requests } = await withMockedFetch(
    () => jsonResponse([BILLING_ROW]),
    async () => {
      await getBillingConfig();
      invalidateBillingConfigCache();
      await getBillingConfig();
    },
  );
  assertEquals(requests.length, 2);
  invalidateBillingConfigCache();
});

Deno.test("billing config: error responses are never cached", async () => {
  invalidateBillingConfigCache();
  let failing = true;
  const { requests } = await withMockedFetch(
    () => failing ? new Response("down", { status: 500 }) : jsonResponse([BILLING_ROW]),
    async () => {
      const fallback = await getBillingConfig();
      // Fallback defaults served, but the failure must not stick.
      assert(fallback.version !== 3);
      failing = false;
      const live = await getBillingConfig();
      assertEquals(live.version, 3);
    },
  );
  assertEquals(requests.length, 2);
  invalidateBillingConfigCache();
});

// ── supabase-bearer auth chain ──────────────────────────────────────────────

function bearerRequest(): Request {
  return new Request("https://api.test/mcp/platform", {
    headers: { Authorization: "Bearer supabase-jwt-token" },
  });
}

Deno.test("auth chain: steady state is auth verify + ONE users read (id,tier)", async () => {
  const { result, requests } = await withMockedFetch(
    (url) => {
      if (url.pathname === "/auth/v1/user") {
        return jsonResponse({ id: "user-1", email: "u@example.com" });
      }
      if (url.pathname.endsWith("/rest/v1/users")) {
        return jsonResponse([{ id: "user-1", tier: "pro" }]);
      }
      return null;
    },
    () => authenticateRequest(bearerRequest(), "bearer_only"),
  );
  assertEquals(result.tier, "pro");
  assertEquals(result.authSource, "supabase");
  // The whole chain: token verify + merged id+tier read. No existence check,
  // no per-request pending-permissions sweep, no separate tier read.
  assertEquals(requests.length, 2);
  const usersRead = requests[1];
  assertEquals(usersRead.url.searchParams.get("select"), "id,tier");
});

Deno.test("auth chain: first contact provisions the account and defaults tier", async () => {
  let userRowExists = false;
  const { result, requests } = await withMockedFetch(
    (url, init) => {
      const method = init?.method ?? "GET";
      if (url.pathname === "/auth/v1/user") {
        return jsonResponse({ id: "user-new", email: "new@example.com" });
      }
      if (url.pathname.endsWith("/rest/v1/users") && method === "GET") {
        return jsonResponse(userRowExists ? [{ id: "user-new" }] : []);
      }
      if (url.pathname.endsWith("/rest/v1/users") && method === "POST") {
        userRowExists = true;
        return new Response(null, { status: 201 });
      }
      if (url.pathname.endsWith("/rest/v1/pending_permissions")) {
        return jsonResponse([]);
      }
      return null;
    },
    () => authenticateRequest(bearerRequest(), "bearer_only"),
  );
  assertEquals(result.tier, "free");
  // The miss path ran the full first-contact provisioning (insert).
  assert(
    requests.some((r) =>
      r.method === "POST" && r.url.pathname.endsWith("/rest/v1/users")
    ),
    "expected the first-contact user insert",
  );
});

// ── api-token verdict cache ─────────────────────────────────────────────────

// sanitizeOps off: tokens.ts lazily creates a module-cached supabase-js
// client whose auth component starts a refresh interval — a process-lifetime
// singleton, not a per-test leak.
Deno.test({
  name:
    "api-token verdict cache: hit serves from memory, revoke invalidates, failures never cached",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
  const token = "ul_abcdef0123456789abcdef0123456789";
  // Build a row whose canonical HMAC hash matches the token.
  const salt = "salt-123";
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(salt),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(token),
  );
  const tokenHash = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const tokenRow = {
    id: "tok-1",
    user_id: "user-1",
    token_hash: tokenHash,
    token_salt: salt,
    plaintext_token: null,
    scopes: ["*"],
    app_ids: null,
    function_names: null,
    expires_at: null,
  };
  const userRow = {
    id: "user-1",
    email: "u@example.com",
    tier: "pro",
    provisional: false,
    last_active_at: null,
  };

  // One mock session for the whole flow: the supabase-js client captures
  // fetch at first creation, so every step must run under the same mock.
  await withMockedFetch(
    (url, init) => {
      const method = init?.method ?? "GET";
      if (url.pathname.endsWith("/rest/v1/user_api_tokens")) {
        if (method === "GET") return jsonResponse(tokenRow);
        // last_used bump (PATCH) and revoke (DELETE)
        return new Response(null, { status: 204 });
      }
      if (url.pathname.endsWith("/rest/v1/users")) {
        return jsonResponse(userRow);
      }
      return null;
    },
    async () => {
      const countNetwork = (reqs: SeenRequest[]) => reqs.length;
      // Miss: full verification (token row + user row + last_used bump).
      const first = await getUserFromToken(token);
      assertEquals(first?.id, "user-1");
      assertEquals(first?.tier, "pro");
      return;
    },
  );

  // Step 2 in a fresh mock so request counting is isolated; the verdict is
  // already cached from step 1 — zero network.
  const second = await withMockedFetch(
    () => null,
    () => getUserFromToken(token),
  );
  assertEquals(second.result?.id, "user-1");
  assertEquals(second.requests.length, 0);

  // Step 3: revoke evicts; the next lookup verifies over the network again.
  await withMockedFetch(
    (url, init) => {
      if ((init?.method ?? "GET") === "DELETE") {
        return new Response(null, { status: 204 });
      }
      return null;
    },
    () => revokeToken("user-1", "tok-1"),
  );
  const third = await withMockedFetch(
    (url, init) => {
      const method = init?.method ?? "GET";
      if (url.pathname.endsWith("/rest/v1/user_api_tokens")) {
        if (method === "GET") return jsonResponse(tokenRow);
        return new Response(null, { status: 204 });
      }
      if (url.pathname.endsWith("/rest/v1/users")) {
        return jsonResponse(userRow);
      }
      return null;
    },
    () => getUserFromToken(token),
  );
  assertEquals(third.result?.id, "user-1");
  assert(third.requests.length > 0, "revoke must force re-verification");

  // Step 4: an invalid token is never cached.
  const badToken = "ul_ffffffffffffffffffffffffffffffff";
  const miss1 = await withMockedFetch(
    (url, init) => {
      if (
        url.pathname.endsWith("/rest/v1/user_api_tokens") &&
        (init?.method ?? "GET") === "GET"
      ) {
        // PostgREST .single() with no row → error payload.
        return jsonResponse({ message: "no rows" }, 406);
      }
      return null;
    },
    () => getUserFromToken(badToken),
  );
  assertEquals(miss1.result, null);
  const miss2 = await withMockedFetch(
    (url, init) => {
      if (
        url.pathname.endsWith("/rest/v1/user_api_tokens") &&
        (init?.method ?? "GET") === "GET"
      ) {
        return jsonResponse({ message: "no rows" }, 406);
      }
      return null;
    },
    () => getUserFromToken(badToken),
  );
    assertEquals(miss2.result, null);
    assert(miss2.requests.length > 0, "failed verdicts must not be cached");
  },
});

// ── entity-index rebuild debounce ───────────────────────────────────────────

Deno.test("entity index: a rebuild within the debounce window is skipped entirely", async () => {
  const kvStore = new Map<string, string>();
  const kv = {
    get: (key: string) => Promise.resolve(kvStore.get(key) ?? null),
    put: (key: string, value: string) => {
      kvStore.set(key, value);
      return Promise.resolve();
    },
  };
  const userId = `debounce-user-${crypto.randomUUID()}`;

  const first = await withMockedFetch(
    (url) =>
      url.pathname.endsWith("/rest/v1/apps") ? jsonResponse([]) : null,
    () => rebuildEntityIndex(userId),
    { FN_INDEX: kv },
  );
  assert(first.result !== null, "first rebuild must run");
  assert(first.requests.length > 0);
  assert(
    kvStore.has(`entities-rebuilt:${userId}`),
    "successful rebuild must stamp the debounce timestamp",
  );

  const second = await withMockedFetch(
    () => null,
    () => rebuildEntityIndex(userId),
    { FN_INDEX: kv },
  );
  assertEquals(second.result, null);
  assertEquals(second.requests.length, 0);
});
