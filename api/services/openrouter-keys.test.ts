import { assert } from "https://deno.land/std@0.210.0/assert/assert.ts";
import { assertEquals } from "https://deno.land/std@0.210.0/assert/assert_equals.ts";
import { assertRejects } from "https://deno.land/std@0.210.0/assert/assert_rejects.ts";
import { decryptApiKey, encryptApiKey } from "./api-key-crypto.ts";
import {
  getStoredOpenRouterKey,
  storeOpenRouterKey,
} from "./openrouter-keys.ts";
import { createUserService } from "./user.ts";

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

Deno.test("OpenRouter keys: decrypts encrypted platform-managed entries", async () => {
  await runSerial(async () => {
    let encryptedKey = "";
    const methods: string[] = [];

    await withMockedEnvAndFetch(async (_input, init) => {
      methods.push(init?.method || "GET");
      return jsonResponse([{
        byok_keys: {
          _platform_openrouter: {
            encrypted_key: encryptedKey,
            added_at: "2026-04-16T00:00:00Z",
            provisioned_at: "2026-04-16T00:00:00Z",
            managed_by_platform: true,
          },
        },
      }]);
    }, async () => {
      encryptedKey = await encryptApiKey("or-encrypted-key");
      const key = await getStoredOpenRouterKey("user-1");
      assertEquals(key, "or-encrypted-key");
    });

    assertEquals(methods, ["GET"]);
  });
});

Deno.test("OpenRouter keys: rejects legacy plaintext entries at runtime", async () => {
  await runSerial(async () => {
    const methods: string[] = [];

    await withMockedEnvAndFetch(async (_input, init) => {
      const method = init?.method || "GET";
      methods.push(method);

      return jsonResponse([{
        byok_keys: {
          openai: {
            encrypted_key: "keep-existing-provider",
            added_at: "2026-04-01T00:00:00Z",
          },
          _platform_openrouter: {
            key: "or-legacy-key",
            provisioned_at: "2026-04-15T00:00:00Z",
          },
        },
      }]);
    }, async () => {
      await assertRejects(
        () => getStoredOpenRouterKey("user-1"),
        Error,
        "Legacy plaintext OpenRouter key entry is unsupported at runtime",
      );
    });

    assertEquals(methods, ["GET"]);
  });
});

Deno.test("OpenRouter keys: storeOpenRouterKey persists encrypted platform-managed entry", async () => {
  await runSerial(async () => {
    let patchBody: Record<string, unknown> | null = null;

    await withMockedEnvAndFetch(async (_input, init) => {
      const method = init?.method || "GET";
      if (method === "PATCH") {
        patchBody = JSON.parse(String(init?.body));
        return new Response(null, { status: 204 });
      }

      return jsonResponse([{
        byok_keys: {
          anthropic: {
            encrypted_key: "existing-anthropic-key",
            added_at: "2026-04-01T00:00:00Z",
          },
        },
      }]);
    }, async () => {
      await storeOpenRouterKey("user-1", "or-new-platform-key");
      assert(patchBody !== null);
      const body = patchBody as {
        byok_keys: Record<string, Record<string, unknown>>;
      };
      const byokKeys = body.byok_keys;
      const storedEntry = byokKeys._platform_openrouter;
      assert(storedEntry !== undefined);
      assertEquals(typeof storedEntry.key, "undefined");
      assertEquals(storedEntry.managed_by_platform, true);
      assertEquals(
        await decryptApiKey(storedEntry.encrypted_key as string),
        "or-new-platform-key",
      );
      assertEquals(byokKeys.anthropic.encrypted_key, "existing-anthropic-key");
    });
  });
});

Deno.test("User service: hides internal platform-managed key from byok_configs", async () => {
  await runSerial(async () => {
    let openrouterKey = "";
    let platformKey = "";

    await withMockedEnvAndFetch(async () =>
      jsonResponse([{
        id: "user-1",
        email: "user@example.com",
        display_name: null,
        avatar_url: null,
        tier: "free",
        country: null,
        featured_app_id: null,
        profile_slug: null,
        byok_enabled: true,
        byok_provider: "openrouter",
        byok_keys: {
          openrouter: {
            encrypted_key: openrouterKey,
            model: "anthropic/claude-sonnet-4",
            added_at: "2026-04-10T00:00:00Z",
          },
          _platform_openrouter: {
            encrypted_key: platformKey,
            added_at: "2026-04-11T00:00:00Z",
            provisioned_at: "2026-04-11T00:00:00Z",
            managed_by_platform: true,
          },
        },
      }]), async () => {
      openrouterKey = await encryptApiKey("or-user-key");
      platformKey = await encryptApiKey("or-platform-key");
      const user = await createUserService().getUser("user-1");
      assert(user !== null);
      assertEquals(user.byok_configs.length, 1);
      assertEquals(user.byok_configs[0].provider, "openrouter");
      assertEquals(user.byok_configs[0].has_key, true);
      assertEquals(user.byok_configs[0].model, "anthropic/claude-sonnet-4");
    });
  });
});

Deno.test("User service: internal platform key does not count as BYOK-enabled state", async () => {
  await runSerial(async () => {
    let platformKey = "";

    await withMockedEnvAndFetch(async () =>
      jsonResponse([{
        id: "user-1",
        email: "user@example.com",
        display_name: null,
        avatar_url: null,
        tier: "free",
        country: null,
        featured_app_id: null,
        profile_slug: null,
        byok_enabled: true,
        byok_provider: "_platform_openrouter",
        byok_keys: {
          _platform_openrouter: {
            encrypted_key: platformKey,
            added_at: "2026-04-11T00:00:00Z",
            provisioned_at: "2026-04-11T00:00:00Z",
            managed_by_platform: true,
          },
        },
      }]), async () => {
      platformKey = await encryptApiKey("or-platform-key");
      const user = await createUserService().getUser("user-1");
      assert(user !== null);
      assertEquals(user.byok_enabled, false);
      assertEquals(user.byok_provider, null);
      assertEquals(user.byok_configs.length, 0);
    });
  });
});
