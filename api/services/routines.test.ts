import {
  assertEquals,
  assertRejects,
  assertThrows,
} from "https://deno.land/std@0.210.0/assert/mod.ts";

import {
  createRoutine,
  createRoutineRun,
  listRoutines,
  normalizeRoutineCreateInput,
  recordRoutineRunStep,
  routineCapabilitiesFromManifest,
  updateRoutineRun,
} from "./routines.ts";

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
  });
}

function routineRow(body: Record<string, unknown>) {
  return {
    id: "routine-1",
    user_id: body.user_id,
    composer_app_id: body.composer_app_id ?? null,
    composer_app_slug: body.composer_app_slug ?? null,
    template_id: body.template_id,
    template_version: body.template_version ?? null,
    name: body.name,
    description: body.description ?? null,
    intent: body.intent ?? null,
    handler_function: body.handler_function,
    status: body.status ?? "paused",
    schedule: body.schedule,
    config: body.config,
    budget_policy: body.budget_policy,
    approval_policy: body.approval_policy,
    max_concurrency: body.max_concurrency ?? 1,
    next_run_at: body.next_run_at ?? null,
    last_run_at: null,
    last_success_at: null,
    last_error_at: null,
    failure_count: 0,
    created_by_trace_id: body.created_by_trace_id ?? null,
    metadata: body.metadata ?? {},
    created_at: "2026-05-17T12:00:00Z",
    updated_at: body.updated_at ?? "2026-05-17T12:00:00Z",
    deleted_at: null,
  };
}

Deno.test("routines: normalizes schedules, capability fan-out, and manifest capabilities", () => {
  const normalized = normalizeRoutineCreateInput({
    template_id: "sales_followup_loop",
    name: "Sales follow-up",
    handler_function: "poll_email_followups",
    schedule: { every_minutes: 5 },
    config: { max_emails: 20 },
    budget_policy: { max_light_per_day: 500 },
    capabilities: [{
      app_ref: "email-drafter",
      functions: ["draft_reply", "summarize_thread"],
      access: "write",
      purpose: "Prepare reviewable replies",
    }],
  });

  assertEquals(normalized.routine.schedule, {
    type: "interval",
    every_minutes: 5,
  });
  assertEquals(normalized.capabilities.length, 2);
  assertEquals(normalized.capabilities[0].access, "write");

  assertEquals(
    routineCapabilitiesFromManifest([{
      app: "crm",
      functions: ["log_followup"],
      access: "write",
    }]),
    [{
      app_ref: "crm",
      function_name: "log_followup",
      access: "write",
      required: true,
      purpose: null,
    }],
  );

  assertThrows(
    () =>
      normalizeRoutineCreateInput({
        template_id: "bad",
        handler_function: "handler",
        schedule: { every_minutes: 0 },
      }),
    Error,
    "every_minutes",
  );

  assertThrows(
    () =>
      normalizeRoutineCreateInput({
        template_id: "bad",
        handler_function: "handler",
        capabilities: [{
          app_ref: "mail",
          functions: ["send"],
          access: "admin",
        }],
      }),
    Error,
    "access",
  );
});

Deno.test("routines: creates routine instances with capabilities and dashboard bindings", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = globalThis.__env;
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  globalThis.__env = {
    ...(originalEnv || {}),
    SUPABASE_URL: "https://supabase.example",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
  };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input.toString();
    const method = init?.method || "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body });

    if (url.includes("/user_routines") && method === "POST") {
      return jsonResponse([routineRow(body as Record<string, unknown>)]);
    }
    if (url.includes("/routine_capabilities") && method === "POST") {
      return jsonResponse(
        (body as Array<Record<string, unknown>>).map((row, index) => ({
          id: `cap-${index}`,
          created_at: "2026-05-17T12:00:00Z",
          updated_at: "2026-05-17T12:00:00Z",
          approved_by_user_id: row.approved ? row.user_id : null,
          ...row,
        })),
      );
    }
    if (url.includes("/routine_dashboard_bindings") && method === "POST") {
      return jsonResponse(
        (body as Array<Record<string, unknown>>).map((row, index) => ({
          id: `binding-${index}`,
          created_at: "2026-05-17T12:00:00Z",
          ...row,
        })),
      );
    }
    return jsonResponse([]);
  }) as typeof fetch;

  try {
    const routine = await createRoutine("user-1", {
      composer_app_id: "app-compose",
      composer_app_slug: "routine-composer",
      template_id: "sales_followup_loop",
      template_version: "1.2.3",
      name: "Sales follow-up",
      handler_function: "poll_email_followups",
      schedule: "*/5 * * * *",
      capabilities: [{
        app_ref: "email-drafter",
        function_name: "draft_reply",
        access: "write",
      }],
      dashboard_bindings: [{
        dashboard_key: "command_home",
        widget_id: "email_ops",
        card_id: "pending_drafts",
      }],
    });

    assertEquals(routine.id, "routine-1");
    assertEquals(routine.status, "paused");
    assertEquals(routine.schedule, { type: "cron", cron: "*/5 * * * *" });
    assertEquals(routine.capabilities[0].app_ref, "email-drafter");
    assertEquals(routine.dashboard_bindings[0].widget_id, "email_ops");
    assertEquals(calls.length, 3);
    assertEquals(
      calls[0].body && (calls[0].body as Record<string, unknown>).user_id,
      "user-1",
    );
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.__env = originalEnv;
  }
});

Deno.test("routines: lists user-owned routine summaries", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = globalThis.__env;
  globalThis.__env = {
    ...(originalEnv || {}),
    SUPABASE_URL: "https://supabase.example",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
  };
  globalThis.fetch = (async () =>
    jsonResponse([
      routineRow({
        user_id: "user-1",
        template_id: "daily_digest",
        name: "Daily digest",
        handler_function: "run_digest",
        schedule: { type: "cron", cron: "0 9 * * *" },
        config: {},
        budget_policy: {},
        approval_policy: {},
      }),
    ])) as typeof fetch;

  try {
    const result = await listRoutines("user-1", { status: "paused" });
    assertEquals(result.routines.length, 1);
    assertEquals(result.routines[0].template_id, "daily_digest");
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.__env = originalEnv;
  }
});

Deno.test("routines: records runs, steps, and terminal run status", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = globalThis.__env;
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  globalThis.__env = {
    ...(originalEnv || {}),
    SUPABASE_URL: "https://supabase.example",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
  };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input.toString();
    const method = init?.method || "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body });

    if (url.includes("/routine_runs") && method === "POST") {
      return jsonResponse([{
        id: "run-1",
        created_at: "2026-05-17T12:00:00Z",
        completed_at: null,
        duration_ms: null,
        total_light: 0,
        summary: null,
        error: null,
        ...body,
      }]);
    }
    if (url.includes("/routine_run_steps") && method === "POST") {
      return jsonResponse([{
        id: "step-1",
        created_at: "2026-05-17T12:00:01Z",
        started_at: "2026-05-17T12:00:01Z",
        ...body,
      }]);
    }
    if (url.includes("/routine_runs") && method === "PATCH") {
      return jsonResponse([{
        id: "run-1",
        routine_id: "routine-1",
        user_id: "user-1",
        trigger: "manual",
        trace_id: null,
        started_at: "2026-05-17T12:00:00Z",
        duration_ms: 1200,
        run_config: {},
        created_at: "2026-05-17T12:00:00Z",
        ...body,
      }]);
    }
    return jsonResponse([]);
  }) as typeof fetch;

  try {
    const run = await createRoutineRun({
      routineId: "routine-1",
      userId: "user-1",
      trigger: "manual",
      status: "running",
    });
    const step = await recordRoutineRunStep({
      runId: run.id,
      routineId: "routine-1",
      userId: "user-1",
      stepIndex: 0,
      appRef: "email-drafter",
      functionName: "draft_reply",
      status: "succeeded",
      costLight: 2.5,
    });
    const completed = await updateRoutineRun(run.id, "user-1", {
      status: "succeeded",
      summary: "Drafted one reply.",
      totalLight: 2.5,
    });

    assertEquals(run.status, "running");
    assertEquals(step.status, "succeeded");
    assertEquals(step.cost_light, 2.5);
    assertEquals(completed.status, "succeeded");
    assertEquals(completed.total_light, 2.5);
    assertEquals(calls.map((call) => call.method), ["POST", "POST", "PATCH"]);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.__env = originalEnv;
  }
});

Deno.test("routines: propagates Supabase write failures", async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = globalThis.__env;
  globalThis.__env = {
    ...(originalEnv || {}),
    SUPABASE_URL: "https://supabase.example",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
  };
  globalThis.fetch =
    (async () => new Response("bad write", { status: 500 })) as typeof fetch;

  try {
    await assertRejects(
      () =>
        createRoutine("user-1", {
          template_id: "broken",
          handler_function: "run",
        }),
      Error,
      "bad write",
    );
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.__env = originalEnv;
  }
});
