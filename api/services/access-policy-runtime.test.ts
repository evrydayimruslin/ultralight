import { assertEquals } from "https://deno.land/std@0.210.0/assert/assert_equals.ts";

import {
  evaluateStaticAccessPolicy,
  resolveManifestAccessPolicy,
} from "./access-policy.ts";
import { createRuntimeAccessPolicyExecutor } from "./access-policy-runtime.ts";

Deno.test("runtime access policy executor calls declared export with policy payload", async () => {
  const app = {
    id: "app_123",
    owner_id: "owner_123",
    slug: "policy-tool",
    pricing_config: {
      functions: {
        search: { price_light: 9, free_calls: 2 },
      },
    },
    manifest: {
      access_policy: {
        mode: "module",
        module: "policy.ts",
        export: "planAccess",
      },
    },
  };
  const context = {
    app,
    caller: { userId: "caller_123" },
    subject: { kind: "function" as const, id: "search" },
    input: { query: "launch" },
    metadata: { surface: "test" },
  };

  const staticDecision = evaluateStaticAccessPolicy(context);
  const manifestPolicy = resolveManifestAccessPolicy(app);
  const executor = createRuntimeAccessPolicyExecutor({
    app,
    executeInSandbox: async (config, functionName, args) => {
      assertEquals(config.appId, "app_123");
      assertEquals(config.ownerId, "owner_123");
      assertEquals(config.permissions, []);
      assertEquals(config.timeoutMs, 2_000);
      assertEquals(functionName, "planAccess");
      assertEquals(args.length, 1);
      const payload = args[0] as Record<string, unknown>;
      assertEquals(
        (payload.subject as Record<string, unknown>).kind,
        "function",
      );
      assertEquals((payload.subject as Record<string, unknown>).id, "search");
      assertEquals((payload.input as Record<string, unknown>).query, "launch");
      assertEquals((payload.static as Record<string, unknown>).price_light, 9);
      return {
        success: true,
        result: { effect: "allow", price_light: 4 },
        logs: [],
        durationMs: 1,
        aiCostLight: 0,
      };
    },
  });

  const result = await executor({
    context,
    staticDecision,
    manifestPolicy,
  });

  assertEquals(result, { effect: "allow", price_light: 4 });
});
