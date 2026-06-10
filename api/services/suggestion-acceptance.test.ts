import { assert } from "https://deno.land/std@0.210.0/assert/assert.ts";
import { assertEquals } from "https://deno.land/std@0.210.0/assert/assert_equals.ts";
import { assertStringIncludes } from "https://deno.land/std@0.210.0/assert/assert_string_includes.ts";

import {
  acceptSuggestion,
  type SuggestionAcceptanceDependencies,
} from "./suggestion-acceptance.ts";
import type { CapabilitySuggestionEventInput } from "./capability-suggestion-telemetry.ts";
import type { SuggestionRow } from "./suggestion-preview.ts";
import type { SuggestionTarget } from "../../shared/contracts/suggestions.ts";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const APP_ID = "00000000-0000-4000-8000-000000000002";
const SUGGESTION_ID = "00000000-0000-4000-8000-000000000003";
const SUGGESTION_SET_ID = "00000000-0000-4000-8000-000000000004";
const INTENT_ID = "00000000-0000-4000-8000-000000000005";

function makeRow(target: SuggestionTarget): SuggestionRow {
  return {
    id: SUGGESTION_ID,
    suggestion_set_id: SUGGESTION_SET_ID,
    intent_id: INTENT_ID,
    user_id: USER_ID,
    app_id: target.kind === "app" || target.kind === "function"
      ? target.appId
      : null,
    app_slug: target.kind === "app" || target.kind === "function"
      ? target.appSlug || null
      : null,
    app_name: "Calendar Helper",
    suggestion_source: target.kind === "system_agent"
      ? "platform_primitive"
      : "library",
    rank: 1,
    similarity: 0.9,
    key_functions: ["schedule_meeting"],
    metadata: {
      target,
      display: {
        label: "Schedule the meeting",
        description: "Use the suggested capability.",
      },
    },
  };
}

function dependenciesFor(target: SuggestionTarget, options: {
  libraryInstalled?: boolean;
  events?: CapabilitySuggestionEventInput[];
  installs?: Array<{ userId: string; appId: string }>;
} = {}): SuggestionAcceptanceDependencies {
  return {
    fetchSuggestionRow: async () => makeRow(target),
    recordEvent: async (input) => {
      options.events?.push(input);
      return {
        eventId: "00000000-0000-4000-8000-000000000006",
        libraryInstalled: false,
      };
    },
    installAcceptedApp: async (userId, appId) => {
      options.installs?.push({ userId, appId });
      return options.libraryInstalled ?? true;
    },
  };
}

Deno.test("suggestion acceptance: app target installs app and records accepted event", async () => {
  const events: CapabilitySuggestionEventInput[] = [];
  const installs: Array<{ userId: string; appId: string }> = [];
  const result = await acceptSuggestion({
    userId: USER_ID,
    suggestionId: SUGGESTION_ID,
    conversationId: "conversation-1",
    dependencies: dependenciesFor({
      kind: "app",
      appId: APP_ID,
      appSlug: "calendar-helper",
    }, { events, installs, libraryInstalled: true }),
  });

  assertEquals(result, {
    ok: true,
    kind: "installed_app",
    suggestionId: SUGGESTION_ID,
    appId: APP_ID,
    appSlug: "calendar-helper",
    libraryInstalled: true,
  });
  assertEquals(installs, [{ userId: USER_ID, appId: APP_ID }]);
  assertEquals(events.length, 1);
  assertEquals(events[0].eventType, "accepted");
  assertEquals(events[0].appId, APP_ID);
  assertEquals(events[0].installOnAccept, false);
  assertEquals(events[0].intentId, INTENT_ID);
  assertEquals(events[0].suggestionSetId, SUGGESTION_SET_ID);
  assertEquals(
    events[0].metadata?.accept_result_kind,
    "installed_app",
  );
});

Deno.test("suggestion acceptance: Tool Dealer target returns inline discover command", async () => {
  const events: CapabilitySuggestionEventInput[] = [];
  const result = await acceptSuggestion({
    userId: USER_ID,
    suggestionId: SUGGESTION_ID,
    dependencies: dependenciesFor({
      kind: "system_agent",
      agentType: "tool_marketer",
      task: "Find scheduling tools. Search marketplace for good options.",
      originalPrompt: "Find scheduling tools",
    }, { events }),
  });

  assert(result.ok);
  assertEquals(result.kind, "inline_discover");
  assertEquals(result.query, "Find scheduling tools");
  assertEquals(result.content, "{{discover:Find scheduling tools}}");
  assertEquals(events[0].installOnAccept, false);
  assertEquals(
    events[0].metadata?.accept_result_kind,
    "inline_discover",
  );
});

Deno.test("suggestion acceptance: system agent target starts orchestrate with context", async () => {
  const result = await acceptSuggestion({
    userId: USER_ID,
    suggestionId: SUGGESTION_ID,
    dependencies: dependenciesFor({
      kind: "system_agent",
      agentType: "tool_builder",
      task: "Build a scheduling widget.",
    }),
  });

  assert(result.ok);
  assertEquals(result.kind, "start_orchestrate");
  assertEquals(result.systemAgentContext?.type, "tool_builder");
  assertStringIncludes(
    result.systemAgentContext?.persona || "",
    "Tool Maker",
  );
  assertStringIncludes(result.message, "Build a scheduling widget.");
});

Deno.test("suggestion acceptance: function target returns plan-gated verified action prompt", async () => {
  const events: CapabilitySuggestionEventInput[] = [];
  const result = await acceptSuggestion({
    userId: USER_ID,
    suggestionId: SUGGESTION_ID,
    dependencies: dependenciesFor({
      kind: "function",
      appId: APP_ID,
      appSlug: "calendar-helper",
      fnName: "schedule_meeting",
      args: { starts_at: "2026-06-02T09:00:00.000Z" },
      label: "Schedule for 9am",
    }, { events }),
  });

  assert(result.ok);
  assertEquals(result.kind, "start_orchestrate");
  assertEquals(result.autoConfirmFirstPlan, false);
  assertStringIncludes(result.message, "Use the existing app/tool context");
  assertStringIncludes(result.message, '"kind": "mcp_function"');
  assertStringIncludes(result.message, `"app_id": "${APP_ID}"`);
  assertStringIncludes(result.message, '"function_name": "schedule_meeting"');
  assertStringIncludes(
    result.message,
    '"starts_at": "2026-06-02T09:00:00.000Z"',
  );
  assertEquals(events[0].appId, APP_ID);
  assertEquals(events[0].appSlug, "calendar-helper");
});

Deno.test("suggestion acceptance: prompt target returns prefill text", async () => {
  const result = await acceptSuggestion({
    userId: USER_ID,
    suggestionId: SUGGESTION_ID,
    dependencies: dependenciesFor({
      kind: "prompt",
      text: "Show me the calendar before scheduling.",
    }),
  });

  assertEquals(result, {
    ok: true,
    kind: "prefill_prompt",
    suggestionId: SUGGESTION_ID,
    text: "Show me the calendar before scheduling.",
  });
});
