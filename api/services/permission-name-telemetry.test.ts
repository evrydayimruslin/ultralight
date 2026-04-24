import { assertEquals } from "https://deno.land/std@0.210.0/assert/assert_equals.ts";

import {
  buildLegacyPermissionNameLogEntry,
  logLegacyPermissionNameCompatibility,
} from "./permission-name-telemetry.ts";

Deno.test("permission name telemetry: builds log entries with alias details", () => {
  assertEquals(
    buildLegacyPermissionNameLogEntry({
      surface: "runtime_permission_fetch",
      appId: "app-123",
      appSlug: "demo-app",
      actorUserId: "user-123",
      ownerUserId: "owner-123",
      aliases: [
        { alias: "demo-app_search", canonical: "search" },
        { alias: "demo-app_list", canonical: "list" },
      ],
      note: "compat read-path still active",
    }),
    {
      event: "legacy_mcp_permission_name",
      surface: "runtime_permission_fetch",
      app_id: "app-123",
      app_slug: "demo-app",
      actor_user_id: "user-123",
      owner_user_id: "owner-123",
      alias_count: 2,
      legacy_aliases: ["demo-app_search", "demo-app_list"],
      canonical_names: ["search", "list"],
      note: "compat read-path still active",
    },
  );
});

Deno.test("permission name telemetry: logs only when legacy aliases are present", () => {
  const calls: Array<{ message: string; context?: Record<string, unknown> }> =
    [];
  const logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: (message: string, context?: Record<string, unknown>) => {
      calls.push({ message, context });
    },
    error: () => undefined,
  };

  assertEquals(
    logLegacyPermissionNameCompatibility(
      {
        surface: "pending_invite_resolution",
        appId: "app-123",
        appSlug: "demo-app",
        actorUserId: "user-123",
        rows: [
          { function_name: "demo-app_search" },
          { function_name: "list" },
        ],
      },
      { logger },
    ),
    1,
  );
  assertEquals(calls.length, 1);
  assertEquals(calls[0], {
    message: "Legacy MCP permission names normalized",
    context: {
      event: "legacy_mcp_permission_name",
      surface: "pending_invite_resolution",
      app_id: "app-123",
      app_slug: "demo-app",
      actor_user_id: "user-123",
      owner_user_id: undefined,
      alias_count: 1,
      legacy_aliases: ["demo-app_search"],
      canonical_names: ["search"],
      note: undefined,
    },
  });

  calls.length = 0;
  assertEquals(
    logLegacyPermissionNameCompatibility(
      {
        surface: "pending_invite_resolution",
        appId: "app-123",
        appSlug: "demo-app",
        rows: [{ function_name: "search" }],
      },
      { logger },
    ),
    0,
  );
  assertEquals(calls.length, 0);
});
