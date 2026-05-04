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
      check: "deepseek_platform_key",
      ok: deepSeekKeyConfigured,
      severity: "required",
      result: deepSeekKeyConfigured
        ? `Configured for direct ${directModels} routing`
        : `DEEPSEEK_API_KEY is missing; direct ${directModels} routes will fail closed`,
    },
    {
      check: "openrouter_platform_key",
      ok: openRouterKeyConfigured,
      severity: "required",
      result: openRouterKeyConfigured
        ? "Configured for platform OpenRouter routing and non-DeepSeek Light models"
        : "OPENROUTER_API_KEY is missing; non-DeepSeek Light models cannot provision platform OpenRouter keys",
    },
  ];

  return {
    ok: checks.every((check) => check.severity !== "required" || check.ok),
    checks,
  };
}
