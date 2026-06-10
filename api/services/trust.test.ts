import { assert } from "https://deno.land/std@0.210.0/assert/assert.ts";
import { assertEquals } from "https://deno.land/std@0.210.0/assert/assert_equals.ts";

import {
  buildAppTrustCard,
  buildVersionMetadataEntry,
  buildVersionTrustMetadata,
  diffManifests,
  generateGpuManifest,
} from "./trust.ts";

async function withTrustEnv<T>(fn: () => Promise<T> | T): Promise<T> {
  const globalWithEnv = globalThis as typeof globalThis & { __env?: Record<string, unknown> };
  const previousEnv = globalWithEnv.__env;
  globalWithEnv.__env = {
    ...(previousEnv || {}),
    LIGHT_TRUST_SIGNING_SECRET: "test-trust-secret",
    SUPABASE_SERVICE_ROLE_KEY: "fallback-service-key",
  };
  try {
    return await fn();
  } finally {
    globalWithEnv.__env = previousEnv;
  }
}

Deno.test("trust: signs manifest and artifacts for a version", async () => {
  await withTrustEnv(async () => {
    const manifest = {
      name: "Trust Test",
      version: "1.0.0",
      type: "mcp" as const,
      entry: { functions: "index.ts" },
      permissions: ["ai:call", "storage:read"],
      env: {
        API_KEY: { required: true, scope: "per_user" as const },
      },
      functions: {
        ask: { description: "Ask a question" },
      },
    };

    const trust = await buildVersionTrustMetadata({
      appId: "app-123",
      version: "1.0.0",
      runtime: "deno",
      manifest,
      storageKey: "apps/app-123/1.0.0/",
      files: [
        { name: "index.ts", content: "export function ask() {}" },
        { name: "manifest.json", content: JSON.stringify(manifest) },
      ],
    });

    assertEquals(trust.schema_version, 1);
    assertEquals(trust.permissions, ["ai:call", "storage:read"]);
    assertEquals(trust.required_secrets, ["API_KEY"]);
    assertEquals(trust.per_user_secrets, ["API_KEY"]);
    assertEquals(trust.signature.signer, "light-platform");
    assert(trust.manifest_hash);
    assert(trust.artifact_hash);
    assert(trust.artifact_hashes["index.ts"]);
  });
});

Deno.test("trust: builds a public trust card from current version metadata", async () => {
  await withTrustEnv(async () => {
    const manifest = generateGpuManifest({
      name: "GPU App",
      version: "1.0.0",
      description: "Runs GPU jobs",
      exports: ["segment", "embed"],
    });
    const trust = await buildVersionTrustMetadata({
      appId: "app-gpu",
      version: "1.0.0",
      runtime: "gpu",
      manifest,
      files: [{ name: "main.py", content: "def segment(input): return input" }],
    });

    const card = buildAppTrustCard({
      current_version: "1.0.0",
      runtime: "gpu",
      manifest: JSON.stringify(manifest),
      version_metadata: [buildVersionMetadataEntry("1.0.0", 42, trust)],
      visibility: "public",
      download_access: "owner",
      env_schema: {},
    } as any);

    assertEquals(card.signed_manifest, true);
    assertEquals(card.permissions, ["gpu:execute"]);
    assertEquals(card.capability_summary.gpu, true);
    assertEquals(card.execution_receipts.field, "receipt_id");
  });
});

Deno.test("trust: diffs manifest functions permissions and secrets", () => {
  const previous = {
    name: "Diff",
    version: "1",
    type: "mcp",
    entry: { functions: "index.ts" },
    permissions: ["ai:call"],
    env: { OLD_KEY: { required: true } },
    functions: { oldFn: { description: "old" }, changed: { description: "v1" } },
  };
  const next = {
    ...previous,
    version: "2",
    permissions: ["net:fetch"],
    env: { NEW_KEY: { required: true } },
    functions: { newFn: { description: "new" }, changed: { description: "v2" } },
  };

  const diff = diffManifests(previous, next);
  assertEquals(diff.functions.added, ["newFn"]);
  assertEquals(diff.functions.removed, ["oldFn"]);
  assertEquals(diff.functions.changed, ["changed"]);
  assertEquals(diff.permissions.added, ["net:fetch"]);
  assertEquals(diff.permissions.removed, ["ai:call"]);
  assertEquals(diff.secrets.added, ["NEW_KEY"]);
  assertEquals(diff.secrets.removed, ["OLD_KEY"]);
});
