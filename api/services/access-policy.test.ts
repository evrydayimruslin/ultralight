import { assertEquals } from "https://deno.land/std@0.210.0/assert/assert_equals.ts";

import {
  evaluateAccessPolicy,
  evaluateStaticAccessPolicy,
  resolveManifestAccessPolicy,
} from "./access-policy.ts";

const app = {
  id: "app_123",
  owner_id: "owner_123",
  slug: "paid-tool",
  pricing_config: {
    default_price_light: 3,
    default_free_calls: 1,
    functions: {
      search: { price_light: 9, free_calls: 2 },
    },
    skills: {
      context: { price_light: 5, free_pulls: 1 },
    },
  },
};

Deno.test("access policy: resolves function subjects from static pricing config", () => {
  const decision = evaluateStaticAccessPolicy({
    app,
    caller: { userId: "caller_123", authState: "authenticated" },
    subject: { kind: "function", id: "search" },
    input: { query: "launch" },
  });

  assertEquals(decision.effect, "allow");
  assertEquals(decision.source, "static_config");
  assertEquals(decision.subjectKind, "function");
  assertEquals(decision.subjectId, "search");
  assertEquals(decision.priceLight, 9);
  assertEquals(decision.chargeLight, 9);
  assertEquals(decision.freeQuotaLimit, 2);
  assertEquals(decision.freeQuotaCounterKey, "search");
  assertEquals(decision.free, false);
  assertEquals(decision.metadata.subject_kind, "function");
});

Deno.test("access policy: resolves skill subjects from static pricing config", () => {
  const decision = evaluateStaticAccessPolicy({
    app,
    caller: { userId: "caller_123", authState: "authenticated" },
    subject: { kind: "skill", id: "context" },
  });

  assertEquals(decision.effect, "allow");
  assertEquals(decision.source, "static_config");
  assertEquals(decision.subjectKind, "skill");
  assertEquals(decision.subjectId, "context");
  assertEquals(decision.priceLight, 5);
  assertEquals(decision.chargeLight, 5);
  assertEquals(decision.freeQuotaLimit, 1);
  assertEquals(decision.freeQuotaCounterKey, "skill:context");
  assertEquals(decision.free, false);
  assertEquals(decision.metadata.subject_kind, "skill");
});

Deno.test("access policy: owner access is allowed without caller charge", () => {
  const decision = evaluateStaticAccessPolicy({
    app,
    caller: { userId: "owner_123", authState: "authenticated" },
    subject: { kind: "function", id: "search" },
  });

  assertEquals(decision.priceLight, 9);
  assertEquals(decision.chargeLight, 0);
  assertEquals(decision.freeQuotaLimit, 0);
  assertEquals(decision.freeQuotaCounterKey, null);
  assertEquals(decision.selfAccess, true);
});

Deno.test("access policy: manifest policy declaration is resolved without execution", () => {
  const policy = resolveManifestAccessPolicy({
    manifest: {
      name: "Policy App",
      version: "1.0.0",
      type: "mcp",
      entry: { functions: "index.ts" },
      access_policy: {
        mode: "module",
        module: "policies/access.ts",
        export: "planAccess",
      },
    },
  });

  assertEquals(policy.configured, true);
  assertEquals(policy.mode, "module");
  assertEquals(policy.module, "policies/access.ts");
  assertEquals(policy.exportName, "planAccess");

  const decision = evaluateStaticAccessPolicy({
    app: {
      ...app,
      manifest: {
        access_policy: {
          mode: "module",
          module: "policies/access.ts",
          export: "planAccess",
        },
      },
    },
    caller: { userId: "caller_123", authState: "authenticated" },
    subject: { kind: "skill", id: "context" },
  });

  assertEquals(decision.source, "manifest_policy_declared_static_fallback");
  assertEquals(decision.metadata.access_policy_configured, true);
  assertEquals(decision.metadata.access_policy_mode, "module");
  assertEquals(decision.metadata.access_policy_module, "policies/access.ts");
  assertEquals(decision.metadata.access_policy_export, "planAccess");
  assertEquals(decision.metadata.access_policy_executed, false);
  assertEquals(decision.chargeLight, 5);
});

Deno.test("access policy: runtime policy can override function pricing", async () => {
  const decision = await evaluateAccessPolicy({
    app: {
      ...app,
      manifest: {
        access_policy: {
          mode: "module",
          module: "policy.ts",
          export: "planAccess",
        },
      },
    },
    caller: { userId: "caller_123", authState: "authenticated" },
    subject: { kind: "function", id: "search" },
    input: { query: "vip" },
  }, {
    executeRuntimePolicy: async ({ context, staticDecision }) => {
      assertEquals(context.subject.kind, "function");
      assertEquals(staticDecision.priceLight, 9);
      return {
        effect: "allow",
        price_light: 12,
        charge_light: 7,
        free_quota_limit: 3,
        free_quota_counter_key: "policy:search",
        metadata: { policy_rule: "discount" },
      };
    },
  });

  assertEquals(decision.effect, "allow");
  if (decision.effect !== "allow") return;
  assertEquals(decision.source, "runtime_policy");
  assertEquals(decision.priceLight, 12);
  assertEquals(decision.chargeLight, 7);
  assertEquals(decision.freeQuotaLimit, 3);
  assertEquals(decision.freeQuotaCounterKey, "policy:search");
  assertEquals(decision.metadata.access_policy_executed, true);
  assertEquals(decision.metadata.policy_rule, "discount");
});

Deno.test("access policy: runtime policy can deny skill access", async () => {
  const decision = await evaluateAccessPolicy({
    app: {
      ...app,
      manifest: {
        access_policy: {
          mode: "module",
          module: "policy.ts",
          export: "planAccess",
        },
      },
    },
    caller: { userId: "caller_123", authState: "authenticated" },
    subject: { kind: "skill", id: "context" },
  }, {
    executeRuntimePolicy: async () => ({
      effect: "deny",
      reason: "Skill context is not available for this account.",
    }),
  });

  assertEquals(decision.effect, "deny");
  if (decision.effect !== "deny") return;
  assertEquals(decision.source, "runtime_policy");
  assertEquals(decision.code, "access_policy_denied");
  assertEquals(
    decision.reason,
    "Skill context is not available for this account.",
  );
  assertEquals(decision.metadata.access_policy_denied, true);
});

Deno.test("access policy: runtime policy errors fail closed", async () => {
  const decision = await evaluateAccessPolicy({
    app: {
      ...app,
      manifest: {
        access_policy: {
          mode: "module",
          module: "policy.ts",
          export: "planAccess",
        },
      },
    },
    caller: { userId: "caller_123", authState: "authenticated" },
    subject: { kind: "function", id: "search" },
  }, {
    executeRuntimePolicy: async () => {
      throw new Error("policy boom");
    },
  });

  assertEquals(decision.effect, "deny");
  if (decision.effect !== "deny") return;
  assertEquals(decision.source, "runtime_policy_error");
  assertEquals(decision.code, "access_policy_error");
  assertEquals(decision.reason, "Access policy failed: policy boom");
  assertEquals(decision.metadata.access_policy_error, "policy boom");
});
