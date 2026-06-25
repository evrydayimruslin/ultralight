import type { Env } from "../lib/env.ts";
import { getEnv } from "../lib/env.ts";
import { PLATFORM_INFERENCE_MODELS } from "./platform-inference-models.ts";

export type PlatformInferenceDiagnosticSeverity = "required" | "optional";

export interface PlatformInferenceDiagnosticCheck {
  check: string;
  ok: boolean;
  severity: PlatformInferenceDiagnosticSeverity;
  result: string;
}

export interface PlatformInferenceReadiness {
  ok: boolean;
  checks: PlatformInferenceDiagnosticCheck[];
}

function envString(env: Env | Record<string, unknown>, key: string): string {
  const value = env[key];
  return typeof value === "string" ? value.trim() : "";
}

function directDeepSeekModelNames(): string {
  return PLATFORM_INFERENCE_MODELS
    .filter((model) => model.upstreamProvider === "deepseek")
    .map((model) => model.name)
    .join(", ");
}

export function buildPlatformInferenceReadiness(
  env: Env | Record<string, unknown> = getEnv(),
): PlatformInferenceReadiness {
  const deepSeekKeyConfigured = envString(env, "DEEPSEEK_API_KEY").length > 0;
  const openRouterKeyConfigured = envString(env, "OPENROUTER_API_KEY").length > 0;
  const directModels = directDeepSeekModelNames();

  const checks: PlatformInferenceDiagnosticCheck[] = [
    {
      check: "openrouter_platform_key",
      ok: openRouterKeyConfigured,
      severity: "required",
      result: openRouterKeyConfigured
        ? "Configured — all platform (Light) models route through OpenRouter"
        : "OPENROUTER_API_KEY is missing; platform (Light) inference cannot provision per-user OpenRouter keys and will fail closed",
    },
    {
      // DeepSeek-direct routing is retired: every platform (Light) model now
      // resolves to an OpenRouter slug, so DEEPSEEK_API_KEY is no longer a
      // launch-blocking secret. Kept as an informational (optional) check.
      check: "deepseek_platform_key",
      ok: true,
      severity: "optional",
      result: deepSeekKeyConfigured
        ? `Present but unused — ${directModels} now route through OpenRouter (DeepSeek-direct retired)`
        : `Not set (expected) — ${directModels} route through OpenRouter; the direct DeepSeek API path is retired`,
    },
  ];

  return {
    ok: checks.every((check) => check.severity !== "required" || check.ok),
    checks,
  };
}
