import { Loader2 } from "lucide-react";
import type { AmbientSuggestion } from "../../types/ambientSuggestion";
import type { CommandSuggestionAcceptState } from "../../hooks/useCommandSuggestions";
import type { SuggestionPreviewDescriptor } from "../../../../shared/contracts/suggestions.ts";

interface SuggestionPreviewPanelProps {
  suggestion: AmbientSuggestion | null;
  preview: SuggestionPreviewDescriptor | null;
  loading: boolean;
  error: string | null;
  acceptState?: CommandSuggestionAcceptState;
  onAccept: (suggestion: AmbientSuggestion) => void | Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return String(value);
  }
}

function actionLabel(
  preview: SuggestionPreviewDescriptor | null,
  acceptState?: CommandSuggestionAcceptState,
): string {
  if (acceptState === "accepting") return "Working";
  if (acceptState === "accepted") return "Accepted";
  if (!preview) return "Accept";
  switch (preview.kind) {
    case "app":
      return "Install";
    case "function":
      return "Preview run";
    case "system_agent":
      return "Run";
    case "prompt":
      return "Prefill";
  }
}

function PreviewHeader({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description?: string;
}) {
  return (
    <div>
      <div className="text-nano font-mono uppercase tracking-widest text-ul-text-muted">
        {eyebrow}
      </div>
      <div className="mt-1 text-small font-semibold text-ul-text leading-tight">
        {title}
      </div>
      {description && (
        <div className="mt-1 text-caption text-ul-text-secondary leading-relaxed">
          {description}
        </div>
      )}
    </div>
  );
}

function AppPreview({ preview }: {
  preview: Extract<SuggestionPreviewDescriptor, { kind: "app" }>;
}) {
  const trust = isRecord(preview.trust_card) ? preview.trust_card : {};
  const marketplace = isRecord(preview.marketplace) ? preview.marketplace : {};
  const permissions = stringList(trust.permissions || marketplace.permissions);
  const installed = marketplace.installed === true;
  const visibility = typeof marketplace.visibility === "string"
    ? marketplace.visibility
    : null;

  return (
    <div className="space-y-4">
      <PreviewHeader
        eyebrow={preview.source}
        title={preview.name}
        description={preview.description}
      />
      <div>
        <div className="text-nano font-mono uppercase tracking-widest text-ul-text-muted mb-1.5">
          Functions
        </div>
        {preview.functions && preview.functions.length > 0
          ? (
            <div className="grid gap-1.5">
              {preview.functions.slice(0, 5).map((fn) => (
                <div
                  key={fn.name}
                  className="rounded-md border border-ul-border bg-ul-bg-subtle px-2.5 py-2"
                >
                  <div className="flex items-center justify-between gap-3">
                    <code className="text-caption text-ul-text">
                      {fn.name}()
                    </code>
                    {typeof fn.cost_light === "number" && (
                      <span className="text-nano font-mono text-ul-text-muted">
                        {fn.cost_light} Light
                      </span>
                    )}
                  </div>
                  {fn.description && (
                    <div className="mt-0.5 text-nano text-ul-text-muted truncate">
                      {fn.description}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )
          : (
            <div className="text-caption text-ul-text-muted">
              Function details will appear after install or discovery.
            </div>
          )}
      </div>
      <div className="grid grid-cols-1 gap-2 text-nano font-mono text-ul-text-muted sm:grid-cols-2">
        <div className="rounded-md bg-ul-bg-subtle border border-ul-border px-2.5 py-2">
          {installed ? "installed" : "not installed"}
        </div>
        <div className="rounded-md bg-ul-bg-subtle border border-ul-border px-2.5 py-2">
          {visibility || "visibility unknown"}
        </div>
        <div className="col-span-2 rounded-md bg-ul-bg-subtle border border-ul-border px-2.5 py-2">
          {permissions.length > 0
            ? `permissions: ${permissions.slice(0, 4).join(", ")}`
            : "permissions: none listed"}
        </div>
      </div>
    </div>
  );
}

function FunctionPreview({ preview }: {
  preview: Extract<SuggestionPreviewDescriptor, { kind: "function" }>;
}) {
  return (
    <div className="space-y-4">
      <PreviewHeader
        eyebrow={preview.appSlug || preview.appId}
        title={preview.label || preview.fnName}
        description={preview.description}
      />
      <div>
        <div className="text-nano font-mono uppercase tracking-widest text-ul-text-muted mb-1.5">
          Signature
        </div>
        <div className="rounded-md border border-ul-border bg-ul-bg-subtle px-2.5 py-2 text-caption text-ul-text overflow-hidden">
          <code className="break-words">
            {preview.signature || `${preview.fnName}(args)`}
          </code>
        </div>
      </div>
      <div>
        <div className="text-nano font-mono uppercase tracking-widest text-ul-text-muted mb-1.5">
          Inferred args
        </div>
        <pre className="max-h-40 overflow-auto rounded-md border border-ul-border bg-ul-bg-subtle px-2.5 py-2 text-nano text-ul-text-secondary">
          {formatJson(preview.args || {})}
        </pre>
      </div>
      {typeof preview.cost_light === "number" && (
        <div className="text-nano font-mono text-ul-text-muted">
          estimated cost: {preview.cost_light} Light
        </div>
      )}
    </div>
  );
}

function SystemAgentPreview({ preview }: {
  preview: Extract<SuggestionPreviewDescriptor, { kind: "system_agent" }>;
}) {
  return (
    <div className="space-y-4">
      <PreviewHeader
        eyebrow={preview.agentType}
        title={preview.name}
        description={preview.description}
      />
      <div>
        <div className="text-nano font-mono uppercase tracking-widest text-ul-text-muted mb-1.5">
          Task
        </div>
        <div className="rounded-md border border-ul-border bg-ul-bg-subtle px-2.5 py-2 text-caption text-ul-text-secondary leading-relaxed">
          {preview.task}
        </div>
      </div>
      <div className="grid gap-2 text-nano font-mono text-ul-text-muted">
        {preview.skillsPath && (
          <div className="rounded-md bg-ul-bg-subtle border border-ul-border px-2.5 py-2">
            skills: {preview.skillsPath}
          </div>
        )}
        {preview.touchScope && preview.touchScope.length > 0 && (
          <div className="rounded-md bg-ul-bg-subtle border border-ul-border px-2.5 py-2">
            can touch: {preview.touchScope.slice(0, 5).join(", ")}
          </div>
        )}
      </div>
    </div>
  );
}

function PromptPreview({ preview }: {
  preview: Extract<SuggestionPreviewDescriptor, { kind: "prompt" }>;
}) {
  return (
    <div className="space-y-4">
      <PreviewHeader
        eyebrow="prompt"
        title="Composer prompt"
        description={preview.description}
      />
      <div className="rounded-md border border-ul-border bg-ul-bg-subtle px-2.5 py-2 text-caption text-ul-text-secondary leading-relaxed whitespace-pre-wrap">
        {preview.text}
      </div>
    </div>
  );
}

export default function SuggestionPreviewPanel({
  suggestion,
  preview,
  loading,
  error,
  acceptState,
  onAccept,
}: SuggestionPreviewPanelProps) {
  if (!suggestion) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-caption text-ul-text-muted">
        Select a suggestion to preview what it can do.
      </div>
    );
  }

  const accepting = acceptState === "accepting";
  const accepted = acceptState === "accepted";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex-1 overflow-auto p-4">
        {loading
          ? (
            <div className="flex items-center gap-2 text-caption text-ul-text-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.6} />
              Loading preview
            </div>
          )
          : error && !preview
          ? (
            <div className="rounded-md border border-ul-error/30 bg-ul-error/5 px-3 py-2 text-caption text-ul-error">
              {error}
            </div>
          )
          : preview?.kind === "app"
          ? <AppPreview preview={preview} />
          : preview?.kind === "function"
          ? <FunctionPreview preview={preview} />
          : preview?.kind === "system_agent"
          ? <SystemAgentPreview preview={preview} />
          : preview?.kind === "prompt"
          ? <PromptPreview preview={preview} />
          : (
            <PreviewHeader
              eyebrow="suggestion"
              title={suggestion.name}
              description={suggestion.description}
            />
          )}
      </div>
      <div className="border-t border-ul-border p-3">
        {error && preview && (
          <div className="mb-2 text-nano text-ul-error">{error}</div>
        )}
        <button
          type="button"
          onClick={() => void onAccept(suggestion)}
          disabled={accepting || accepted}
          className="h-9 w-full rounded-md border border-ul-text bg-ul-text px-3 text-caption font-mono text-white transition-colors hover:bg-ul-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {accepting && (
            <Loader2
              className="mr-2 inline h-3.5 w-3.5 animate-spin"
              strokeWidth={1.6}
            />
          )}
          {actionLabel(preview, acceptState)}
        </button>
      </div>
    </div>
  );
}
