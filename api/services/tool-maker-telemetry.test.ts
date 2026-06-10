import { assertEquals } from "https://deno.land/std@0.210.0/assert/assert_equals.ts";
import { assertStringIncludes } from "https://deno.land/std@0.210.0/assert/assert_string_includes.ts";

import {
  buildToolMakerTelemetryLogEntry,
  logToolMakerStage,
} from "./tool-maker-telemetry.ts";

Deno.test("tool maker telemetry: builds structured stage logs", () => {
  const record = buildToolMakerTelemetryLogEntry({
    stage: "ul.test.bundle",
    status: "failed",
    userId: "user-123",
    appId: "app-123",
    functionName: "search",
    runtime: "deno",
    fileCount: 3,
    durationMs: 42,
    note: "esm_bundle_missing",
  });

  assertEquals(record, {
    event: "tool_maker_stage",
    stage: "ul.test.bundle",
    status: "failed",
    user_id: "user-123",
    app_id: "app-123",
    app_slug: undefined,
    function_name: "search",
    runtime: "deno",
    file_count: 3,
    export_count: undefined,
    duration_ms: 42,
    note: "esm_bundle_missing",
    error: undefined,
  });
});

Deno.test("tool maker telemetry: routes failures to error logs", () => {
  const calls: Array<{ level: string; args: unknown[] }> = [];

  logToolMakerStage(
    {
      stage: "ul.upload.pipeline",
      status: "failed",
      userId: "user-123",
      error: new Error("bundle blew up"),
    },
    {
      logger: {
        debug: (...args: unknown[]) => calls.push({ level: "debug", args }),
        info: (...args: unknown[]) => calls.push({ level: "info", args }),
        warn: (...args: unknown[]) => calls.push({ level: "warn", args }),
        error: (...args: unknown[]) => calls.push({ level: "error", args }),
      },
    },
  );

  assertEquals(calls.length, 1);
  assertEquals(calls[0].level, "error");
  assertEquals(calls[0].args[0], "Tool Maker stage failed");
  assertStringIncludes(JSON.stringify(calls[0].args[1]), '"stage":"ul.upload.pipeline"');
});
