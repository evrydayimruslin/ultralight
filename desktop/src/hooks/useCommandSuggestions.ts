import { useCallback, useMemo, useState } from "react";
import { acceptSuggestionById, fetchSuggestionPreview } from "../lib/api";
import { useAmbientSuggestions } from "./useAmbientSuggestions";
import type { AmbientSuggestion } from "../types/ambientSuggestion";
import type {
  SuggestionAcceptResult,
  SuggestionPreviewDescriptor,
  SuggestionTarget,
} from "../../../shared/contracts/suggestions.ts";

export type CommandSuggestionAcceptState =
  | "idle"
  | "accepting"
  | "accepted"
  | "error";

export function commandSuggestionKey(suggestion: AmbientSuggestion): string {
  return suggestion.suggestion_id ||
    `${suggestion.suggestion_set_id || "set"}:${suggestion.id}`;
}

function targetFromSuggestion(
  suggestion: AmbientSuggestion,
): SuggestionTarget | undefined {
  if (suggestion.target) return suggestion.target;
  const target = suggestion.metadata?.target;
  return target && typeof target === "object" && !Array.isArray(target)
    ? target as SuggestionTarget
    : undefined;
}

function fallbackPreview(
  suggestion: AmbientSuggestion,
): SuggestionPreviewDescriptor | null {
  const target = targetFromSuggestion(suggestion);
  if (!target) {
    if (suggestion.type === "app" || suggestion.type === "skill") {
      return {
        kind: "app",
        appId: suggestion.app_id || suggestion.id,
        appSlug: suggestion.app_slug || suggestion.slug,
        name: suggestion.name,
        description: suggestion.description,
        source: suggestion.source === "shared"
          ? "marketplace"
          : suggestion.source,
        functions: [],
        trust_card: suggestion.trust_card,
        marketplace: suggestion.marketplace || undefined,
      };
    }
    return null;
  }

  switch (target.kind) {
    case "app":
      return {
        kind: "app",
        appId: target.appId,
        appSlug: target.appSlug || suggestion.app_slug || suggestion.slug,
        name: suggestion.name,
        description: suggestion.description,
        source: suggestion.source === "shared"
          ? "marketplace"
          : suggestion.source,
        functions: [],
        trust_card: suggestion.trust_card,
        marketplace: suggestion.marketplace || undefined,
      };
    case "function":
      return {
        kind: "function",
        appId: target.appId,
        appSlug: target.appSlug || suggestion.app_slug || suggestion.slug,
        fnName: target.fnName,
        label: target.label || suggestion.name,
        args: target.args || {},
        description: suggestion.description,
      };
    case "system_agent":
      return {
        kind: "system_agent",
        agentType: target.agentType,
        name: suggestion.name,
        task: target.task,
        description: suggestion.description,
      };
    case "prompt":
      return {
        kind: "prompt",
        text: target.text,
        description: suggestion.description,
      };
  }
}

function verifiedActionPrompt(
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

function localAcceptResult(
  suggestion: AmbientSuggestion,
): SuggestionAcceptResult {
  const target = targetFromSuggestion(suggestion);
  if (!target) {
    return {
      ok: true,
      kind: "noop",
      suggestionId: suggestion.suggestion_id,
      message: "Suggestion accepted.",
    };
  }

  switch (target.kind) {
    case "app":
      return {
        ok: true,
        kind: "installed_app",
        suggestionId: suggestion.suggestion_id,
        appId: target.appId,
        appSlug: target.appSlug || suggestion.app_slug || suggestion.slug,
        libraryInstalled: false,
      };
    case "function":
      return {
        ok: true,
        kind: "start_orchestrate",
        suggestionId: suggestion.suggestion_id,
        message: verifiedActionPrompt(target),
        autoConfirmFirstPlan: false,
      };
    case "prompt":
      return {
        ok: true,
        kind: "prefill_prompt",
        suggestionId: suggestion.suggestion_id,
        text: target.text,
      };
    case "system_agent":
      return {
        ok: true,
        kind: "noop",
        suggestionId: suggestion.suggestion_id,
        message:
          "This suggestion needs a saved server-side target before it can run.",
      };
  }
}

export function useCommandSuggestions() {
  const ambient = useAmbientSuggestions();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [previewByKey, setPreviewByKey] = useState<
    Record<string, SuggestionPreviewDescriptor | null>
  >({});
  const [previewLoadingByKey, setPreviewLoadingByKey] = useState<
    Record<string, boolean>
  >({});
  const [previewErrorByKey, setPreviewErrorByKey] = useState<
    Record<string, string | null>
  >({});
  const [acceptStateByKey, setAcceptStateByKey] = useState<
    Record<string, CommandSuggestionAcceptState>
  >({});

  const selectedSuggestion = useMemo(() => {
    if (!selectedKey) return null;
    return ambient.suggestions.find((suggestion) =>
      commandSuggestionKey(suggestion) === selectedKey
    ) || null;
  }, [ambient.suggestions, selectedKey]);

  const selectSuggestion = useCallback(
    async (suggestion: AmbientSuggestion) => {
      const key = commandSuggestionKey(suggestion);
      setSelectedKey(key);
      ambient.markViewed("command_surface");
      if (key in previewByKey || previewLoadingByKey[key]) return;

      setPreviewLoadingByKey((current) => ({ ...current, [key]: true }));
      setPreviewErrorByKey((current) => ({ ...current, [key]: null }));
      try {
        const preview = suggestion.suggestion_id
          ? await fetchSuggestionPreview(suggestion.suggestion_id)
          : fallbackPreview(suggestion);
        setPreviewByKey((current) => ({ ...current, [key]: preview }));
      } catch (err) {
        setPreviewErrorByKey((current) => ({
          ...current,
          [key]: err instanceof Error
            ? err.message
            : "Failed to load suggestion preview",
        }));
        setPreviewByKey((current) => ({
          ...current,
          [key]: fallbackPreview(suggestion),
        }));
      } finally {
        setPreviewLoadingByKey((current) => ({ ...current, [key]: false }));
      }
    },
    [ambient, previewByKey, previewLoadingByKey],
  );

  const acceptSuggestion = useCallback(async (
    suggestion: AmbientSuggestion,
    surface = "command_surface",
  ): Promise<SuggestionAcceptResult> => {
    const key = commandSuggestionKey(suggestion);
    setAcceptStateByKey((current) => ({ ...current, [key]: "accepting" }));
    try {
      const result = suggestion.suggestion_id
        ? await acceptSuggestionById(suggestion.suggestion_id, {
          conversationId: suggestion.conversation_id,
          messageId: suggestion.message_id,
          traceId: suggestion.trace_id,
          eventSource: surface,
          metadata: { surface },
        })
        : localAcceptResult(suggestion);

      if (result.ok) {
        ambient.acceptSuggestion(suggestion, surface, {
          record: !suggestion.suggestion_id,
        });
        setAcceptStateByKey((current) => ({ ...current, [key]: "accepted" }));
        if (selectedKey === key) setSelectedKey(null);
      } else {
        setAcceptStateByKey((current) => ({ ...current, [key]: "error" }));
      }
      return result;
    } catch (err) {
      setAcceptStateByKey((current) => ({ ...current, [key]: "error" }));
      return {
        ok: false,
        kind: "error",
        suggestionId: suggestion.suggestion_id,
        error: err instanceof Error ? err.message : "Suggestion accept failed",
      };
    }
  }, [ambient, selectedKey]);

  const dismissSuggestion = useCallback((
    suggestion: AmbientSuggestion,
    surface = "command_surface",
  ) => {
    const key = commandSuggestionKey(suggestion);
    ambient.dismissSuggestion(suggestion, surface);
    if (selectedKey === key) setSelectedKey(null);
  }, [ambient, selectedKey]);

  const selectedPreview = selectedKey
    ? previewByKey[selectedKey] ?? null
    : null;
  const selectedPreviewLoading = selectedKey
    ? previewLoadingByKey[selectedKey] ?? false
    : false;
  const selectedPreviewError = selectedKey
    ? previewErrorByKey[selectedKey] ?? null
    : null;

  return {
    suggestions: ambient.suggestions,
    hasNew: ambient.hasNew,
    isPulsing: ambient.isPulsing,
    markViewed: ambient.markViewed,
    selectedKey,
    selectedSuggestion,
    selectedPreview,
    selectedPreviewLoading,
    selectedPreviewError,
    acceptStateByKey,
    selectSuggestion,
    acceptSuggestion,
    dismissSuggestion,
  };
}
