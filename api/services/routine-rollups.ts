import { createSupabaseRestClient } from "./platform-clients/supabase-rest.ts";
import type { RoutineTraceContext } from "./routine-trace.ts";

export interface RoutineCallContributionInput {
  userId: string;
  routine: RoutineTraceContext;
  appId?: string | null;
  appRef?: string | null;
  functionName: string;
  receiptId?: string | null;
  toolInvocationId?: string | null;
  status: "succeeded" | "failed" | "skipped";
  durationMs?: number | null;
  costLight?: number | null;
  argsPreview?: Record<string, unknown>;
  resultPreview?: Record<string, unknown>;
  error?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
}

interface RoutineRollupDeps {
  fetchFn?: typeof fetch;
}

function nonNegativeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 0;
}

export async function recordRoutineCallContribution(
  input: RoutineCallContributionInput,
  deps?: RoutineRollupDeps,
): Promise<
  { step_id: string; step_index: number; total_light: number } | null
> {
  const supabase = createSupabaseRestClient({ fetchFn: deps?.fetchFn });
  const res = await supabase.rpc("record_routine_call_contribution", {
    p_routine_id: input.routine.routineId,
    p_routine_run_id: input.routine.routineRunId,
    p_user_id: input.userId,
    p_app_id: input.appId ?? null,
    p_app_ref: input.appRef ?? null,
    p_function_name: input.functionName,
    p_receipt_id: input.receiptId ?? null,
    p_tool_invocation_id: input.toolInvocationId ?? null,
    p_status: input.status,
    p_duration_ms: input.durationMs ?? null,
    p_cost_light: nonNegativeNumber(input.costLight),
    p_args_preview: input.argsPreview ?? {},
    p_result_preview: input.resultPreview ?? {},
    p_error: input.error ?? null,
    p_metadata: {
      ...(input.metadata ?? {}),
      trace_id: input.routine.traceId ?? null,
    },
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `Failed to record routine contribution (${res.status}): ${detail}`,
    );
  }

  const payload = await res.json().catch(() => null);
  const row = Array.isArray(payload) ? payload[0] : payload;
  if (!row || typeof row !== "object") return null;
  return row as { step_id: string; step_index: number; total_light: number };
}
