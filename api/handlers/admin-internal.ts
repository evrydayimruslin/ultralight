// Internal platform-admin routes — owner-actor gated (NOT the service-role gate
// that /api/admin uses). This is the reusable "internal platform API exposed as a
// private agent" chokepoint: every mutation passes authenticateInternalAdmin,
// which accepts ONLY a gxo_ owner-actor token whose signed user_id is the
// platform owner. The owner's private Defaults Manager agent reaches it via the
// host-side ADMIN runtime binding; nothing else can mint a gxo_ token.

import { authenticateInternalAdmin } from "../services/owner-auth.ts";
import {
  addDefault,
  listDefaults,
  PlatformDefaultsError,
  removeDefault,
} from "../services/platform-defaults.ts";
import { error, json } from "./response.ts";

export async function handleInternalAdmin(request: Request): Promise<Response> {
  // Single owner-only gate. Fail-closed: missing/invalid/expired/non-owner token
  // or an unconfigured PLATFORM_OWNER_USER_ID all return 401.
  const ownerId = await authenticateInternalAdmin(request);
  if (!ownerId) {
    return error("Unauthorized: a platform owner-actor token is required", 401);
  }

  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  try {
    if (path === "/api/admin/internal/defaults" && method === "GET") {
      return json({ defaults: await listDefaults() });
    }

    if (path === "/api/admin/internal/defaults" && method === "POST") {
      const body = await request.json().catch(() => ({})) as {
        app_id?: string;
        badge?: string | null;
      };
      const entry = await addDefault({
        appId: String(body.app_id ?? ""),
        badge: body.badge ?? null,
        addedBy: ownerId,
      });
      return json({ default: entry }, 201);
    }

    const delMatch = path.match(
      /^\/api\/admin\/internal\/defaults\/([^/]+)$/,
    );
    if (delMatch && method === "DELETE") {
      return json(await removeDefault(decodeURIComponent(delMatch[1])));
    }

    return error("Not found", 404);
  } catch (err) {
    if (err instanceof PlatformDefaultsError) {
      return error(err.message, err.status);
    }
    console.error("[INTERNAL-ADMIN] defaults error:", err);
    return error("Internal error", 500);
  }
}
