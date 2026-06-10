interface PendingExecutionPlan {
  userId: string;
  expiresAt: number;
  finish: (decision: PlanGateDecision) => void;
  timeoutHandle: ReturnType<typeof setTimeout>;
}

interface StoredExecutionPlanGate {
  userId: string;
  status: 'pending' | 'confirmed' | 'cancelled' | 'timeout';
  createdAt: number;
  expiresAt: number;
  decidedAt?: number;
}

export interface PlanGateDecision {
  status: 'confirmed' | 'cancelled' | 'timeout';
  decidedAt: number;
}

interface PlanGateMutationResult {
  ok: boolean;
  status: number;
  message: string;
}

const PLAN_TTL_MS = 10 * 60 * 1000;
const PLAN_SETTLED_TTL_MS = 60 * 1000;
const PLAN_POLL_INTERVAL_MS = 1000;
const PLAN_EXPIRY_GRACE_MS = 2500;
const PLAN_KV_KEY_PREFIX = 'plan_gate:';
const pendingPlans = new Map<string, PendingExecutionPlan>();

function getPlanGateKey(planId: string): string {
  return `${PLAN_KV_KEY_PREFIX}${planId}`;
}

function getPlanGateStore(): KVNamespace | null {
  return globalThis.__env?.FN_INDEX ?? null;
}

function cleanupExpiredPlans(now = Date.now()): void {
  for (const [planId, entry] of pendingPlans) {
    if (entry.expiresAt <= now) {
      clearTimeout(entry.timeoutHandle);
      pendingPlans.delete(planId);
      entry.finish({ status: 'timeout', decidedAt: now });
    }
  }
}

function registerInMemoryPlanGate(
  planId: string,
  userId: string,
  ttlMs: number,
): Promise<PlanGateDecision> {
  cleanupExpiredPlans();

  return new Promise<PlanGateDecision>((resolve) => {
    const finish = (decision: PlanGateDecision) => {
      const existing = pendingPlans.get(planId);
      if (existing) {
        clearTimeout(existing.timeoutHandle);
        pendingPlans.delete(planId);
      }
      resolve(decision);
    };

    const timeoutHandle = setTimeout(() => {
      finish({ status: 'timeout', decidedAt: Date.now() });
    }, ttlMs);

    pendingPlans.set(planId, {
      userId,
      expiresAt: Date.now() + ttlMs,
      finish,
      timeoutHandle,
    });
  });
}

function confirmInMemoryPlanGate(planId: string, userId: string): PlanGateMutationResult {
  cleanupExpiredPlans();
  const entry = pendingPlans.get(planId);
  if (!entry) {
    return { ok: false, status: 404, message: 'Execution plan not found or already resolved' };
  }
  if (entry.userId !== userId) {
    return { ok: false, status: 403, message: 'Execution plan does not belong to this user' };
  }

  entry.finish({ status: 'confirmed', decidedAt: Date.now() });
  return { ok: true, status: 200, message: 'confirmed' };
}

function cancelInMemoryPlanGate(planId: string, userId: string): PlanGateMutationResult {
  cleanupExpiredPlans();
  const entry = pendingPlans.get(planId);
  if (!entry) {
    return { ok: false, status: 404, message: 'Execution plan not found or already resolved' };
  }
  if (entry.userId !== userId) {
    return { ok: false, status: 403, message: 'Execution plan does not belong to this user' };
  }

  entry.finish({ status: 'cancelled', decidedAt: Date.now() });
  return { ok: true, status: 200, message: 'cancelled' };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function getStoredPlanGate(
  kv: KVNamespace,
  planId: string,
  attempts = 1,
  retryDelayMs = 100,
): Promise<StoredExecutionPlanGate | null> {
  const key = getPlanGateKey(planId);

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const record = await kv.get(key, 'json') as StoredExecutionPlanGate | null;
    if (record) return record;
    if (attempt < attempts - 1) {
      await sleep(retryDelayMs);
    }
  }

  return null;
}

async function putStoredPlanGate(
  kv: KVNamespace,
  planId: string,
  record: StoredExecutionPlanGate,
  ttlMs: number,
): Promise<void> {
  await kv.put(getPlanGateKey(planId), JSON.stringify(record), {
    expirationTtl: Math.max(1, Math.ceil(ttlMs / 1000)),
  });
}

export async function registerExecutionPlanGate(
  planId: string,
  userId: string,
  ttlMs = PLAN_TTL_MS,
): Promise<PlanGateDecision> {
  const kv = getPlanGateStore();
  if (!kv) {
    return registerInMemoryPlanGate(planId, userId, ttlMs);
  }

  const createdAt = Date.now();
  const expiresAt = createdAt + ttlMs;
  await putStoredPlanGate(kv, planId, {
    userId,
    status: 'pending',
    createdAt,
    expiresAt,
  }, ttlMs + PLAN_SETTLED_TTL_MS);

  while (Date.now() < expiresAt) {
    await sleep(Math.min(PLAN_POLL_INTERVAL_MS, Math.max(expiresAt - Date.now(), 50)));
    const record = await getStoredPlanGate(kv, planId, 2);
    if (!record) {
      continue;
    }
    if (record.status === 'confirmed' || record.status === 'cancelled' || record.status === 'timeout') {
      return {
        status: record.status,
        decidedAt: record.decidedAt ?? Date.now(),
      };
    }
  }

  const graceDeadline = Date.now() + PLAN_EXPIRY_GRACE_MS;
  while (Date.now() < graceDeadline) {
    const record = await getStoredPlanGate(kv, planId, 2);
    if (record?.status === 'confirmed' || record?.status === 'cancelled' || record?.status === 'timeout') {
      return {
        status: record.status,
        decidedAt: record.decidedAt ?? Date.now(),
      };
    }
    await sleep(250);
  }

  return { status: 'timeout', decidedAt: Date.now() };
}

async function mutateStoredPlanGate(
  planId: string,
  userId: string,
  nextStatus: 'confirmed' | 'cancelled',
): Promise<PlanGateMutationResult> {
  const kv = getPlanGateStore();
  if (!kv) {
    return nextStatus === 'confirmed'
      ? confirmInMemoryPlanGate(planId, userId)
      : cancelInMemoryPlanGate(planId, userId);
  }

  const record = await getStoredPlanGate(kv, planId, 4);
  if (!record) {
    return { ok: false, status: 404, message: 'Execution plan not found or already resolved' };
  }
  if (record.userId !== userId) {
    return { ok: false, status: 403, message: 'Execution plan does not belong to this user' };
  }

  const now = Date.now();
  if (record.status === nextStatus) {
    return { ok: true, status: 200, message: nextStatus };
  }
  if (record.status === 'confirmed' || record.status === 'cancelled') {
    return { ok: false, status: 409, message: `Execution plan already ${record.status}` };
  }
  if (record.status === 'timeout' || record.expiresAt <= now) {
    await putStoredPlanGate(kv, planId, {
      ...record,
      status: 'timeout',
      decidedAt: record.decidedAt ?? now,
    }, PLAN_SETTLED_TTL_MS);
    return { ok: false, status: 410, message: 'Execution plan expired' };
  }

  await putStoredPlanGate(kv, planId, {
    ...record,
    status: nextStatus,
    decidedAt: now,
  }, PLAN_SETTLED_TTL_MS);

  return { ok: true, status: 200, message: nextStatus };
}

export async function confirmExecutionPlanGate(
  planId: string,
  userId: string,
): Promise<PlanGateMutationResult> {
  return mutateStoredPlanGate(planId, userId, 'confirmed');
}

export async function cancelExecutionPlanGate(
  planId: string,
  userId: string,
): Promise<PlanGateMutationResult> {
  return mutateStoredPlanGate(planId, userId, 'cancelled');
}
