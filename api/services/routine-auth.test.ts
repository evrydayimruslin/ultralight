import { assert } from "https://deno.land/std@0.210.0/assert/assert.ts";
import { assertEquals } from "https://deno.land/std@0.210.0/assert/assert_equals.ts";
import { assertRejects } from "https://deno.land/std@0.210.0/assert/assert_rejects.ts";

import {
  createRoutineActorToken,
  createRoutineActorTokenForRun,
  ROUTINE_ACTOR_TOKEN_PREFIX,
  routineActorScopeFromCapabilities,
  verifyRoutineActorToken,
} from "./routine-auth.ts";

const SECRET = "routine-actor-test-secret";
const NOW = new Date("2026-05-17T12:00:00.000Z");

Deno.test("routine auth: creates scoped ephemeral actor tokens", async () => {
  const created = await createRoutineActorToken(
    {
      user: {
        id: "user-1",
        email: "manager@example.com",
        tier: "pro",
      },
      routine: {
        id: "routine-1",
        composerAppSlug: "email-ops",
        handlerFunction: "draft_followups",
        budgetPolicy: { max_light_per_run: 25, max_calls_per_run: 12 },
      },
      routineRunId: "run-1",
      traceId: "trace-1",
      tokenId: "token-1",
      expiresInSeconds: 300,
      capabilities: [
        {
          app_id: "crm-app-id",
          app_ref: "crm",
          function_name: "log_lead",
          access: "write",
          approved: true,
          constraints: { max_calls: 3 },
        },
        {
          app_ref: "calendar",
          function_name: "schedule_followup",
          approved: false,
        },
      ],
    },
    { secret: SECRET, now: NOW },
  );

  assert(created.token.startsWith(ROUTINE_ACTOR_TOKEN_PREFIX));
  assertEquals(created.claims.app_ids, ["crm", "crm-app-id", "email-ops"]);
  assertEquals(created.claims.function_names, [
    "draft_followups",
    "log_lead",
  ]);
  assertEquals(created.claims.scopes, ["apps:call"]);
  assertEquals(created.claims.capabilities, [
    {
      app_id: "crm-app-id",
      app_ref: "crm",
      function_name: "log_lead",
      access: "write",
      required: true,
      constraints: { max_calls: 3 },
    },
  ]);

  const verified = await verifyRoutineActorToken(created.token, {
    secret: SECRET,
    now: NOW,
  });
  assertEquals(verified?.claims.routine_id, "routine-1");
  assertEquals(verified?.claims.routine_run_id, "run-1");
  assertEquals(verified?.claims.trace_id, "trace-1");
  assertEquals(verified?.claims.budget_policy, {
    max_light_per_run: 25,
    max_calls_per_run: 12,
  });
});

Deno.test("routine auth: derives scope from approved capabilities only", () => {
  assertEquals(
    routineActorScopeFromCapabilities({
      routine: {
        id: "routine-1",
        composerAppId: "composer-app-id",
        composerAppSlug: "composer",
        handlerFunction: "run",
      },
      capabilities: [
        {
          app_ref: "approved",
          function_name: "go",
          approved: true,
        },
        {
          app_ref: "pending",
          function_name: "wait",
          approved: false,
        },
      ],
    }),
    {
      appIds: ["approved", "composer", "composer-app-id"],
      functionNames: ["go", "run"],
      capabilities: [
        {
          app_id: null,
          app_ref: "approved",
          function_name: "go",
          access: "read",
          required: true,
        },
      ],
    },
  );
});

Deno.test("routine auth: mints from stored routine and run rows", async () => {
  const created = await createRoutineActorTokenForRun(
    {
      user: { id: "user-1", email: "manager@example.com" },
      routine: {
        id: "routine-1",
        composer_app_id: "composer-app-id",
        composer_app_slug: "composer",
        handler_function: "run",
        budget_policy: { max_light_per_day: 100 },
        capabilities: [
          {
            app_ref: "contracts",
            function_name: "generate",
            approved: true,
          },
        ],
      },
      run: { id: "run-1", trace_id: "trace-1" },
      tokenId: "token-from-rows",
    },
    { secret: SECRET, now: NOW },
  );

  assertEquals(created.claims.jti, "token-from-rows");
  assertEquals(created.claims.app_ids, [
    "composer",
    "composer-app-id",
    "contracts",
  ]);
  assertEquals(created.claims.function_names, ["generate", "run"]);
  assertEquals(created.claims.budget_policy, { max_light_per_day: 100 });
});

Deno.test("routine auth: rejects tampered and expired tokens", async () => {
  const created = await createRoutineActorToken(
    {
      user: { id: "user-1", email: "manager@example.com" },
      routine: {
        id: "routine-1",
        composerAppSlug: "email-ops",
        handlerFunction: "draft_followups",
      },
      routineRunId: "run-1",
      expiresInSeconds: 1,
    },
    { secret: SECRET, now: NOW },
  );

  const tampered = `${created.token.slice(0, -1)}${
    created.token.endsWith("A") ? "B" : "A"
  }`;
  assertEquals(
    await verifyRoutineActorToken(tampered, { secret: SECRET, now: NOW }),
    null,
  );
  assertEquals(
    await verifyRoutineActorToken(created.token, {
      secret: SECRET,
      now: new Date("2026-05-17T12:00:02.000Z"),
    }),
    null,
  );
});

Deno.test("routine auth: refuses unscoped actor tokens", async () => {
  await assertRejects(
    () =>
      createRoutineActorToken(
        {
          user: { id: "user-1", email: "manager@example.com" },
          routine: { id: "routine-1" },
          routineRunId: "run-1",
        },
        { secret: SECRET, now: NOW },
      ),
    Error,
    "at least one app identifier",
  );
});
