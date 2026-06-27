import { getEnv } from "../lib/env.ts";

export const ROUTINES_FLAG_ENV = "ROUTINES_ENABLED";

const ENABLED_VALUES = new Set(["1", "true", "yes", "on", "enabled"]);

/**
 * Durable user routines are a deferred (post-launch) capability. The per-minute
 * routine-executor cron and the routine APIs read tables (user_routines,
 * routine_runs, ...) that only exist where routines are enabled. Default OFF so
 * production — which intentionally does not ship the routines schema — does not
 * run the executor and error every minute. Staging sets ROUTINES_ENABLED=1
 * (it has the full migration set) so the executor is still exercised there.
 */
export function isRoutinesEnabled(): boolean {
  return ENABLED_VALUES.has(getEnv(ROUTINES_FLAG_ENV).trim().toLowerCase());
}
