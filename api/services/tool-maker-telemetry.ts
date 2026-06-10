import type { LoggerLike } from "./logging.ts";
import { createServerLogger } from "./logging.ts";

export type ToolMakerStageStatus = "started" | "succeeded" | "failed";

export interface ToolMakerTelemetryInput {
  stage: string;
  status: ToolMakerStageStatus;
  userId?: string;
  appId?: string;
  appSlug?: string;
  functionName?: string;
  runtime?: "deno" | "gpu" | "unknown";
  fileCount?: number;
  exportCount?: number;
  durationMs?: number;
  note?: string;
  error?: unknown;
  metadata?: Record<string, unknown>;
}

export function buildToolMakerTelemetryLogEntry(
  input: ToolMakerTelemetryInput,
): Record<string, unknown> {
  return {
    event: "tool_maker_stage",
    stage: input.stage,
    status: input.status,
    user_id: input.userId || undefined,
    app_id: input.appId || undefined,
    app_slug: input.appSlug || undefined,
    function_name: input.functionName || undefined,
    runtime: input.runtime || undefined,
    file_count: input.fileCount,
    export_count: input.exportCount,
    duration_ms: input.durationMs,
    note: input.note || undefined,
    error: input.error,
    ...input.metadata,
  };
}

export function logToolMakerStage(
  input: ToolMakerTelemetryInput,
  deps: { logger?: LoggerLike } = {},
): Record<string, unknown> {
  const logger = deps.logger ?? createServerLogger("TOOL-MAKER");
  const context = buildToolMakerTelemetryLogEntry(input);
  const message = `Tool Maker stage ${input.status}`;

  if (input.status === "failed") {
    logger.error(message, context);
  } else {
    logger.info(message, context);
  }

  return context;
}
