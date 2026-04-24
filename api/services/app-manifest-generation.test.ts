import { assertEquals } from "https://deno.land/std@0.210.0/assert/assert_equals.ts";
import { assertExists } from "https://deno.land/std@0.210.0/assert/assert_exists.ts";

import {
  generateManifestFromParseResult,
  hydrateManifestForSource,
  resolveStoredManifestCoverage,
  upsertManifestUploadFile,
} from "./app-manifest-generation.ts";
import { parseTypeScript } from "./parser.ts";

Deno.test("manifest generation: uses entry filename when building contracts from source", async () => {
  const parseResult = await parseTypeScript(
    "export async function greet(name: string) { return `hi ${name}`; }",
    "functions.ts",
  );

  const manifest = generateManifestFromParseResult(
    { name: "Greeting App", slug: "greeting-app" },
    parseResult,
    "1.2.3",
    { entryFileName: "functions.ts" },
  );

  assertEquals(manifest.entry.functions, "functions.ts");
  assertExists(manifest.functions?.greet);
  assertEquals(manifest.version, "1.2.3");
});

Deno.test("manifest generation: preserves rich uploaded manifests and merges missing source functions", async () => {
  const hydrated = await hydrateManifestForSource({
    app: { name: "Planner", slug: "planner" },
    existingManifest: {
      name: "Planner",
      version: "1.0.0",
      type: "mcp",
      entry: { functions: "planner.ts" },
      functions: {
        listTasks: {
          description: "List all tasks",
        },
      },
    },
    sourceCode: [
      "export async function listTasks() { return []; }",
      "export async function addTask(title: string) { return { ok: true, title }; }",
    ].join("\n"),
    filename: "planner.ts",
    version: "2.0.0",
  });

  assertEquals(hydrated.source, "merged");
  assertEquals(hydrated.manifest.version, "2.0.0");
  assertEquals(hydrated.manifest.functions?.listTasks?.description, "List all tasks");
  assertExists(hydrated.manifest.functions?.addTask);
});

Deno.test("manifest generation: rebuilds stored manifest coverage from source when manifest.json is missing", async () => {
  const stored = await resolveStoredManifestCoverage({
    app: { name: "Search", slug: "search" },
    fetchTextFile: async (path) => {
      if (path.endsWith("_source_index.ts")) {
        return "export async function search(query: string) { return [{ query }]; }";
      }
      throw new Error(`missing: ${path}`);
    },
    storageKey: "apps/app-123/1.0.0/",
    version: "1.0.0",
  });

  assertEquals(stored.source, "generated");
  assertExists(stored.manifest?.functions?.search);
  assertExists(stored.manifestJson);
});

Deno.test("manifest generation: upsertManifestUploadFile replaces stale manifest payloads", () => {
  const files = upsertManifestUploadFile(
    [
      { name: "manifest.json", content: "old" },
      { name: "index.ts", content: "code" },
    ],
    {
      name: "Search",
      version: "1.0.0",
      type: "mcp",
      entry: { functions: "index.ts" },
      functions: {
        search: { description: "Search things" },
      },
    },
    (manifestJson) => ({ name: "manifest.json", content: manifestJson }),
  );

  assertEquals(files.length, 2);
  assertEquals(files[1].name, "manifest.json");
  assertExists(files[1].content.includes('"search"'));
});
