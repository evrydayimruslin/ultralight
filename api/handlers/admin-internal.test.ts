// Route-level CI gates for the owner-only internal-admin surface (Slice B.2).
// Asserts the defaults routes reject every non-owner caller and that the owner
// path performs the right registry reads/writes (add validates installability;
// remove soft-retires).

import { assert } from "https://deno.land/std@0.210.0/assert/assert.ts";
import { assertEquals } from "https://deno.land/std@0.210.0/assert/assert_equals.ts";
import { handleInternalAdmin } from "./admin-internal.ts";
import { createOwnerActorToken } from "../services/owner-auth.ts";

const SB = "https://supabase.test";
const OWNER = "11111111-1111-4111-8111-111111111111";
const NOT_OWNER = "22222222-2222-4222-8222-222222222222";
const SECRET = "owner-secret";
const APP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PRIVATE_APP = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

interface Call {
  method: string;
  url: string;
  body?: string;
}

async function withFetch(
  handler: (url: string, init?: RequestInit) => Response,
  fn: (calls: Call[]) => Promise<void>,
): Promise<void> {
  const g = globalThis as typeof globalThis & {
    __env?: Record<string, unknown>;
  };
  const prevEnv = g.__env;
  const prevFetch = globalThis.fetch;
  const calls: Call[] = [];
  g.__env = {
    ...(prevEnv || {}),
    SUPABASE_URL: SB,
    SUPABASE_SERVICE_ROLE_KEY: "svc",
    OWNER_ACTOR_TOKEN_SECRET: SECRET,
    PLATFORM_OWNER_USER_ID: OWNER,
  };
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      method: init?.method ?? "GET",
      url,
      body: init?.body ? String(init.body) : undefined,
    });
    return Promise.resolve(handler(url, init));
  }) as typeof fetch;
  try {
    await fn(calls);
  } finally {
    globalThis.fetch = prevFetch;
    g.__env = prevEnv;
  }
}

function req(
  method: string,
  path: string,
  token?: string,
  body?: unknown,
): Request {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  return new Request(`https://api.test${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

const noFetch = () => {
  throw new Error("auth must reject before any DB fetch");
};

Deno.test("internal-admin: rejects a request with no token (401)", async () => {
  await withFetch(noFetch, async () => {
    const res = await handleInternalAdmin(
      req("GET", "/api/admin/internal/defaults"),
    );
    assertEquals(res.status, 401);
  });
});

Deno.test("internal-admin: rejects a valid gxo_ token for a NON-owner (401)", async () => {
  await withFetch(noFetch, async () => {
    const { token } = await createOwnerActorToken({ userId: NOT_OWNER });
    const res = await handleInternalAdmin(
      req("GET", "/api/admin/internal/defaults", token),
    );
    assertEquals(res.status, 401);
  });
});

Deno.test("internal-admin: rejects a non-owner-actor bearer, e.g. a normal API token (401)", async () => {
  await withFetch(noFetch, async () => {
    const res = await handleInternalAdmin(
      req("GET", "/api/admin/internal/defaults", "gx_normal_api_token"),
    );
    assertEquals(res.status, 401);
  });
});

Deno.test("internal-admin: owner GET lists the registry with installability", async () => {
  await withFetch((url, init) => {
    const method = init?.method ?? "GET";
    if (url.includes("/rest/v1/platform_default_apps") && method === "GET") {
      return Response.json([
        {
          app_id: APP,
          badge: null,
          position: 0,
          enabled: true,
          removed_at: null,
          added_at: "2026-06-30T00:00:00Z",
        },
      ]);
    }
    if (url.includes("/rest/v1/apps") && method === "GET") {
      return Response.json([
        {
          id: APP,
          name: "Recipe Box",
          slug: "recipe-box",
          visibility: "public",
          deleted_at: null,
        },
      ]);
    }
    throw new Error(`unexpected ${method} ${url}`);
  }, async () => {
    const { token } = await createOwnerActorToken({ userId: OWNER });
    const res = await handleInternalAdmin(
      req("GET", "/api/admin/internal/defaults", token),
    );
    assertEquals(res.status, 200);
    const data = await res.json() as {
      defaults: Array<{ app_id: string; name: string; installable: boolean }>;
    };
    assertEquals(data.defaults.length, 1);
    assertEquals(data.defaults[0].app_id, APP);
    assertEquals(data.defaults[0].name, "Recipe Box");
    assertEquals(data.defaults[0].installable, true);
  });
});

Deno.test("internal-admin: owner POST adds an installable Agent, stamping added_by", async () => {
  await withFetch((url, init) => {
    const method = init?.method ?? "GET";
    if (url.includes(`/rest/v1/apps?id=eq.${APP}`) && method === "GET") {
      return Response.json([
        {
          id: APP,
          name: "Recipe Box",
          slug: "recipe-box",
          visibility: "public",
          deleted_at: null,
        },
      ]);
    }
    if (
      url.includes("/rest/v1/platform_default_apps?select=position") &&
      method === "GET"
    ) {
      return Response.json([{ position: 2 }]);
    }
    if (url.includes("/rest/v1/platform_default_apps") && method === "POST") {
      return Response.json([
        {
          app_id: APP,
          badge: "Starter",
          position: 3,
          enabled: true,
          removed_at: null,
          added_at: "2026-06-30T00:00:00Z",
        },
      ], { status: 201 });
    }
    throw new Error(`unexpected ${method} ${url}`);
  }, async (calls) => {
    const { token } = await createOwnerActorToken({ userId: OWNER });
    const res = await handleInternalAdmin(
      req("POST", "/api/admin/internal/defaults", token, {
        app_id: APP,
        badge: "Starter",
      }),
    );
    assertEquals(res.status, 201);
    const data = await res.json() as { default: { app_id: string; position: number } };
    assertEquals(data.default.app_id, APP);

    const upsert = calls.find((c) =>
      c.method === "POST" && c.url.includes("platform_default_apps")
    );
    assert(upsert);
    const body = JSON.parse(upsert!.body!);
    assertEquals(body.added_by, OWNER); // owner from the signed token, not the body
    assertEquals(body.enabled, true);
    assertEquals(body.removed_at, null);
    assertEquals(body.app_id, APP);
    assertEquals(body.position, 3);
  });
});

Deno.test("internal-admin: owner POST rejects a PRIVATE Agent (409), never upserts", async () => {
  await withFetch((url, init) => {
    const method = init?.method ?? "GET";
    if (url.includes(`/rest/v1/apps?id=eq.${PRIVATE_APP}`) && method === "GET") {
      return Response.json([
        {
          id: PRIVATE_APP,
          name: "Secret",
          slug: "secret",
          visibility: "private",
          deleted_at: null,
        },
      ]);
    }
    throw new Error(`unexpected ${method} ${url}`);
  }, async (calls) => {
    const { token } = await createOwnerActorToken({ userId: OWNER });
    const res = await handleInternalAdmin(
      req("POST", "/api/admin/internal/defaults", token, { app_id: PRIVATE_APP }),
    );
    assertEquals(res.status, 409);
    assertEquals(
      calls.some((c) =>
        c.method === "POST" && c.url.includes("platform_default_apps")
      ),
      false,
    );
  });
});

Deno.test("internal-admin: owner DELETE soft-retires a default", async () => {
  await withFetch((url, init) => {
    const method = init?.method ?? "GET";
    if (
      url.includes(`/rest/v1/platform_default_apps?app_id=eq.${APP}`) &&
      method === "PATCH"
    ) {
      return Response.json([
        {
          app_id: APP,
          badge: null,
          position: 0,
          enabled: false,
          removed_at: "2026-06-30T01:00:00Z",
          added_at: "2026-06-30T00:00:00Z",
        },
      ]);
    }
    throw new Error(`unexpected ${method} ${url}`);
  }, async (calls) => {
    const { token } = await createOwnerActorToken({ userId: OWNER });
    const res = await handleInternalAdmin(
      req("DELETE", `/api/admin/internal/defaults/${APP}`, token),
    );
    assertEquals(res.status, 200);
    const data = await res.json() as { removed: boolean };
    assertEquals(data.removed, true);
    const patch = calls.find((c) => c.method === "PATCH");
    assert(patch);
    const body = JSON.parse(patch!.body!);
    assertEquals(body.enabled, false);
    assert(typeof body.removed_at === "string");
  });
});
