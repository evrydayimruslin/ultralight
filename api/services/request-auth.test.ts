import { assertEquals } from "https://deno.land/std@0.210.0/assert/assert_equals.ts";

import {
  type PendingPermissionRow,
  resolvePendingPermissionRows,
} from "./request-auth.ts";

Deno.test("request auth: resolvePendingPermissionRows normalizes legacy prefixed function names", () => {
  const pendingRows: PendingPermissionRow[] = [
    {
      app_id: "app-1",
      granted_by_user_id: "owner-1",
      function_name: "demo-app_search",
      allowed: true,
      allowed_args: { q: ["launch"] },
    },
    {
      app_id: "app-2",
      app_slug: "notes",
      granted_by_user_id: "owner-2",
      function_name: "notes_write",
      allowed: false,
    },
    {
      app_id: "app-3",
      granted_by_user_id: "owner-3",
      function_name: "list",
      allowed: true,
      allowed_args: null,
    },
  ];

  assertEquals(
    resolvePendingPermissionRows(pendingRows, "user-123", {
      "app-1": "demo-app",
    }),
    [
      {
        app_id: "app-1",
        granted_to_user_id: "user-123",
        granted_by_user_id: "owner-1",
        function_name: "search",
        allowed: true,
        allowed_args: { q: ["launch"] },
      },
      {
        app_id: "app-2",
        granted_to_user_id: "user-123",
        granted_by_user_id: "owner-2",
        function_name: "write",
        allowed: false,
      },
      {
        app_id: "app-3",
        granted_to_user_id: "user-123",
        granted_by_user_id: "owner-3",
        function_name: "list",
        allowed: true,
        allowed_args: null,
      },
    ],
  );
});
