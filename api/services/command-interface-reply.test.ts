import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.210.0/assert/mod.ts";

import { flattenCommandSurfaceInventory } from "./command-surfaces.ts";
import {
  clearInterfaceDescriptorCacheForTests,
  proposeInterfaceReply,
} from "./command-interface-reply.ts";
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
    needsTool: false,
    directResponse: "Here are the pending approvals.",
    model: "deepseek-v4-flash",
    prompt: "",
    functions: "",
    entities: [],
    conventions: [],
    involvedAppIds: ["app-email"],
    toolMap: {
      email_ops_list_approvals: {
        appId: "app-email",
        appName: "Email Ops",
        appSlug: "email-ops",
        fnName: "list_approvals",
        origin: "library",
      },
    },
  };
}

function makeFunctionIndex(): FunctionIndex {
  return {
    functions: {
      email_ops_list_approvals: {
        appId: "app-email",
        appSlug: "email-ops",
        fnName: "list_approvals",
        description: "[Email Ops] List pending email approvals and draft replies",
        params: {
          status: { type: "string", required: false },
        },
        returns: "Approval[]",
        conventions: [],
        dependsOn: [],
      },
    },
    widgets: [{
      name: "email_approvals",
      label: "Email Approvals",
      description: "Review pending approvals",
      appId: "app-email",
      appSlug: "email-ops",
      appName: "Email Ops",
      uiFunction: "widget_email_approvals_ui",
      dataFunction: "widget_email_approvals_data",
      cards: [{
        id: "pending_approvals",
        label: "Pending Approvals",
        description: "Drafts waiting for review",
        size: "2x1",
        render: "native",
        kind: "table",
        dataView: "pending",
      }],
    }],
    contextSources: [{
      id: "approval_threads",
      appId: "app-email",
      appSlug: "email-ops",
      appName: "Email Ops",
      label: "Approval Threads",
      description: "Searchable approval threads",
      type: "d1_table",
      access: "read",
      searchable: true,
      tables: ["approval_threads"],
    }],
    routines: [],
    types: "",
    updatedAt: "2026-05-30T00:00:00.000Z",
  };
}

Deno.test("command interface reply: emits a verified LLM spec", async () => {
  clearInterfaceDescriptorCacheForTests();
  const fnIndex = makeFunctionIndex();
  const result = await proposeInterfaceReply({
    brokerResult: makeBrokerResult(),
    replyText: "Here are the pending approvals.",
    userMessage: "show pending approvals",
    userId: "user-1",
    userEmail: "user@example.com",
    route: makeRoute(),
    dependencies: {
      getFunctionIndex: async () => fnIndex,
      callFlashText: async () => JSON.stringify({
        render: true,
        spec: {
          id: "pending_approval_queue",
          title: "Pending Approval Queue",
          mode: "temporary",
          data_bindings: [{
            id: "approvals",
            source: "mcp_read_function",
            app_id: "app-email",
            app_slug: "email-ops",
            function_name: "list_approvals",
            args: { status: "pending" },
          }],
          components: [{
            id: "approvals_table",
            kind: "table",
            title: "Approvals",
            data_binding_id: "approvals",
            columns: [{
              id: "subject",
              label: "Subject",
              field: "subject",
            }],
          }],
          version: 1,
        },
      }),
    },
  });

  assert(result);
  assertEquals(result.source, "llm");
  assertEquals(result.spec.components[0].kind, "table");
  assertEquals(result.spec.data_bindings?.[0].source, "mcp_read_function");
});

Deno.test("command interface reply: malformed model output falls back", async () => {
  clearInterfaceDescriptorCacheForTests();
  const fnIndex = makeFunctionIndex();
  const result = await proposeInterfaceReply({
    brokerResult: makeBrokerResult(),
    replyText: "Here are the pending approvals.",
    userMessage: "show pending approvals",
    userId: "user-1",
    userEmail: "user@example.com",
    route: makeRoute(),
    dependencies: {
      getFunctionIndex: async () => fnIndex,
      getCommandSurfaceInventory: async (_userId, index, brokerResult, query) =>
        flattenCommandSurfaceInventory(index, {
          query,
          surfaces: ["command_card", "widget"],
          app_ids: brokerResult.involvedAppIds,
        }),
      callFlashText: async () => "{ definitely not valid json",
    },
  });

  assert(result);
  assertEquals(result.source, "fallback");
  assert(result.spec.components.length > 0);
});

Deno.test("command interface reply: no app context returns null", async () => {
  clearInterfaceDescriptorCacheForTests();
  const result = await proposeInterfaceReply({
    brokerResult: {
      ...makeBrokerResult(),
      involvedAppIds: [],
      toolMap: {},
    },
    replyText: "Two plus two is four.",
    userMessage: "what is 2+2?",
    userId: "user-1",
    userEmail: "user@example.com",
    route: makeRoute(),
    dependencies: {
      getFunctionIndex: async () => makeFunctionIndex(),
      callFlashText: async () => {
        throw new Error("should not call model");
      },
    },
  });

  assertEquals(result, null);
});

Deno.test("command interface reply: repeated prompt-shape reuses descriptor cache", async () => {
  clearInterfaceDescriptorCacheForTests();
  const fnIndex = makeFunctionIndex();
  let calls = 0;
  const dependencies = {
    getFunctionIndex: async () => fnIndex,
    callFlashText: async () => {
      calls += 1;
      return JSON.stringify({
        render: true,
        spec: {
          id: "pending_approval_queue",
          title: "Pending Approval Queue",
          mode: "temporary",
          data_bindings: [{
            id: "approvals",
            source: "mcp_read_function",
            app_id: "app-email",
            app_slug: "email-ops",
            function_name: "list_approvals",
            args: { status: "pending" },
          }],
          components: [{
            id: "approvals_table",
            kind: "table",
            title: "Approvals",
            data_binding_id: "approvals",
            columns: [{
              id: "subject",
              label: "Subject",
              field: "subject",
            }],
          }],
          version: 1,
        },
      });
    },
  };

  const first = await proposeInterfaceReply({
    brokerResult: makeBrokerResult(),
    replyText: "Here are the pending approvals.",
    userMessage: "show pending approvals",
    userId: "user-1",
    userEmail: "user@example.com",
    route: makeRoute(),
    dependencies,
  });
  const second = await proposeInterfaceReply({
    brokerResult: makeBrokerResult(),
    replyText: "Here are the pending approvals.",
    userMessage: "please show my pending approvals",
    userId: "user-1",
    userEmail: "user@example.com",
    route: makeRoute(),
    dependencies,
  });

  assert(first);
  assert(second);
  assertEquals(first.source, "llm");
  assertEquals(second.source, "cache");
  assertEquals(calls, 1);
  clearInterfaceDescriptorCacheForTests();
});

Deno.test("command interface reply: descriptor cache invalidates when tool set changes", async () => {
  clearInterfaceDescriptorCacheForTests();
  const fnIndex = makeFunctionIndex();
  let calls = 0;
  const dependencies = {
    getFunctionIndex: async () => fnIndex,
    callFlashText: async () => {
      calls += 1;
      return JSON.stringify({
        render: true,
        spec: {
          id: "pending_approval_queue",
          title: "Pending Approval Queue",
          mode: "temporary",
          data_bindings: [{
            id: "approvals",
            source: "mcp_read_function",
            app_id: "app-email",
            app_slug: "email-ops",
            function_name: "list_approvals",
            args: { status: "pending" },
          }],
          components: [{
            id: "approvals_table",
            kind: "table",
            title: "Approvals",
            data_binding_id: "approvals",
            columns: [{
              id: "subject",
              label: "Subject",
              field: "subject",
            }],
          }],
          version: 1,
        },
      });
    },
  };

  await proposeInterfaceReply({
    brokerResult: makeBrokerResult(),
    replyText: "Here are the pending approvals.",
    userMessage: "show pending approvals",
    userId: "user-1",
    userEmail: "user@example.com",
    route: makeRoute(),
    dependencies,
  });

  const changedIndex = {
    ...fnIndex,
    updatedAt: "2026-05-31T00:00:00.000Z",
  };
  const second = await proposeInterfaceReply({
    brokerResult: makeBrokerResult(),
    replyText: "Here are the pending approvals.",
    userMessage: "show pending approvals",
    userId: "user-1",
    userEmail: "user@example.com",
    route: makeRoute(),
    dependencies: {
      ...dependencies,
      getFunctionIndex: async () => changedIndex,
    },
  });

  assert(second);
  assertEquals(second.source, "llm");
  assertEquals(calls, 2);
  clearInterfaceDescriptorCacheForTests();
});
