import { assertEquals } from "https://deno.land/std@0.210.0/assert/assert_equals.ts";
import { assertStringIncludes } from "https://deno.land/std@0.210.0/assert/assert_string_includes.ts";

import { handlePlatformMcp } from "./platform-mcp.ts";
import { mintSandboxAuthToken } from "../services/sandbox-actor.ts";
import { createRoutineActorToken } from "../services/routine-auth.ts";

// Hardening test for the gx.call grant-bypass vector (services/sandbox-actor.ts
// header): actor tokens are minted only for the per-app execution path
// (galactic.call() → /mcp/:appId WITH X-Galactic-Caller). The platform
// aggregator's gx.call forwards the bearer to a target app WITHOUT minting that
// header, so an exfiltrated actor token (readable via `galactic.call.toString()`)
// could skip the cross-Agent grant check. handlePlatformMcp must reject actor
// tokens at the door — for EVERY method, not just gx.call.

const USER = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "agent@example.com",
  tier: "free",
};

// sandbox-actor signs with AGENT_CALLER_SECRET; routine-auth with
// ROUTINE_ACTOR_TOKEN_SECRET. Set both so mint + verify round-trip.
const ENV = {
  AGENT_CALLER_SECRET: "test-agent-caller-secret",
  ROUTINE_ACTOR_TOKEN_SECRET: "test-routine-actor-secret",
  BASE_URL: "https://api.test",
};

async function withEnv<T>(fn: () => Promise<T>): Promise<T> {
  const prev = globalThis.__env;
  globalThis.__env = { ...(prev || {}), ...ENV } as typeof globalThis.__env;
  try {
    return await fn();
  } finally {
    globalThis.__env = prev;
  }
}

// The exact request an exfiltrated token would replay: a gx.call to a victim
// app through the aggregator (the path that omits X-Galactic-Caller).
function gxCallRequest(token: string): Request {
  return new Request("https://api.test/mcp/platform", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "gx.call",
        arguments: {
          app_id: "victim-app",
          function_name: "transfer",
          args: {},
        },
      },
    }),
  });
}

async function assertForbidden(res: Response): Promise<void> {
  // FORBIDDEN (-32003) maps to HTTP 400 in platform-mcp's jsonRpcErrorResponse.
  assertEquals(res.status, 400);
  const body = await res.json() as {
    error?: { code?: number; message?: string; data?: { type?: string } };
  };
  assertEquals(body.error?.code, -32003);
  assertEquals(body.error?.data?.type, "ACTOR_TOKEN_FORBIDDEN");
  assertStringIncludes(String(body.error?.message), "galactic.call()");
}

Deno.test("platform MCP rejects an exfiltrated sandbox_actor token (gx.call grant-bypass)", async () => {
  await withEnv(async () => {
    // Worst case: a broadly-scoped (app:call) sandbox token, the kind app code
    // can read out of the dynamic-worker setup module via `.toString()`.
    const token = await mintSandboxAuthToken({
      user: USER,
      appId: "attacker-app",
      hasBroadCallPermission: true,
      dependencyAppIds: [],
    });
    if (!token) throw new Error("failed to mint sandbox actor token");
    await assertForbidden(await handlePlatformMcp(gxCallRequest(token)));
  });
});

Deno.test("platform MCP rejects a routine_actor token at the aggregator", async () => {
  await withEnv(async () => {
    const { token } = await createRoutineActorToken({
      user: USER,
      routine: { id: "routine-1" },
      routineRunId: "run-1",
      capabilities: [
        { app_id: "some-app", function_name: "do_thing", approved: true },
      ],
    });
    await assertForbidden(await handlePlatformMcp(gxCallRequest(token)));
  });
});
