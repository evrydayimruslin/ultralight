import type {
  AgenticInterfaceAction,
  AgenticInterfaceSpec,
} from "../../shared/contracts/agentic-interface.ts";
import type { NextStep } from "../../shared/contracts/command-turn.ts";
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
import type { CommandSuggestionSeed } from "./command-suggestions.ts";
import {
  type FunctionIndex,
  getOrRebuildFunctionIndex,
} from "./function-index.ts";
import { selectInferenceModel } from "./inference-client.ts";
import type { ResolvedInferenceRoute } from "./inference-route.ts";
import { verifyAgenticInterfaceSpec } from "./agentic-interface-validate.ts";
import { ULTRALIGHT_DEEPSEEK_V4_FLASH_MODEL } from "./platform-inference-models.ts";
import type { SuggestionTarget } from "../../shared/contracts/suggestions.ts";

interface CandidateFunction {
  toolName: string;
  appId: string;
  appName: string;
  appSlug: string;
  fnName: string;
  origin: "library" | "marketplace";
}

interface RawNextStep {
  kind?: unknown;
  label?: unknown;
  prompt?: unknown;
  tool_name?: unknown;
  function_name?: unknown;
  function?: unknown;
  args?: unknown;
  arguments?: unknown;
  confirmation?: unknown;
  expected_result?: unknown;
}

export interface ProposeNextStepsInput {
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
    ) => Promise<CommandSurfaceInventory>;
  };
}

const NEXT_STEPS_SYSTEM =
  `You propose concise next steps after an assistant turn.

Return ONLY JSON, no markdown:
{
  "steps": [
    { "kind": "suggest_prompt", "label": "short chip label", "prompt": "prompt to prefill" },
    { "kind": "action", "label": "short chip label", "tool_name": "one candidate tool_name", "args": { "key": "value" } }
  ]
}

Rules:
- Prefer zero steps. Return {"steps":[]} when the turn is complete, factual, or low-value.
- Return at most 3 steps.
- Use suggest_prompt for a helpful follow-up question or alternative ask. It does not run tools.
- Use action only when the user's intent and the assistant reply make a concrete next action obvious.
- For action, tool_name MUST exactly match one candidate tool_name. Never invent tools or arguments.
- Keep labels under 56 characters.`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function labelValue(value: unknown, fallback: string): string {
  return (stringValue(value, fallback).replace(/\s+/g, " ").trim() || fallback)
    .slice(0, 80);
}

function rawArgs(raw: RawNextStep): Record<string, unknown> {
  if (isRecord(raw.args)) return raw.args;
  if (isRecord(raw.arguments)) return raw.arguments;
  return {};
}

function idFor(prefix: string, label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32) || prefix;
  return `${prefix}_${slug}_${crypto.randomUUID().slice(0, 8)}`;
}

export function buildCandidateFunctions(
  brokerResult: FlashBrokerResult,
): CandidateFunction[] {
  return Object.entries(brokerResult.toolMap || {}).map(([toolName, tool]) => ({
    toolName,
    appId: tool.appId,
    appName: tool.appName,
    appSlug: tool.appSlug,
    fnName: tool.fnName,
    origin: tool.origin,
  }));
}

function buildPrompt(input: {
  userMessage: string;
  replyText: string;
  brokerResult: FlashBrokerResult;
  candidates: CandidateFunction[];
}): string {
  const candidateLines = input.candidates.slice(0, 60).map((candidate) => ({
    tool_name: candidate.toolName,
    function_name: candidate.fnName,
    app_slug: candidate.appSlug,
    app_name: candidate.appName,
    origin: candidate.origin,
  }));

  return JSON.stringify(
    {
      user_message: input.userMessage,
      assistant_reply: input.replyText.slice(0, 4000),
      candidate_functions: candidateLines,
      entities: input.brokerResult.entities.slice(0, 12),
      conventions: input.brokerResult.conventions.slice(0, 12),
      mode_hint: input.brokerResult.needsTool
        ? "tool_turn"
        : "direct_or_read_turn",
    },
    null,
    2,
  );
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
    throw new Error("Flash next-steps output was not valid JSON");
  }
}

export function parseRawNextSteps(text: string): RawNextStep[] {
  const parsed = extractJson(text);
  if (Array.isArray(parsed)) return parsed.filter(isRecord);
  if (isRecord(parsed) && Array.isArray(parsed.steps)) {
    return parsed.steps.filter(isRecord);
  }
  return [];
}

function candidateForRawStep(
  raw: RawNextStep,
  candidates: CandidateFunction[],
): CandidateFunction | null {
  const requested = stringValue(raw.tool_name) ||
    stringValue(raw.function_name) ||
    stringValue(raw.function);
  if (!requested) return null;
  return candidates.find((candidate) =>
    candidate.toolName === requested || candidate.fnName === requested
  ) || null;
}

function verifyAction(
  action: AgenticInterfaceAction,
  fnIndex: FunctionIndex,
  inventory: CommandSurfaceInventory,
): AgenticInterfaceAction | null {
  const draft: AgenticInterfaceSpec = {
    id: "next_step_action_validation",
    title: "Next-step action validation",
    mode: "temporary",
    components: [],
    actions: [action],
    version: 1,
  };
  const result = verifyAgenticInterfaceSpec(draft, {
    fnIndex,
    inventory,
    options: {
      maxActions: 1,
      maxComponents: 0,
      maxDataBindings: 0,
    },
  });
  if (!result.verified) return null;
  return result.spec.actions?.[0] || null;
}

function normalizeSuggestRawStep(raw: RawNextStep): NextStep | null {
  if (stringValue(raw.kind) !== "suggest_prompt") return null;
  const prompt = stringValue(raw.prompt).slice(0, 1200);
  if (!prompt) return null;
  const label = labelValue(raw.label, prompt);
  return {
    id: idFor("suggest", label),
    kind: "suggest_prompt",
    label,
    prompt,
  };
}

function normalizeRawStep(
  raw: RawNextStep,
  candidates: CandidateFunction[],
  fnIndex: FunctionIndex,
  inventory: CommandSurfaceInventory,
): NextStep | null {
  const kind = stringValue(raw.kind);
  if (kind === "suggest_prompt") {
    return normalizeSuggestRawStep(raw);
  }

  if (kind !== "action") return null;
  const candidate = candidateForRawStep(raw, candidates);
  if (!candidate) return null;
  const label = labelValue(raw.label, candidate.fnName);
  const confirmation = stringValue(raw.confirmation);
  const draftAction: AgenticInterfaceAction = {
    id: idFor("action", label),
    kind: "mcp_function",
    label,
    mode: "read",
    ...(confirmation === "user" || confirmation === "high_risk" ||
        confirmation === "none"
      ? { confirmation }
      : {}),
    app_id: candidate.appId,
    app_slug: candidate.appSlug,
    function_name: candidate.fnName,
    args_template: rawArgs(raw),
    ...(stringValue(raw.expected_result)
      ? { expected_result: stringValue(raw.expected_result).slice(0, 160) }
      : {}),
  };
  const verifiedAction = verifyAction(draftAction, fnIndex, inventory);
  if (!verifiedAction) return null;
  return {
    id: verifiedAction.id,
    kind: "action",
    label: verifiedAction.label,
    action: verifiedAction,
    preview: verifiedAction.confirmation !== "none",
  };
}

function dedupeAndCap(steps: NextStep[]): NextStep[] {
  const seen = new Set<string>();
  const out: NextStep[] = [];
  for (const step of steps) {
    const key = step.kind === "suggest_prompt"
      ? `suggest:${step.prompt.toLowerCase()}`
      : `action:${step.action.kind}:${step.action.id}:${
        JSON.stringify(step.action.args_template || {})
      }`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(step);
    if (out.length >= 3) break;
  }
  return out;
}

function toolMapEntryForAction(
  step: Extract<NextStep, { kind: "action" }>,
  brokerResult: FlashBrokerResult,
): FlashBrokerResult["toolMap"][string] | undefined {
  const action = step.action;
  if (action.kind !== "mcp_function") return undefined;
  return Object.values(brokerResult.toolMap || {}).find((entry) =>
    entry.appId === action.app_id &&
    entry.fnName === action.function_name
  );
}

export function actionNextStepToFunctionTarget(
  step: NextStep,
): SuggestionTarget | null {
  if (step.kind !== "action") return null;
  const action = step.action;
  if (action.kind !== "mcp_function") return null;
  return {
    kind: "function",
    appId: action.app_id,
    appSlug: action.app_slug,
    fnName: action.function_name,
    args: action.args_template || {},
    label: step.label,
  };
}

export function promptNextStepToPromptTarget(
  step: NextStep,
): SuggestionTarget | null {
  if (step.kind !== "suggest_prompt") return null;
  return {
    kind: "prompt",
    text: step.prompt,
  };
}

export function nextStepToSuggestionSeed(
  step: NextStep,
  brokerResult: FlashBrokerResult,
): CommandSuggestionSeed | null {
  if (step.kind === "suggest_prompt") {
    const target = promptNextStepToPromptTarget(step);
    if (!target) return null;
    return {
      source: "library",
      target,
      name: step.label,
      description: step.prompt,
      appId: null,
      appType: "prompt",
      display: {
        label: step.label,
        description: step.prompt,
        meta: "prompt",
        groupLabel: "library - installed",
      },
      metadata: {
        next_step_id: step.id,
        next_step_kind: step.kind,
      },
    };
  }

  const target = actionNextStepToFunctionTarget(step);
  if (!target) return null;
  const action = step.action;
  if (action.kind !== "mcp_function") return null;
  const tool = toolMapEntryForAction(step, brokerResult);
  const appName = tool?.appName || action.app_slug || action.app_id;
  const description = action.expected_result ||
    `Run ${action.function_name} with ${appName}.`;
  return {
    source: "library",
    target,
    name: step.label,
    description,
    appId: action.app_id,
    appSlug: action.app_slug || tool?.appSlug,
    appName,
    appType: "mcp",
    keyFunctions: [action.function_name],
    display: {
      label: step.label,
      description,
      meta: appName,
      groupLabel: "library - installed",
    },
    metadata: {
      next_step_id: step.id,
      next_step_kind: step.kind,
      preview: step.preview,
      confirmation: action.confirmation || null,
      tool_origin: tool?.origin || "library",
    },
  };
}

export async function proposeNextSteps(
  input: ProposeNextStepsInput,
): Promise<NextStep[]> {
  const candidates = buildCandidateFunctions(input.brokerResult);
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
    NEXT_STEPS_SYSTEM,
    buildPrompt({
      userMessage: input.userMessage,
      replyText: input.replyText,
      brokerResult: input.brokerResult,
      candidates,
    }),
    input.route,
    telemetry
      ? {
        telemetry,
        capabilities: ["json_structured_output", "function_selection"],
        inputFeatures: {
          availableFunctionCount: candidates.length,
          functionCount: candidates.length,
          conventionCount: input.brokerResult.conventions.length,
        },
        metadata: {
          command_next_steps: true,
          candidate_function_count: candidates.length,
        },
      }
      : undefined,
  );
  if (!response.trim()) return [];
  const rawSteps = parseRawNextSteps(response);
  if (rawSteps.length === 0) return [];
  if (!rawSteps.some((raw) => stringValue(raw.kind) === "action")) {
    return dedupeAndCap(
      rawSteps
        .map(normalizeSuggestRawStep)
        .filter((step): step is NextStep => step !== null),
    );
  }

  const fnIndex = await (input.dependencies?.getFunctionIndex ||
    getOrRebuildFunctionIndex)(input.userId);
  const defaultInventory = (
    _userId: string,
    index: FunctionIndex,
    brokerResult: FlashBrokerResult,
  ) =>
    Promise.resolve(flattenCommandSurfaceInventory(index, {
      app_ids: brokerResult.involvedAppIds,
      limit: 100,
    }));
  const inventory = await (input.dependencies?.getCommandSurfaceInventory ||
    defaultInventory)(input.userId, fnIndex, input.brokerResult);

  return dedupeAndCap(
    rawSteps
      .map((raw) => normalizeRawStep(raw, candidates, fnIndex, inventory))
      .filter((step): step is NextStep => step !== null),
  );
}

export async function proposeNextStepsSafely(
  input: ProposeNextStepsInput,
): Promise<NextStep[]> {
  const timeoutMs = input.timeoutMs ?? 5000;
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      proposeNextSteps(input),
      new Promise<NextStep[]>((resolve) => {
        timer = setTimeout(() => resolve([]), timeoutMs);
      }),
    ]);
  } catch (err) {
    console.warn("[command-next-steps] proposal failed:", err);
    return [];
  } finally {
    if (timer) clearTimeout(timer);
  }
}
