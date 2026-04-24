// MCP function-name normalization helpers.
// Private-app permissions are stored against raw function names (for example "search"),
// while app MCP tools are exposed with an app-slug prefix (for example "my-app_search").

export interface FunctionNamedRow {
  function_name: string;
}

export interface PermissionNamedRow extends FunctionNamedRow {
  allowed: boolean;
}

export interface LegacyFunctionNameAlias {
  alias: string;
  canonical: string;
}

export function getMcpToolPrefix(appSlug: string): string {
  return `${appSlug}_`;
}

export function toRawMcpFunctionName(
  appSlug: string,
  identifier: string,
): string {
  if (!identifier) return identifier;
  const prefix = getMcpToolPrefix(appSlug);
  return identifier.startsWith(prefix)
    ? identifier.slice(prefix.length)
    : identifier;
}

export function toPrefixedMcpFunctionName(
  appSlug: string,
  identifier: string,
): string {
  const rawName = toRawMcpFunctionName(appSlug, identifier);
  return `${getMcpToolPrefix(appSlug)}${rawName}`;
}

export function getMcpFunctionNameAliases(
  appSlug: string,
  identifier: string,
): string[] {
  const rawName = toRawMcpFunctionName(appSlug, identifier);
  const prefixedName = toPrefixedMcpFunctionName(appSlug, rawName);
  return rawName === prefixedName ? [rawName] : [rawName, prefixedName];
}

export function getMcpFunctionNameQueryIdentifiers(
  appSlug: string,
  identifiers?: string[] | null,
): string[] {
  const rawIdentifiers = normalizeMcpFunctionIdentifiers(appSlug, identifiers);
  const expanded = new Set<string>();

  for (const identifier of rawIdentifiers) {
    for (const alias of getMcpFunctionNameAliases(appSlug, identifier)) {
      expanded.add(alias);
    }
  }

  return Array.from(expanded.values());
}

export function normalizeMcpFunctionIdentifiers(
  appSlug: string,
  identifiers?: string[] | null,
): string[] {
  if (!identifiers || identifiers.length === 0) return [];

  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const identifier of identifiers) {
    if (typeof identifier !== "string") continue;
    const trimmed = identifier.trim();
    if (!trimmed) continue;

    const rawName = toRawMcpFunctionName(appSlug, trimmed);
    if (!rawName || seen.has(rawName)) continue;

    seen.add(rawName);
    normalized.push(rawName);
  }

  return normalized;
}

export function normalizeFunctionNamedRows<T extends FunctionNamedRow>(
  appSlug: string,
  rows: T[],
): T[] {
  return rows.map((row) => ({
    ...row,
    function_name: toRawMcpFunctionName(appSlug, row.function_name),
  }));
}

export function findLegacyMcpFunctionNameAliases<T extends FunctionNamedRow>(
  appSlug: string,
  rows: T[],
): LegacyFunctionNameAlias[] {
  const aliases = new Map<string, string>();

  for (const row of rows) {
    if (typeof row.function_name !== "string") continue;
    const trimmed = row.function_name.trim();
    if (!trimmed) continue;

    const rawName = toRawMcpFunctionName(appSlug, trimmed);
    const prefixedName = toPrefixedMcpFunctionName(appSlug, rawName);

    if (trimmed === prefixedName && prefixedName !== rawName) {
      aliases.set(prefixedName, rawName);
    }
  }

  return Array.from(aliases, ([alias, canonical]) => ({ alias, canonical }));
}

export function normalizePermissionNamedRows<T extends FunctionNamedRow>(
  appSlug: string,
  rows: T[],
): T[] {
  const normalized = new Map<string, { row: T; canonical: boolean }>();

  for (const row of rows) {
    const rawName = toRawMcpFunctionName(appSlug, row.function_name);
    if (!rawName) continue;
    const existing = normalized.get(rawName);
    const rowUsesCanonicalName = row.function_name === rawName;

    if (!existing || rowUsesCanonicalName || !existing.canonical) {
      normalized.set(rawName, {
        row: { ...row, function_name: rawName },
        canonical: rowUsesCanonicalName,
      });
    }
  }

  return Array.from(normalized.values(), ({ row }) => row);
}

export function buildAllowedPermissionSet(
  appSlug: string,
  rows: PermissionNamedRow[],
): Set<string> {
  const allowed = new Set<string>();

  for (const row of normalizePermissionNamedRows(appSlug, rows)) {
    if (!row.allowed) continue;
    const rawName = toRawMcpFunctionName(appSlug, row.function_name);
    if (rawName) allowed.add(rawName);
  }

  return allowed;
}

export function permissionSetAllowsFunction(
  appSlug: string,
  allowed: Set<string>,
  identifier: string,
): boolean {
  return allowed.has(toRawMcpFunctionName(appSlug, identifier));
}

export function findPermissionRowForFunction<T extends PermissionNamedRow>(
  appSlug: string,
  rows: T[],
  identifier: string,
): T | undefined {
  const rawName = toRawMcpFunctionName(appSlug, identifier);
  const canonicalRow = rows.find((row) =>
    row.allowed && row.function_name === rawName
  );
  if (canonicalRow) return canonicalRow;
  return rows.find((row) =>
    row.allowed && toRawMcpFunctionName(appSlug, row.function_name) === rawName
  );
}
