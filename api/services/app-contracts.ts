import {
  type AppManifest,
  type ManifestParameter,
  normalizeManifestParameters,
} from '../../shared/contracts/manifest.ts';
import type { ParsedSkills, SkillFunction } from '../../shared/types/index.ts';
import { parseAppManifest } from './app-settings.ts';

export type AppContractSource =
  | 'manifest'
  | 'skills_parsed'
  | 'gpu_exports'
  | 'exports'
  | 'none';

export type LegacyAppContractSource =
  | 'skills_parsed'
  | 'gpu_exports'
  | 'exports';

export interface AppContractAppRecord {
  id?: string;
  owner_id?: string | null;
  slug: string;
  runtime?: string | null;
  manifest?: unknown;
  skills_parsed?: unknown;
  exports?: string[] | null;
}

export interface AppFunctionContract {
  name: string;
  description?: string;
  parameters?: Record<string, ManifestParameter>;
  returns?: unknown;
}

export interface AppContractResolution {
  manifest: AppManifest | null;
  functions: AppFunctionContract[];
  source: AppContractSource;
  legacySourceDetected: LegacyAppContractSource | null;
  manifestBacked: boolean;
  migrationRequired: boolean;
  message?: string;
}

interface AppContractResolutionOptions {
  allowLegacySkills?: boolean;
  allowLegacyExports?: boolean;
  allowGpuExports?: boolean;
}

interface AppContractResolutionLogInput {
  appId?: string;
  ownerId?: string | null;
  appSlug: string;
  runtime?: string | null;
  surface: string;
  source: AppContractSource;
  legacySourceDetected?: LegacyAppContractSource | null;
  functionCount: number;
  manifestBacked: boolean;
  migrationRequired: boolean;
  note?: string;
}

export class AppContractMigrationRequiredError extends Error {
  readonly source: AppContractSource;

  constructor(message: string, source: AppContractSource) {
    super(message);
    this.name = 'AppContractMigrationRequiredError';
    this.source = source;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeParameters(params: unknown): Record<string, ManifestParameter> | undefined {
  return normalizeManifestParameters(params);
}

function normalizeSkillFunction(input: unknown): SkillFunction | null {
  if (!isRecord(input) || typeof input.name !== 'string' || !input.name.trim()) {
    return null;
  }

  return {
    name: input.name.trim(),
    description: typeof input.description === 'string' ? input.description : '',
    parameters: (normalizeParameters(input.parameters) || {}) as Record<string, unknown>,
    returns: input.returns,
  };
}

export function parseStoredSkillsParsed(raw: unknown): ParsedSkills | null {
  let value = raw;

  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }

  if (Array.isArray(value)) {
    const functions = value
      .map((entry) => normalizeSkillFunction(entry))
      .filter((entry): entry is SkillFunction => entry !== null);
    return functions.length > 0
      ? { functions, permissions: [] }
      : null;
  }

  if (!isRecord(value) || !Array.isArray(value.functions)) {
    return null;
  }

  const functions = value.functions
    .map((entry) => normalizeSkillFunction(entry))
    .filter((entry): entry is SkillFunction => entry !== null);
  const permissions = Array.isArray(value.permissions)
    ? value.permissions
        .filter((entry): entry is { permission: string; required: boolean; description?: string } =>
          isRecord(entry) &&
          typeof entry.permission === 'string' &&
          typeof entry.required === 'boolean'
        )
    : [];

  return {
    functions,
    permissions,
    description: typeof value.description === 'string' ? value.description : undefined,
  };
}

function extractManifestFunctionContracts(
  manifest: AppManifest | null,
): AppFunctionContract[] {
  if (!manifest?.functions) {
    return [];
  }

  return Object.entries(manifest.functions).map(([name, fn]) => ({
    name,
    description: fn.description,
    parameters: normalizeParameters(fn.parameters),
    returns: fn.returns,
  }));
}

function extractLegacySkillsContracts(raw: unknown): AppFunctionContract[] {
  const functions = parseStoredSkillsParsed(raw)?.functions ?? [];
  return functions.map((fn) => ({
    name: fn.name,
    description: fn.description,
    parameters: normalizeParameters(fn.parameters),
    returns: fn.returns,
  }));
}

function extractExportContracts(exportsList: string[] | null | undefined): AppFunctionContract[] {
  if (!Array.isArray(exportsList)) {
    return [];
  }

  return exportsList
    .filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
    .map((name) => ({ name: name.trim() }));
}

function buildMigrationMessage(
  app: Pick<AppContractAppRecord, 'slug' | 'runtime'>,
  source: LegacyAppContractSource | null,
): string {
  switch (source) {
    case 'skills_parsed':
      return `App "${app.slug}" still relies on legacy skills_parsed contracts. Publish a manifest-backed version before using MCP/runtime discovery.`;
    case 'gpu_exports':
      return `GPU app "${app.slug}" still relies on export-name discovery. Publish a manifest-backed version before using MCP/runtime discovery.`;
    case 'exports':
      return `App "${app.slug}" still relies on legacy export-name discovery. Publish a manifest-backed version before using MCP/runtime discovery.`;
    default:
      return `App "${app.slug}" does not have a manifest-backed function contract. Publish a manifest-backed version before using MCP/runtime discovery.`;
  }
}

function selectLegacySource(
  app: AppContractAppRecord,
  skillFunctions: AppFunctionContract[],
  exportFunctions: AppFunctionContract[],
): LegacyAppContractSource | null {
  if (skillFunctions.length > 0) {
    return 'skills_parsed';
  }

  if (app.runtime === 'gpu' && exportFunctions.length > 0) {
    return 'gpu_exports';
  }

  if (exportFunctions.length > 0) {
    return 'exports';
  }

  return null;
}

export function resolveAppFunctionContracts(
  app: AppContractAppRecord,
  options: AppContractResolutionOptions = {},
): AppContractResolution {
  const manifest = parseAppManifest(app.manifest);
  const manifestFunctions = extractManifestFunctionContracts(manifest);
  if (manifestFunctions.length > 0) {
    return {
      manifest,
      functions: manifestFunctions,
      source: 'manifest',
      legacySourceDetected: null,
      manifestBacked: true,
      migrationRequired: false,
    };
  }

  const skillFunctions = extractLegacySkillsContracts(app.skills_parsed);
  const exportFunctions = extractExportContracts(app.exports);
  const legacySourceDetected = selectLegacySource(app, skillFunctions, exportFunctions);

  if (legacySourceDetected === 'skills_parsed' && options.allowLegacySkills) {
    return {
      manifest,
      functions: skillFunctions,
      source: 'skills_parsed',
      legacySourceDetected,
      manifestBacked: false,
      migrationRequired: true,
      message: buildMigrationMessage(app, legacySourceDetected),
    };
  }

  if (legacySourceDetected === 'gpu_exports' && options.allowGpuExports) {
    return {
      manifest,
      functions: exportFunctions,
      source: 'gpu_exports',
      legacySourceDetected,
      manifestBacked: false,
      migrationRequired: true,
      message: buildMigrationMessage(app, legacySourceDetected),
    };
  }

  if (legacySourceDetected === 'exports' && options.allowLegacyExports) {
    return {
      manifest,
      functions: exportFunctions,
      source: 'exports',
      legacySourceDetected,
      manifestBacked: false,
      migrationRequired: true,
      message: buildMigrationMessage(app, legacySourceDetected),
    };
  }

  return {
    manifest,
    functions: [],
    source: 'none',
    legacySourceDetected,
    manifestBacked: false,
    migrationRequired: legacySourceDetected !== null,
    message: buildMigrationMessage(app, legacySourceDetected),
  };
}

export function requireManifestFunctionContracts(
  app: AppContractAppRecord,
): AppContractResolution {
  const resolution = resolveAppFunctionContracts(app);
  if (resolution.manifestBacked) {
    return resolution;
  }

  throw new AppContractMigrationRequiredError(
    resolution.message || buildMigrationMessage(app, resolution.legacySourceDetected),
    resolution.legacySourceDetected ?? resolution.source,
  );
}

export function buildAppContractResolutionLogEntry(
  input: AppContractResolutionLogInput,
): Record<string, unknown> {
  return {
    event: 'app_contract_resolution',
    app_id: input.appId || '',
    owner_id: input.ownerId || '',
    app_slug: input.appSlug,
    runtime: input.runtime || '',
    surface: input.surface,
    source: input.source,
    legacy_source_detected: input.legacySourceDetected || undefined,
    function_count: input.functionCount,
    manifest_backed: input.manifestBacked,
    migration_required: input.migrationRequired,
    note: input.note || undefined,
  };
}

export function logAppContractResolution(
  input: AppContractResolutionLogInput,
): void {
  const entry = buildAppContractResolutionLogEntry(input);
  const method = input.manifestBacked ? 'info' : 'warn';
  console[method]('[APP-CONTRACTS]', JSON.stringify(entry));
}
