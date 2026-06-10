import { assertEquals } from "https://deno.land/std@0.210.0/assert/assert_equals.ts";
import { assertRejects } from "https://deno.land/std@0.210.0/assert/assert_rejects.ts";
import { ACTIVE_BYOK_PROVIDER_IDS, BYOK_PROVIDERS } from "../../shared/types/index.ts";
import { createAIService, getDefaultModel, getSupportedProviders, validateAPIKey } from "./ai.ts";

Deno.test("AI service routes each active BYOK provider to its configured OpenAI-compatible base URL", async () => {
  const previousFetch = globalThis.fetch;
  const calls: Array<{ url: string; auth: string; body: Record<string, unknown> }> = [];

  try {
    globalThis.fetch = (async (input, init) => {
      const body = JSON.parse(String(init?.body));
      calls.push({
        url: String(input),
        auth: new Headers(init?.headers).get("authorization") || "",
        body,
      });

      return new Response(JSON.stringify({
        model: body.model,
        choices: [{ message: { content: "ok" } }],
        usage: { prompt_tokens: 1, completion_tokens: 2 },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;

    for (const provider of ACTIVE_BYOK_PROVIDER_IDS) {
      const service = createAIService(provider, `${provider}-key`);
      const response = await service.call({
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 1,
      });
      const call = calls.at(-1);
      const info = BYOK_PROVIDERS[provider];

      assertEquals(call?.url, `${info.baseUrl.replace(/\/$/, "")}/chat/completions`);
      assertEquals(call?.auth, `Bearer ${provider}-key`);
      assertEquals(call?.body.model, info.defaultModel);
      assertEquals(response.content, "ok");
      assertEquals(response.model, info.defaultModel);
      assertEquals(response.usage.input_tokens, 1);
      assertEquals(response.usage.output_tokens, 2);
    }
  } finally {
    globalThis.fetch = previousFetch;
  }
});

Deno.test("AI service preserves explicit model overrides and OpenAI-compatible request fields", async () => {
  const previousFetch = globalThis.fetch;
  let capturedBody: Record<string, unknown> = {};

  try {
    globalThis.fetch = (async (_input, init) => {
      capturedBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        model: capturedBody.model,
        choices: [{ message: { content: "custom" } }],
        usage: { prompt_tokens: 3, completion_tokens: 4 },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;

    const service = createAIService("xai", "xai-key");
    const response = await service.call({
      model: "grok-custom-model",
      messages: [{ role: "user", content: "hi" }],
      temperature: 0.2,
      max_tokens: 7,
      tools: [{ name: "lookup", description: "Lookup", parameters: { type: "object" } }],
    });

    assertEquals(capturedBody.model, "grok-custom-model");
    assertEquals(capturedBody.temperature, 0.2);
    assertEquals(capturedBody.max_tokens, 7);
    assertEquals(Array.isArray(capturedBody.tools), true);
    assertEquals(response.content, "custom");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

Deno.test("AI service provider helpers use the active BYOK registry", () => {
  assertEquals(getSupportedProviders(), [
    "openrouter",
    "openai",
    "deepseek",
    "nvidia",
    "google",
    "xai",
  ]);
  assertEquals(getDefaultModel("nvidia"), "deepseek-ai/deepseek-v4-flash");
  assertEquals(getDefaultModel("anthropic"), "deepseek/deepseek-v4-flash");
});

Deno.test("AI key validation treats provider auth errors as invalid keys", async () => {
  const previousFetch = globalThis.fetch;

  try {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({
        error: { message: "Unauthorized API key" },
      }), { status: 401, headers: { "Content-Type": "application/json" } })) as typeof fetch;

    await assertRejects(
      () => validateAPIKey("deepseek", "bad-key"),
      Error,
      "Invalid API key for deepseek",
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});
