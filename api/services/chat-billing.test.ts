import { assertEquals } from "https://deno.land/std@0.210.0/assert/assert_equals.ts";
import { CHAT_PLATFORM_MARKUP } from "../../shared/contracts/ai.ts";
import { calculateCostLight } from "./chat-billing.ts";

Deno.test("chat billing: OpenRouter total_cost is debited at pass-through Light rate", () => {
  assertEquals(CHAT_PLATFORM_MARKUP, 1.0);

  const costLight = calculateCostLight(
    { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 },
    "deepseek/deepseek-v4-flash",
    0.1234,
  );

  assertEquals(costLight, 12.34);
});
