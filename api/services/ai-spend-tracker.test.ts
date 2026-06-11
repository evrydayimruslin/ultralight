import { assertEquals } from "https://deno.land/std@0.210.0/assert/assert_equals.ts";

import { consumeAiSpend, recordAiSpend } from "./ai-spend-tracker.ts";

Deno.test("ai-spend-tracker: records, accumulates, and consume clears", () => {
  const id = crypto.randomUUID();
  recordAiSpend(id, 0.5);
  recordAiSpend(id, 1.25);
  assertEquals(consumeAiSpend(id), 1.75);
  // Consumed — a second read must not double-count.
  assertEquals(consumeAiSpend(id), 0);
});

Deno.test("ai-spend-tracker: unknown execution and missing id read as zero", () => {
  assertEquals(consumeAiSpend(crypto.randomUUID()), 0);
  assertEquals(consumeAiSpend(null), 0);
  assertEquals(consumeAiSpend(undefined), 0);
});

Deno.test("ai-spend-tracker: ignores non-positive and non-finite amounts", () => {
  const id = crypto.randomUUID();
  recordAiSpend(id, 0);
  recordAiSpend(id, -3);
  recordAiSpend(id, Number.NaN);
  recordAiSpend(id, Number.POSITIVE_INFINITY);
  recordAiSpend(null, 5);
  assertEquals(consumeAiSpend(id), 0);
});

Deno.test("ai-spend-tracker: executions are isolated by id", () => {
  const a = crypto.randomUUID();
  const b = crypto.randomUUID();
  recordAiSpend(a, 2);
  recordAiSpend(b, 7);
  assertEquals(consumeAiSpend(a), 2);
  assertEquals(consumeAiSpend(b), 7);
});
