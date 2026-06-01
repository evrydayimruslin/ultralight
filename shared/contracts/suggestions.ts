export const SUGGESTION_SOURCES = [
  "platform_primitive",
  "library",
  "marketplace",
] as const;

export type SuggestionSource = typeof SUGGESTION_SOURCES[number];

export const SYSTEM_AGENT_SUGGESTION_TYPES = [
  "tool_builder",
  "tool_marketer",
  "platform_manager",
] as const;

export type SystemAgentSuggestionType =
  typeof SYSTEM_AGENT_SUGGESTION_TYPES[number];

export type SuggestionTarget =
  | {
    kind: "system_agent";
    agentType: SystemAgentSuggestionType;
    task: string;
    originalPrompt?: string;
  }
  | {
    kind: "function";
    appId: string;
    appSlug?: string;
    fnName: string;
    args?: Record<string, unknown>;
    label?: string;
  }
  | {
    kind: "app";
    appId: string;
    appSlug?: string;
  }
  | {
    kind: "prompt";
    text: string;
  };

export type SuggestionTargetKind = SuggestionTarget["kind"];

export interface SuggestionDisplay {
  label?: string;
  description?: string;
  meta?: string;
  groupLabel?: string;
}

export interface CommandSuggestion {
  id: string;
  name: string;
  description: string;
  source: SuggestionSource;
  /**
   * Transitional during the suggestions rewire: marketplace-only SSE payloads
   * can omit this until the mixed suggestion assembler lands.
   */
  target?: SuggestionTarget;
  label?: string;
  meta?: string;
  icon_url?: string | null;
  similarity?: number | null;
  intent_id?: string;
  suggestion_set_id?: string;
  suggestion_id?: string;
  rank?: number;
  conversation_id?: string;
  message_id?: string;
  trace_id?: string;
  app_id?: string | null;
  app_slug?: string | null;
  app_name?: string | null;
  type?: SuggestionTargetKind | "app" | "skill";
  connected?: boolean;
  display?: SuggestionDisplay;
  metadata?: Record<string, unknown>;
}

export type SuggestionPreviewDescriptor =
  | {
    kind: "app";
    suggestionId?: string;
    appId: string;
    appSlug?: string;
    name: string;
    description?: string;
    source: SuggestionSource;
    functions?: Array<{
      name: string;
      description?: string;
      cost_light?: number;
      params?: Record<string, unknown>;
    }>;
    trust_card?: unknown;
    marketplace?: unknown;
  }
  | {
    kind: "system_agent";
    suggestionId?: string;
    agentType: SystemAgentSuggestionType;
    name: string;
    task: string;
    skillsPath?: string;
    description?: string;
    touchScope?: string[];
  }
  | {
    kind: "function";
    suggestionId?: string;
    appId: string;
    appSlug?: string;
    fnName: string;
    label?: string;
    args?: Record<string, unknown>;
    cost_light?: number;
    signature?: string;
    description?: string;
  }
  | {
    kind: "prompt";
    suggestionId?: string;
    text: string;
    description?: string;
  };

export type SuggestionAcceptResult =
  | {
    ok: true;
    kind: "installed_app";
    suggestionId?: string;
    appId: string;
    appSlug?: string;
    libraryInstalled: boolean;
  }
  | {
    ok: true;
    kind: "start_orchestrate";
    suggestionId?: string;
    message: string;
    systemAgentContext?: {
      type: SystemAgentSuggestionType;
      persona: string;
      skillsPath: string;
    };
    autoConfirmFirstPlan?: boolean;
  }
  | {
    ok: true;
    kind: "inline_discover";
    suggestionId?: string;
    query: string;
    content?: string;
  }
  | {
    ok: true;
    kind: "prefill_prompt";
    suggestionId?: string;
    text: string;
  }
  | {
    ok: true;
    kind: "noop";
    suggestionId?: string;
    message?: string;
  }
  | {
    ok: false;
    kind: "error";
    suggestionId?: string;
    error: string;
  };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function isOptionalRecord(
  value: unknown,
): value is Record<string, unknown> | undefined {
  return value === undefined || isRecord(value);
}

export function isSuggestionSource(value: unknown): value is SuggestionSource {
  return typeof value === "string" &&
    (SUGGESTION_SOURCES as readonly string[]).includes(value);
}

export function isSystemAgentSuggestionType(
  value: unknown,
): value is SystemAgentSuggestionType {
  return typeof value === "string" &&
    (SYSTEM_AGENT_SUGGESTION_TYPES as readonly string[]).includes(value);
}

export function isSuggestionTarget(value: unknown): value is SuggestionTarget {
  if (!isRecord(value) || !isString(value.kind)) return false;

  switch (value.kind) {
    case "system_agent":
      return isSystemAgentSuggestionType(value.agentType) &&
        isString(value.task) &&
        isOptionalString(value.originalPrompt);
    case "function":
      return isString(value.appId) &&
        isString(value.fnName) &&
        isOptionalString(value.appSlug) &&
        isOptionalString(value.label) &&
        isOptionalRecord(value.args);
    case "app":
      return isString(value.appId) &&
        isOptionalString(value.appSlug);
    case "prompt":
      return isString(value.text);
    default:
      return false;
  }
}

export function isCommandSuggestion(
  value: unknown,
): value is CommandSuggestion {
  if (!isRecord(value)) return false;
  if (!isString(value.id) || !isString(value.name)) return false;
  if (typeof value.description !== "string") return false;
  if (!isSuggestionSource(value.source)) return false;
  if (value.target !== undefined && !isSuggestionTarget(value.target)) {
    return false;
  }
  return true;
}

export function suggestionTargetKind(
  target: SuggestionTarget | undefined,
): SuggestionTargetKind | undefined {
  return target?.kind;
}

export function suggestionSourceGroupLabel(source: SuggestionSource): string {
  switch (source) {
    case "platform_primitive":
      return "platform";
    case "library":
      return "library - installed";
    case "marketplace":
      return "marketplace";
  }
}

export function suggestionDefaultMeta(
  suggestion: Pick<
    CommandSuggestion,
    "source" | "target" | "app_name" | "name" | "meta"
  >,
): string {
  if (suggestion.meta) return suggestion.meta;
  if (suggestion.target?.kind === "system_agent") return "one-click";
  if (suggestion.target?.kind === "app") return "install";
  if (suggestion.source === "platform_primitive") return "one-click";
  if (suggestion.source === "marketplace") return "install";
  return suggestion.app_name || suggestion.name;
}
