import { assertEquals } from "https://deno.land/std@0.210.0/assert/assert_equals.ts";
import { assertRejects } from "https://deno.land/std@0.210.0/assert/assert_rejects.ts";

import { validateCapabilitySuggestionEventRequest } from "./capability-suggestion-validation.ts";
import { RequestValidationError } from "./request-validation.ts";

const INTENT_ID = "11111111-1111-4111-8111-111111111111";
const SET_ID = "22222222-2222-4222-8222-222222222222";
const SUGGESTION_ID = "33333333-3333-4333-8333-333333333333";
const TRACE_ID = "44444444-4444-4444-8444-444444444444";
const APP_ID = "55555555-5555-4555-8555-555555555555";

Deno.test("capability suggestion validation: accepts normalized event payload", async () => {
  const payload = await validateCapabilitySuggestionEventRequest(
    new Request("https://example.com/chat/capability-suggestion-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event_type: "accepted",
        intent_id: INTENT_ID,
        suggestion_set_id: SET_ID,
        suggestion_id: SUGGESTION_ID,
        conversation_id: "conversation-1",
        trace_id: TRACE_ID,
        message_id: "message-1",
        app_id: APP_ID,
        app_slug: "crm-helper",
        event_source: "composer",
        metadata: { position: 1 },
      }),
    }),
  );

  assertEquals(payload, {
    eventType: "accepted",
    intentId: INTENT_ID,
    suggestionSetId: SET_ID,
    suggestionId: SUGGESTION_ID,
    conversationId: "conversation-1",
    traceId: TRACE_ID,
    messageId: "message-1",
    appId: APP_ID,
    appSlug: "crm-helper",
    eventSource: "composer",
    installOnAccept: undefined,
    metadata: { position: 1 },
  });
});

Deno.test("capability suggestion validation: accepted events require app_id by default", async () => {
  await assertRejects(
    async () => {
      await validateCapabilitySuggestionEventRequest(
        new Request("https://example.com/chat/capability-suggestion-event", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event_type: "accepted",
            suggestion_id: SUGGESTION_ID,
          }),
        }),
      );
    },
    RequestValidationError,
    "app_id is required",
  );
});

Deno.test("capability suggestion validation: accepts non-app target accepts without app_id", async () => {
  const systemAgentPayload = await validateCapabilitySuggestionEventRequest(
    new Request("https://example.com/chat/capability-suggestion-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event_type: "accepted",
        suggestion_id: SUGGESTION_ID,
        metadata: {
          target: {
            kind: "system_agent",
            agentType: "tool_marketer",
            task: "Find tools for live FX rates",
          },
        },
      }),
    }),
  );

  assertEquals(systemAgentPayload.appId, undefined);
  assertEquals(systemAgentPayload.metadata, {
    target: {
      kind: "system_agent",
      agentType: "tool_marketer",
      task: "Find tools for live FX rates",
    },
  });

  const functionPayload = await validateCapabilitySuggestionEventRequest(
    new Request("https://example.com/chat/capability-suggestion-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event_type: "accepted",
        suggestion_id: SUGGESTION_ID,
        metadata: {
          target: {
            kind: "function",
            appId: "app-email",
            appSlug: "email-ops",
            fnName: "send_draft",
            args: { draft_id: "draft-1" },
          },
        },
      }),
    }),
  );

  assertEquals(functionPayload.appId, undefined);
  assertEquals(functionPayload.metadata?.target, {
    kind: "function",
    appId: "app-email",
    appSlug: "email-ops",
    fnName: "send_draft",
    args: { draft_id: "draft-1" },
  });

  const promptPayload = await validateCapabilitySuggestionEventRequest(
    new Request("https://example.com/chat/capability-suggestion-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event_type: "accepted",
        suggestion_id: SUGGESTION_ID,
        install_on_accept: false,
        metadata: {
          target: {
            kind: "prompt",
            text: "Summarize these drafts instead.",
          },
        },
      }),
    }),
  );

  assertEquals(promptPayload.installOnAccept, false);
  assertEquals(promptPayload.metadata?.target, {
    kind: "prompt",
    text: "Summarize these drafts instead.",
  });
});

Deno.test("capability suggestion validation: rejects malformed suggestion target metadata", async () => {
  await assertRejects(
    async () => {
      await validateCapabilitySuggestionEventRequest(
        new Request("https://example.com/chat/capability-suggestion-event", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event_type: "accepted",
            suggestion_id: SUGGESTION_ID,
            metadata: {
              target: {
                kind: "system_agent",
                agentType: "unknown_agent",
                task: "Do something",
              },
            },
          }),
        }),
      );
    },
    RequestValidationError,
    "metadata.target must be a valid suggestion target",
  );
});

Deno.test("capability suggestion validation: rejects unknown events and fields", async () => {
  await assertRejects(
    async () => {
      await validateCapabilitySuggestionEventRequest(
        new Request("https://example.com/chat/capability-suggestion-event", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ event_type: "clicked" }),
        }),
      );
    },
    RequestValidationError,
    "event_type must be one of",
  );

  await assertRejects(
    async () => {
      await validateCapabilitySuggestionEventRequest(
        new Request("https://example.com/chat/capability-suggestion-event", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event_type: "dismissed",
            unexpected: true,
          }),
        }),
      );
    },
    RequestValidationError,
    "Unsupported field",
  );
});
