import { getEnv } from "../lib/env.ts";
import type {
  SuggestionAcceptResult,
  SuggestionTarget,
} from "../../shared/contracts/suggestions.ts";
import { isSuggestionTarget } from "../../shared/contracts/suggestions.ts";
import type { SuggestionRow } from "./suggestion-preview.ts";
import {
  type CapabilitySuggestionEventInput,
  installAcceptedSuggestionApp,
  recordCapabilitySuggestionEvent,
} from "./capability-suggestion-telemetry.ts";
import { getSystemAgentDescriptor } from "./system-agent-descriptors.ts";
import { createServerLogger } from "./logging.ts";

type JsonRecord = Record<string, unknown>;

export interface SuggestionAcceptanceDependencies {
  fetchSuggestionRow?: (
    userId: string,
    suggestionId: string,
  ) => Promise<SuggestionRow | null>;
  recordEvent?: (
    input: CapabilitySuggestionEventInput,
  ) => Promise<{ eventId: string; libraryInstalled: boolean }>;
  installAcceptedApp?: (userId: string, appId: string) => Promise<boolean>;
}

export interface AcceptSuggestionInput {
  userId: string;
  suggestionId: string;
  conversationId?: string;
  traceId?: string;
  messageId?: string;
  eventSource?: string;
  metadata?: JsonRecord;
  fallbackTarget?: SuggestionTarget;
  fallbackSuggestion?: Partial<SuggestionRow>;
  dependencies?: SuggestionAcceptanceDependencies;
}

const suggestionAcceptanceLogger = createServerLogger("SUGGESTION-ACCEPTANCE");

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

function metadataTarget(
  row?: Partial<SuggestionRow> | null,
): SuggestionTarget | undefined {
  const metadata = isRecord(row?.metadata) ? row.metadata : undefined;
  const target = metadata?.target;
  return isSuggestionTarget(target) ? target : undefined;
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

function eventAppId(target: SuggestionTarget, row: Partial<SuggestionRow>) {
  if (target.kind === "app" || target.kind === "function") {
    return target.appId;
  }
  return row.app_id || undefined;
}

function eventAppSlug(target: SuggestionTarget, row: Partial<SuggestionRow>) {
  if (target.kind === "app" || target.kind === "function") {
    return target.appSlug || row.app_slug || undefined;
  }
  return row.app_slug || undefined;
}

function acceptanceMetadata(
  input: AcceptSuggestionInput,
  row: Partial<SuggestionRow>,
  target: SuggestionTarget,
  resultKind: SuggestionAcceptResult["kind"],
): JsonRecord {
  return {
    ...(input.metadata || {}),
    target,
    target_kind: target.kind,
    accept_result_kind: resultKind,
    suggestion_source: row.suggestion_source || undefined,
  };
}

async function recordAcceptedSuggestion(
  input: AcceptSuggestionInput,
  row: Partial<SuggestionRow>,
  target: SuggestionTarget,
  resultKind: SuggestionAcceptResult["kind"],
  dependencies: Required<SuggestionAcceptanceDependencies>,
): Promise<void> {
  await dependencies.recordEvent({
    userId: input.userId,
    eventType: "accepted",
    intentId: row.intent_id || undefined,
    suggestionSetId: row.suggestion_set_id || undefined,
    suggestionId: input.suggestionId,
    conversationId: input.conversationId,
    traceId: input.traceId,
    messageId: input.messageId,
    appId: eventAppId(target, row),
    appSlug: eventAppSlug(target, row),
    eventSource: input.eventSource || "server",
    installOnAccept: false,
    metadata: acceptanceMetadata(input, row, target, resultKind),
  });
}

function discoveryQuery(
  target: Extract<SuggestionTarget, { kind: "system_agent" }>,
): string {
  const source = target.originalPrompt || target.task;
  const stripped = source
    .replace(/^user\s+(needs|wants|asked for)\s+/i, "")
    .replace(/\.\s*search marketplace.*$/i, "")
    .replace(/\.\s*help them.*$/i, "")
    .trim();
  return stripped || source.trim() || "marketplace tools";
}

function systemAgentMessage(
  target: Extract<SuggestionTarget, { kind: "system_agent" }>,
): string {
  const descriptor = getSystemAgentDescriptor(target.agentType);
  return [
    `Start ${descriptor.name} for this accepted suggestion:`,
    "",
    target.task,
  ].join("\n");
}

function functionSuggestionPrompt(
  target: Extract<SuggestionTarget, { kind: "function" }>,
): string {
  const label = target.label || target.fnName;
  return [
    `Run this accepted suggestion: ${label}`,
    "",
    "Use the existing app/tool context and execute this verified action:",
    "```json",
    JSON.stringify(
      {
        kind: "mcp_function",
        label,
        mode: "write",
        confirmation: "user",
        app_id: target.appId,
        app_slug: target.appSlug,
        function_name: target.fnName,
        args: target.args || {},
      },
      null,
      2,
    ),
    "```",
  ].join("\n");
}

function requiredDependencies(
  dependencies?: SuggestionAcceptanceDependencies,
): Required<SuggestionAcceptanceDependencies> {
  return {
    fetchSuggestionRow: dependencies?.fetchSuggestionRow ||
      defaultFetchSuggestionRow,
    recordEvent: dependencies?.recordEvent || recordCapabilitySuggestionEvent,
    installAcceptedApp: dependencies?.installAcceptedApp ||
      installAcceptedSuggestionApp,
  };
}

export async function acceptSuggestion(
  input: AcceptSuggestionInput,
): Promise<SuggestionAcceptResult> {
  const dependencies = requiredDependencies(input.dependencies);

  try {
    const persistedRow = await dependencies.fetchSuggestionRow(
      input.userId,
      input.suggestionId,
    );
    const row: Partial<SuggestionRow> = persistedRow ||
      input.fallbackSuggestion ||
      {};
    const target = targetFromRow(row, input.fallbackTarget);
    if (!target) {
      return {
        ok: false,
        kind: "error",
        suggestionId: input.suggestionId,
        error: "Suggestion target was not found",
      };
    }

    switch (target.kind) {
      case "app": {
        const libraryInstalled = await dependencies.installAcceptedApp(
          input.userId,
          target.appId,
        );
        await recordAcceptedSuggestion(
          input,
          row,
          target,
          "installed_app",
          dependencies,
        );
        return {
          ok: true,
          kind: "installed_app",
          suggestionId: input.suggestionId,
          appId: target.appId,
          appSlug: target.appSlug || row.app_slug || undefined,
          libraryInstalled,
        };
      }
      case "system_agent": {
        if (target.agentType === "tool_marketer") {
          const query = discoveryQuery(target);
          await recordAcceptedSuggestion(
            input,
            row,
            target,
            "inline_discover",
            dependencies,
          );
          return {
            ok: true,
            kind: "inline_discover",
            suggestionId: input.suggestionId,
            query,
            content: `{{discover:${query}}}`,
          };
        }

        const descriptor = getSystemAgentDescriptor(target.agentType);
        await recordAcceptedSuggestion(
          input,
          row,
          target,
          "start_orchestrate",
          dependencies,
        );
        return {
          ok: true,
          kind: "start_orchestrate",
          suggestionId: input.suggestionId,
          message: systemAgentMessage(target),
          systemAgentContext: {
            type: target.agentType,
            persona: descriptor.persona,
            skillsPath: descriptor.skillsPath,
          },
        };
      }
      case "function": {
        await recordAcceptedSuggestion(
          input,
          row,
          target,
          "start_orchestrate",
          dependencies,
        );
        return {
          ok: true,
          kind: "start_orchestrate",
          suggestionId: input.suggestionId,
          message: functionSuggestionPrompt(target),
          autoConfirmFirstPlan: false,
        };
      }
      case "prompt": {
        await recordAcceptedSuggestion(
          input,
          row,
          target,
          "prefill_prompt",
          dependencies,
        );
        return {
          ok: true,
          kind: "prefill_prompt",
          suggestionId: input.suggestionId,
          text: target.text,
        };
      }
    }
  } catch (err) {
    suggestionAcceptanceLogger.warn("Suggestion accept failed", {
      user_id: input.userId,
      suggestion_id: input.suggestionId,
      error: err,
    });
    return {
      ok: false,
      kind: "error",
      suggestionId: input.suggestionId,
      error: err instanceof Error ? err.message : "Suggestion accept failed",
    };
  }
}
