import { assertEquals } from "https://deno.land/std@0.210.0/assert/assert_equals.ts";
import {
  cancelExecutionPlanGate,
  confirmExecutionPlanGate,
  registerExecutionPlanGate,
} from "./plan-gate.ts";

class MockKVNamespace {
  private entries = new Map<string, { value: string; expiresAt: number | null }>();

  async get(key: string, type?: 'text' | 'json'): Promise<unknown> {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return null;
    }

    if (type === 'json') {
      return JSON.parse(entry.value);
    }
    return entry.value;
  }

  async put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void> {
    this.entries.set(key, {
      value,
      expiresAt: options?.expirationTtl ? Date.now() + options.expirationTtl * 1000 : null,
    });
  }
}

async function withMockedEnv<T>(fn: () => Promise<T> | T): Promise<T> {
  const globalWithEnv = globalThis as typeof globalThis & { __env?: Record<string, unknown> };
  const previousEnv = globalWithEnv.__env;
  globalWithEnv.__env = {
    ...(previousEnv || {}),
    FN_INDEX: new MockKVNamespace() as unknown as KVNamespace,
  };

  try {
    return await fn();
  } finally {
    globalWithEnv.__env = previousEnv;
  }
}

Deno.test("plan gate confirms across KV-backed requests", async () => {
  await withMockedEnv(async () => {
    const decisionPromise = registerExecutionPlanGate("plan_confirm", "user_1", 2_000);
    const confirmResult = await confirmExecutionPlanGate("plan_confirm", "user_1");
    const decision = await decisionPromise;

    assertEquals(confirmResult.ok, true);
    assertEquals(confirmResult.message, "confirmed");
    assertEquals(decision.status, "confirmed");
  });
});

Deno.test("plan gate cancel is idempotent after the first write", async () => {
  await withMockedEnv(async () => {
    const decisionPromise = registerExecutionPlanGate("plan_cancel", "user_2", 2_000);
    const firstResult = await cancelExecutionPlanGate("plan_cancel", "user_2");
    const secondResult = await cancelExecutionPlanGate("plan_cancel", "user_2");
    const decision = await decisionPromise;

    assertEquals(firstResult.ok, true);
    assertEquals(secondResult.ok, true);
    assertEquals(secondResult.message, "cancelled");
    assertEquals(decision.status, "cancelled");
  });
});

Deno.test("plan gate expires and rejects late confirmation", async () => {
  await withMockedEnv(async () => {
    const decision = await registerExecutionPlanGate("plan_timeout", "user_3", 30);
    const confirmResult = await confirmExecutionPlanGate("plan_timeout", "user_3");

    assertEquals(decision.status, "timeout");
    assertEquals(confirmResult.ok, false);
    assertEquals(confirmResult.status, 410);
  });
});
