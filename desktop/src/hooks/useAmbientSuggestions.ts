import { useCallback, useEffect, useRef, useState } from 'react';
import type { AmbientSuggestion } from '../types/ambientSuggestion';
import { recordCapabilitySuggestionEvent } from '../lib/api';

const AMBIENT_EVENT_NAME = 'ul-ambient-suggestions';

function suggestionTelemetryKey(suggestion: AmbientSuggestion): string {
  return suggestion.suggestion_id || `${suggestion.suggestion_set_id || 'set'}:${suggestion.id}`;
}

function recordSuggestionLifecycleEvent(
  suggestion: AmbientSuggestion,
  eventType: 'viewed' | 'accepted' | 'dismissed',
  metadata?: Record<string, unknown>,
): void {
  void recordCapabilitySuggestionEvent({
    eventType,
    intentId: suggestion.intent_id,
    suggestionSetId: suggestion.suggestion_set_id,
    suggestionId: suggestion.suggestion_id,
    conversationId: suggestion.conversation_id,
    traceId: suggestion.trace_id,
    messageId: suggestion.message_id,
    appId: suggestion.id,
    appSlug: suggestion.slug,
    eventSource: metadata?.surface && typeof metadata.surface === 'string'
      ? metadata.surface
      : 'composer',
    metadata: {
      rank: suggestion.rank ?? null,
      similarity: suggestion.similarity ?? null,
      surface: 'ambient_tool_suggestion',
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
      const detail = (event as CustomEvent<{ suggestions?: AmbientSuggestion[] }>).detail;
      const nextSuggestions = (detail?.suggestions || []).filter((suggestion) => {
        const key = suggestionTelemetryKey(suggestion);
        return !dismissedRef.current.has(key) && !acceptedRef.current.has(key);
      });
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

    window.addEventListener(AMBIENT_EVENT_NAME, handleSuggestions as EventListener);
    return () => {
      window.removeEventListener(AMBIENT_EVENT_NAME, handleSuggestions as EventListener);
      clearPulseTimer();
    };
  }, [clearPulseTimer]);

  const markViewed = useCallback((surface = 'composer') => {
    for (const suggestion of suggestions) {
      const key = suggestionTelemetryKey(suggestion);
      if (viewedRef.current.has(key)) continue;
      viewedRef.current.add(key);
      recordSuggestionLifecycleEvent(suggestion, 'viewed', { surface });
    }
    setHasNew(false);
    setIsPulsing(false);
    clearPulseTimer();
  }, [clearPulseTimer, suggestions]);

  const dismissSuggestion = useCallback((suggestion: AmbientSuggestion, surface = 'composer') => {
    const key = suggestionTelemetryKey(suggestion);
    dismissedRef.current.add(key);
    recordSuggestionLifecycleEvent(suggestion, 'dismissed', { surface });
    setSuggestions((prev) => prev.filter((entry) => suggestionTelemetryKey(entry) !== key));
    setHasNew(false);
    setIsPulsing(false);
    clearPulseTimer();
  }, [clearPulseTimer]);

  const acceptSuggestion = useCallback((suggestion: AmbientSuggestion, surface = 'composer') => {
    const key = suggestionTelemetryKey(suggestion);
    acceptedRef.current.add(key);
    recordSuggestionLifecycleEvent(suggestion, 'accepted', { surface });
    setSuggestions((prev) => prev.filter((entry) => suggestionTelemetryKey(entry) !== key));
    setHasNew(false);
    setIsPulsing(false);
    clearPulseTimer();
  }, [clearPulseTimer]);

  return {
    suggestions,
    hasNew,
    isPulsing,
    markViewed,
    dismissSuggestion,
    acceptSuggestion,
  };
}

export function dispatchAmbientSuggestions(suggestions: AmbientSuggestion[]): void {
  if (!suggestions.length) return;
  window.dispatchEvent(new CustomEvent(AMBIENT_EVENT_NAME, {
    detail: { suggestions },
  }));
}
