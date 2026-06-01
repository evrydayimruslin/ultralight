import type {
  CommandSuggestion,
  SuggestionDisplay,
  SuggestionSource,
  SuggestionTarget,
  SystemAgentSuggestionType,
} from "../../shared/contracts/suggestions.ts";
import {
  isSuggestionTarget,
  isSystemAgentSuggestionType,
  suggestionDefaultMeta,
  suggestionSourceGroupLabel,
} from "../../shared/contracts/suggestions.ts";
import {
  type CapabilitySuggestionCandidateInput,
  type CapabilitySuggestionSetRecord,
  recordCapabilitySuggestionSet,
} from "./capability-suggestion-telemetry.ts";
import type {
  FlashBrokerResult,
  MarketplaceCandidate,
  SystemAgentDelegation,
} from "./flash-broker.ts";
import { buildAppTrustCard } from "./trust.ts";

type JsonRecord = Record<string, unknown>;

export interface CommandSuggestionSeed {
  suggestionId?: string;
  source: SuggestionSource;
  target: SuggestionTarget;
  name: string;
  description: string;
  rank?: number | null;
  similarity?: number | null;
  appId?: string | null;
  appSlug?: string | null;
  appName?: string | null;
  appType?: string | null;
  iconUrl?: string | null;
  keyFunctions?: string[];
  display?: SuggestionDisplay;
  metadata?: JsonRecord;
  connected?: boolean;
  runtime?: string | null;
  trustCard?: unknown;
}

export interface RecordCommandSuggestionSetInput {
  userId: string;
  conversationId?: string;
  traceId?: string;
  messageId?: string;
  source?: string;
  intentSummary?: string;
  queryText?: string;
  retrievalSource?: string;
  candidateCount?: number;
  weakMatch?: boolean;
  noMatch?: boolean;
  seeds: CommandSuggestionSeed[];
  metadata?: JsonRecord;
}

export interface CommandSuggestionSetResult {
  intentId: string;
  suggestionSetId: string;
  suggestions: CommandSuggestion[];
  seeds: CommandSuggestionSeed[];
  telemetry: CapabilitySuggestionSetRecord;
}

const SOURCE_ORDER: Record<SuggestionSource, number> = {
  platform_primitive: 1,
  library: 2,
  marketplace: 3,
};

const SYSTEM_AGENT_DISPLAY: Record<SystemAgentSuggestionType, {
  name: string;
  description: string;
}> = {
  tool_builder: {
    name: "Tool Maker",
    description: "Build, test, and deploy a missing tool or widget.",
  },
  tool_marketer: {
    name: "Tool Dealer",
    description: "Find marketplace tools that can fill this capability gap.",
  },
  platform_manager: {
    name: "Platform Guide",
    description:
      "Help configure the platform, settings, billing, and API keys.",
  },
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanText(value: string | null | undefined, fallback = ""): string {
  const text = (value || "").replace(/\s+/g, " ").trim();
  return text || fallback;
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function targetAppId(target: SuggestionTarget): string | null {
  return target.kind === "app" || target.kind === "function"
    ? target.appId
    : null;
}

function targetAppSlug(target: SuggestionTarget): string | null {
  return target.kind === "app" || target.kind === "function"
    ? target.appSlug || null
    : null;
}

function defaultDisplay(seed: CommandSuggestionSeed): SuggestionDisplay {
  const display = seed.display || {};
  const label = display.label || seed.name;
  const description = display.description || seed.description;
  const baseSuggestion = {
    source: seed.source,
    target: seed.target,
    app_name: seed.appName ?? null,
    name: seed.name,
    meta: display.meta,
  };
  return {
    label,
    description,
    meta: suggestionDefaultMeta(baseSuggestion),
    groupLabel: display.groupLabel || suggestionSourceGroupLabel(seed.source),
  };
}

function rankFor(_seed: CommandSuggestionSeed, index: number): number {
  return index + 1;
}

function sortSeeds(seeds: CommandSuggestionSeed[]): CommandSuggestionSeed[] {
  return [...seeds].sort((a, b) => {
    const sourceDelta = SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source];
    if (sourceDelta !== 0) return sourceDelta;
    return (a.rank || 0) - (b.rank || 0);
  });
}

export function extractSuggestionTarget(
  metadata: JsonRecord | undefined,
): SuggestionTarget | undefined {
  if (!metadata || metadata.target === undefined || metadata.target === null) {
    return undefined;
  }
  return isSuggestionTarget(metadata.target) ? metadata.target : undefined;
}

export function systemAgentDelegationToSuggestionSeed(
  delegation: SystemAgentDelegation,
  rankBase = 1,
): CommandSuggestionSeed | null {
  if (!isSystemAgentSuggestionType(delegation.agentType)) return null;

  const display = SYSTEM_AGENT_DISPLAY[delegation.agentType];
  const task = truncate(
    cleanText(delegation.task, delegation.originalPrompt),
    1200,
  );
  const target: SuggestionTarget = {
    kind: "system_agent",
    agentType: delegation.agentType,
    task,
    originalPrompt: cleanText(delegation.originalPrompt) || undefined,
  };

  return {
    source: "platform_primitive",
    target,
    name: display.name,
    description: task || display.description,
    rank: rankBase,
    appId: null,
    appType: "system_agent",
    display: {
      label: display.name,
      description: task || display.description,
      meta: "one-click",
      groupLabel: suggestionSourceGroupLabel("platform_primitive"),
    },
    metadata: {
      system_agent_type: delegation.agentType,
    },
  };
}

export function marketplaceCandidateToSuggestionSeed(
  candidate: MarketplaceCandidate,
  rankBase = 1,
): CommandSuggestionSeed {
  const target: SuggestionTarget = {
    kind: "app",
    appId: candidate.app.id,
    appSlug: candidate.app.slug,
  };
  const trustCard = buildAppTrustCard(candidate.app);
  const description = cleanText(
    candidate.app.description,
    "Install this marketplace tool for the current task.",
  );

  return {
    source: "marketplace",
    target,
    name: candidate.app.name,
    description,
    rank: rankBase,
    similarity: candidate.similarity,
    appId: candidate.app.id,
    appSlug: candidate.app.slug,
    appName: candidate.app.name,
    appType: candidate.app.app_type || "app",
    iconUrl: candidate.app.icon_url,
    keyFunctions: candidate.keyFunctions,
    runtime: candidate.app.runtime || null,
    trustCard,
    connected: false,
    display: {
      label: candidate.app.name,
      description,
      meta: "install",
      groupLabel: suggestionSourceGroupLabel("marketplace"),
    },
    metadata: {
      runtime: candidate.app.runtime || null,
      visibility: candidate.app.visibility || null,
      current_version: candidate.app.current_version || null,
      download_access: candidate.app.download_access || null,
      key_functions: candidate.keyFunctions,
    },
  };
}

export function suggestionSeedToTelemetryInput(
  seed: CommandSuggestionSeed,
  rank: number,
): CapabilitySuggestionCandidateInput {
  const display = defaultDisplay(seed);
  const metadata = {
    ...(seed.metadata || {}),
    target: seed.target,
    display,
    target_kind: seed.target.kind,
    source_group: display.groupLabel,
    icon_url: seed.iconUrl ?? null,
    trust_card: seed.trustCard ?? null,
  };

  return {
    suggestionId: seed.suggestionId,
    appId: seed.appId ?? targetAppId(seed.target),
    appSlug: seed.appSlug ?? targetAppSlug(seed.target),
    appName: seed.appName ?? null,
    appType: seed.appType ?? seed.target.kind,
    suggestionSource: seed.source,
    rank,
    similarity: seed.similarity ?? null,
    keyFunctions: seed.keyFunctions || [],
    metadata,
  };
}

export function serializeCommandSuggestion(
  seed: CommandSuggestionSeed,
  telemetryRecord: CapabilitySuggestionCandidateInput & {
    suggestionId: string;
  },
): CommandSuggestion {
  const display = defaultDisplay(seed);
  const appId = seed.appId ?? targetAppId(seed.target);
  const appSlug = seed.appSlug ?? targetAppSlug(seed.target);
  const id = seed.target.kind === "app" && appId
    ? appId
    : telemetryRecord.suggestionId;
  const metadata = isRecord(telemetryRecord.metadata)
    ? telemetryRecord.metadata
    : {
      ...(seed.metadata || {}),
      target: seed.target,
      display,
    };

  return {
    id,
    name: seed.name,
    description: seed.description,
    source: seed.source,
    target: seed.target,
    label: display.label,
    meta: display.meta,
    display,
    icon_url: seed.iconUrl ?? null,
    similarity: seed.similarity ?? null,
    intent_id: undefined,
    suggestion_id: telemetryRecord.suggestionId,
    rank: telemetryRecord.rank ?? seed.rank ?? undefined,
    app_id: appId,
    app_slug: appSlug,
    app_name: seed.appName ?? null,
    type: seed.target.kind,
    connected: seed.connected ?? false,
    metadata,
    ...(seed.runtime ? { runtime: seed.runtime } : {}),
    ...(seed.trustCard ? { trust_card: seed.trustCard } : {}),
    ...(appSlug ? { slug: appSlug } : {}),
  } as CommandSuggestion & {
    runtime?: string;
    trust_card?: unknown;
    slug?: string;
  };
}

export async function recordCommandSuggestionSet(
  input: RecordCommandSuggestionSetInput,
): Promise<CommandSuggestionSetResult> {
  const seeds = sortSeeds(input.seeds);
  const telemetryInputs = seeds.map((seed, index) =>
    suggestionSeedToTelemetryInput(seed, rankFor(seed, index))
  );
  const telemetry = await recordCapabilitySuggestionSet({
    userId: input.userId,
    conversationId: input.conversationId,
    traceId: input.traceId,
    messageId: input.messageId,
    source: input.source || "orchestrate",
    intentSummary: input.intentSummary,
    queryText: input.queryText,
    retrievalSource: input.retrievalSource || "command_mixed_suggestions",
    candidateCount: input.candidateCount ?? seeds.length,
    weakMatch: input.weakMatch,
    noMatch: input.noMatch,
    suggestions: telemetryInputs,
    metadata: {
      ...(input.metadata || {}),
      suggestion_sources: [...new Set(seeds.map((seed) => seed.source))],
      target_kinds: [...new Set(seeds.map((seed) => seed.target.kind))],
    },
  });

  const suggestions = seeds.map((seed, index) => {
    const suggestion = serializeCommandSuggestion(
      seed,
      telemetry.suggestions[index],
    );
    return {
      ...suggestion,
      intent_id: telemetry.intentId,
      suggestion_set_id: telemetry.suggestionSetId,
    };
  });

  return {
    intentId: telemetry.intentId,
    suggestionSetId: telemetry.suggestionSetId,
    suggestions,
    seeds,
    telemetry,
  };
}

export function buildCommandSuggestionSeedsFromBroker(
  brokerResult: FlashBrokerResult,
): CommandSuggestionSeed[] {
  const platformSeeds = (brokerResult.systemAgentDelegations || [])
    .map((delegation, index) =>
      systemAgentDelegationToSuggestionSeed(delegation, index + 1)
    )
    .filter((seed): seed is CommandSuggestionSeed => !!seed);

  const marketplaceSeeds = (brokerResult.marketplaceCandidates || [])
    .map((candidate, index) =>
      marketplaceCandidateToSuggestionSeed(candidate, index + 1)
    );

  return sortSeeds([...platformSeeds, ...marketplaceSeeds]);
}
