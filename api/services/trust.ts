import type { App, VersionMetadata, VersionTrustMetadata } from "../../shared/types/index.ts";
import type { AppManifest } from "../../shared/contracts/manifest.ts";
import { getManifestEnvVars } from "../../shared/contracts/manifest.ts";
import { getEnv } from "../lib/env.ts";
import { parseAppManifest, resolveAppEnvSchema } from "./app-settings.ts";

export interface TrustArtifactFile {
  name: string;
  content: Uint8Array | string;
}

export interface ManifestDiff {
  functions: {
    added: string[];
    removed: string[];
    changed: string[];
  };
  permissions: {
    added: string[];
    removed: string[];
  };
  secrets: {
    added: string[];
    removed: string[];
    changed: string[];
  };
}

export interface TrustCard {
  schema_version: 1;
  signed_manifest: boolean;
  signer: string | null;
  signed_at: string | null;
  version: string | null;
  runtime: string;
  manifest_hash: string | null;
  artifact_hash: string | null;
  artifact_count: number;
  permissions: string[];
  capability_summary: {
    ai: boolean;
    network: boolean;
    storage: boolean;
    memory: boolean;
    gpu: boolean;
  };
  required_secrets: string[];
  per_user_secrets: string[];
  access: {
    visibility: App["visibility"];
    download_access: App["download_access"];
  };
  reliability?: unknown;
  execution_receipts: {
    enabled: true;
    field: "receipt_id";
    backing_log: "mcp_call_logs.id";
  };
}

const encoder = new TextEncoder();

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      result[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return result;
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function bytesFromContent(content: Uint8Array | string): Uint8Array {
  return typeof content === "string" ? encoder.encode(content) : content;
}

function arrayBufferFromContent(content: Uint8Array | string): ArrayBuffer {
  const bytes = bytesFromContent(content);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function sha256Hex(content: Uint8Array | string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", arrayBufferFromContent(content)));
}

function resolveTrustSigningSecret(): string {
  return getEnv("LIGHT_TRUST_SIGNING_SECRET") ||
    getEnv("TRUST_SIGNING_SECRET") ||
    getEnv("SUPABASE_SERVICE_ROLE_KEY") ||
    "development-trust-signing-secret";
}

async function hmacSha256Hex(content: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(resolveTrustSigningSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(content)));
}

export function getManifestPermissions(manifest: AppManifest | string | null | undefined): string[] {
  const parsed = parseAppManifest(manifest);
  if (!Array.isArray(parsed?.permissions)) return [];
  return [...new Set(parsed.permissions.filter((permission) => typeof permission === "string"))];
}

export function getManifestEntrypoints(manifest: AppManifest | string | null | undefined): string[] {
  const parsed = parseAppManifest(manifest);
  const entrypoints: string[] = [];
  if (parsed?.entry?.functions) entrypoints.push(parsed.entry.functions);
  if (parsed?.functions) entrypoints.push(...Object.keys(parsed.functions));
  return [...new Set(entrypoints)];
}

function getSecretKeys(manifest: AppManifest | string | null | undefined): {
  requiredSecrets: string[];
  perUserSecrets: string[];
} {
  const parsed = parseAppManifest(manifest);
  const envVars = parsed ? getManifestEnvVars(parsed) : null;
  if (!envVars) {
    return { requiredSecrets: [], perUserSecrets: [] };
  }

  const requiredSecrets: string[] = [];
  const perUserSecrets: string[] = [];
  for (const [key, entry] of Object.entries(envVars)) {
    if (entry.required) requiredSecrets.push(key);
    if ((entry.scope || entry.type) === "per_user") perUserSecrets.push(key);
  }
  return {
    requiredSecrets: requiredSecrets.sort(),
    perUserSecrets: perUserSecrets.sort(),
  };
}

export function generateGpuManifest(input: {
  name: string;
  version: string;
  description?: string | null;
  exports: string[];
}): AppManifest {
  const functions: NonNullable<AppManifest["functions"]> = {};
  for (const fnName of input.exports.length > 0 ? input.exports : ["main"]) {
    functions[fnName] = {
      description: `GPU function ${fnName}`,
      parameters: {
        input: {
          type: "object",
          description: "Function input payload",
          required: false,
        },
      },
      returns: {
        type: "object",
        description: "Function result",
      },
    };
  }

  return {
    name: input.name,
    version: input.version,
    description: input.description || undefined,
    type: "mcp",
    entry: { functions: "main.py" },
    functions,
    permissions: ["gpu:execute"],
  };
}

export async function buildVersionTrustMetadata(input: {
  appId: string;
  version: string;
  runtime: string;
  manifest: AppManifest | string | null | undefined;
  files: TrustArtifactFile[];
  storageKey?: string;
}): Promise<VersionTrustMetadata> {
  const manifest = parseAppManifest(input.manifest);
  const manifestJson = manifest ? canonicalJson(manifest) : null;
  const manifestHash = manifestJson ? await sha256Hex(manifestJson) : null;

  const artifactHashes: Record<string, string> = {};
  for (const file of [...input.files].sort((a, b) => a.name.localeCompare(b.name))) {
    artifactHashes[file.name] = await sha256Hex(file.content);
  }
  const artifactHash = await sha256Hex(canonicalJson(artifactHashes));
  const secrets = getSecretKeys(manifest);

  const unsigned = {
    schema_version: 1 as const,
    app_id: input.appId,
    version: input.version,
    runtime: input.runtime,
    manifest_hash: manifestHash,
    artifact_hash: artifactHash,
    artifact_hashes: artifactHashes,
    storage_key: input.storageKey,
    permissions: getManifestPermissions(manifest).sort(),
    entrypoints: getManifestEntrypoints(manifest).sort(),
    required_secrets: secrets.requiredSecrets,
    per_user_secrets: secrets.perUserSecrets,
  };

  return {
    ...unsigned,
    signature: {
      algorithm: "HMAC-SHA256",
      signer: "light-platform",
      signed_at: new Date().toISOString(),
      signature: await hmacSha256Hex(canonicalJson(unsigned)),
      key_hint: "platform",
    },
  };
}

export function buildVersionMetadataEntry(
  version: string,
  sizeBytes: number,
  trust: VersionTrustMetadata,
): VersionMetadata {
  return {
    version,
    size_bytes: sizeBytes,
    created_at: new Date().toISOString(),
    trust,
  };
}

export function appendVersionTrustMetadata(
  versionMetadata: VersionMetadata[] | null | undefined,
  entry: VersionMetadata,
): VersionMetadata[] {
  return [...(Array.isArray(versionMetadata) ? versionMetadata : []), entry];
}

export function getLatestVersionTrust(app: Pick<App, "current_version" | "version_metadata">): VersionTrustMetadata | null {
  const metadata = Array.isArray(app.version_metadata) ? app.version_metadata : [];
  for (let i = metadata.length - 1; i >= 0; i--) {
    const entry = metadata[i];
    if (entry?.version === app.current_version && entry.trust) {
      return entry.trust;
    }
  }
  return null;
}

export function buildAppTrustCard(
  app: Pick<App, "current_version" | "runtime" | "manifest" | "version_metadata" | "visibility" | "download_access" | "env_schema">,
  options: { reliability?: unknown } = {},
): TrustCard {
  const trust = getLatestVersionTrust(app as Pick<App, "current_version" | "version_metadata">);
  const manifest = parseAppManifest(app.manifest);
  const permissions = trust?.permissions.length ? trust.permissions : getManifestPermissions(manifest).sort();
  const envSchema = resolveAppEnvSchema(app);
  const requiredSecrets = Object.entries(envSchema)
    .filter(([, entry]) => entry.required)
    .map(([key]) => key)
    .sort();
  const perUserSecrets = Object.entries(envSchema)
    .filter(([, entry]) => entry.scope === "per_user")
    .map(([key]) => key)
    .sort();

  return {
    schema_version: 1,
    signed_manifest: !!trust?.signature && !!trust.manifest_hash,
    signer: trust?.signature.signer || null,
    signed_at: trust?.signature.signed_at || null,
    version: app.current_version || trust?.version || null,
    runtime: app.runtime || "deno",
    manifest_hash: trust?.manifest_hash || null,
    artifact_hash: trust?.artifact_hash || null,
    artifact_count: trust ? Object.keys(trust.artifact_hashes).length : 0,
    permissions,
    capability_summary: {
      ai: permissions.includes("ai:call"),
      network: permissions.some((permission) => permission === "net:fetch" || permission === "net:connect" || permission.startsWith("net:")),
      storage: permissions.some((permission) => permission.startsWith("storage:")),
      memory: permissions.some((permission) => permission.startsWith("memory:")),
      gpu: permissions.includes("gpu:execute") || app.runtime === "gpu",
    },
    required_secrets: trust?.required_secrets.length ? trust.required_secrets : requiredSecrets,
    per_user_secrets: trust?.per_user_secrets.length ? trust.per_user_secrets : perUserSecrets,
    access: {
      visibility: app.visibility,
      download_access: app.download_access,
    },
    ...(options.reliability !== undefined ? { reliability: options.reliability } : {}),
    execution_receipts: {
      enabled: true,
      field: "receipt_id",
      backing_log: "mcp_call_logs.id",
    },
  };
}

function namesFromFunctions(manifest: AppManifest | null): string[] {
  return Object.keys(manifest?.functions || {}).sort();
}

function changedFunctionNames(previous: AppManifest | null, next: AppManifest | null): string[] {
  const changed: string[] = [];
  const previousFunctions = previous?.functions || {};
  const nextFunctions = next?.functions || {};
  for (const name of Object.keys(previousFunctions)) {
    if (!nextFunctions[name]) continue;
    if (canonicalJson(previousFunctions[name]) !== canonicalJson(nextFunctions[name])) {
      changed.push(name);
    }
  }
  return changed.sort();
}

function diffKeys(previous: string[], next: string[]): { added: string[]; removed: string[] } {
  const previousSet = new Set(previous);
  const nextSet = new Set(next);
  return {
    added: next.filter((item) => !previousSet.has(item)).sort(),
    removed: previous.filter((item) => !nextSet.has(item)).sort(),
  };
}

export function diffManifests(previousManifest: unknown, nextManifest: unknown): ManifestDiff {
  const previous = parseAppManifest(previousManifest);
  const next = parseAppManifest(nextManifest);
  const previousSecrets = getSecretKeys(previous).requiredSecrets.concat(getSecretKeys(previous).perUserSecrets);
  const nextSecrets = getSecretKeys(next).requiredSecrets.concat(getSecretKeys(next).perUserSecrets);

  return {
    functions: {
      ...diffKeys(namesFromFunctions(previous), namesFromFunctions(next)),
      changed: changedFunctionNames(previous, next),
    },
    permissions: diffKeys(getManifestPermissions(previous).sort(), getManifestPermissions(next).sort()),
    secrets: {
      ...diffKeys([...new Set(previousSecrets)].sort(), [...new Set(nextSecrets)].sort()),
      changed: [],
    },
  };
}
