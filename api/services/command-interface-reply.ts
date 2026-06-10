import type {
  AgenticInterfaceSpec,
} from "../../shared/contracts/agentic-interface.ts";
import {
  buildAgenticInterfacePlanFromInventory,
} from "./agentic-interface-planner.ts";
import {
  buildAgenticInterfacePlannerContextSummary,
} from "./agentic-interface-prompts.ts";
import { verifyAgenticInterfaceSpec } from "./agentic-interface-validate.ts";
import {
  type CommandSurfaceInventory,
  flattenCommandSurfaceInventory,
} from "./command-surfaces.ts";
import {
  buildFlashCallTelemetryContext,
  callFlashText,
  type FlashBrokerResult,
  type FlashBrokerTelemetryContext,
} from "./flash-broker.ts";
import {
  type FunctionIndex,
  getOrRebuildFunctionIndex,
} from "./function-index.ts";
import { selectInferenceModel } from "./inference-client.ts";
import type { ResolvedInferenceRoute } from "./inference-route.ts";
import { ULTRALIGHT_DEEPSEEK_V4_FLASH_MODEL } from "./platform-inference-models.ts";
import {
  clearCommandDescriptorCacheForTests,
  readCommandDescriptorCache,
  writeCommandDescriptorCache,
} from "./command-descriptor-cache.ts";

export interface ProposeInterfaceReplyInput {
  brokerResult: FlashBrokerResult;
  replyText: string;
  userMessage: string;
  userId: string;
  userEmail: string;
  route: ResolvedInferenceRoute;
  interpreterModel?: string;
  telemetry?: FlashBrokerTelemetryContext;
  timeoutMs?: number;
  dependencies?: {
    callFlashText?: typeof callFlashText;
    getFunctionIndex?: (userId: string) => Promise<FunctionIndex>;
    getCommandSurfaceInventory?: (
      userId: string,
      fnIndex: FunctionIndex,
      brokerResult: FlashBrokerResult,
      query: string,
    ) => Promise<CommandSurfaceInventory>;
  };
}

export interface InterfaceReplyResult {
  spec: AgenticInterfaceSpec;
  source: "llm" | "fallback" | "cache";
}

const INTERFACE_REPLY_SYSTEM =
  `You decide whether an assistant chat reply should also render as a typed AgenticInterfaceSpec.

Return ONLY JSON, no markdown:
{
  "render": true,
  "spec": { "...": "AgenticInterfaceSpec" }
}

Or:
{ "render": false, "reason": "short reason" }

Rules:
- Return render=false when prose is enough.
- Return render=true for queue, approval, status, table, list, metrics, dashboard, comparison, timeline, or record-review answers.
- Never write HTML, CSS, JSX, scripts, selectors, or iframe code.
- Use only the provided inventory and function/context names.
- Prefer command_card and widget_embed components when a matching shipped surface exists.
- Use mcp_read_function or context_source data bindings for read data.
- Write actions must use confirmation "user" or "high_risk".
- Keep the spec compact: 1-6 components.`;

const PROMPT_SHAPE_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "for",
  "from",
  "give",
  "i",
  "in",
  "into",
  "make",
  "me",
  "my",
  "of",
  "please",
  "show",
  "the",
  "to",
  "with",
]);

export function deriveInterfacePromptShape(prompt: string): string {
  const tokens = prompt
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, " id ")
    .replace(/\b\d+(?:\.\d+)?\b/g, " number ")
    .replace(/[^a-z0-9_]+/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !PROMPT_SHAPE_STOPWORDS.has(token));
  const unique = [...new Set(tokens)].slice(0, 16);
  return unique.length > 0 ? unique.join(" ") : "general";
}

function deriveToolSetVersion(
  fnIndex: FunctionIndex,
  brokerResult: FlashBrokerResult,
): string {
  const scoped = scopedFunctions(fnIndex, brokerResult);
  const parts = [
    fnIndex.updatedAt || "no-updated-at",
    ...Object.entries(scoped)
      .map(([name, fn]) => `${name}:${fn.appId}:${fn.appSlug}:${fn.fnName}`)
      .sort(),
    ...fnIndex.widgets
      .filter((widget) =>
        brokerResult.involvedAppIds.length === 0 ||
        brokerResult.involvedAppIds.includes(widget.appId)
      )
      .map((widget) =>
        `w:${widget.appId}:${widget.name}:${
          widget.cards?.map((card) => card.id).sort().join(",") || ""
        }`
      )
      .sort(),
    ...fnIndex.contextSources
      .filter((source) =>
        brokerResult.involvedAppIds.length === 0 ||
        brokerResult.involvedAppIds.includes(source.appId)
      )
      .map((source) =>
        `c:${source.appId}:${source.id}:${
          source.searchable ? "search" : "read"
        }`
      )
      .sort(),
  ];
  return parts.join("|");
}

function descriptorCacheKey(input: {
  userId: string;
  promptShape: string;
  toolSetVersion: string;
}): string {
  return `${input.userId}::${input.toolSetVersion}::${input.promptShape}`;
}

export function clearInterfaceDescriptorCacheForTests(): void {
  clearCommandDescriptorCacheForTests("interface_reply");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence?.[1]?.trim() || trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1));
    }
    throw new Error("Flash interface output was not valid JSON");
  }
}

function looksSurfaceShaped(input: {
  brokerResult: FlashBrokerResult;
  userMessage: string;
  replyText: string;
}): boolean {
  if (input.brokerResult.involvedAppIds.length === 0) return false;
  const text = `${input.userMessage}\n${input.replyText}`.toLowerCase();
  return /\b(show|list|table|queue|dashboard|overview|status|pending|approvals?|review|compare|timeline|metrics?|progress|open|recent|records?|inbox|drafts?)\b/
    .test(text);
}

function scopedFunctions(
  fnIndex: FunctionIndex,
  brokerResult: FlashBrokerResult,
): FunctionIndex["functions"] {
  const involved = new Set(brokerResult.involvedAppIds);
  const candidateNames = new Set([
    ...Object.keys(brokerResult.toolMap || {}),
    ...Object.values(brokerResult.toolMap || {}).map((tool) => tool.fnName),
  ]);
  const entries = Object.entries(fnIndex.functions || {}).filter(([name, fn]) =>
    candidateNames.has(name) || candidateNames.has(fn.fnName) ||
    involved.has(fn.appId)
  );
  return Object.fromEntries(entries);
}

function defaultInventory(
  _userId: string,
  fnIndex: FunctionIndex,
  brokerResult: FlashBrokerResult,
  query: string,
): Promise<CommandSurfaceInventory> {
  return Promise.resolve(flattenCommandSurfaceInventory(fnIndex, {
    query,
    surfaces: ["command_card", "widget"],
    limit: 18,
    app_ids: brokerResult.involvedAppIds,
  }));
}

function buildPrompt(input: {
  userMessage: string;
  replyText: string;
  brokerResult: FlashBrokerResult;
  fnIndex: FunctionIndex;
  inventory: CommandSurfaceInventory;
}): string {
  const functions = scopedFunctions(input.fnIndex, input.brokerResult);
  const contextSources = input.fnIndex.contextSources.filter((source) =>
    input.brokerResult.involvedAppIds.length === 0 ||
    input.brokerResult.involvedAppIds.includes(source.appId)
  );
  const summary = buildAgenticInterfacePlannerContextSummary({
    inventory: input.inventory,
    functions,
    contextSources,
    maxItems: 12,
  });
  return JSON.stringify(
    {
      user_message: input.userMessage,
      assistant_reply: input.replyText.slice(0, 4000),
      interface_contract: {
        required_top_level_fields: [
          "id",
          "title",
          "mode",
          "components",
          "version",
        ],
        allowed_component_kinds: [
          "metric",
          "list",
          "table",
          "detail",
          "form",
          "action_bar",
          "timeline",
          "card_ref",
          "widget_embed",
          "routine_panel",
          "text",
        ],
        allowed_binding_sources: [
          "command_card",
          "context_source",
          "mcp_read_function",
          "literal",
        ],
        allowed_action_kinds: [
          "mcp_function",
          "open_widget",
          "refresh_binding",
          "select_entity",
          "widget_action",
        ],
      },
      inventory: summary,
      functions: Object.entries(functions).slice(0, 40).map(([name, fn]) => ({
        name,
        app_id: fn.appId,
        app_slug: fn.appSlug,
        function_name: fn.fnName,
        description: fn.description,
        params: fn.params,
        returns: fn.returns,
      })),
      context_sources: contextSources.slice(0, 16),
      entities: input.brokerResult.entities.slice(0, 12),
      conventions: input.brokerResult.conventions.slice(0, 12),
    },
    null,
    2,
  );
}

function parseLlmSpec(
  text: string,
): { wantsRender: boolean; spec?: AgenticInterfaceSpec } {
  const parsed = extractJson(text);
  if (!isRecord(parsed)) return { wantsRender: false };
  if (parsed.render === false) return { wantsRender: false };
  const spec = isRecord(parsed.spec) ? parsed.spec : parsed;
  if (parsed.render === true || isRecord(parsed.spec)) {
    return { wantsRender: true, spec: spec as unknown as AgenticInterfaceSpec };
  }
  return { wantsRender: false };
}

function verifyRenderableSpec(
  draft: AgenticInterfaceSpec,
  fnIndex: FunctionIndex,
  inventory: CommandSurfaceInventory,
): AgenticInterfaceSpec | null {
  const result = verifyAgenticInterfaceSpec(draft, {
    fnIndex,
    inventory,
    options: {
      maxComponents: 8,
      maxActions: 8,
      maxDataBindings: 10,
    },
  });
  if (!result.verified || result.spec.components.length === 0) return null;
  return result.spec;
}

function fallbackSpec(input: {
  userMessage: string;
  fnIndex: FunctionIndex;
  inventory: CommandSurfaceInventory;
  brokerResult: FlashBrokerResult;
}): AgenticInterfaceSpec | null {
  const result = buildAgenticInterfacePlanFromInventory(
    input.fnIndex,
    input.inventory,
    {
      prompt: input.userMessage,
      query: input.userMessage,
      mode: "temporary",
      max_components: 6,
      app_ids: input.brokerResult.involvedAppIds,
    },
  );
  if (
    !result.verification.verified ||
    result.normalized_spec.components.length === 0
  ) {
    return null;
  }
  return result.normalized_spec;
}

export async function proposeInterfaceReply(
  input: ProposeInterfaceReplyInput,
): Promise<InterfaceReplyResult | null> {
  if (!looksSurfaceShaped(input)) return null;

  const fnIndex = await (input.dependencies?.getFunctionIndex ||
    getOrRebuildFunctionIndex)(input.userId);
  const inventory = await (input.dependencies?.getCommandSurfaceInventory ||
    defaultInventory)(
      input.userId,
      fnIndex,
      input.brokerResult,
      input.userMessage,
    );
  if (
    inventory.surfaces.length === 0 &&
    input.brokerResult.involvedAppIds.length === 0
  ) {
    return null;
  }

  const promptShape = deriveInterfacePromptShape(input.userMessage);
  const cacheKey = descriptorCacheKey({
    userId: input.userId,
    promptShape,
    toolSetVersion: deriveToolSetVersion(fnIndex, input.brokerResult),
  });
  const cachedSpec = readCommandDescriptorCache<AgenticInterfaceSpec>(
    "interface_reply",
    cacheKey,
    (spec) => verifyRenderableSpec(spec, fnIndex, inventory),
  );
  if (cachedSpec) {
    return { spec: cachedSpec, source: "cache" };
  }

  const model = selectInferenceModel(
    input.route,
    input.interpreterModel || ULTRALIGHT_DEEPSEEK_V4_FLASH_MODEL,
  );
  const telemetry = buildFlashCallTelemetryContext(input.telemetry, {
    userId: input.userId,
    userEmail: input.userEmail,
  });
  const response = await (input.dependencies?.callFlashText || callFlashText)(
    model,
    INTERFACE_REPLY_SYSTEM,
    buildPrompt({
      userMessage: input.userMessage,
      replyText: input.replyText,
      brokerResult: input.brokerResult,
      fnIndex,
      inventory,
    }),
    input.route,
    telemetry
      ? {
        telemetry,
        capabilities: [
          "json_structured_output",
          "function_selection",
          "schema_conditioning",
        ],
        inputFeatures: {
          availableFunctionCount:
            Object.keys(scopedFunctions(fnIndex, input.brokerResult)).length,
          conventionCount: input.brokerResult.conventions.length,
        },
        metadata: {
          command_interface_reply: true,
          surface_count: inventory.surfaces.length,
        },
      }
      : undefined,
  );

  try {
    const parsed = parseLlmSpec(response);
    if (!parsed.wantsRender) return null;
    if (parsed.spec) {
      const spec = verifyRenderableSpec(parsed.spec, fnIndex, inventory);
      if (spec) {
        writeCommandDescriptorCache("interface_reply", cacheKey, spec, "llm");
        return { spec, source: "llm" };
      }
    }
  } catch {
    // Fall through to the deterministic planner; malformed model output is recoverable.
  }

  const spec = fallbackSpec({
    userMessage: input.userMessage,
    fnIndex,
    inventory,
    brokerResult: input.brokerResult,
  });
  if (!spec) return null;
  writeCommandDescriptorCache("interface_reply", cacheKey, spec, "fallback");
  return { spec, source: "fallback" };
}

export async function proposeInterfaceReplySafely(
  input: ProposeInterfaceReplyInput,
): Promise<InterfaceReplyResult | null> {
  const timeoutMs = input.timeoutMs ?? 6500;
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      proposeInterfaceReply(input),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } catch (err) {
    console.warn("[command-interface-reply] proposal failed:", err);
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
