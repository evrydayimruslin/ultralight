import { assertEquals } from "https://deno.land/std@0.210.0/assert/assert_equals.ts";
import type { ResolvedInferenceRoute } from "./inference-route.ts";
import {
  buildInferenceHeaders,
  fetchInferenceChatCompletion,
  getInferenceChatCompletionsUrl,
  selectInferenceModel,
} from "./inference-client.ts";

function makeRoute(overrides: Partial<ResolvedInferenceRoute> = {}): ResolvedInferenceRoute {
  return {
    billingMode: "light",
    provider: "openrouter",
    baseUrl: "https://openrouter.test/api/v1/",
    apiKey: "route-key",
    model: "deepseek/deepseek-v4-flash",
    keySource: "platform_openrouter",
    shouldRequireBalance: true,
    shouldDebitLight: true,
    ...overrides,
  };
}

Deno.test("inference client: Light mode honors requested model overrides", () => {
  const route = makeRoute();
  assertEquals(selectInferenceModel(route, "openai/gpt-4o-mini"), "openai/gpt-4o-mini");
  assertEquals(selectInferenceModel(route, "  "), "deepseek/deepseek-v4-flash");
});

Deno.test("inference client: BYOK mode stays on the resolved provider model", () => {
  const route = makeRoute({
    billingMode: "byok",
    provider: "deepseek",
    baseUrl: "https://api.deepseek.com",
    apiKey: "ds-key",
    model: "deepseek-v4-pro",
    keySource: "user_byok",
    shouldRequireBalance: false,
    shouldDebitLight: false,
  });

  assertEquals(selectInferenceModel(route, "google/gemini-3.1-flash-lite-preview:nitro"), "deepseek-v4-pro");
});

Deno.test("inference client: builds OpenAI-compatible chat requests from the route", async () => {
  const previousFetch = globalThis.fetch;
  let capturedUrl = "";
  let capturedHeaders = new Headers();
  let capturedBody: Record<string, unknown> = {};

  try {
    globalThis.fetch = (async (input, init) => {
      capturedUrl = String(input);
      capturedHeaders = new Headers(init?.headers);
      capturedBody = JSON.parse(String(init?.body));
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    const route = makeRoute();
    const response = await fetchInferenceChatCompletion(
      route,
      { model: "deepseek/deepseek-v4-flash", messages: [] },
      { title: "Ultralight Test", referer: "https://ultralight.test" },
    );

    assertEquals(response.status, 200);
    assertEquals(capturedUrl, getInferenceChatCompletionsUrl(route));
    assertEquals(capturedHeaders.get("authorization"), "Bearer route-key");
    assertEquals(capturedHeaders.get("content-type"), "application/json");
    assertEquals(capturedHeaders.get("http-referer"), "https://ultralight.test");
    assertEquals(capturedHeaders.get("x-title"), "Ultralight Test");
    assertEquals(capturedBody.model, "deepseek/deepseek-v4-flash");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

Deno.test("inference client: strips trailing base URL slash", () => {
  assertEquals(
    getInferenceChatCompletionsUrl(makeRoute({ baseUrl: "https://api.x.ai/v1/" })),
    "https://api.x.ai/v1/chat/completions",
  );
});
