import { assertEquals } from "https://deno.land/std@0.210.0/assert/assert_equals.ts";
import { assert } from "https://deno.land/std@0.210.0/assert/assert.ts";

import { buildPlatformInferenceReadiness } from "./platform-inference-diagnostics.ts";

Deno.test("platform inference diagnostics: reports platform keys without exposing values", () => {
  const readiness = buildPlatformInferenceReadiness({
    DEEPSEEK_API_KEY: "ds-secret",
    OPENROUTER_API_KEY: "or-secret",
  });

  assertEquals(readiness.ok, true);
  assertEquals(readiness.checks.map((check) => check.check), [
    "openrouter_platform_key",
    "deepseek_platform_key",
  ]);
  assert(readiness.checks.every((check) => check.ok));
  assert(readiness.checks.every((check) => !check.result.includes("secret")));
});

Deno.test("platform inference diagnostics: stays ready without the retired DeepSeek key", () => {
  const readiness = buildPlatformInferenceReadiness({
    DEEPSEEK_API_KEY: "",
    OPENROUTER_API_KEY: "or-secret",
  });

  // DeepSeek-direct is retired — DEEPSEEK_API_KEY is optional/informational and
  // its absence must not block readiness.
  assertEquals(readiness.ok, true);
  const deepSeek = readiness.checks.find((check) => check.check === "deepseek_platform_key");
  assertEquals(deepSeek?.severity, "optional");
  assertEquals(deepSeek?.ok, true);
});

Deno.test("platform inference diagnostics: fails readiness when OpenRouter key is missing", () => {
  const readiness = buildPlatformInferenceReadiness({
    DEEPSEEK_API_KEY: "ds-secret",
    OPENROUTER_API_KEY: "",
  });

  assertEquals(readiness.ok, false);
  const openRouter = readiness.checks.find((check) => check.check === "openrouter_platform_key");
  assertEquals(openRouter?.ok, false);
  assertEquals(openRouter?.severity, "required");
  assert(openRouter?.result.includes("OPENROUTER_API_KEY"));
});
