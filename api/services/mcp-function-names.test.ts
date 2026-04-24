import { assertEquals } from "https://deno.land/std@0.210.0/assert/assert_equals.ts";
import { assert } from "https://deno.land/std@0.210.0/assert/assert.ts";

import {
  buildAllowedPermissionSet,
  findLegacyMcpFunctionNameAliases,
  findPermissionRowForFunction,
  getMcpFunctionNameAliases,
  getMcpFunctionNameQueryIdentifiers,
  normalizeFunctionNamedRows,
  normalizeMcpFunctionIdentifiers,
  normalizePermissionNamedRows,
  permissionSetAllowsFunction,
  toPrefixedMcpFunctionName,
  toRawMcpFunctionName,
} from "./mcp-function-names.ts";

Deno.test("mcp function names: converts raw and prefixed identifiers consistently", () => {
  assertEquals(toRawMcpFunctionName("demo-app", "demo-app_search"), "search");
  assertEquals(toRawMcpFunctionName("demo-app", "search"), "search");
  assertEquals(
    toPrefixedMcpFunctionName("demo-app", "search"),
    "demo-app_search",
  );
  assertEquals(
    toPrefixedMcpFunctionName("demo-app", "demo-app_search"),
    "demo-app_search",
  );
  assertEquals(getMcpFunctionNameAliases("demo-app", "demo-app_search"), [
    "search",
    "demo-app_search",
  ]);
});

Deno.test("mcp function names: normalizes mixed identifiers to raw names", () => {
  assertEquals(
    normalizeMcpFunctionIdentifiers("demo-app", [
      "search",
      "demo-app_search",
      "list",
      "demo-app_list",
    ]),
    ["search", "list"],
  );

  assertEquals(
    getMcpFunctionNameQueryIdentifiers("demo-app", [
      "search",
      "demo-app_search",
    ]),
    ["search", "demo-app_search"],
  );
});

Deno.test("mcp function names: detects legacy prefixed aliases for telemetry", () => {
  assertEquals(
    findLegacyMcpFunctionNameAliases("demo-app", [
      { function_name: "demo-app_search" },
      { function_name: "search" },
      { function_name: "demo-app_list" },
      { function_name: "demo-app_search" },
    ]),
    [
      { alias: "demo-app_search", canonical: "search" },
      { alias: "demo-app_list", canonical: "list" },
    ],
  );
});

Deno.test("mcp function names: normalizes permission rows for display and writes", () => {
  assertEquals(
    normalizeFunctionNamedRows("demo-app", [{
      function_name: "demo-app_search",
    }, { function_name: "list" }]),
    [{ function_name: "search" }, { function_name: "list" }],
  );

  assertEquals(
    normalizePermissionNamedRows("demo-app", [
      { function_name: "demo-app_search", allowed: true },
      { function_name: "search", allowed: false },
      { function_name: "list", allowed: true },
    ]),
    [
      { function_name: "search", allowed: false },
      { function_name: "list", allowed: true },
    ],
  );

  assertEquals(
    normalizePermissionNamedRows("demo-app", [
      { function_name: "search", allowed: false },
      { function_name: "demo-app_search", allowed: true },
      { function_name: "write", allowed: true },
    ]),
    [
      { function_name: "search", allowed: false },
      { function_name: "write", allowed: true },
    ],
  );
});

Deno.test("mcp function names: permission checks work across raw and prefixed forms", () => {
  const rows = [
    { function_name: "search", allowed: true },
    { function_name: "demo-app_list", allowed: true },
    { function_name: "demo-app_write", allowed: false },
  ];

  const allowed = buildAllowedPermissionSet("demo-app", rows);

  assertEquals(Array.from(allowed.values()), ["search", "list"]);
  assert(permissionSetAllowsFunction("demo-app", allowed, "search"));
  assert(permissionSetAllowsFunction("demo-app", allowed, "demo-app_search"));
  assert(permissionSetAllowsFunction("demo-app", allowed, "demo-app_list"));
  assertEquals(
    permissionSetAllowsFunction("demo-app", allowed, "write"),
    false,
  );

  assertEquals(
    findPermissionRowForFunction("demo-app", rows, "demo-app_search")
      ?.function_name,
    "search",
  );
  assertEquals(
    findPermissionRowForFunction("demo-app", rows, "list")?.function_name,
    "demo-app_list",
  );
  assertEquals(
    findPermissionRowForFunction("demo-app", rows, "write"),
    undefined,
  );
});

Deno.test("mcp function names: canonical raw rows win over legacy aliases when duplicates exist", () => {
  const denyRows = [
    { function_name: "demo-app_search", allowed: true },
    { function_name: "search", allowed: false },
  ];

  const allowed = buildAllowedPermissionSet("demo-app", denyRows);
  assertEquals(
    permissionSetAllowsFunction("demo-app", allowed, "search"),
    false,
  );

  const allowedRows = [
    { function_name: "demo-app_search", allowed: true },
    { function_name: "search", allowed: true },
  ];
  assertEquals(
    findPermissionRowForFunction("demo-app", allowedRows, "search")
      ?.function_name,
    "search",
  );
});
