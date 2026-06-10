import { useEffect, useMemo, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import type { AmbientSuggestion } from "../../types/ambientSuggestion";
import {
  type CommandSuggestionAcceptState,
  commandSuggestionKey,
} from "../../hooks/useCommandSuggestions";
import type { SuggestionPreviewDescriptor } from "../../../../shared/contracts/suggestions.ts";
import {
  type SuggestionSource,
  suggestionSourceGroupLabel,
} from "../../../../shared/contracts/suggestions.ts";
import SuggestionPreviewPanel from "./SuggestionPreviewPanel";

interface CommandSuggestionsSurfaceProps {
  suggestions: AmbientSuggestion[];
  hasNew: boolean;
  selectedSuggestion: AmbientSuggestion | null;
  selectedPreview: SuggestionPreviewDescriptor | null;
  previewLoading: boolean;
  previewError: string | null;
  acceptStateByKey: Record<string, CommandSuggestionAcceptState>;
  onView: () => void;
  onSelect: (suggestion: AmbientSuggestion) => void | Promise<void>;
  onAccept: (suggestion: AmbientSuggestion) => void | Promise<void>;
}

const SOURCE_ORDER: SuggestionSource[] = [
  "platform_primitive",
  "library",
  "marketplace",
];

function rowLabel(suggestion: AmbientSuggestion): string {
  return suggestion.display?.label || suggestion.label || suggestion.name;
}

function rowDescription(suggestion: AmbientSuggestion): string {
  return suggestion.display?.description || suggestion.description || "";
}

function rowMeta(suggestion: AmbientSuggestion): string {
  if (suggestion.display?.meta) return suggestion.display.meta;
  if (suggestion.source === "platform_primitive") return "one-click";
  if (suggestion.source === "marketplace") return "install";
  if (suggestion.target?.kind === "function") {
    return suggestion.target.appSlug || suggestion.app_slug ||
      suggestion.app_name || "installed";
  }
  return suggestion.app_name || suggestion.app_slug || suggestion.meta ||
    "installed";
}

function groupedSuggestions(suggestions: AmbientSuggestion[]) {
  return SOURCE_ORDER.map((source) => ({
    source,
    label: suggestionSourceGroupLabel(source),
    suggestions: suggestions.filter((suggestion) =>
      suggestion.source === source
    ),
  })).filter((group) => group.suggestions.length > 0);
}

export default function CommandSuggestionsSurface({
  suggestions,
  hasNew,
  selectedSuggestion,
  selectedPreview,
  previewLoading,
  previewError,
  acceptStateByKey,
  onView,
  onSelect,
  onAccept,
}: CommandSuggestionsSurfaceProps) {
  const [open, setOpen] = useState(false);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const groups = useMemo(() => groupedSuggestions(suggestions), [suggestions]);
  const selectedKey = selectedSuggestion
    ? commandSuggestionKey(selectedSuggestion)
    : null;

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      const target = event.target as Node;
      if (popupRef.current?.contains(target)) return;
      if (buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (selectedSuggestion) return;
    const first = suggestions[0];
    if (first) void onSelect(first);
  }, [open, onSelect, selectedSuggestion, suggestions]);

  return (
    <div className="fixed bottom-5 right-5 z-40 sm:bottom-6 sm:right-6">
      {open && (
        <div
          ref={popupRef}
          role="dialog"
          aria-label="Command suggestions"
          className="absolute bottom-16 right-0 flex h-[520px] max-h-[calc(100vh-128px)] w-[760px] max-w-[calc(100vw-32px)] overflow-hidden rounded-xl border border-ul-border bg-ul-bg shadow-2xl ring-1 ring-black/[0.03] animate-fade-up max-[720px]:h-[min(78vh,620px)] max-[720px]:flex-col"
        >
          <div className="flex w-[310px] min-w-0 flex-col border-r border-ul-border max-[720px]:h-[220px] max-[720px]:w-full max-[720px]:border-b max-[720px]:border-r-0">
            <div className="border-b border-ul-border px-4 py-3">
              <div className="text-caption font-semibold text-ul-text">
                Suggestions
              </div>
              <div className="mt-0.5 text-micro text-ul-text-muted">
                Context-aware actions from this Command turn.
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-auto py-2">
              {groups.length === 0
                ? (
                  <div className="px-4 py-8 text-caption text-ul-text-muted">
                    Suggestions will appear here when Command finds useful
                    platform, library, or marketplace paths.
                  </div>
                )
                : groups.map((group) => (
                  <div key={group.source} className="pb-2">
                    <div className="px-4 pb-1 pt-2 text-nano font-mono uppercase tracking-widest text-ul-text-muted">
                      {group.label}
                    </div>
                    <div className="grid gap-0.5">
                      {group.suggestions.map((suggestion) => {
                        const key = commandSuggestionKey(suggestion);
                        const active = key === selectedKey;
                        const acceptState = acceptStateByKey[key] || "idle";
                        return (
                          <button
                            key={key}
                            type="button"
                            onClick={() => void onSelect(suggestion)}
                            className={`grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-4 py-2 text-left transition-colors ${
                              active
                                ? "bg-ul-accent-soft"
                                : "hover:bg-ul-bg-hover"
                            }`}
                          >
                            <span className="min-w-0">
                              <span className="block truncate text-caption font-medium text-ul-text">
                                {rowLabel(suggestion)}
                              </span>
                              {rowDescription(suggestion) && (
                                <span className="mt-0.5 block truncate text-nano text-ul-text-muted">
                                  {rowDescription(suggestion)}
                                </span>
                              )}
                            </span>
                            <span className="self-start whitespace-nowrap pt-0.5 text-nano font-mono text-ul-text-muted">
                              {acceptState === "accepted"
                                ? "done"
                                : acceptState === "accepting"
                                ? "..."
                                : rowMeta(suggestion)}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
            </div>
          </div>
          <div className="min-h-0 min-w-0 flex-1">
            <SuggestionPreviewPanel
              suggestion={selectedSuggestion}
              preview={selectedPreview}
              loading={previewLoading}
              error={previewError}
              acceptState={selectedKey
                ? acceptStateByKey[selectedKey] || "idle"
                : "idle"}
              onAccept={onAccept}
            />
          </div>
        </div>
      )}

      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          setOpen((current) => !current);
          onView();
        }}
        className={`relative flex h-12 w-12 items-center justify-center rounded-full border border-ul-border bg-white text-ul-text shadow-lg transition-all hover:-translate-y-0.5 hover:border-ul-border-strong hover:shadow-xl ${
          open ? "ring-2 ring-ul-text/10" : ""
        }`}
        title="Suggestions"
        aria-label="Suggestions"
      >
        {hasNew && !open && (
          <span className="absolute inset-0 rounded-full border border-ul-text/35 animate-ping" />
        )}
        <Sparkles className="h-5 w-5" strokeWidth={1.6} />
      </button>
    </div>
  );
}
