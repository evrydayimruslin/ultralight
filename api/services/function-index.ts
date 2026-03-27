// Function Index — per-user index of all available app functions.
// Built on app upload/version change, stored in R2, cached on desktop.
// Enables typed codemode recipes without a discovery call.

import { createR2Service } from './storage.ts';
import { createAppsService } from './apps.ts';
import { buildJsonSchemaDescriptors, generateTypes } from './codemode-tools.ts';

// ── Types ──

export interface FunctionIndex {
  functions: Record<string, {
    appId: string;
    appSlug: string;
    fnName: string;
    description: string;
    params: Record<string, { type: string; required?: boolean; description?: string }>;
  }>;
  widgets: Array<{ name: string; appId: string; label: string }>;
  types: string;
  updatedAt: string;
}

// ── Build Index ──

/**
 * Rebuild the function index for a user.
 * Fetches all owned + liked apps, extracts function metadata,
 * generates TypeScript type declarations, and stores in R2.
 */
export async function rebuildFunctionIndex(userId: string): Promise<FunctionIndex> {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = getSupabaseEnv();
  const headers = {
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  };

  // Fetch owned apps
  const ownedRes = await fetch(
    `${SUPABASE_URL}/rest/v1/apps?owner_id=eq.${userId}&deleted_at=is.null&select=id,name,slug,manifest`,
    { headers }
  );
  const ownedApps = ownedRes.ok
    ? await ownedRes.json() as Array<{ id: string; name: string; slug: string; manifest: string | null }>
    : [];

  // Fetch liked apps
  const likedRes = await fetch(
    `${SUPABASE_URL}/rest/v1/user_app_likes?user_id=eq.${userId}&liked=eq.true&select=app_id`,
    { headers }
  );
  const likedIds = likedRes.ok
    ? (await likedRes.json() as Array<{ app_id: string }>).map(l => l.app_id)
    : [];

  let likedApps: typeof ownedApps = [];
  if (likedIds.length > 0) {
    const likedAppsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/apps?id=in.(${likedIds.join(',')})&deleted_at=is.null&select=id,name,slug,manifest`,
      { headers }
    );
    likedApps = likedAppsRes.ok ? await likedAppsRes.json() as typeof ownedApps : [];
  }

  // Deduplicate and parse manifests
  const allAppsMap = new Map<string, { id: string; name: string; slug: string; manifest: unknown }>();
  for (const app of [...ownedApps, ...likedApps]) {
    if (!allAppsMap.has(app.id) && app.manifest) {
      const manifest = typeof app.manifest === 'string' ? JSON.parse(app.manifest) : app.manifest;
      allAppsMap.set(app.id, { id: app.id, name: app.name, slug: app.slug, manifest });
    }
  }
  const apps = Array.from(allAppsMap.values());

  // Build descriptors and types
  const { descriptors, toolMap, widgets } = buildJsonSchemaDescriptors(apps);
  const types = generateTypes(descriptors);

  // Build function entries
  const functions: FunctionIndex['functions'] = {};
  for (const [sanitizedName, mapping] of Object.entries(toolMap)) {
    const desc = descriptors[sanitizedName];
    const params: Record<string, { type: string; required?: boolean; description?: string }> = {};

    if (desc?.inputSchema?.properties) {
      const required = new Set(desc.inputSchema.required || []);
      for (const [pName, pSchema] of Object.entries(desc.inputSchema.properties)) {
        const schema = pSchema as Record<string, unknown>;
        params[pName] = {
          type: (schema.type as string) || 'unknown',
          required: required.has(pName),
          description: schema.description as string | undefined,
        };
      }
    }

    functions[sanitizedName] = {
      appId: mapping.appId,
      appSlug: mapping.appSlug,
      fnName: mapping.fnName,
      description: desc?.description || mapping.fnName,
      params,
    };
  }

  const index: FunctionIndex = {
    functions,
    widgets,
    types,
    updatedAt: new Date().toISOString(),
  };

  // Store in R2
  try {
    const r2 = createR2Service();
    const content = new TextEncoder().encode(JSON.stringify(index));
    await r2.uploadFile(`users/${userId}/function-index.json`, {
      name: 'function-index.json',
      content,
      contentType: 'application/json',
    });
  } catch (err) {
    console.error(`Failed to store function index for ${userId}:`, err);
  }

  return index;
}

// ── Read Index ──

/**
 * Get the function index for a user.
 * Reads from R2. Returns null if not yet built.
 */
export async function getFunctionIndex(userId: string): Promise<FunctionIndex | null> {
  try {
    const r2 = createR2Service();
    const text = await r2.fetchTextFile(`users/${userId}/function-index.json`);
    return JSON.parse(text) as FunctionIndex;
  } catch {
    return null;
  }
}

// ── Supabase Env Helper ──

function getSupabaseEnv(): { SUPABASE_URL: string; SUPABASE_SERVICE_ROLE_KEY: string } {
  // @ts-ignore: Deno global
  const _Deno = globalThis.Deno;
  return {
    SUPABASE_URL: _Deno?.env?.get('SUPABASE_URL') || '',
    SUPABASE_SERVICE_ROLE_KEY: _Deno?.env?.get('SUPABASE_SERVICE_ROLE_KEY') || '',
  };
}
