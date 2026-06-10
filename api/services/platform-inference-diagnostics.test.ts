import { assertEquals } from "https://deno.land/std@0.210.0/assert/assert_equals.ts";
import { assert } from "https://deno.land/std@0.210.0/assert/assert.ts";

import { buildPlatformInferenceReadiness } from "./platform-inference-diagnostics.ts";

Deno.test("platform inference diagnostics: reports required platform keys without exposing values", () => {
  const readiness = buildPlatformInferenceReadiness({
    DEEPSEEK_API_KEY: "ds-secret",
    OPENROUTER_API_KEY: "or-secret",
  });

  assertEquals(readiness.ok, true);
  assertEquals(readiness.checks.map((check) => check.check), [
    "deepseek_platform_key",
    "openrouter_platform_key",
  ]);
  assert(readiness.checks.every((check) => check.ok));
  assert(readiness.checks.every((check) => !check.result.includes("secret")));
});

Deno.test("platform inference diagnostics: fails readiness when direct DeepSeek key is missing", () => {
  const readiness = buildPlatformInferenceReadiness({
    DEEPSEEK_API_KEY: "",
    OPENROUTER_API_KEY: "or-secret",
  });

  assertEquals(readiness.ok, false);
  const deepSeek = readiness.checks.find((check) => check.check === "deepseek_platform_key");
  assertEquals(deepSeek?.ok, false);
  assertEquals(deepSeek?.severity, "required");
  assert(deepSeek?.result.includes("DEEPSEEK_API_KEY"));
  assert(deepSeek?.result.includes("fail closed"));
});
