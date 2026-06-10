import { useCallback, useEffect, useRef, useState } from "react";
import type { AmbientSuggestion } from "../types/ambientSuggestion";
import { recordCapabilitySuggestionEvent } from "../lib/api";
import type { SuggestionTarget } from "../../../shared/contracts/suggestions.ts";

const AMBIENT_EVENT_NAME = "ul-ambient-suggestions";

function suggestionTelemetryKey(suggestion: AmbientSuggestion): string {
  return suggestion.suggestion_id ||
    `${suggestion.suggestion_set_id || "set"}:${suggestion.id}`;
}

function suggestionTarget(
  suggestion: AmbientSuggestion,
): SuggestionTarget | undefined {
  if (suggestion.target) return suggestion.target;
  const target = suggestion.metadata?.target;
  if (target && typeof target === "object" && !Array.isArray(target)) {
    return target as SuggestionTarget;
  }
  return undefined;
}

function suggestionTelemetryApp(suggestion: AmbientSuggestion): {
  appId?: string;
  appSlug?: string;
  installOnAccept?: boolean;
} {
  const target = suggestionTarget(suggestion);
  if (target?.kind === "app") {
    return {
      appId: target.appId,
      appSlug: target.appSlug || suggestion.slug || suggestion.app_slug ||
        undefined,
    };
  }
  if (target?.kind === "function") {
    return {
      appId: target.appId,
      appSlug: target.appSlug || suggestion.slug || suggestion.app_slug ||
        undefined,
      installOnAccept: false,
    };
  }
  if (target) {
    return { installOnAccept: false };
  }
  if (suggestion.type === "app" || suggestion.type === "skill") {
    return {
      appId: suggestion.app_id || suggestion.id,
      appSlug: suggestion.app_slug || suggestion.slug,
    };
  }
  return {};
}

function recordSuggestionLifecycleEvent(
  suggestion: AmbientSuggestion,
  eventType: "viewed" | "accepted" | "dismissed",
  metadata?: Record<string, unknown>,
): void {
  const target = suggestionTarget(suggestion);
  const app = suggestionTelemetryApp(suggestion);
  void recordCapabilitySuggestionEvent({
    eventType,
    intentId: suggestion.intent_id,
    suggestionSetId: suggestion.suggestion_set_id,
    suggestionId: suggestion.suggestion_id,
    conversationId: suggestion.conversation_id,
    traceId: suggestion.trace_id,
    messageId: suggestion.message_id,
    appId: app.appId,
    appSlug: app.appSlug,
    installOnAccept: eventType === "accepted" ? app.installOnAccept : undefined,
    eventSource: metadata?.surface && typeof metadata.surface === "string"
      ? metadata.surface
      : "composer",
    metadata: {
      rank: suggestion.rank ?? null,
      similarity: suggestion.similarity ?? null,
      surface: "ambient_tool_suggestion",
      ...(target ? { target } : {}),
      ...metadata,
    },
  }).catch(() => {});
}

export function useAmbientSuggestions() {
  const [suggestions, setSuggestions] = useState<AmbientSuggestion[]>([]);
  const [hasNew, setHasNew] = useState(false);
  const [isPulsing, setIsPulsing] = useState(false);
  const pulseTimeoutRef = useRef<number | null>(null);
  const dismissedRef = useRef<Set<string>>(new Set());
  const acceptedRef = useRef<Set<string>>(new Set());
  const viewedRef = useRef<Set<string>>(new Set());

  const clearPulseTimer = useCallback(() => {
    if (pulseTimeoutRef.current !== null) {
      window.clearTimeout(pulseTimeoutRef.current);
      pulseTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    const handleSuggestions = (event: Event) => {
      const detail =
        (event as CustomEvent<{ suggestions?: AmbientSuggestion[] }>).detail;
      const nextSuggestions = (detail?.suggestions || []).filter(
        (suggestion) => {
          const key = suggestionTelemetryKey(suggestion);
          return !dismissedRef.current.has(key) &&
            !acceptedRef.current.has(key);
        },
      );
      if (!nextSuggestions.length) return;

      setSuggestions(nextSuggestions);
      setHasNew(true);
      setIsPulsing(true);
      clearPulseTimer();
      pulseTimeoutRef.current = window.setTimeout(() => {
        setIsPulsing(false);
        pulseTimeoutRef.current = null;
      }, 3000);
    };

    window.addEventListener(
      AMBIENT_EVENT_NAME,
      handleSuggestions as EventListener,
    );
    return () => {
      window.removeEventListener(
        AMBIENT_EVENT_NAME,
        handleSuggestions as EventListener,
      );
      clearPulseTimer();
    };
  }, [clearPulseTimer]);

  const markViewed = useCallback((surface = "composer") => {
    for (const suggestion of suggestions) {
      const key = suggestionTelemetryKey(suggestion);
      if (viewedRef.current.has(key)) continue;
      viewedRef.current.add(key);
      recordSuggestionLifecycleEvent(suggestion, "viewed", { surface });
    }
    setHasNew(false);
    setIsPulsing(false);
    clearPulseTimer();
  }, [clearPulseTimer, suggestions]);

  const dismissSuggestion = useCallback(
    (suggestion: AmbientSuggestion, surface = "composer") => {
      const key = suggestionTelemetryKey(suggestion);
      dismissedRef.current.add(key);
      recordSuggestionLifecycleEvent(suggestion, "dismissed", { surface });
      setSuggestions((prev) =>
        prev.filter((entry) => suggestionTelemetryKey(entry) !== key)
      );
      setHasNew(false);
      setIsPulsing(false);
      clearPulseTimer();
    },
    [clearPulseTimer],
  );

  const acceptSuggestion = useCallback(
    (
      suggestion: AmbientSuggestion,
      surface = "composer",
      options?: { record?: boolean },
    ) => {
      const key = suggestionTelemetryKey(suggestion);
      acceptedRef.current.add(key);
      if (options?.record !== false) {
        recordSuggestionLifecycleEvent(suggestion, "accepted", { surface });
      }
      setSuggestions((prev) =>
        prev.filter((entry) => suggestionTelemetryKey(entry) !== key)
      );
      setHasNew(false);
      setIsPulsing(false);
      clearPulseTimer();
    },
    [clearPulseTimer],
  );

  return {
    suggestions,
    hasNew,
    isPulsing,
    markViewed,
    dismissSuggestion,
    acceptSuggestion,
  };
}

export function dispatchAmbientSuggestions(
  suggestions: AmbientSuggestion[],
): void {
  if (!suggestions.length) return;
  window.dispatchEvent(
    new CustomEvent(AMBIENT_EVENT_NAME, {
      detail: { suggestions },
    }),
  );
}
