import { assertEquals } from "https://deno.land/std@0.210.0/assert/assert_equals.ts";
import { assertRejects } from "https://deno.land/std@0.210.0/assert/assert_rejects.ts";

import { pullSkillContext, SkillPullBillingError } from "./skill-pulls.ts";

Deno.test("skill pulls: runtime access policy can deny full context pulls", async () => {
  const error = await assertRejects(
    () =>
      pullSkillContext({
        app: {
          id: "app_123",
          owner_id: "owner_123",
          slug: "policy-skill",
          name: "Policy Skill",
          description: "Skill policy test",
          skills_md: "# Secret context",
          manifest: {
            access_policy: {
              mode: "module",
              module: "policy.ts",
              export: "planAccess",
            },
            skills: {
              context: {
                description: "Private full context",
                resource: "skills.md",
                format: "markdown",
              },
            },
          },
          pricing_config: {
            default_skill_pull_price_light: 5,
          },
        },
        userId: "caller_123",
        skillId: "context",
        accessPolicyExecutor: async ({ context, staticDecision }) => {
          assertEquals(context.subject.kind, "skill");
          assertEquals(context.subject.id, "context");
          assertEquals(staticDecision.priceLight, 5);
          return {
            effect: "deny",
            reason: "Private skill context.",
          };
        },
      }),
    SkillPullBillingError,
    "Private skill context.",
  );

  assertEquals(error.status, 403);
  assertEquals(error.code, "access_policy_denied");
});

Deno.test("skill pulls: paid pull sends idempotency keys to transfer and receipt RPCs", async () => {
  const previousEnv = globalThis.__env;
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  globalThis.__env = {
    SUPABASE_URL: "https://supabase.example",
    SUPABASE_SERVICE_ROLE_KEY: "service-role",
  } as unknown as typeof globalThis.__env;

  const fetchFn = ((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.toString()
      : input.url;
    const body = init?.body && typeof init.body === "string"
      ? JSON.parse(init.body)
      : {};
    calls.push({ url, body });

    if (url.endsWith("/rest/v1/rpc/transfer_light")) {
      return Promise.resolve(
        new Response(
          JSON.stringify([{
            platform_fee: 0.75,
            transfer_id: "transfer-123",
            fee_would_have_been: 0.75,
            fee_waived: 0,
            waiver_source: null,
            waiver_event_id: null,
          }]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    }

    return Promise.resolve(
      new Response(
        JSON.stringify([{
          receipt_id: "receipt-123",
          transfer_id: "transfer-123",
          waiver_event_id: null,
        }]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
  }) as typeof fetch;

  try {
    const result = await pullSkillContext({
      app: {
        id: "app_123",
        owner_id: "owner_123",
        slug: "paid-skill",
        name: "Paid Skill",
        description: "Skill billing test",
        skills_md: "# Paid context",
        manifest: {
          skills: {
            context: {
              description: "Paid full context",
              resource: "skills.md",
              format: "markdown",
            },
          },
        },
        pricing_config: {
          default_skill_pull_price_light: 5,
        },
      },
      userId: "caller_123",
      skillId: "context",
      operationId: "op_123",
      fetchFn,
    });

    assertEquals(result.receipt.id, "receipt-123");
    assertEquals(result.receipt.transferId, "transfer-123");
    assertEquals(
      calls[0].body.p_idempotency_key,
      "skill_pull:op_123:caller_123:app_123:context:transfer",
    );
    assertEquals(
      calls[1].body.p_idempotency_key,
      "skill_pull:op_123:caller_123:app_123:context",
    );
  } finally {
    globalThis.__env = previousEnv;
  }
});
