import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.210.0/assert/mod.ts";

import {
  buildServerLogRecord,
  createServerLogger,
  sanitizeLogContext,
} from "./logging.ts";

Deno.test("logging: sanitizes nested auth and PII fields", () => {
  const context = sanitizeLogContext({
    authorization: "Bearer secret-token",
    user_email: "user@example.com",
    nested: {
      refresh_token: "refresh-token",
      headers: {
        cookie: "session=abc",
      },
    },
  });

  assertEquals(context, {
    authorization: "[REDACTED]",
    user_email: "[REDACTED]",
    nested: {
      refresh_token: "[REDACTED]",
      headers: {
        cookie: "[REDACTED]",
      },
    },
  });
});

Deno.test("logging: builds structured records and redacts errors", () => {
  const record = buildServerLogRecord("AUTH", "error", "Session bootstrap failed", {
    route: "/auth/session",
    token: "ul_secret",
    error: new Error("db offline"),
  });

  assertEquals(record.scope, "AUTH");
  assertEquals(record.level, "error");
  assertStringIncludes(String(record.ts), "T");
  assertEquals(record.context, {
    route: "/auth/session",
    token: "[REDACTED]",
    error: { name: "Error", message: "db offline" },
  });
});

Deno.test("logging: server logger writes JSON records and suppresses debug by default", () => {
  const calls: Array<{ level: string; args: unknown[] }> = [];
  const logger = createServerLogger("TELEMETRY", {
    sink: {
      info: (...args: unknown[]) => calls.push({ level: "info", args }),
      warn: (...args: unknown[]) => calls.push({ level: "warn", args }),
      error: (...args: unknown[]) => calls.push({ level: "error", args }),
      debug: (...args: unknown[]) => calls.push({ level: "debug", args }),
      log: (...args: unknown[]) => calls.push({ level: "log", args }),
    },
  });

  logger.debug("debug only", { token: "hidden" });
  logger.warn("legacy flow", { token: "hidden", route: "/mcp" });

  assertEquals(calls.length, 1);
  assertEquals(calls[0].level, "warn");
  assertEquals(calls[0].args[0], "[TELEMETRY]");
  assertStringIncludes(String(calls[0].args[1]), "\"message\":\"legacy flow\"");
  assertStringIncludes(String(calls[0].args[1]), "\"token\":\"[REDACTED]\"");
});
