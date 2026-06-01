import { assert } from "https://deno.land/std@0.210.0/assert/assert.ts";
import { assertEquals } from "https://deno.land/std@0.210.0/assert/assert_equals.ts";

import {
  buildCommandSuggestionSeedsFromBroker,
  type CommandSuggestionSeed,
  extractSuggestionTarget,
  marketplaceCandidateToSuggestionSeed,
  recordCommandSuggestionSet,
  serializeCommandSuggestion,
  systemAgentDelegationToSuggestionSeed,
} from "./command-suggestions.ts";
import type {
  FlashBrokerResult,
  MarketplaceCandidate,
} from "./flash-broker.ts";

const PLATFORM_SUGGESTION_ID = "00000000-0000-4000-8000-000000000101";
const LIBRARY_SUGGESTION_ID = "00000000-0000-4000-8000-000000000102";
const MARKETPLACE_SUGGESTION_ID = "00000000-0000-4000-8000-000000000103";
const APP_ID = "00000000-0000-4000-8000-000000000201";

function marketplaceCandidate(): MarketplaceCandidate {
  return {
    app: {
      id: APP_ID,
      name: "Calendar Helper",
      slug: "calendar-helper",
      description: "Finds open calendar slots and schedules meetings.",
      icon_url: null,
      runtime: "deno",
      manifest: JSON.stringify({
        functions: {
          schedule_meeting: {
            description: "Schedule a meeting",
            parameters: {},
          },
        },
        permissions: [],
      }),
      exports: ["schedule_meeting"],
      owner_id: "owner-1",
      app_type: "mcp",
      current_version: "1.0.0",
      version_metadata: [],
      visibility: "public",
      download_access: "public",
      env_schema: {},
    },
    similarity: 0.82,
    keyFunctions: ["schedule_meeting"],
  };
}

function librarySeed(): CommandSuggestionSeed {
  return {
    suggestionId: LIBRARY_SUGGESTION_ID,
    source: "library",
    target: {
      kind: "function",
      appId: APP_ID,
      appSlug: "calendar-helper",
      fnName: "schedule_meeting",
      args: { starts_at: "2026-06-02T09:00:00.000Z" },
      label: "Schedule for 9am",
    },
    name: "Schedule for 9am",
    description: "Use Calendar Helper to schedule the meeting.",
    appId: APP_ID,
    appSlug: "calendar-helper",
    appName: "Calendar Helper",
    appType: "mcp",
    keyFunctions: ["schedule_meeting"],
  };
}

function brokerResult(): FlashBrokerResult {
  return {
    needsTool: false,
    directResponse: "",
    model: "deepseek-v4-flash",
    prompt: "",
    functions: "",
    entities: [],
    conventions: [],
    involvedAppIds: [],
    toolMap: {},
    systemAgentDelegations: [{
      agentType: "tool_marketer",
      task: "Find calendar scheduling tools.",
      originalPrompt: "Can you schedule this?",
    }],
    marketplaceCandidates: [marketplaceCandidate()],
  };
}

Deno.test("command suggestions: converts system agent delegation to platform target", () => {
  const seed = systemAgentDelegationToSuggestionSeed({
    agentType: "tool_marketer",
    task: "Find a tool for calendar scheduling.",
    originalPrompt: "I need calendar scheduling.",
  }, 1);

  assert(seed);
  assertEquals(seed.source, "platform_primitive");
  assertEquals(seed.target.kind, "system_agent");
  assert(seed.target.kind === "system_agent");
  assertEquals(seed.target.agentType, "tool_marketer");
  assertEquals(seed.display?.meta, "one-click");
});

Deno.test("command suggestions: converts marketplace candidate to app target", () => {
  const seed = marketplaceCandidateToSuggestionSeed(marketplaceCandidate(), 1);
  assertEquals(seed.source, "marketplace");
  assertEquals(seed.target, {
    kind: "app",
    appId: APP_ID,
    appSlug: "calendar-helper",
  });
  assertEquals(seed.display?.meta, "install");
  assert(seed.trustCard);
});

Deno.test("command suggestions: preserves mixed source ordering and targets in one set", async () => {
  const platformSeed = systemAgentDelegationToSuggestionSeed({
    agentType: "tool_marketer",
    task: "Find scheduling tools.",
    originalPrompt: "Can you schedule this?",
  }, 1);
  assert(platformSeed);
  platformSeed.suggestionId = PLATFORM_SUGGESTION_ID;

  const marketplaceSeed = marketplaceCandidateToSuggestionSeed(
    marketplaceCandidate(),
    1,
  );
  marketplaceSeed.suggestionId = MARKETPLACE_SUGGESTION_ID;

  const result = await recordCommandSuggestionSet({
    userId: "user-1",
    conversationId: "conversation-1",
    traceId: "00000000-0000-4000-8000-000000000301",
    messageId: "message-1",
    intentSummary: "Need scheduling help",
    queryText: "Can you schedule this?",
    candidateCount: 3,
    seeds: [
      marketplaceSeed,
      librarySeed(),
      platformSeed,
    ],
  });

  assertEquals(result.suggestions.map((suggestion) => suggestion.source), [
    "platform_primitive",
    "library",
    "marketplace",
  ]);
  assertEquals(
    result.suggestions.map((suggestion) => suggestion.suggestion_id),
    [
      PLATFORM_SUGGESTION_ID,
      LIBRARY_SUGGESTION_ID,
      MARKETPLACE_SUGGESTION_ID,
    ],
  );
  assertEquals(result.suggestions.map((suggestion) => suggestion.rank), [
    1,
    2,
    3,
  ]);
  assertEquals(result.suggestions[0].target?.kind, "system_agent");
  assertEquals(result.suggestions[1].target?.kind, "function");
  assertEquals(result.suggestions[2].target?.kind, "app");
  assertEquals(
    result.telemetry.suggestions[1].metadata?.target,
    librarySeed().target,
  );
});

Deno.test("command suggestions: builds seeds from broker result", () => {
  const seeds = buildCommandSuggestionSeedsFromBroker(brokerResult());
  assertEquals(seeds.map((seed) => seed.source), [
    "platform_primitive",
    "marketplace",
  ]);
  assertEquals(seeds[0].target.kind, "system_agent");
  assertEquals(seeds[1].target.kind, "app");
});

Deno.test("command suggestions: extracts valid metadata target only", () => {
  const target = {
    kind: "prompt" as const,
    text: "Show me the calendar first.",
  };
  assertEquals(extractSuggestionTarget({ target }), target);
  assertEquals(
    extractSuggestionTarget({ target: { kind: "nope" } }),
    undefined,
  );
});

Deno.test("command suggestions: serializes non-app ids to suggestion id", () => {
  const seed = librarySeed();
  const serialized = serializeCommandSuggestion(seed, {
    ...seed,
    suggestionId: LIBRARY_SUGGESTION_ID,
    rank: 4,
  });
  assertEquals(serialized.id, LIBRARY_SUGGESTION_ID);
  assertEquals(serialized.app_id, APP_ID);
  assertEquals(serialized.type, "function");
});
