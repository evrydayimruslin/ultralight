import { useCallback, useEffect, useRef, useState } from 'react';
import type { AmbientSuggestion } from '../types/ambientSuggestion';

const AMBIENT_EVENT_NAME = 'ul-ambient-suggestions';

export function useAmbientSuggestions() {
  const [suggestions, setSuggestions] = useState<AmbientSuggestion[]>([]);
  const [hasNew, setHasNew] = useState(false);
  const [isPulsing, setIsPulsing] = useState(false);
  const pulseTimeoutRef = useRef<number | null>(null);

  const clearPulseTimer = useCallback(() => {
    if (pulseTimeoutRef.current !== null) {
      window.clearTimeout(pulseTimeoutRef.current);
      pulseTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    const handleSuggestions = (event: Event) => {
      const detail = (event as CustomEvent<{ suggestions?: AmbientSuggestion[] }>).detail;
      const nextSuggestions = detail?.suggestions || [];
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

  const markViewed = useCallback(() => {
    setHasNew(false);
    setIsPulsing(false);
    clearPulseTimer();
  }, [clearPulseTimer]);

  return {
    suggestions,
    hasNew,
    isPulsing,
    markViewed,
  };
}

export function dispatchAmbientSuggestions(suggestions: AmbientSuggestion[]): void {
  if (!suggestions.length) return;
  window.dispatchEvent(new CustomEvent(AMBIENT_EVENT_NAME, {
    detail: { suggestions },
  }));
}
