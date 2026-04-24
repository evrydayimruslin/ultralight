import type { EnvSchemaEntry } from '../../shared/contracts/env.ts';
import type { AppManifest } from '../../shared/contracts/manifest.ts';
import {
  normalizeEnvSchema,
  resolveManifestEnvSchema,
} from '../../shared/contracts/manifest.ts';

export function parseAppManifest(manifest: unknown): AppManifest | null {
  if (!manifest) return null;

  if (typeof manifest === 'string') {
    try {
      return JSON.parse(manifest) as AppManifest;
    } catch {
      return null;
    }
  }

  if (typeof manifest === 'object' && !Array.isArray(manifest)) {
    return manifest as AppManifest;
  }

  return null;
}

export function resolveAppEnvSchema(app: {
  env_schema?: unknown;
  manifest?: unknown;
}): Record<string, EnvSchemaEntry> {
  const storedSchema = normalizeEnvSchema(app.env_schema);
  if (Object.keys(storedSchema).length > 0) {
    return storedSchema;
  }

  const manifest = parseAppManifest(app.manifest);
  if (!manifest) {
    return {};
  }

  return resolveManifestEnvSchema(manifest);
}

export function getScopedEnvSchemaEntries(
  schema: Record<string, EnvSchemaEntry>,
  scope: EnvSchemaEntry['scope'],
): Array<{ key: string; entry: EnvSchemaEntry }> {
  return Object.entries(schema)
    .filter(([, entry]) => entry.scope === scope)
    .map(([key, entry]) => ({ key, entry }));
}
