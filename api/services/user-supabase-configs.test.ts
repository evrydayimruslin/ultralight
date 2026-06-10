import { assertEquals } from "https://deno.land/std@0.210.0/assert/assert_equals.ts";

import {
  getDecryptedPlatformSupabase,
  getDecryptedSupabaseConfig,
  listSupabaseConfigs,
} from "./user-supabase-configs.ts";

Deno.test("user supabase configs: list maps saved configs into summaries", async () => {
  const configs = await listSupabaseConfigs("user-123", {
    env: {
      SUPABASE_URL: "https://supabase.test",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    },
    fetchFn: async () => new Response(JSON.stringify([
      {
        id: "cfg-1",
        name: "Primary",
        supabase_url: "https://db.example",
        service_key_encrypted: "enc-service",
        created_at: "2026-04-20T00:00:00.000Z",
      },
    ])),
  });

  assertEquals(configs, [
    {
      id: "cfg-1",
      name: "Primary",
      supabase_url: "https://db.example",
      has_service_key: true,
      created_at: "2026-04-20T00:00:00.000Z",
    },
  ]);
});

Deno.test("user supabase configs: decrypts anon and service keys", async () => {
  const config = await getDecryptedSupabaseConfig("cfg-1", {
    env: {
      SUPABASE_URL: "https://supabase.test",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    },
    fetchFn: async () => new Response(JSON.stringify([
      {
        supabase_url: "https://db.example",
        anon_key_encrypted: "enc-anon",
        service_key_encrypted: "enc-service",
      },
    ])),
    decryptEnvVarFn: async (value: string) => `dec:${value}`,
  });

  assertEquals(config, {
    url: "https://db.example",
    anonKey: "dec:enc-anon",
    serviceKey: "dec:enc-service",
  });
});

Deno.test("user supabase configs: platform lookup resolves the earliest saved config", async () => {
  const urls: string[] = [];
  const config = await getDecryptedPlatformSupabase("user-123", {
    env: {
      SUPABASE_URL: "https://supabase.test",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    },
    fetchFn: async (input) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("order=created_at.asc")) {
        return new Response(JSON.stringify([
          {
            id: "cfg-first",
            name: "Oldest",
            supabase_url: "https://db.example",
            service_key_encrypted: null,
            created_at: "2026-04-20T00:00:00.000Z",
          },
        ]));
      }

      return new Response(JSON.stringify([
        {
          supabase_url: "https://db.example",
          anon_key_encrypted: "enc-anon",
          service_key_encrypted: null,
        },
      ]));
    },
    decryptEnvVarFn: async (value: string) => `dec:${value}`,
  });

  assertEquals(urls.length, 2);
  assertEquals(urls[1].includes("cfg-first"), true);
  assertEquals(config, {
    url: "https://db.example",
    anonKey: "dec:enc-anon",
  });
});
