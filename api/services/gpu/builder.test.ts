import { assertEquals } from "https://deno.land/std@0.210.0/assert/assert_equals.ts";

import { resolveGpuBuildPreflight } from "./builder.ts";

Deno.test("gpu builder preflight: reports missing config and passes once per-app injection is configured", async (t) => {
  const originalEnv = globalThis.__env;

  try {
    await t.step("reports missing RunPod API key", () => {
      globalThis.__env = {} as typeof globalThis.__env;

      assertEquals(resolveGpuBuildPreflight("app-123", "1.0.0"), {
        ok: false,
        status: "build_config_invalid",
        message:
          "GPU compute is not configured. RUNPOD_API_KEY environment variable is required.",
      });
    });

    await t.step("passes when per-app template injection is configured", () => {
      globalThis.__env = {
        RUNPOD_API_KEY: "runpod-key",
        RUNPOD_BASE_IMAGE: "ghcr.io/example/image:latest",
        PLATFORM_URL: "https://platform.example",
        GPU_INTERNAL_SECRET: "gpu-secret",
      } as typeof globalThis.__env;

      assertEquals(resolveGpuBuildPreflight("app-123", "1.0.0"), {
        ok: true,
        status: "ready",
        message: "GPU build configuration is ready.",
        template_mode: "per_app",
      });
    });
  } finally {
    globalThis.__env = originalEnv;
  }
});
