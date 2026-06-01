import { getEnv } from "../lib/env.ts";
import type {
  SuggestionPreviewDescriptor,
  SuggestionSource,
  SuggestionTarget,
} from "../../shared/contracts/suggestions.ts";
import {
  isSuggestionSource,
  isSuggestionTarget,
} from "../../shared/contracts/suggestions.ts";
import type { App, AppPricingConfig } from "../../shared/types/index.ts";
import { getCallPriceLight } from "../../shared/types/index.ts";
import {
  readCommandDescriptorCache,
  writeCommandDescriptorCache,
} from "./command-descriptor-cache.ts";
import { createAppsService } from "./apps.ts";
import {
  type FunctionIndex,
  getOrRebuildFunctionIndex,
} from "./function-index.ts";
import { buildAppTrustCard, getManifestPermissions } from "./trust.ts";
import { getSystemAgentDescriptor } from "./system-agent-descriptors.ts";

type JsonRecord = Record<string, unknown>;

export type SuggestionPreviewApp = Pick<
  App,
  | "id"
  | "owner_id"
  | "slug"
  | "name"
  | "description"
  | "icon_url"
  | "visibility"
  | "download_access"
  | "current_version"
  | "version_metadata"
  | "exports"
  | "env_schema"
  | "manifest"
  | "app_type"
  | "runtime"
  | "pricing_config"
>;

export interface SuggestionRow {
  id: string;
  suggestion_set_id?: string | null;
  intent_id?: string | null;
  user_id?: string | null;
  app_id?: string | null;
  app_slug?: string | null;
  app_name?: string | null;
  app_type?: string | null;
  suggestion_source?: string | null;
  rank?: number | null;
  similarity?: number | null;
  key_functions?: unknown;
  metadata?: JsonRecord | null;
}

export interface SuggestionPreviewDependencies {
  fetchSuggestionRow?: (
    userId: string,
    suggestionId: string,
  ) => Promise<SuggestionRow | null>;
  fetchSuggestionRowsBySet?: (
    userId: string,
    suggestionSetId: string,
  ) => Promise<SuggestionRow[]>;
  getFunctionIndex?: (userId: string) => Promise<FunctionIndex>;
  findAppById?: (appId: string) => Promise<SuggestionPreviewApp | null>;
  isAppInstalled?: (userId: string, appId: string) => Promise<boolean>;
}

export interface BuildSuggestionPreviewInput {
  userId: string;
  suggestionId: string;
  fallbackTarget?: SuggestionTarget;
  fallbackSuggestion?: Partial<SuggestionRow>;
  dependencies?: SuggestionPreviewDependencies;
}

export interface BuildSuggestionPreviewBatchInput {
  userId: string;
  suggestionIds?: string[];
  suggestionSetId?: string;
  dependencies?: SuggestionPreviewDependencies;
}

const APP_SELECT = [
  "id",
  "owner_id",
  "slug",
  "name",
  "description",
  "icon_url",
  "visibility",
  "download_access",
  "current_version",
  "versions",
  "version_metadata",
  "storage_key",
  "storage_bytes",
  "skills_md",
  "skills_parsed",
  "exports",
  "declared_permissions",
  "category",
  "tags",
  "screenshots",
  "long_description",
  "env_schema",
  "manifest",
  "app_type",
  "runtime",
  "pricing_config",
  "weighted_likes",
  "weighted_dislikes",
  "likes",
  "dislikes",
  "runs_30d",
].join(",");

function supabaseReady(): boolean {
  return !!getEnv("SUPABASE_URL") && !!getEnv("SUPABASE_SERVICE_ROLE_KEY");
}

function dbHeaders(): Record<string, string> {
  const key = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  return {
    "apikey": key,
    "Authorization": `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sourceFromRow(row?: Partial<SuggestionRow> | null): SuggestionSource {
  return isSuggestionSource(row?.suggestion_source)
    ? row.suggestion_source
    : "marketplace";
}

function metadataTarget(
  row?: Partial<SuggestionRow> | null,
): SuggestionTarget | undefined {
  const target = row?.metadata?.target;
  return isSuggestionTarget(target) ? target : undefined;
}

function metadataDisplayString(
  row: Partial<SuggestionRow>,
  field: "label" | "description",
): string | undefined {
  const display = row.metadata?.display;
  if (!isRecord(display)) return undefined;
  const value = display[field];
  return typeof value === "string" ? value : undefined;
}

function targetFromRow(
  row?: Partial<SuggestionRow> | null,
  fallback?: SuggestionTarget,
): SuggestionTarget | undefined {
  const target = metadataTarget(row);
  if (target) return target;
  if (fallback) return fallback;
  if (row?.app_id) {
    return {
      kind: "app",
      appId: row.app_id,
      appSlug: row.app_slug || undefined,
    };
  }
  return undefined;
}

function cacheKey(userId: string, suggestionId: string): string {
  return `${userId}::${suggestionId}`;
}

function keyFunctions(row?: Partial<SuggestionRow> | null): string[] {
  if (Array.isArray(row?.key_functions)) {
    return row.key_functions.filter((value): value is string =>
      typeof value === "string"
    );
  }
  const metadataFunctions = row?.metadata?.key_functions;
  if (Array.isArray(metadataFunctions)) {
    return metadataFunctions.filter((value): value is string =>
      typeof value === "string"
    );
  }
  return [];
}

function signatureForFunction(
  functionName: string,
  fn?: FunctionIndex["functions"][string],
): string {
  if (!fn) return `${functionName}(args: Record<string, unknown>)`;
  const params = Object.entries(fn.params || {})
    .map(([name, info]) => `${name}${info.required ? "" : "?"}: ${info.type}`)
    .join(", ");
  const returns = fn.returns && fn.returns !== "unknown"
    ? fn.returns
    : "unknown";
  return `${functionName}(args: { ${params} }): Promise<${returns}>`;
}

async function defaultFetchSuggestionRow(
  userId: string,
  suggestionId: string,
): Promise<SuggestionRow | null> {
  if (!supabaseReady()) return null;
  const url = new URL(
    `${getEnv("SUPABASE_URL")}/rest/v1/capability_suggestions`,
  );
  url.searchParams.set("id", `eq.${suggestionId}`);
  url.searchParams.set("user_id", `eq.${userId}`);
  url.searchParams.set("select", "*");
  url.searchParams.set("limit", "1");

  const response = await fetch(url.toString(), {
    headers: dbHeaders(),
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch suggestion: ${await response.text()}`);
  }
  const rows = await response.json() as SuggestionRow[];
  return rows[0] || null;
}

async function defaultFetchSuggestionRowsBySet(
  userId: string,
  suggestionSetId: string,
): Promise<SuggestionRow[]> {
  if (!supabaseReady()) return [];
  const url = new URL(
    `${getEnv("SUPABASE_URL")}/rest/v1/capability_suggestions`,
  );
  url.searchParams.set("suggestion_set_id", `eq.${suggestionSetId}`);
  url.searchParams.set("user_id", `eq.${userId}`);
  url.searchParams.set("select", "*");
  url.searchParams.set("order", "rank.asc");

  const response = await fetch(url.toString(), {
    headers: dbHeaders(),
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch suggestion set: ${await response.text()}`);
  }
  return await response.json() as SuggestionRow[];
}

async function defaultFindAppById(
  appId: string,
): Promise<SuggestionPreviewApp | null> {
  try {
    return await createAppsService().findById(appId) as
      | SuggestionPreviewApp
      | null;
  } catch {
    if (!supabaseReady()) return null;
    const url = new URL(`${getEnv("SUPABASE_URL")}/rest/v1/apps`);
    url.searchParams.set("id", `eq.${appId}`);
    url.searchParams.set("select", APP_SELECT);
    url.searchParams.set("limit", "1");
    const response = await fetch(url.toString(), {
      headers: dbHeaders(),
    });
    if (!response.ok) return null;
    const rows = await response.json() as SuggestionPreviewApp[];
    return rows[0] || null;
  }
}

async function defaultIsAppInstalled(
  userId: string,
  appId: string,
): Promise<boolean> {
  if (!supabaseReady()) return false;
  const url = new URL(`${getEnv("SUPABASE_URL")}/rest/v1/user_app_library`);
  url.searchParams.set("user_id", `eq.${userId}`);
  url.searchParams.set("app_id", `eq.${appId}`);
  url.searchParams.set("select", "app_id");
  url.searchParams.set("limit", "1");
  const response = await fetch(url.toString(), {
    headers: dbHeaders(),
  });
  if (!response.ok) return false;
  const rows = await response.json() as Array<{ app_id: string }>;
  return rows.length > 0;
}

function functionEntryForTarget(
  fnIndex: FunctionIndex,
  target: Extract<SuggestionTarget, { kind: "function" }>,
): FunctionIndex["functions"][string] | undefined {
  return Object.values(fnIndex.functions || {}).find((fn) =>
    fn.appId === target.appId &&
    (fn.fnName === target.fnName || fn.appSlug === target.appSlug)
  );
}

async function buildAppDescriptor(input: {
  userId: string;
  suggestionId: string;
  row: Partial<SuggestionRow>;
  target: Extract<SuggestionTarget, { kind: "app" }>;
  dependencies: Required<SuggestionPreviewDependencies>;
}): Promise<SuggestionPreviewDescriptor> {
  const app = await input.dependencies.findAppById(input.target.appId);
  const trustCard = app ? buildAppTrustCard(app) : null;
  const installed = app?.owner_id === input.userId
    ? true
    : await input.dependencies.isAppInstalled(input.userId, input.target.appId);
  const fnIndex = await input.dependencies.getFunctionIndex(input.userId);
  const functions = Object.values(fnIndex.functions || {})
    .filter((fn) => fn.appId === input.target.appId)
    .slice(0, 8)
    .map((fn) => ({
      name: fn.fnName,
      description: fn.description,
      cost_light: app && app.owner_id !== input.userId
        ? getCallPriceLight(
          app.pricing_config as AppPricingConfig | null | undefined,
          fn.fnName,
        )
        : 0,
      params: fn.params,
    }));
  const fallbackFunctions = keyFunctions(input.row).map((name) => ({
    name,
    description: undefined,
    cost_light: undefined,
    params: undefined,
  }));

  return {
    kind: "app",
    suggestionId: input.suggestionId,
    appId: input.target.appId,
    appSlug: app?.slug || input.target.appSlug || input.row.app_slug ||
      undefined,
    name: app?.name || input.row.app_name || "Suggested app",
    description: app?.description ||
      metadataDisplayString(input.row, "description"),
    source: sourceFromRow(input.row),
    functions: functions.length > 0 ? functions : fallbackFunctions,
    trust_card: trustCard,
    marketplace: {
      installed,
      permissions: trustCard?.permissions ||
        getManifestPermissions(app?.manifest),
      visibility: app?.visibility || input.row.metadata?.visibility || null,
      download_access: app?.download_access ||
        input.row.metadata?.download_access || null,
      current_version: app?.current_version ||
        input.row.metadata?.current_version || null,
      similarity: input.row.similarity ?? null,
    },
  };
}

async function buildFunctionDescriptor(input: {
  userId: string;
  suggestionId: string;
  row: Partial<SuggestionRow>;
  target: Extract<SuggestionTarget, { kind: "function" }>;
  dependencies: Required<SuggestionPreviewDependencies>;
}): Promise<SuggestionPreviewDescriptor> {
  const [fnIndex, app] = await Promise.all([
    input.dependencies.getFunctionIndex(input.userId),
    input.dependencies.findAppById(input.target.appId),
  ]);
  const fn = functionEntryForTarget(fnIndex, input.target);
  const costLight = app && app.owner_id !== input.userId
    ? getCallPriceLight(
      app.pricing_config as AppPricingConfig | null | undefined,
      input.target.fnName,
    )
    : 0;
  return {
    kind: "function",
    suggestionId: input.suggestionId,
    appId: input.target.appId,
    appSlug: app?.slug || input.target.appSlug || input.row.app_slug ||
      undefined,
    fnName: input.target.fnName,
    label: input.target.label || metadataDisplayString(input.row, "label"),
    args: input.target.args || {},
    cost_light: costLight,
    signature: signatureForFunction(input.target.fnName, fn),
    description: fn?.description ||
      metadataDisplayString(input.row, "description"),
  };
}

function buildSystemAgentDescriptor(input: {
  suggestionId: string;
  target: Extract<SuggestionTarget, { kind: "system_agent" }>;
}): SuggestionPreviewDescriptor {
  const descriptor = getSystemAgentDescriptor(input.target.agentType);
  return {
    kind: "system_agent",
    suggestionId: input.suggestionId,
    agentType: input.target.agentType,
    name: descriptor.name,
    task: input.target.task,
    skillsPath: descriptor.skillsPath,
    description: descriptor.description,
    touchScope: descriptor.touchScope,
  };
}

function buildPromptDescriptor(input: {
  suggestionId: string;
  target: Extract<SuggestionTarget, { kind: "prompt" }>;
  row: Partial<SuggestionRow>;
}): SuggestionPreviewDescriptor {
  return {
    kind: "prompt",
    suggestionId: input.suggestionId,
    text: input.target.text,
    description: metadataDisplayString(input.row, "description"),
  };
}

function requiredDependencies(
  dependencies?: SuggestionPreviewDependencies,
): Required<SuggestionPreviewDependencies> {
  return {
    fetchSuggestionRow: dependencies?.fetchSuggestionRow ||
      defaultFetchSuggestionRow,
    fetchSuggestionRowsBySet: dependencies?.fetchSuggestionRowsBySet ||
      defaultFetchSuggestionRowsBySet,
    getFunctionIndex: dependencies?.getFunctionIndex ||
      getOrRebuildFunctionIndex,
    findAppById: dependencies?.findAppById || defaultFindAppById,
    isAppInstalled: dependencies?.isAppInstalled || defaultIsAppInstalled,
  };
}

export async function buildSuggestionPreviewDescriptor(
  input: BuildSuggestionPreviewInput,
): Promise<SuggestionPreviewDescriptor> {
  const cached = readCommandDescriptorCache<SuggestionPreviewDescriptor>(
    "suggestion_preview",
    cacheKey(input.userId, input.suggestionId),
  );
  if (cached) return cached;

  const dependencies = requiredDependencies(input.dependencies);
  const persistedRow = await dependencies.fetchSuggestionRow(
    input.userId,
    input.suggestionId,
  );
  const row: Partial<SuggestionRow> = persistedRow ||
    input.fallbackSuggestion ||
    {};
  const target = targetFromRow(row, input.fallbackTarget);
  if (!target) {
    throw new Error("Suggestion target was not found");
  }

  let descriptor: SuggestionPreviewDescriptor;
  switch (target.kind) {
    case "app":
      descriptor = await buildAppDescriptor({
        userId: input.userId,
        suggestionId: input.suggestionId,
        row,
        target,
        dependencies,
      });
      break;
    case "function":
      descriptor = await buildFunctionDescriptor({
        userId: input.userId,
        suggestionId: input.suggestionId,
        row,
        target,
        dependencies,
      });
      break;
    case "system_agent":
      descriptor = buildSystemAgentDescriptor({
        suggestionId: input.suggestionId,
        target,
      });
      break;
    case "prompt":
      descriptor = buildPromptDescriptor({
        suggestionId: input.suggestionId,
        target,
        row,
      });
      break;
  }

  writeCommandDescriptorCache(
    "suggestion_preview",
    cacheKey(input.userId, input.suggestionId),
    descriptor,
    persistedRow ? "persisted" : "fallback",
  );
  return descriptor;
}

export async function buildSuggestionPreviewBatch(
  input: BuildSuggestionPreviewBatchInput,
): Promise<{ previews: SuggestionPreviewDescriptor[] }> {
  const dependencies = requiredDependencies(input.dependencies);
  const ids = new Set(input.suggestionIds || []);
  if (input.suggestionSetId) {
    const rows = await dependencies.fetchSuggestionRowsBySet(
      input.userId,
      input.suggestionSetId,
    );
    for (const row of rows) ids.add(row.id);
  }

  const previews = await Promise.all(
    [...ids].map((suggestionId) =>
      buildSuggestionPreviewDescriptor({
        userId: input.userId,
        suggestionId,
        dependencies,
      })
    ),
  );
  return { previews };
}
