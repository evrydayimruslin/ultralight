interface PendingTurn {
  userId: string;
  controller: AbortController;
  createdAt: number;
  expiresAt: number;
}

export interface TurnCancelMutationResult {
  ok: boolean;
  status: number;
  message: string;
}

const TURN_TTL_MS = 15 * 60 * 1000;
const pendingTurns = new Map<string, PendingTurn>();

function cleanupExpiredTurns(now = Date.now()): void {
  for (const [turnId, entry] of pendingTurns) {
    if (entry.expiresAt <= now || entry.controller.signal.aborted) {
      pendingTurns.delete(turnId);
    }
  }
}

export function registerGenerationTurn(
  turnId: string,
  userId: string,
  controller: AbortController,
  ttlMs = TURN_TTL_MS,
): void {
  cleanupExpiredTurns();
  pendingTurns.set(turnId, {
    userId,
    controller,
    createdAt: Date.now(),
    expiresAt: Date.now() + ttlMs,
  });
}

export function unregisterGenerationTurn(turnId: string): void {
  pendingTurns.delete(turnId);
}

export function cancelGenerationTurn(
  turnId: string,
  userId: string,
): TurnCancelMutationResult {
  cleanupExpiredTurns();
  const entry = pendingTurns.get(turnId);
  if (!entry) {
    return { ok: false, status: 404, message: "Generation turn not found or already finished" };
  }
  if (entry.userId !== userId) {
    return { ok: false, status: 403, message: "Generation turn does not belong to this user" };
  }

  entry.controller.abort("user_cancelled");
  pendingTurns.delete(turnId);
  return { ok: true, status: 200, message: "cancelled" };
}

export function clearGenerationTurnsForTests(): void {
  pendingTurns.clear();
}
