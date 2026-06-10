import type { RequestCallerContext } from "./request-caller-context.ts";

export interface RoutineTraceContext {
  routineId: string;
  routineRunId: string;
  traceId?: string;
}

export function routineTraceContextFromCaller(
  caller: Pick<RequestCallerContext, "routineActor">,
): RoutineTraceContext | undefined {
  const actor = caller.routineActor;
  if (!actor?.routineId || !actor.routineRunId) return undefined;
  return {
    routineId: actor.routineId,
    routineRunId: actor.routineRunId,
    ...(actor.traceId ? { traceId: actor.traceId } : {}),
  };
}

export function routineTraceMetadata(
  context: RoutineTraceContext | null | undefined,
): Record<string, unknown> {
  if (!context) return {};
  return {
    routine_id: context.routineId,
    routine_run_id: context.routineRunId,
    ...(context.traceId ? { trace_id: context.traceId } : {}),
  };
}
