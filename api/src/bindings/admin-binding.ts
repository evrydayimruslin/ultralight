// RPC Admin Binding for Dynamic Workers (Phase 1: platform-management pilot).
// Lets the platform OWNER's own Agent code mutate platform-wide state — the
// pre-install defaults registry — without any standing god-mode key (e.g. the
// service role key) ever entering the isolate.
//
// TRUST BOUNDARY:
//   - Wired ONLY when the platform owner runs one of their OWN Agents (see the
//     dynamic-sandbox gate: userId === ownerId === PLATFORM_OWNER_USER_ID). A
//     third-party Agent run by the owner does NOT get this binding, so it cannot
//     hijack it to inject a default.
//   - Acts only for `ownerUserId`, a host-side prop set from the authenticated
//     execution context — never anything the sandbox supplies.
//   - Each call mints a short-lived owner-actor token from that id and routes
//     through handleInternalAdmin, so every mutation passes the SAME
//     authenticateInternalAdmin chokepoint as an external owner call. The token
//     stays host-side (in this parent-isolate binding); app code never sees it.

import { WorkerEntrypoint } from "cloudflare:workers";
import { createOwnerActorToken } from "../../services/owner-auth.ts";
import { handleInternalAdmin } from "../../handlers/admin-internal.ts";

interface AdminBindingProps {
  // Platform owner's user id, set host-side from config.userId (gated to the
  // owner) — never a sandbox input.
  ownerUserId: string;
}

const INTERNAL_BASE = "https://internal/api/admin/internal";

export class AdminBinding extends WorkerEntrypoint<unknown, AdminBindingProps> {
  private async call(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    const { token } = await createOwnerActorToken({
      userId: this.ctx.props.ownerUserId,
    });
    const request = new Request(`${INTERNAL_BASE}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const response = await handleInternalAdmin(request);
    const text = await response.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = { raw: text };
    }
    if (!response.ok) {
      const msg = parsed && typeof parsed === "object" && "error" in parsed
        ? String((parsed as { error: unknown }).error)
        : `platform admin request failed (${response.status})`;
      throw new Error(msg);
    }
    return parsed;
  }

  async defaultsList(): Promise<unknown> {
    return await this.call("GET", "/defaults");
  }

  async defaultsAdd(appId: unknown, badge?: unknown): Promise<unknown> {
    if (typeof appId !== "string" || !appId.trim()) {
      throw new Error("defaultsAdd requires an app id string");
    }
    return await this.call("POST", "/defaults", {
      app_id: appId.trim(),
      badge: typeof badge === "string" && badge.trim() ? badge.trim() : null,
    });
  }

  async defaultsRemove(appId: unknown): Promise<unknown> {
    if (typeof appId !== "string" || !appId.trim()) {
      throw new Error("defaultsRemove requires an app id string");
    }
    return await this.call(
      "DELETE",
      `/defaults/${encodeURIComponent(appId.trim())}`,
    );
  }
}
