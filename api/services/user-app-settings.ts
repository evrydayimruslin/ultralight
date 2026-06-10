import type { EnvSchemaEntry } from "../../shared/contracts/env.ts";
import { validateEnvVarValue } from "../../shared/contracts/env.ts";
import { getScopedEnvSchemaEntries } from "./app-settings.ts";

export interface UserAppSecretStatusRow {
  key: string;
  updated_at?: string | null;
}

export interface PerUserSettingStatus {
  key: string;
  label: string;
  description: string | null;
  help: string | null;
  input: string;
  placeholder: string | null;
  required: boolean;
  configured: boolean;
  updated_at: string | null;
}

export interface PerUserSettingsStatusSummary {
  settings: PerUserSettingStatus[];
  connectedKeys: string[];
  missingRequired: string[];
  fullyConnected: boolean;
}

export interface PerUserSettingsValidationResult {
  entries: Array<[string, string | null]>;
  errors: string[];
  allowedKeys: string[];
}

export function buildPerUserSettingsStatus(
  schema: Record<string, EnvSchemaEntry>,
  secretRows: UserAppSecretStatusRow[],
): PerUserSettingsStatusSummary {
  const perUserEntries = getScopedEnvSchemaEntries(schema, "per_user");
  const connectedKeys = secretRows.map((row) => row.key);
  const connectedKeySet = new Set(connectedKeys);
  const updatedAtByKey = new Map(
    secretRows.map((row) => [row.key, row.updated_at || null]),
  );

  const settings = perUserEntries.map(({ key, entry }) => ({
    key,
    label: entry.label || key,
    description: entry.description || null,
    help: entry.help || null,
    input: entry.input || "text",
    placeholder: entry.placeholder || null,
    required: entry.required ?? false,
    configured: connectedKeySet.has(key),
    updated_at: updatedAtByKey.get(key) || null,
  }));

  const missingRequired = settings
    .filter((setting) => setting.required && !setting.configured)
    .map((setting) => setting.key);

  return {
    settings,
    connectedKeys,
    missingRequired,
    fullyConnected: missingRequired.length === 0,
  };
}

export function validatePerUserSettingsValues(
  schema: Record<string, EnvSchemaEntry>,
  values: Record<string, unknown>,
): PerUserSettingsValidationResult {
  const perUserEntries = getScopedEnvSchemaEntries(schema, "per_user");
  const allowedKeys = perUserEntries.map(({ key }) => key);
  const allowedKeySet = new Set(allowedKeys);
  const errors: string[] = [];
  const entries: Array<[string, string | null]> = [];

  for (const [key, value] of Object.entries(values)) {
    if (!allowedKeySet.has(key)) {
      errors.push(`${key}: not a declared per-user setting for this app`);
      continue;
    }

    if (value !== null && typeof value !== "string") {
      errors.push(`${key}: Value must be a string`);
      continue;
    }

    if (typeof value === "string") {
      const valueValidation = validateEnvVarValue(value);
      if (!valueValidation.valid) {
        errors.push(`${key}: ${valueValidation.error}`);
        continue;
      }
    }

    entries.push([key, value as string | null]);
  }

  return {
    entries,
    errors,
    allowedKeys,
  };
}
