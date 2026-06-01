import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.210.0/assert/mod.ts";

import {
  cancelGenerationTurn,
  clearGenerationTurnsForTests,
  registerGenerationTurn,
  unregisterGenerationTurn,
} from "./turn-cancel.ts";

Deno.test("turn cancel: aborts a registered generation turn", () => {
  clearGenerationTurnsForTests();
  const controller = new AbortController();
  registerGenerationTurn("turn-1", "user-1", controller);

  const result = cancelGenerationTurn("turn-1", "user-1");
  assertEquals(result.ok, true);
  assertEquals(result.message, "cancelled");
  assert(controller.signal.aborted);

  clearGenerationTurnsForTests();
});

Deno.test("turn cancel: rejects the wrong user", () => {
  clearGenerationTurnsForTests();
  const controller = new AbortController();
  registerGenerationTurn("turn-1", "user-1", controller);

  const result = cancelGenerationTurn("turn-1", "user-2");
  assertEquals(result.ok, false);
  assertEquals(result.status, 403);
  assertEquals(controller.signal.aborted, false);

  unregisterGenerationTurn("turn-1");
  clearGenerationTurnsForTests();
});
