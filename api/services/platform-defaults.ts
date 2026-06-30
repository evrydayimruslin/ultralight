// Platform default-install registry mutations — the single implementation behind
// both the owner's "Defaults Manager" agent (via the ADMIN runtime binding) and
// the /api/admin/internal/defaults routes, all gated by authenticateInternalAdmin
// (owner-actor only). FORWARD-ONLY: editing the registry changes future-signup
// seeding; it never writes to existing users' libraries.

import { getEnv } from "../lib/env.ts";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

function db() {
  const url = getEnv("SUPABASE_URL");
  const key = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  return {
    url,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    } as Record<string, string>,
  };
}

export class PlatformDefaultsError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export interface DefaultAppEntry {
  app_id: string;
  name: string | null;
  slug: string | null;
  visibility: string | null;
  badge: string | null;
  position: number;
  enabled: boolean;
  removed_at: string | null;
  added_at: string;
  /** Whether the underlying Agent is currently live + installable. */
  installable: boolean;
}

interface RegistryRow {
  app_id: string;
  badge: string | null;
  position: number;
  enabled: boolean;
  removed_at: string | null;
  added_at: string;
}

interface AppRow {
  id: string;
  name: string;
  slug: string;
  visibility: string;
  deleted_at: string | null;
}

function isInstallable(a: AppRow | undefined): boolean {
  return !!a && a.deleted_at === null &&
    (a.visibility === "public" || a.visibility === "unlisted");
}

/** List every registry entry (enabled and retired), with resolved app metadata. */
export async function listDefaults(): Promise<DefaultAppEntry[]> {
  const { url, headers } = db();
  const res = await fetch(
    `${url}/rest/v1/platform_default_apps` +
      `?select=app_id,badge,position,enabled,removed_at,added_at&order=position.asc`,
    { headers },
  );
  if (!res.ok) throw new PlatformDefaultsError("Failed to read the registry", 502);
  const rows = await res.json() as RegistryRow[];
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.app_id);
  const appsRes = await fetch(
    `${url}/rest/v1/apps?id=in.(${ids.join(",")})` +
      `&select=id,name,slug,visibility,deleted_at`,
    { headers },
  );
  const apps = appsRes.ok ? await appsRes.json() as AppRow[] : [];
  const byId = new Map(apps.map((a) => [a.id, a]));

  return rows.map((r) => {
    const a = byId.get(r.app_id);
    return {
      app_id: r.app_id,
      name: a?.name ?? null,
      slug: a?.slug ?? null,
      visibility: a?.visibility ?? null,
      badge: r.badge,
      position: r.position,
      enabled: r.enabled,
      removed_at: r.removed_at,
      added_at: r.added_at,
      installable: isInstallable(a),
    };
  });
}

/** Add (or re-enable) an Agent as a platform default. Validates live+installable. */
export async function addDefault(input: {
  appId: string;
  badge?: string | null;
  addedBy: string;
}): Promise<DefaultAppEntry> {
  const appId = input.appId?.trim();
  if (!appId || !isUuid(appId)) {
    throw new PlatformDefaultsError("A valid app_id (uuid) is required", 400);
  }
  const { url, headers } = db();

  // The Agent must exist, be live, and be installable (public/unlisted). Seeding
  // a private/deleted Agent would drop an unusable row into every new library.
  const appRes = await fetch(
    `${url}/rest/v1/apps?id=eq.${appId}` +
      `&select=id,name,slug,visibility,deleted_at&limit=1`,
    { headers },
  );
  if (!appRes.ok) {
    throw new PlatformDefaultsError("Failed to validate the Agent", 502);
  }
  const app = (await appRes.json() as AppRow[])[0];
  if (!app) throw new PlatformDefaultsError("Agent not found", 404);
  if (app.deleted_at !== null) {
    throw new PlatformDefaultsError("Agent is deleted", 409);
  }
  if (!isInstallable(app)) {
    throw new PlatformDefaultsError(
      "Agent must be public or unlisted to be a default (it is private)",
      409,
    );
  }

  // Append after the current max position so new adds go last and order is
  // deterministic (a re-enabled entry is re-appended).
  const posRes = await fetch(
    `${url}/rest/v1/platform_default_apps?select=position&order=position.desc&limit=1`,
    { headers },
  );
  const posRows = posRes.ok
    ? await posRes.json() as Array<{ position: number }>
    : [];
  const nextPosition = (posRows[0]?.position ?? -1) + 1;

  // Upsert on the app_id primary key: a fresh add inserts; re-adding a retired
  // default re-enables it (enabled=true, removed_at=null).
  const upsertRes = await fetch(`${url}/rest/v1/platform_default_apps`, {
    method: "POST",
    headers: {
      ...headers,
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify({
      app_id: appId,
      badge: input.badge?.trim() || null,
      enabled: true,
      removed_at: null,
      added_by: input.addedBy,
      position: nextPosition,
    }),
  });
  if (!upsertRes.ok) {
    throw new PlatformDefaultsError(
      `Failed to add default: ${(await upsertRes.text()).slice(0, 200)}`,
      502,
    );
  }
  const row = (await upsertRes.json() as RegistryRow[])[0];
  return {
    app_id: appId,
    name: app.name,
    slug: app.slug,
    visibility: app.visibility,
    badge: row?.badge ?? (input.badge?.trim() || null),
    position: row?.position ?? nextPosition,
    enabled: true,
    removed_at: null,
    added_at: row?.added_at ?? new Date().toISOString(),
    installable: true,
  };
}

/** Soft-retire a default: stops FUTURE seeding; existing users keep theirs. */
export async function removeDefault(
  appId: string,
): Promise<{ app_id: string; removed: boolean }> {
  const id = appId?.trim();
  if (!id || !isUuid(id)) {
    throw new PlatformDefaultsError("A valid app_id (uuid) is required", 400);
  }
  const { url, headers } = db();
  const res = await fetch(
    `${url}/rest/v1/platform_default_apps?app_id=eq.${id}`,
    {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=representation" },
      body: JSON.stringify({
        enabled: false,
        removed_at: new Date().toISOString(),
      }),
    },
  );
  if (!res.ok) {
    throw new PlatformDefaultsError(
      `Failed to remove default: ${(await res.text()).slice(0, 200)}`,
      502,
    );
  }
  const updated = await res.json() as RegistryRow[];
  if (updated.length === 0) {
    throw new PlatformDefaultsError("Default not found", 404);
  }
  return { app_id: id, removed: true };
}
