// Defaults Manager — a PRIVATE platform-management Agent for the platform owner.
// Its functions curate the pre-install defaults registry: the set of Agents that
// NEW accounts are seeded with at first sign-in (forward-only — editing it never
// touches existing users).
//
// It reaches platform state through the host-side ADMIN binding, which the
// runtime wires ONLY when the platform owner runs THIS (their own) Agent — see
// api/runtime/dynamic-sandbox.ts. No credential ever enters this code; the SDK
// surface throws "owner only" if the binding is absent. Deploy PRIVATE.
//
// This is instance #1 of the reusable "internal platform API as a private agent"
// pattern: a private owner Agent -> ultralight.admin -> ADMIN binding ->
// /api/admin/internal/* (owner-actor gated).

// deno-lint-ignore no-explicit-any
const ultralight = (globalThis as any).ultralight;

/** List the current default-install Agents (with live/installable status). */
export async function list_defaults() {
  return await ultralight.admin.defaultsList();
}

/** Add (or re-enable) an Agent as a platform default by app id. Future signups only. */
export async function add_default(args: { app_id: string; badge?: string }) {
  const appId = (args?.app_id || "").toString().trim();
  if (!appId) throw new Error("app_id is required");
  return await ultralight.admin.defaultsAdd(appId, args?.badge);
}

/** Remove an Agent from the defaults. Stops future seeding; existing users keep it. */
export async function remove_default(args: { app_id: string }) {
  const appId = (args?.app_id || "").toString().trim();
  if (!appId) throw new Error("app_id is required");
  return await ultralight.admin.defaultsRemove(appId);
}
