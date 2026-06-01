import { assertEquals } from "https://deno.land/std@0.210.0/assert/assert_equals.ts";
import { assert } from "https://deno.land/std@0.210.0/assert/assert.ts";
import {
  actionNextStepToFunctionTarget,
  buildCandidateFunctions,
  nextStepToSuggestionSeed,
  parseRawNextSteps,
  promptNextStepToPromptTarget,
  proposeNextSteps,
} from "./command-next-steps.ts";
import type { FlashBrokerResult } from "./flash-broker.ts";
import type { FunctionIndex } from "./function-index.ts";
import type { ResolvedInferenceRoute } from "./inference-route.ts";

function makeRoute(): ResolvedInferenceRoute {
  return {
    billingMode: "light",
    provider: "ultralight",
    upstreamProvider: "deepseek",
    baseUrl: "https://api.deepseek.test",
    apiKey: "deepseek-key",
    model: "deepseek-v4-flash",
    canonicalModelId: "ultralight/deepseek-v4-flash",
    billingModelId: "ultralight/deepseek-v4-flash",
    keySource: "platform_deepseek",
    billingSource: "platform_deepseek_direct",
    shouldRequireBalance: true,
    shouldDebitLight: true,
  };
}

function makeBrokerResult(): FlashBrokerResult {
  return {
    needsTool: true,
    directResponse: "",
    model: "deepseek-v4-pro",
    prompt: "Fulfill the request.",
    functions: "",
    entities: [],
    conventions: [],
    involvedAppIds: ["app-email"],
    toolMap: {
      email_send_draft: {
        appId: "app-email",
        appName: "Email Ops",
        appSlug: "email",
        fnName: "send_draft",
        origin: "library",
      },
    },
  };
}

function makeFunctionIndex(): FunctionIndex {
  return {
    functions: {
      email_send_draft: {
        appId: "app-email",
        appSlug: "email",
        fnName: "send_draft",
        description: "[Email Ops] Send a prepared email draft",
        params: {
          draft_id: { type: "string", required: true },
        },
        returns: "object",
        conventions: [],
        dependsOn: [],
      },
    },
    widgets: [],
    contextSources: [],
    routines: [],
    types: "",
    updatedAt: "2026-05-30T00:00:00.000Z",
  };
}

Deno.test("command next steps: parses fenced JSON", () => {
  const steps = parseRawNextSteps(
    '```json\n{"steps":[{"kind":"suggest_prompt","label":"Ask","prompt":"What next?"}]}\n```',
  );
  assertEquals(steps.length, 1);
  assertEquals(steps[0].kind, "suggest_prompt");
});

Deno.test("command next steps: builds candidates from broker tool map", () => {
  const candidates = buildCandidateFunctions(makeBrokerResult());
  assertEquals(candidates, [{
    toolName: "email_send_draft",
    appId: "app-email",
    appName: "Email Ops",
    appSlug: "email",
    fnName: "send_draft",
    origin: "library",
  }]);
});

Deno.test("command next steps: converts action step to function target", () => {
  const step = {
    id: "action_send_drafts",
    kind: "action" as const,
    label: "Send the drafts",
    preview: true,
    action: {
      id: "action_send_drafts",
      kind: "mcp_function" as const,
      label: "Send the drafts",
      mode: "write" as const,
      confirmation: "user" as const,
      app_id: "app-email",
      app_slug: "email",
      function_name: "send_draft",
      args_template: { draft_id: "draft-1" },
    },
  };

  assertEquals(actionNextStepToFunctionTarget(step), {
    kind: "function",
    appId: "app-email",
    appSlug: "email",
    fnName: "send_draft",
    args: { draft_id: "draft-1" },
    label: "Send the drafts",
  });
});

Deno.test("command next steps: converts prompt step to prompt target", () => {
  const step = {
    id: "suggest_summarize",
    kind: "suggest_prompt" as const,
    label: "Summarize instead",
    prompt: "Summarize these drafts instead.",
  };

  assertEquals(promptNextStepToPromptTarget(step), {
    kind: "prompt",
    text: "Summarize these drafts instead.",
  });
});

Deno.test("command next steps: converts next-step action to library suggestion seed", () => {
  const step = {
    id: "action_send_drafts",
    kind: "action" as const,
    label: "Send the drafts",
    preview: true,
    action: {
      id: "action_send_drafts",
      kind: "mcp_function" as const,
      label: "Send the drafts",
      mode: "write" as const,
      confirmation: "user" as const,
      app_id: "app-email",
      app_slug: "email",
      function_name: "send_draft",
      args_template: { draft_id: "draft-1" },
      expected_result: "Sends the prepared email draft.",
    },
  };

  const seed = nextStepToSuggestionSeed(step, makeBrokerResult());
  assert(seed);
  assertEquals(seed.source, "library");
  assertEquals(seed.target.kind, "function");
  assert(seed.target.kind === "function");
  assertEquals(seed.target.fnName, "send_draft");
  assertEquals(seed.appName, "Email Ops");
  assertEquals(seed.metadata?.next_step_id, "action_send_drafts");
});

Deno.test("command next steps: drops unknown actions and verifies writes", async () => {
  const steps = await proposeNextSteps({
    brokerResult: makeBrokerResult(),
    replyText: "I drafted the investor replies.",
    userMessage: "Draft replies to today's investor emails",
    userId: "user-1",
    userEmail: "user@example.com",
    route: makeRoute(),
    dependencies: {
      callFlashText: async () =>
        JSON.stringify({
          steps: [
            {
              kind: "action",
              label: "Send the drafts",
              tool_name: "email_send_draft",
              args: { draft_id: "draft-1" },
            },
            {
              kind: "action",
              label: "Invented action",
              tool_name: "email_delete_everything",
              args: {},
            },
            {
              kind: "suggest_prompt",
              label: "Summarize instead",
              prompt: "Summarize these drafts instead.",
            },
          ],
        }),
      getFunctionIndex: async () => makeFunctionIndex(),
    },
  });

  assertEquals(steps.length, 2);
  const action = steps[0];
  assertEquals(action.kind, "action");
  assert(action.kind === "action");
  assertEquals(action.action.kind, "mcp_function");
  assertEquals(action.action.function_name, "send_draft");
  assertEquals(action.action.mode, "write");
  assertEquals(action.action.confirmation, "user");
  assertEquals(action.preview, true);
  assertEquals(action.action.args_template, { draft_id: "draft-1" });
  assertEquals(steps[1].kind, "suggest_prompt");
});
