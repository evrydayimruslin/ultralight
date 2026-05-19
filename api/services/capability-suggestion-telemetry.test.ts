import { assert } from "https://deno.land/std@0.210.0/assert/assert.ts";
import { assertEquals } from "https://deno.land/std@0.210.0/assert/assert_equals.ts";

import {
  recordCapabilitySuggestionEvent,
  recordCapabilitySuggestionSet,
} from "./capability-suggestion-telemetry.ts";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const TRACE_ID = "00000000-0000-4000-8000-000000000002";
const APP_ID = "00000000-0000-4000-8000-000000000003";

type FetchPost = {
  url: string;
  method: string;
  body: unknown;
};

function installTelemetryEnv(posts: FetchPost[]) {
  const previousEnv = globalThis.__env;
  const previousFetch = globalThis.fetch;

  globalThis.__env = {
    CHAT_CAPTURE_ENABLED: "true",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    ANALYTICS_PEPPER_V1: "test-pepper",
    FN_INDEX: {
      put: () => Promise.resolve(),
      get: () => Promise.resolve(null),
    },
  } as unknown as typeof globalThis.__env;

  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
    const method = init?.method || "GET";
    if (method !== "GET") {
      posts.push({
        url,
        method,
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
    }

    if (method === "GET" && url.includes("/rest/v1/apps")) {
      return Promise.resolve(new Response("[]", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    }
    if (method === "GET" && url.includes("/rest/v1/user_app_library")) {
      return Promise.resolve(new Response("[]", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    }

    return Promise.resolve(new Response("", { status: 201 }));
  }) as typeof fetch;

  return async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    globalThis.fetch = previousFetch;
    globalThis.__env = previousEnv;
  };
}

Deno.test("capability suggestion telemetry: records intent, set, suggestions, and suggested events", async () => {
  const posts: FetchPost[] = [];
  const restore = installTelemetryEnv(posts);

  try {
    const result = await recordCapabilitySuggestionSet({
      userId: USER_ID,
      conversationId: "conversation-1",
      traceId: TRACE_ID,
      messageId: "message-1",
      intentSummary: "Need a CRM helper",
      queryText: "Find a tool for CRM follow-ups",
      candidateCount: 1,
      suggestions: [{
        appId: APP_ID,
        appSlug: "crm-helper",
        appName: "CRM Helper",
        rank: 1,
        similarity: 0.81,
        keyFunctions: ["create_follow_up"],
      }],
    });

    assert(result.intentId);
    assert(result.suggestionSetId);
    assertEquals(result.suggestions.length, 1);
    assert(result.suggestions[0].suggestionId);

    const intentPost = posts.find((post) => post.url.includes("/capability_intents"));
    const setPost = posts.find((post) => post.url.includes("/capability_suggestion_sets"));
    const suggestionPost = posts.find((post) => post.url.includes("/capability_suggestions"));
    const eventPost = posts.find((post) => post.url.includes("/capability_suggestion_events"));

    assert(intentPost);
    assertEquals((intentPost.body as { conversation_id: string }).conversation_id, "conversation-1");
    assert(setPost);
    assertEquals((setPost.body as { suggestion_count: number }).suggestion_count, 1);
    assert(suggestionPost);
    assertEquals(
      (suggestionPost.body as Array<{ app_id: string; app_slug: string }>)[0].app_id,
      APP_ID,
    );
    assert(eventPost);
    assertEquals(
      (eventPost.body as Array<{ event_type: string; suggestion_id: string }>)[0].event_type,
      "suggested",
    );
  } finally {
    await restore();
  }
});

Deno.test("capability suggestion telemetry: accepted events install the app library row", async () => {
  const posts: FetchPost[] = [];
  const restore = installTelemetryEnv(posts);

  try {
    const result = await recordCapabilitySuggestionEvent({
      userId: USER_ID,
      eventType: "accepted",
      conversationId: "conversation-1",
      traceId: TRACE_ID,
      messageId: "message-1",
      appId: APP_ID,
      appSlug: "crm-helper",
      suggestionId: "00000000-0000-4000-8000-000000000004",
    });

    assert(result.eventId);
    assertEquals(result.libraryInstalled, true);

    const libraryPost = posts.find((post) => post.url.includes("/user_app_library"));
    assert(libraryPost);
    assertEquals((libraryPost.body as { user_id: string; app_id: string; source: string }), {
      user_id: USER_ID,
      app_id: APP_ID,
      source: "ambient_suggestion_accept",
    });

    const eventPost = posts.find((post) => post.url.includes("/capability_suggestion_events"));
    assert(eventPost);
    assertEquals((eventPost.body as { event_type: string; library_installed: boolean }).event_type, "accepted");
    assertEquals((eventPost.body as { event_type: string; library_installed: boolean }).library_installed, true);
  } finally {
    await restore();
  }
});
