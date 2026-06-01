import { assert } from "https://deno.land/std@0.210.0/assert/assert.ts";
import { assertEquals } from "https://deno.land/std@0.210.0/assert/assert_equals.ts";

import { clearCommandDescriptorCacheForTests } from "./command-descriptor-cache.ts";
import {
  buildSuggestionPreviewDescriptor,
  type SuggestionPreviewApp,
  type SuggestionRow,
} from "./suggestion-preview.ts";
import type { FunctionIndex } from "./function-index.ts";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const APP_ID = "00000000-0000-4000-8000-000000000002";
const SUGGESTION_ID = "00000000-0000-4000-8000-000000000003";

function makeFunctionIndex(): FunctionIndex {
  return {
    functions: {
      calendar_schedule_meeting: {
        appId: APP_ID,
        appSlug: "calendar-helper",
        fnName: "schedule_meeting",
        description: "[Calendar Helper] Schedule a meeting",
        params: {
          starts_at: { type: "string", required: true },
          title: { type: "string", required: false },
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
    updatedAt: "2026-06-01T00:00:00.000Z",
  };
}

function makeApp(): SuggestionPreviewApp {
  return {
    id: APP_ID,
    owner_id: "owner-1",
    slug: "calendar-helper",
    name: "Calendar Helper",
    description: "Finds open slots and schedules meetings.",
    icon_url: null,
    visibility: "public",
    download_access: "public",
    current_version: "1.0.0",
    version_metadata: [],
    exports: ["schedule_meeting"],
    env_schema: {},
    manifest: JSON.stringify({
      functions: {
        schedule_meeting: {
          description: "Schedule a meeting",
          parameters: {},
        },
      },
      permissions: ["calendar:write"],
    }),
    app_type: "mcp",
    runtime: "deno",
    pricing_config: {
      default_price_light: 3,
      functions: {
        schedule_meeting: { price_light: 7 },
      },
    },
  };
}

function makeRow(target: unknown): SuggestionRow {
  return {
    id: SUGGESTION_ID,
    user_id: USER_ID,
    app_id: APP_ID,
    app_slug: "calendar-helper",
    app_name: "Calendar Helper",
    suggestion_source: "library",
    similarity: 0.88,
    key_functions: ["schedule_meeting"],
    metadata: {
      target,
      display: {
        label: "Schedule for 9am",
        description: "Schedule the meeting with Calendar Helper.",
      },
    },
  };
}

Deno.test("suggestion preview: app descriptor includes functions, trust, and install state", async () => {
  clearCommandDescriptorCacheForTests("suggestion_preview");
  const descriptor = await buildSuggestionPreviewDescriptor({
    userId: USER_ID,
    suggestionId: SUGGESTION_ID,
    dependencies: {
      fetchSuggestionRow: async () =>
        makeRow({
          kind: "app",
          appId: APP_ID,
          appSlug: "calendar-helper",
        }),
      getFunctionIndex: async () => makeFunctionIndex(),
      findAppById: async () => makeApp(),
      isAppInstalled: async () => true,
    },
  });

  assertEquals(descriptor.kind, "app");
  assert(descriptor.kind === "app");
  assertEquals(descriptor.name, "Calendar Helper");
  assertEquals(descriptor.functions?.[0].name, "schedule_meeting");
  assertEquals(descriptor.functions?.[0].cost_light, 7);
  assert(descriptor.trust_card);
  assertEquals(
    (descriptor.marketplace as { installed?: boolean }).installed,
    true,
  );
  assertEquals(
    (descriptor.marketplace as { permissions?: string[] }).permissions,
    ["calendar:write"],
  );
});

Deno.test("suggestion preview: system-agent descriptor includes skills and touch scope", async () => {
  clearCommandDescriptorCacheForTests("suggestion_preview");
  const descriptor = await buildSuggestionPreviewDescriptor({
    userId: USER_ID,
    suggestionId: SUGGESTION_ID,
    dependencies: {
      fetchSuggestionRow: async () =>
        makeRow({
          kind: "system_agent",
          agentType: "tool_marketer",
          task: "Find scheduling tools.",
        }),
    },
  });

  assertEquals(descriptor.kind, "system_agent");
  assert(descriptor.kind === "system_agent");
  assertEquals(descriptor.name, "Tool Dealer");
  assertEquals(descriptor.skillsPath, "system-agents/tool_marketer/skills.md");
  assert(descriptor.touchScope?.includes("marketplace_search"));
});

Deno.test("suggestion preview: function descriptor includes inferred args and signature", async () => {
  clearCommandDescriptorCacheForTests("suggestion_preview");
  const descriptor = await buildSuggestionPreviewDescriptor({
    userId: USER_ID,
    suggestionId: SUGGESTION_ID,
    dependencies: {
      fetchSuggestionRow: async () =>
        makeRow({
          kind: "function",
          appId: APP_ID,
          appSlug: "calendar-helper",
          fnName: "schedule_meeting",
          args: { starts_at: "2026-06-02T09:00:00.000Z" },
          label: "Schedule for 9am",
        }),
      getFunctionIndex: async () => makeFunctionIndex(),
      findAppById: async () => makeApp(),
      isAppInstalled: async () => false,
    },
  });

  assertEquals(descriptor.kind, "function");
  assert(descriptor.kind === "function");
  assertEquals(descriptor.fnName, "schedule_meeting");
  assertEquals(descriptor.args, { starts_at: "2026-06-02T09:00:00.000Z" });
  assertEquals(descriptor.cost_light, 7);
  assert(descriptor.signature?.includes("starts_at: string"));
});

Deno.test("suggestion preview: prompt descriptor includes prompt effect", async () => {
  clearCommandDescriptorCacheForTests("suggestion_preview");
  const descriptor = await buildSuggestionPreviewDescriptor({
    userId: USER_ID,
    suggestionId: SUGGESTION_ID,
    dependencies: {
      fetchSuggestionRow: async () =>
        makeRow({
          kind: "prompt",
          text: "Show me the calendar first.",
        }),
    },
  });

  assertEquals(descriptor, {
    kind: "prompt",
    suggestionId: SUGGESTION_ID,
    text: "Show me the calendar first.",
    description: "Schedule the meeting with Calendar Helper.",
  });
});

Deno.test("suggestion preview: cache hit returns descriptor without rebuilding", async () => {
  clearCommandDescriptorCacheForTests("suggestion_preview");
  let fetchCount = 0;
  let indexCount = 0;
  const dependencies = {
    fetchSuggestionRow: async () => {
      fetchCount += 1;
      return makeRow({
        kind: "function",
        appId: APP_ID,
        appSlug: "calendar-helper",
        fnName: "schedule_meeting",
        args: { starts_at: "2026-06-02T09:00:00.000Z" },
      });
    },
    getFunctionIndex: async () => {
      indexCount += 1;
      return makeFunctionIndex();
    },
    findAppById: async () => makeApp(),
    isAppInstalled: async () => false,
  };

  const first = await buildSuggestionPreviewDescriptor({
    userId: USER_ID,
    suggestionId: SUGGESTION_ID,
    dependencies,
  });
  const second = await buildSuggestionPreviewDescriptor({
    userId: USER_ID,
    suggestionId: SUGGESTION_ID,
    dependencies,
  });

  assertEquals(first, second);
  assertEquals(fetchCount, 1);
  assertEquals(indexCount, 1);
});
