import { assertEquals } from "https://deno.land/std@0.210.0/assert/assert_equals.ts";
import {
  buildLegacyAuthTransportLogEntry,
  classifyLegacyAuthTokenShape,
} from "./auth-transport.ts";

Deno.test("auth transport: classifies personal API tokens", () => {
  assertEquals(classifyLegacyAuthTokenShape("ul_abcdef123456"), "api_token");
});

Deno.test("auth transport: classifies JWT-style tokens", () => {
  assertEquals(classifyLegacyAuthTokenShape("aaa.bbb.ccc"), "jwt");
});

Deno.test("auth transport: builds safe log entries without raw tokens", () => {
  const entry = buildLegacyAuthTransportLogEntry({
    kind: "query_token_used",
    surface: "mcp_query_token",
    path: "/mcp/app-123",
    method: "POST",
    token: "ul_secret_token_value",
    isEmbed: false,
    note: "app:app-123",
  });

  assertEquals(entry.kind, "query_token_used");
  assertEquals(entry.surface, "mcp_query_token");
  assertEquals(entry.path, "/mcp/app-123");
  assertEquals(entry.token_shape, "api_token");
  assertEquals(entry.token_length, "ul_secret_token_value".length);
});

Deno.test("auth transport: supports rejected legacy query token telemetry", () => {
  const entry = buildLegacyAuthTransportLogEntry({
    kind: "query_token_rejected",
    surface: "http_query_token",
    path: "/http/app-123/ui",
    method: "GET",
    token: "jwt.header.signature",
  });

  assertEquals(entry.kind, "query_token_rejected");
  assertEquals(entry.token_shape, "jwt");
  assertEquals(entry.path, "/http/app-123/ui");
});
