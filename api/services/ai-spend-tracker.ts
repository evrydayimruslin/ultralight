// Main-isolate ledger of AI credits actually debited per execution.
//
// AIBinding runs in the MAIN worker isolate (ctx.exports loopback) and debits
// credits per provider call as they complete. The sandbox separately
// self-reports an accumulated total (globalThis.__aiCostLight), but that value
// is (a) lost when the execution aborts mid-flight — every call that finished
// before the abort was already charged — and (b) writable by tenant code, so a
// hostile app could under-report to dodge cross-Agent grant caps.
//
// This tracker is the authoritative source: the binding records each debit
// here keyed by executionId, and executeInDynamicSandbox consumes the total
// when it builds the ExecutionResult — on success, on error, AND on abort.

const spend = new Map<string, { costLight: number; at: number }>();

// Executions are short-lived (≤120s today); entries are consumed at result
// build. The TTL sweep only matters for the rare debit that lands after its
// execution already aborted and consumed — bound the map so those can't leak.
const ENTRY_TTL_MS = 15 * 60 * 1000;
const SWEEP_THRESHOLD = 1_000;

export function recordAiSpend(
  executionId: string | null | undefined,
  costLight: number,
): void {
  if (!executionId || !Number.isFinite(costLight) || costLight <= 0) return;
  if (spend.size >= SWEEP_THRESHOLD) sweep();
  const current = spend.get(executionId);
  spend.set(executionId, {
    costLight: (current?.costLight ?? 0) + costLight,
    at: Date.now(),
  });
}

// Read-and-clear. Returns 0 when nothing was recorded (no AI calls, BYOK
// route with shouldDebitLight=false, or no ai:call permission).
export function consumeAiSpend(executionId: string | null | undefined): number {
  if (!executionId) return 0;
  const entry = spend.get(executionId);
  if (!entry) return 0;
  spend.delete(executionId);
  return entry.costLight;
}

function sweep(): void {
  const cutoff = Date.now() - ENTRY_TTL_MS;
  for (const [key, entry] of spend) {
    if (entry.at < cutoff) spend.delete(key);
  }
}
