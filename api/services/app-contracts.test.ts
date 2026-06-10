import { assertEquals } from "https://deno.land/std@0.210.0/assert/assert_equals.ts";
import { assertThrows } from "https://deno.land/std@0.210.0/assert/assert_throws.ts";

import {
  buildAppContractResolutionLogEntry,
  parseStoredSkillsParsed,
  requireManifestFunctionContracts,
  resolveAppFunctionContracts,
  type AppContractAppRecord,
} from "./app-contracts.ts";

function baseApp(overrides: Partial<AppContractAppRecord> = {}): AppContractAppRecord {
  return {
    id: "app-123",
    owner_id: "user-123",
    slug: "test-app",
    runtime: "edge",
    manifest: null,
    skills_parsed: null,
    exports: null,
    ...overrides,
  };
}

Deno.test("app contracts: manifest-backed contracts are canonical", () => {
  const resolution = resolveAppFunctionContracts(baseApp({
    manifest: JSON.stringify({
      name: "Test App",
      version: "1.0.0",
      type: "mcp",
      entry: { functions: "index.ts" },
      functions: {
        greet: {
          description: "Say hello",
          parameters: {
            name: { type: "string", required: true },
          },
        },
      },
    }),
  }));

  assertEquals(resolution.source, "manifest");
  assertEquals(resolution.manifestBacked, true);
  assertEquals(resolution.migrationRequired, false);
  assertEquals(resolution.functions.map((fn) => fn.name), ["greet"]);
});

Deno.test("app contracts: legacy skills_parsed records normalize array storage", () => {
  const parsed = parseStoredSkillsParsed([
    {
      name: "lookup",
      description: "Find a record",
      parameters: [
        { name: "query", type: "string", required: true },
      ],
    },
  ]);

  assertEquals(parsed?.functions[0]?.name, "lookup");
  assertEquals(parsed?.functions[0]?.parameters?.query?.type, "string");
});

Deno.test("app contracts: legacy skills can be exposed only when explicitly allowed", () => {
  const app = baseApp({
    skills_parsed: {
      functions: [
        {
          name: "lookup",
          description: "Find a record",
          parameters: { query: { type: "string", required: true } },
        },
      ],
      permissions: [],
    },
  });

  const blocked = resolveAppFunctionContracts(app);
  assertEquals(blocked.source, "none");
  assertEquals(blocked.legacySourceDetected, "skills_parsed");
  assertEquals(blocked.migrationRequired, true);

  const allowed = resolveAppFunctionContracts(app, { allowLegacySkills: true });
  assertEquals(allowed.source, "skills_parsed");
  assertEquals(allowed.functions.map((fn) => fn.name), ["lookup"]);
});

Deno.test("app contracts: gpu exports are separately classified", () => {
  const app = baseApp({
    runtime: "gpu",
    exports: ["infer"],
  });

  const blocked = resolveAppFunctionContracts(app);
  assertEquals(blocked.source, "none");
  assertEquals(blocked.legacySourceDetected, "gpu_exports");

  const allowed = resolveAppFunctionContracts(app, { allowGpuExports: true });
  assertEquals(allowed.source, "gpu_exports");
  assertEquals(allowed.functions.map((fn) => fn.name), ["infer"]);
});

Deno.test("app contracts: manifest requirement throws migration guidance for legacy apps", () => {
  assertThrows(
    () => requireManifestFunctionContracts(baseApp({
      exports: ["run"],
    })),
    Error,
    'manifest-backed version',
  );
});

Deno.test("app contracts: telemetry entries capture blocked legacy sources", () => {
  const entry = buildAppContractResolutionLogEntry({
    appId: "app-123",
    ownerId: "user-123",
    appSlug: "test-app",
    runtime: "edge",
    surface: "mcp_tools_list",
    source: "none",
    legacySourceDetected: "skills_parsed",
    functionCount: 0,
    manifestBacked: false,
    migrationRequired: true,
    note: "manifest_required",
  });

  assertEquals(entry.event, "app_contract_resolution");
  assertEquals(entry.surface, "mcp_tools_list");
  assertEquals(entry.legacy_source_detected, "skills_parsed");
  assertEquals(entry.manifest_backed, false);
});
