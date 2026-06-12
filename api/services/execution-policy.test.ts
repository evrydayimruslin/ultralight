// Dispatch-time execution policy: which functions go to the durable queue,
// and with what budget. The clamp is load-bearing — a manifest can only
// LOWER the timeout below the platform ceiling, never raise it.

import { assert } from "https://deno.land/std@0.210.0/assert/assert.ts";
import { assertEquals } from "https://deno.land/std@0.210.0/assert/assert_equals.ts";

import {
  MAX_ASYNC_EXECUTION_MS,
  resolveFunctionExecutionPolicy,
} from "./app-runtime-resources.ts";
import { validateManifest } from "../../shared/contracts/manifest.ts";

function manifestWith(execution: unknown) {
  return {
    functions: {
      slow_fn: { description: "x", execution },
    },
  };
}

Deno.test("execution policy: no execution block → sync at the ceiling", () => {
  const policy = resolveFunctionExecutionPolicy(
    { manifest: { functions: { slow_fn: { description: "x" } } } },
    "slow_fn",
  );
  assertEquals(policy, { async: false, timeoutMs: MAX_ASYNC_EXECUTION_MS });
});

Deno.test("execution policy: class async is honored; timeout_ms lowers the budget", () => {
  const policy = resolveFunctionExecutionPolicy(
    { manifest: manifestWith({ class: "async", timeout_ms: 60_000 }) },
    "slow_fn",
  );
  assertEquals(policy, { async: true, timeoutMs: 60_000 });
});

Deno.test("execution policy: timeout_ms can never EXCEED the platform ceiling", () => {
  const policy = resolveFunctionExecutionPolicy(
    { manifest: manifestWith({ class: "async", timeout_ms: 999_999_999 }) },
    "slow_fn",
  );
  assertEquals(policy.timeoutMs, MAX_ASYNC_EXECUTION_MS);
});

Deno.test("execution policy: string manifests (DB rows) parse", () => {
  const policy = resolveFunctionExecutionPolicy(
    { manifest: JSON.stringify(manifestWith({ class: "async" })) },
    "slow_fn",
  );
  assertEquals(policy.async, true);
});

Deno.test("execution policy: malformed manifest / unknown function → safe sync fallback", () => {
  for (
    const manifest of [
      "{not json",
      null,
      { functions: null },
      manifestWith("async"), // execution must be an object
      manifestWith({ class: "turbo" }), // unknown class
    ]
  ) {
    const policy = resolveFunctionExecutionPolicy(
      { manifest } as Parameters<typeof resolveFunctionExecutionPolicy>[0],
      "slow_fn",
    );
    assertEquals(policy.async, false);
  }
  const missingFn = resolveFunctionExecutionPolicy(
    { manifest: manifestWith({ class: "async" }) },
    "other_fn",
  );
  assertEquals(missingFn.async, false);
});

// --- manifest validation for the execution block ---

function validManifestBase(execution?: unknown) {
  return {
    name: "test-app",
    version: "1.0.0",
    type: "mcp",
    entry: { functions: "functions.js" },
    functions: {
      slow_fn: {
        description: "a slow function",
        ...(execution !== undefined ? { execution } : {}),
      },
    },
  };
}

function errorPaths(input: unknown): string[] {
  return validateManifest(input).errors.map((e) => e.path);
}

Deno.test("manifest validation: valid execution blocks pass", () => {
  for (
    const execution of [
      { class: "async" },
      { class: "sync" },
      { class: "async", timeout_ms: 60_000 },
      { timeout_ms: 1 },
    ]
  ) {
    const result = validateManifest(validManifestBase(execution));
    assertEquals(
      result.errors.filter((e) => e.path.includes("execution")),
      [],
      JSON.stringify(execution),
    );
  }
});

Deno.test("manifest validation: bad execution class is rejected", () => {
  assert(
    errorPaths(validManifestBase({ class: "turbo" }))
      .includes("functions.slow_fn.execution.class"),
  );
});

Deno.test("manifest validation: bad timeout_ms values are rejected", () => {
  for (const timeout of [0, -5, 1.5, "60000", Infinity, 600_001]) {
    assert(
      errorPaths(validManifestBase({ timeout_ms: timeout }))
        .includes("functions.slow_fn.execution.timeout_ms"),
      `expected rejection for timeout_ms=${String(timeout)}`,
    );
  }
});

Deno.test("manifest validation: non-object execution is rejected", () => {
  assert(
    errorPaths(validManifestBase("async"))
      .includes("functions.slow_fn.execution"),
  );
});
