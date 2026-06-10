import { assertEquals } from "https://deno.land/std@0.210.0/assert/assert_equals.ts";
import { normalizeOAuthPrompt } from "./oauth-login.ts";

Deno.test("OAuth login prompt: allows select_account passthrough", () => {
  assertEquals(normalizeOAuthPrompt("select_account"), "select_account");
});

Deno.test("OAuth login prompt: trims prompt values", () => {
  assertEquals(normalizeOAuthPrompt(" select_account "), "select_account");
});

Deno.test("OAuth login prompt: rejects unsupported provider prompts", () => {
  assertEquals(normalizeOAuthPrompt("consent"), null);
  assertEquals(normalizeOAuthPrompt("login"), null);
  assertEquals(normalizeOAuthPrompt(null), null);
});
