import type { LoggerLike } from "./logging.ts";
import { createServerLogger } from "./logging.ts";
import {
  type FunctionNamedRow,
  findLegacyMcpFunctionNameAliases,
} from "./mcp-function-names.ts";

export type PermissionNameCompatibilitySurface =
  | "runtime_permission_fetch"
  | "pending_invite_resolution"
  | "user_permissions_api"
  | "user_pending_permissions_api"
  | "platform_permissions_list"
  | "platform_pending_permissions_list"
  | "platform_inspect_permissions";

export interface LegacyPermissionNameTelemetryInput {
  surface: PermissionNameCompatibilitySurface;
  appId?: string;
  appSlug: string;
  actorUserId?: string;
  ownerUserId?: string;
  aliases: Array<{ alias: string; canonical: string }>;
  note?: string;
}

export function buildLegacyPermissionNameLogEntry(
  input: LegacyPermissionNameTelemetryInput,
): Record<string, unknown> {
  return {
    event: "legacy_mcp_permission_name",
    surface: input.surface,
    app_id: input.appId || undefined,
    app_slug: input.appSlug,
    actor_user_id: input.actorUserId || undefined,
    owner_user_id: input.ownerUserId || undefined,
    alias_count: input.aliases.length,
    legacy_aliases: input.aliases.map(({ alias }) => alias),
    canonical_names: input.aliases.map(({ canonical }) => canonical),
    note: input.note || undefined,
  };
}

export function logLegacyPermissionNameCompatibility<
  T extends FunctionNamedRow,
>(
  input: Omit<LegacyPermissionNameTelemetryInput, "aliases"> & { rows: T[] },
  deps: { logger?: LoggerLike } = {},
): number {
  const aliases = findLegacyMcpFunctionNameAliases(input.appSlug, input.rows);
  if (aliases.length === 0) {
    return 0;
  }

  const logger = deps.logger ?? createServerLogger("PERMISSION-COMPAT");
  logger.warn(
    "Legacy MCP permission names normalized",
    buildLegacyPermissionNameLogEntry({
      ...input,
      aliases,
    }),
  );
  return aliases.length;
}
