// CommandHomescreen — native cozy dashboard. Replaces the legacy tabbed
// HomeView (Project / Agents / Activity) per the Batch 7 addendum's
// A8 + A9 decisions. Ports `CozyHomescreen` from
// handoff/mockups/command-screens.jsx.
//
// Data flow:
//   1. fetchCommandDashboardLayout('command_home') -> StoredCommandDashboardLayout
//   2. fetchCommandWidgets() -> FunctionIndex.widgets[] (card metadata lookup)
//   3. For each card instance, look up its card defn via app_id + widget_id +
//      card_id to determine kind + dataView + sizing.
//   4. Render the tile in a grid based on size ("WxH").
//
// Behaviour:
//   - Chrome + 4-col grid + click-to-expand into the parent widget window.
//   - Per-tile data fetched via the widget's dataFunction. metric / list
//     templates render the response; generic fallback shows kind + label
//     when the shape doesn't match a known template.
//   - Edit mode: tiles wiggle, header recolors, × remove button per tile,
//     "Done" exits. Remove persists via saveCommandDashboardLayout.
//   - + Widget opens WidgetPickerModal listing every available card from
//     the function index; pick appends to the layout and persists.
//   - Drag-to-reorder: in edit mode, tiles are HTML5-draggable. Dropping
//     a tile on top of another moves it before that target and shifts the
//     rest. Card sizes are fixed (per addendum: no resize); reorder is
//     the only positional affordance.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArrowLeft, History, Loader2, X } from "lucide-react";
import {
  type AgenticInterfaceActionExecutionContext,
  type AgenticInterfacePlannerResult,
  type AgenticInterfaceSummary,
  buildInferenceSetupPrompt,
  cancelGenerationTurn,
  type CommandDashboardLayout,
  confirmExecutionPlan,
  deleteAgenticInterface,
  executeAgenticInterfaceAction,
  fetchAgenticInterface,
  fetchAgenticInterfaces,
  fetchCommandDashboardLayout,
  fetchCommandWidgets,
  fetchInferenceSettings,
  fetchRoutineMonitor,
  type FunctionIndex,
  type InferenceSetupPrompt,
  type RoutineMonitorItem,
  type RoutineMonitorResponse,
  runRoutineNow,
  saveAgenticInterface,
  saveCommandDashboardLayout,
  savedAgenticInterfaceToPlannerResult,
  streamOrchestrate,
  updateRoutineMonitorStatus,
} from "../lib/api";
import {
  getHeavyModel,
  getInferencePreference,
  getInterpreterModel,
} from "../lib/storage";
import { openWidgetWindow } from "../lib/multiWindow";
import { fetchWidgetDataPayload } from "../lib/widgetRuntime";
import {
  getActiveWidgetSurfaces,
  invokeWidgetSurfaceAction,
  subscribeAgenticSurfaces,
} from "../lib/widgetSurfaceRegistry";
import {
  type ActiveAgenticSurface,
  buildActiveAgenticSurfaceContext,
} from "../lib/widgetAgentTypes";
import { dispatchAmbientSuggestions } from "../hooks/useAmbientSuggestions";
import { useCommandSuggestions } from "../hooks/useCommandSuggestions";
import { type Conversation, useConversations } from "../hooks/useConversations";
import type { Message } from "../hooks/useChat";
import type { AmbientSuggestion } from "../types/ambientSuggestion";
import type { ExecutionPlan } from "../types/executionPlan";
import { createDesktopLogger } from "../lib/logging";
import Glyph, { deriveGlyph, deriveTone } from "./ui/Glyph";
import WidgetPickerModal, {
  buildKey,
  type PickedCard,
} from "./dashboard/WidgetPickerModal";
import RoutineMonitorPanel from "./RoutineMonitorPanel";
import CommandComposer from "./command/CommandComposer";
import CommandSuggestionsSurface from "./command/CommandSuggestionsSurface";
import MessageBubble from "./MessageBubble";
import GeneratedInterface from "./agentic/GeneratedInterface";
import AgenticInterfaceLibrary from "./agentic/AgenticInterfaceLibrary";
import type { AgenticOpenWidgetRequest } from "./agentic/AgenticInterfaceHost";
import type { AgenticInterfaceAction } from "../../../shared/contracts/agentic-interface.ts";
import type {
  ChatTurnArtifact,
  NextStep,
} from "../../../shared/contracts/command-turn.ts";
import type { SuggestionAcceptResult } from "../../../shared/contracts/suggestions.ts";

// ── Types (FE-internal) ───────────────────────────────────────────────

type CardInstance = CommandDashboardLayout["cards"][number];
type WidgetDefn = NonNullable<FunctionIndex["widgets"][number]>;
type CardDefn = NonNullable<WidgetDefn["cards"]>[number];

const COMMAND_CONVERSATION_MODEL = "Command";
const commandLogger = createDesktopLogger("CommandHomescreen");

interface ResolvedTile {
  instance: CardInstance;
  widget: WidgetDefn;
  card: CardDefn;
}

interface CommandSession {
  conversationId: string;
  mode: "live" | "replay";
}

type CommandTurnOptions = {
  autoConfirmFirstPlan?: boolean;
  systemAgentContext?: { type: string; persona: string; skillsPath: string };
  acceptedSuggestionId?: string;
};

function buildCommandConversationTitle(prompt: string): string {
  const text = prompt.trim().replace(/\s+/g, " ");
  if (!text) return "Command session";
  if (text.length <= 56) return text;
  const truncated = text.slice(0, 56);
  const lastSpace = truncated.lastIndexOf(" ");
  return `${lastSpace > 24 ? truncated.slice(0, lastSpace) : truncated}...`;
}

function formatSessionDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function buildNextStepActionPrompt(
  step: Extract<NextStep, { kind: "action" }>,
): string {
  const action = step.action;
  const args = "args_template" in action ? action.args_template || {} : {};
  return [
    `Run this next step from the previous assistant turn: ${step.label}`,
    "",
    "Use the existing app/tool context and execute this verified action:",
    "```json",
    JSON.stringify(
      {
        kind: action.kind,
        label: action.label,
        mode: action.mode,
        confirmation: action.confirmation,
        app_id: "app_id" in action ? action.app_id : undefined,
        app_slug: "app_slug" in action ? action.app_slug : undefined,
        function_name: "function_name" in action
          ? action.function_name
          : undefined,
        widget_id: "widget_id" in action ? action.widget_id : undefined,
        action_id: "action_id" in action ? action.action_id : undefined,
        args,
      },
      null,
      2,
    ),
    "```",
  ].join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function actionArgs(
  action: AgenticInterfaceAction,
  args?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...(isRecord(action.args_template) ? action.args_template : {}),
    ...(args || {}),
  };
}

function generatedActionError(
  action: AgenticInterfaceAction,
  fallback: string,
): Error {
  return new Error(`${action.label}: ${fallback}`);
}

// ── Sizing ────────────────────────────────────────────────────────────

/** Parse "1x1", "2x1", "2x2", "4x2"... into [colSpan, rowSpan]. Defaults to 1×1. */
function parseSize(size: string): { colSpan: number; rowSpan: number } {
  const m = /^(\d+)x(\d+)$/i.exec(size.trim());
  if (!m) return { colSpan: 1, rowSpan: 1 };
  const col = Math.min(Math.max(parseInt(m[1], 10) || 1, 1), 4);
  const row = Math.min(Math.max(parseInt(m[2], 10) || 1, 1), 4);
  return { colSpan: col, rowSpan: row };
}

// ── Tile data shapes ──────────────────────────────────────────────────
// Tolerant parsers — the data function may wrap the payload in a `body`
// envelope (per email-ops convention) or return the body directly.

interface MetricBody {
  metric: number | string;
  label?: string;
  suffix?: string;
}
interface ListItem {
  primary?: string;
  secondary?: string;
  trailing?: string;
}
interface ListBody {
  items: ListItem[];
}

function unwrapBody(raw: unknown): unknown {
  if (raw && typeof raw === "object" && "body" in raw) {
    return (raw as { body: unknown }).body;
  }
  return raw;
}

function parseMetricBody(raw: unknown): MetricBody | null {
  const body = unwrapBody(raw);
  if (!body || typeof body !== "object") return null;
  const obj = body as Record<string, unknown>;
  // accept `metric` (per email-ops shape) or `value` (common alternative)
  const metric = obj.metric ?? obj.value;
  if (metric === undefined || metric === null) return null;
  if (typeof metric !== "number" && typeof metric !== "string") return null;
  return {
    metric,
    label: typeof obj.label === "string" ? obj.label : undefined,
    suffix: typeof obj.suffix === "string" ? obj.suffix : undefined,
  };
}

function parseListBody(raw: unknown): ListBody | null {
  const body = unwrapBody(raw);
  if (!body || typeof body !== "object") return null;
  const items = (body as Record<string, unknown>).items;
  if (!Array.isArray(items)) return null;
  return {
    items: items.map((item) => {
      if (!item || typeof item !== "object") return {};
      const o = item as Record<string, unknown>;
      return {
        primary: typeof o.primary === "string"
          ? o.primary
          : (typeof o.title === "string" ? o.title : undefined),
        secondary: typeof o.secondary === "string"
          ? o.secondary
          : (typeof o.subtitle === "string" ? o.subtitle : undefined),
        trailing: typeof o.trailing === "string"
          ? o.trailing
          : (typeof o.right === "string" ? o.right : undefined),
      };
    }),
  };
}

// ── Tile templates ────────────────────────────────────────────────────

function MetricTile(
  { card, data, loading }: { card: CardDefn; data: unknown; loading: boolean },
) {
  const parsed = parseMetricBody(data);
  return (
    <div className="flex flex-col h-full justify-between">
      <div className="text-display text-ul-text leading-none tabular-nums">
        {loading && !parsed
          ? <span className="text-ul-text-muted">—</span>
          : (parsed?.metric ?? "—")}
        {parsed?.suffix && (
          <span className="text-h3 text-ul-text-muted ml-1">
            {parsed.suffix}
          </span>
        )}
      </div>
      <div className="text-caption text-ul-text-secondary">
        {parsed?.label || card.description || card.label}
      </div>
    </div>
  );
}

function ListTile(
  { card, data, loading }: { card: CardDefn; data: unknown; loading: boolean },
) {
  const parsed = parseListBody(data);
  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 flex flex-col gap-1.5 overflow-hidden">
        {!parsed && loading
          // Skeleton rows while loading and shape unknown
          ? [0, 1, 2].map((i) => (
            <div
              key={i}
              className="flex items-center justify-between border-b border-ul-border last:border-b-0 pb-1.5"
            >
              <div className="h-2.5 w-2/3 bg-ul-bg-active rounded-xs" />
              <div className="h-2 w-8 bg-ul-bg-subtle rounded-xs" />
            </div>
          ))
          : parsed?.items.slice(0, 4).map((item, i) => (
            <div
              key={i}
              className="flex items-center justify-between gap-2 border-b border-ul-border last:border-b-0 pb-1.5 min-w-0"
            >
              <div className="flex-1 min-w-0">
                {item.primary && (
                  <div className="text-caption text-ul-text font-medium truncate">
                    {item.primary}
                  </div>
                )}
                {item.secondary && (
                  <div className="text-nano text-ul-text-muted truncate">
                    {item.secondary}
                  </div>
                )}
              </div>
              {item.trailing && (
                <div className="text-nano text-ul-text-muted font-mono flex-shrink-0">
                  {item.trailing}
                </div>
              )}
            </div>
          ))}
      </div>
      <div className="text-nano text-ul-text-muted font-mono mt-2">
        {card.description || card.label}
      </div>
    </div>
  );
}

function GenericTile({ card, data }: { card: CardDefn; data: unknown }) {
  // Render data if present (tolerant), else the card metadata.
  const body = unwrapBody(data);
  return (
    <div className="flex flex-col h-full justify-center items-center text-center gap-1">
      <div className="text-caption font-semibold text-ul-text">
        {card.label}
      </div>
      {card.kind && (
        <div className="text-nano font-mono text-ul-text-muted uppercase tracking-wider">
          {card.kind}
        </div>
      )}
      {!body && card.description && (
        <div className="text-nano text-ul-text-secondary line-clamp-2 px-2">
          {card.description}
        </div>
      )}
      {body && typeof body === "object"
        ? (
          <pre className="text-nano font-mono text-ul-text-muted overflow-hidden whitespace-pre-wrap max-h-16">
          {JSON.stringify(body, null, 0)}
          </pre>
        )
        : null}
    </div>
  );
}

function renderTileBody(card: CardDefn, data: unknown, loading: boolean) {
  switch (card.kind) {
    case "metric":
      return <MetricTile card={card} data={data} loading={loading} />;
    case "list":
      return <ListTile card={card} data={data} loading={loading} />;
    default:
      return <GenericTile card={card} data={data} />;
  }
}

// ── Tile shell ────────────────────────────────────────────────────────

function CozyTile({
  tile,
  colSpan,
  rowSpan,
  data,
  loading,
  edit,
  wiggleDelayMs,
  isDragging,
  isDropTarget,
  onOpen,
  onRemove,
  onDragStart,
  onDragOver,
  onDragEnter,
  onDragLeave,
  onDrop,
  onDragEnd,
}: {
  tile: ResolvedTile;
  colSpan: number;
  rowSpan: number;
  data: unknown;
  loading: boolean;
  edit: boolean;
  wiggleDelayMs: number;
  isDragging: boolean;
  isDropTarget: boolean;
  onOpen: () => void;
  onRemove: () => void;
  onDragStart: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragEnter: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave: (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
}) {
  const { widget, card } = tile;
  const appLabel = widget.appName || widget.appSlug || "tool";
  const tone = deriveTone(widget.appId);

  return (
    <div
      onClick={edit ? undefined : onOpen}
      draggable={edit}
      onDragStart={edit ? onDragStart : undefined}
      onDragOver={edit ? onDragOver : undefined}
      onDragEnter={edit ? onDragEnter : undefined}
      onDragLeave={edit ? onDragLeave : undefined}
      onDrop={edit ? onDrop : undefined}
      onDragEnd={edit ? onDragEnd : undefined}
      // TODO(token): rounded-[22px] — design tile radius doesn't match
      // any current ul-* radius token (xs/sm/md/pill/lg/card/xl).
      className={`bg-ul-bg border rounded-[22px] p-4 relative overflow-${
        edit ? "visible" : "hidden"
      } transition-all duration-base flex flex-col gap-2.5 text-left ${
        edit
          ? `cursor-grab shadow-md ${
            isDragging ? "opacity-40" : "animate-wiggle"
          } ${
            isDropTarget
              ? "border-ul-text ring-2 ring-ul-text/15"
              : "border-ul-border"
          }`
          : "cursor-pointer hover:-translate-y-px hover:shadow-md border-ul-border"
      }`}
      style={{
        gridColumn: `span ${colSpan}`,
        gridRow: `span ${rowSpan}`,
        animationDelay: edit && !isDragging ? `${wiggleDelayMs}ms` : undefined,
      }}
    >
      {edit && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          // TODO(token): bg-ul-text + shadow combo is the negative-action mockup style.
          className="absolute -top-2 -left-2 w-[22px] h-[22px] rounded-full bg-ul-text text-white text-caption flex items-center justify-center cursor-pointer shadow-md z-10 leading-none"
          title="Remove from dashboard"
        >
          ×
        </button>
      )}
      <div className="flex items-center gap-2.5">
        <Glyph glyph={deriveGlyph(appLabel)} tone={tone} size={22} />
        <div
          className="text-nano font-mono uppercase tracking-widest font-semibold truncate"
          style={{ color: tone }}
        >
          {appLabel}
        </div>
        {/* Burn rate / cost-per-min not on card defn today — DESIGN-FOLLOWUPS B6. */}
      </div>
      <div className="flex-1 min-h-0">
        {renderTileBody(card, data, loading)}
      </div>
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────

function EmptyState({ onAddWidget }: { onAddWidget: () => void }) {
  return (
    <div className="px-7 pt-6 pb-6 flex flex-col items-center justify-center min-h-[60vh]">
      <div className="text-h2 text-ul-text tracking-tight mb-2">
        No widgets yet
      </div>
      <div className="text-body text-ul-text-secondary max-w-md text-center mb-6">
        Your homescreen is a grid of widgets pulled from your installed tools.
        Add one to start.
      </div>
      <button
        type="button"
        onClick={onAddWidget}
        // TODO(token): rounded-md, bg-ul-text + text-white pair is consistent
        // with composer send button "armed" state.
        className="bg-ul-text text-white px-4 py-2.5 rounded-md font-mono text-caption cursor-pointer hover:bg-ul-accent-hover transition-colors"
      >
        ＋ Add a widget
      </button>
    </div>
  );
}

function CommandSessionPanel({
  session,
  messages,
  working,
  draftOverride,
  inferenceNotice,
  onHome,
  onContinue,
  onSend,
  onCancel,
  onNextStepClick,
  onClearInferenceNotice,
}: {
  session: CommandSession;
  messages: Message[];
  working: boolean;
  draftOverride: { id: string; text: string } | null;
  inferenceNotice: InferenceSetupPrompt | null;
  onHome: () => void;
  onContinue: () => void;
  onSend: (prompt: string) => void | Promise<void>;
  onCancel: () => void;
  onNextStepClick: (step: NextStep, message: Message) => void;
  onClearInferenceNotice: () => void;
}) {
  const turnCount =
    messages.filter((message) => message.role === "user").length;
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, working]);

  return (
    <div className="px-[22px] pt-2 pb-6">
      <div className="bg-ul-bg border border-ul-border rounded-xl overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-ul-border bg-ul-bg-subtle">
          <div className="min-w-0">
            <div className="text-micro font-mono uppercase tracking-widest text-ul-text-muted">
              Command session
            </div>
            <div className="text-caption text-ul-text-secondary">
              {turnCount} {turnCount === 1 ? "turn" : "turns"} ·{" "}
              {session.mode === "replay" ? "read-only replay" : "live"}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {working && (
              <button
                type="button"
                onClick={onCancel}
                className="inline-flex items-center gap-2 rounded-full border border-ul-border bg-ul-bg px-2.5 py-1.5 text-caption text-ul-text-muted hover:text-ul-text hover:border-ul-border-strong transition-colors"
                title="Cancel generation"
                aria-label="Cancel generation"
              >
                <Loader2
                  className="h-3.5 w-3.5 animate-spin"
                  strokeWidth={1.5}
                />
                <span className="hidden sm:inline">Running</span>
                <span className="h-3 w-px bg-ul-border" />
                <X className="h-3.5 w-3.5" strokeWidth={1.7} />
              </button>
            )}
            {session.mode === "replay" && (
              <button
                type="button"
                onClick={onContinue}
                className="font-mono text-caption text-white bg-ul-text border border-ul-text px-3 py-2 rounded-md cursor-pointer hover:bg-ul-accent-hover"
              >
                Continue
              </button>
            )}
            <button
              type="button"
              onClick={onHome}
              disabled={working}
              className="inline-flex items-center gap-2 font-mono text-caption text-ul-text-secondary bg-ul-bg border border-ul-border px-3 py-2 rounded-md cursor-pointer hover:bg-ul-bg-hover disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.6} />
              Home
            </button>
          </div>
        </div>

        {inferenceNotice && (
          <div className="mx-4 mt-3 rounded-md border border-ul-border bg-ul-bg-subtle px-3 py-2 text-caption text-ul-text-secondary">
            <div className="font-medium text-ul-text">
              {inferenceNotice.title}
            </div>
            <div>{inferenceNotice.message}</div>
            <button
              type="button"
              onClick={onClearInferenceNotice}
              className="mt-2 font-mono text-nano text-ul-text-muted hover:text-ul-text"
            >
              Dismiss
            </button>
          </div>
        )}

        <div className="max-h-[58vh] overflow-auto px-4 py-4">
          {messages.length === 0
            ? (
              <div className="py-10 text-center text-caption text-ul-text-muted">
                Ask Command to inspect tools, data, widgets, or the active app
                surface.
              </div>
            )
            : (
              messages.map((message) => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  onNextStepClick={onNextStepClick}
                />
              ))
            )}
          <div ref={endRef} />
        </div>

        <div className="border-t border-ul-border bg-ul-warm-paper/70 py-2">
          {session.mode === "live"
            ? (
              <CommandComposer
                loading={working}
                onGenerate={onSend}
                placeholder="Ask Command to explain, render, combine, or act through your widgets..."
                submitLabel="Send"
                ariaLabel="Command chat prompt"
                draftOverride={draftOverride}
              />
            )
            : (
              <div className="px-[22px] py-2 text-caption text-ul-text-muted">
                Continue this session to append a new turn.
              </div>
            )}
        </div>
      </div>
    </div>
  );
}

function RecentCommandSessions({
  conversations,
  onOpen,
}: {
  conversations: Conversation[];
  onOpen: (conversationId: string) => void;
}) {
  if (conversations.length === 0) return null;
  return (
    <div className="px-[22px] pb-3">
      <div className="bg-ul-bg border border-ul-border rounded-xl p-3">
        <div className="flex items-center gap-2 text-micro font-mono uppercase tracking-widest text-ul-text-muted mb-2">
          <History className="h-3.5 w-3.5" strokeWidth={1.6} />
          Recent sessions
        </div>
        <div className="grid gap-1.5">
          {conversations.map((conversation) => (
            <button
              key={conversation.id}
              type="button"
              onClick={() => onOpen(conversation.id)}
              className="min-w-0 rounded-md border border-transparent px-2.5 py-2 text-left hover:border-ul-border hover:bg-ul-bg-hover transition-colors"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="text-caption text-ul-text truncate">
                  {conversation.title || "Command session"}
                </div>
                <div className="text-nano text-ul-text-muted flex-shrink-0">
                  {formatSessionDate(conversation.updated_at)}
                </div>
              </div>
              {conversation.last_message_preview && (
                <div className="text-nano text-ul-text-muted truncate mt-0.5">
                  {conversation.last_message_preview}
                </div>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────

export default function CommandHomescreen() {
  const [layout, setLayout] = useState<CommandDashboardLayout | null>(null);
  const [widgetsIndex, setWidgetsIndex] = useState<FunctionIndex["widgets"]>(
    [],
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [edit, setEdit] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Drag-to-reorder state (edit mode only). draggingId lives in component
  // state so the dragged tile can fade; dropTargetId drives the ring on the
  // tile currently being hovered. Cleared on dragend / drop.
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  // Per-instance card data, keyed by instance_id
  const [cardData, setCardData] = useState<Record<string, unknown>>({});
  const [cardLoading, setCardLoading] = useState<Record<string, boolean>>({});
  const [routineMonitor, setRoutineMonitor] = useState<
    RoutineMonitorResponse | null
  >(null);
  const [routineLoading, setRoutineLoading] = useState(false);
  const [routineError, setRoutineError] = useState<string | null>(null);
  const [generatedInterface, setGeneratedInterface] = useState<
    AgenticInterfacePlannerResult | null
  >(null);
  const [interfaceLoading, setInterfaceLoading] = useState(false);
  const [interfaceError, setInterfaceError] = useState<string | null>(null);
  const [savedInterfaces, setSavedInterfaces] = useState<
    AgenticInterfaceSummary[]
  >([]);
  const [savedInterfacesLoading, setSavedInterfacesLoading] = useState(false);
  const [savedInterfacesError, setSavedInterfacesError] = useState<
    string | null
  >(null);
  const [savingInterface, setSavingInterface] = useState(false);
  const [activeInterfaceKey, setActiveInterfaceKey] = useState<string | null>(
    null,
  );
  const [lastInterfacePrompt, setLastInterfacePrompt] = useState<string | null>(
    null,
  );
  // Track which instance ids we've already started a fetch for. Ref (not
  // state) so the dispatch loop doesn't read stale cardData/cardLoading
  // closures when tiles change quickly (e.g. after a layout edit).
  const fetchedInstanceIdsRef = useRef<Set<string>>(new Set());
  const {
    conversations,
    createConversation,
    loadConversation,
    saveMessages,
    updateTitle,
    refreshList,
  } = useConversations();
  const [commandSession, setCommandSession] = useState<CommandSession | null>(
    null,
  );
  const [commandMessages, setCommandMessages] = useState<Message[]>([]);
  const [commandWorking, setCommandWorking] = useState(false);
  const [commandDraft, setCommandDraft] = useState<
    { id: string; text: string } | null
  >(null);
  const [commandInferenceNotice, setCommandInferenceNotice] = useState<
    InferenceSetupPrompt | null
  >(null);
  const commandMessagesRef = useRef<Message[]>([]);
  const commandSessionRef = useRef<CommandSession | null>(null);
  const activeAgenticSurfacesRef = useRef<ActiveAgenticSurface[]>([]);
  const commandAbortControllerRef = useRef<AbortController | null>(null);
  const commandTurnIdRef = useRef<string | null>(null);
  const {
    suggestions: commandSuggestions,
    hasNew: commandSuggestionsHasNew,
    selectedSuggestion: selectedCommandSuggestion,
    selectedPreview: selectedCommandSuggestionPreview,
    selectedPreviewLoading: selectedCommandSuggestionPreviewLoading,
    selectedPreviewError: selectedCommandSuggestionPreviewError,
    acceptStateByKey: commandSuggestionAcceptStateByKey,
    markViewed: markCommandSuggestionsViewed,
    selectSuggestion: selectCommandSuggestion,
    acceptSuggestion: acceptCommandSuggestion,
  } = useCommandSuggestions();

  useEffect(() => {
    commandMessagesRef.current = commandMessages;
  }, [commandMessages]);

  useEffect(() => {
    commandSessionRef.current = commandSession;
  }, [commandSession]);

  useEffect(() =>
    subscribeAgenticSurfaces((surfaces) => {
      activeAgenticSurfacesRef.current = surfaces;
    }), []);

  const recentCommandConversations = useMemo(() => (
    conversations
      .filter((conversation) =>
        conversation.model === COMMAND_CONVERSATION_MODEL
      )
      .slice(0, 5)
  ), [conversations]);

  // Format today's date in the cozy header style ("Sunday, March 9")
  const today = useMemo(() => {
    return new Date().toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
  }, []);

  // Initial load — fetch layout + widget index in parallel
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetchCommandDashboardLayout("command_home"),
      fetchCommandWidgets(),
    ])
      .then(([stored, widgets]) => {
        if (cancelled) return;
        setLayout(stored?.layout ?? null);
        setWidgetsIndex(widgets?.widgets ?? []);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshCommandWidgets = useCallback(async () => {
    try {
      const widgets = await fetchCommandWidgets();
      setWidgetsIndex(widgets?.widgets ?? []);
    } catch (err) {
      commandLogger.warn("Failed to refresh Command widgets", { error: err });
    }
  }, []);

  const refreshSavedInterfaces = useCallback(async () => {
    setSavedInterfacesLoading(true);
    setSavedInterfacesError(null);
    try {
      const interfaces = await fetchAgenticInterfaces();
      setSavedInterfaces(interfaces);
    } catch (err) {
      setSavedInterfacesError(
        err instanceof Error ? err.message : "Failed to load saved interfaces",
      );
    } finally {
      setSavedInterfacesLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshSavedInterfaces();
  }, [refreshSavedInterfaces]);

  const refreshRoutineMonitor = useCallback(async () => {
    setRoutineLoading(true);
    setRoutineError(null);
    try {
      const monitor = await fetchRoutineMonitor();
      setRoutineMonitor(monitor);
    } catch (err) {
      setRoutineError(
        err instanceof Error ? err.message : "Failed to load routines",
      );
    } finally {
      setRoutineLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshRoutineMonitor();
  }, [refreshRoutineMonitor]);

  const replaceRoutine = useCallback((routine: RoutineMonitorItem | null) => {
    if (!routine) return;
    setRoutineMonitor((current) => {
      if (!current) return current;
      return {
        ...current,
        routines: current.routines.map((item) =>
          item.id === routine.id ? routine : item
        ),
      };
    });
  }, []);

  const handlePauseRoutine = useCallback(async (routineId: string) => {
    const routine = await updateRoutineMonitorStatus(routineId, "pause");
    replaceRoutine(routine);
    void refreshRoutineMonitor();
  }, [refreshRoutineMonitor, replaceRoutine]);

  const handleResumeRoutine = useCallback(async (routineId: string) => {
    const routine = await updateRoutineMonitorStatus(routineId, "resume");
    replaceRoutine(routine);
    void refreshRoutineMonitor();
  }, [refreshRoutineMonitor, replaceRoutine]);

  const handleRunRoutineNow = useCallback(async (routineId: string) => {
    await runRoutineNow(routineId);
    void refreshRoutineMonitor();
  }, [refreshRoutineMonitor]);

  const ensureCommandInferenceReady = useCallback(
    async (): Promise<boolean> => {
      try {
        const settings = await fetchInferenceSettings();
        const notice = buildInferenceSetupPrompt(
          settings,
          getInferencePreference() ?? {},
        );
        setCommandInferenceNotice(notice);
        return notice === null;
      } catch (err) {
        commandLogger.warn("Failed to load Command inference settings", {
          error: err,
        });
        setCommandInferenceNotice({
          state: "needs_inference_setup",
          title: "Inference unavailable",
          message:
            "Command could not verify the current inference settings. Check sign-in and provider settings before sending.",
          primaryAction: { label: "Open settings", action: "open_settings" },
        });
        return false;
      }
    },
    [],
  );

  const openCommandConversation = useCallback(
    async (conversationId: string) => {
      if (commandWorking) return;
      setCommandDraft(null);
      setCommandInferenceNotice(null);
      const messages = await loadConversation(conversationId);
      commandMessagesRef.current = messages;
      setCommandMessages(messages);
      setCommandSession({ conversationId, mode: "replay" });
    },
    [commandWorking, loadConversation],
  );

  const returnCommandHome = useCallback(() => {
    if (commandWorking) return;
    setCommandSession(null);
    setCommandMessages([]);
    commandMessagesRef.current = [];
    setCommandDraft(null);
    setCommandInferenceNotice(null);
    void refreshList();
  }, [commandWorking, refreshList]);

  const continueCommandSession = useCallback(() => {
    setCommandSession((current) =>
      current ? { ...current, mode: "live" } : current
    );
  }, []);

  const cancelCommandGeneration = useCallback(() => {
    const turnId = commandTurnIdRef.current;
    if (turnId) {
      void cancelGenerationTurn(turnId).catch((err) => {
        commandLogger.debug(
          "Command generation cancel endpoint did not resolve",
          {
            error: err,
            turnId,
          },
        );
      });
    }
    commandAbortControllerRef.current?.abort("user_cancelled");
  }, []);

  const appendCommandAssistantMessage = useCallback(async (content: string) => {
    const session = commandSessionRef.current;
    if (!session?.conversationId) return;
    const message: Message = {
      id: crypto.randomUUID(),
      role: "assistant",
      content,
      created_at: Date.now(),
    };
    const next = [...commandMessagesRef.current, message];
    commandMessagesRef.current = next;
    setCommandMessages(next);
    await saveMessages(session.conversationId, next, true);
    await refreshList();
  }, [refreshList, saveMessages]);

  const runCommandTurn = useCallback(async (
    prompt: string,
    options?: CommandTurnOptions,
  ) => {
    const trimmed = prompt.trim();
    if (!trimmed || commandWorking) return;
    if (!(await ensureCommandInferenceReady())) return;

    setCommandWorking(true);
    setCommandDraft(null);
    setCommandInferenceNotice(null);

    let localMessages = commandMessagesRef.current;
    const setLocalMessages = (next: Message[]) => {
      localMessages = next;
      commandMessagesRef.current = next;
      setCommandMessages(next);
    };
    const upsertMessage = (message: Message) => {
      const existing = localMessages.findIndex((entry) =>
        entry.id === message.id
      );
      const next = existing >= 0
        ? localMessages.map((entry) =>
          entry.id === message.id ? message : entry
        )
        : [...localMessages, message];
      setLocalMessages(next);
    };

    let session = commandSessionRef.current;
    let conversationId = session?.conversationId;
    try {
      if (!conversationId) {
        conversationId = await createConversation(
          COMMAND_CONVERSATION_MODEL,
          null,
        );
        await updateTitle(
          conversationId,
          buildCommandConversationTitle(trimmed),
        );
        session = { conversationId, mode: "live" };
        commandSessionRef.current = session;
        setCommandSession(session);
        localMessages = [];
      } else if (session?.mode === "replay") {
        session = { conversationId, mode: "live" };
        commandSessionRef.current = session;
        setCommandSession(session);
      }

      const history = localMessages
        .filter((message) =>
          message.role === "user" || message.role === "assistant"
        )
        .map((message) => ({ role: message.role, content: message.content }));
      const userMessage: Message = {
        id: crypto.randomUUID(),
        role: "user",
        content: trimmed,
        created_at: Date.now(),
      };
      setLocalMessages([...localMessages, userMessage]);

      const assistantId = crypto.randomUUID();
      const abortController = new AbortController();
      commandAbortControllerRef.current = abortController;
      commandTurnIdRef.current = assistantId;
      let assistantContent = "";
      let assistantArtifacts: ChatTurnArtifact[] = [];
      let statusHint = "";
      let currentPlanId: string | null = null;
      let autoConfirmedPlan = false;
      const executeWindowSeconds = 8;

      const commitAssistantMessage = () => {
        upsertMessage({
          id: assistantId,
          role: "assistant",
          content: assistantContent,
          artifacts: assistantArtifacts.length > 0
            ? assistantArtifacts
            : undefined,
          created_at: Date.now(),
        });
      };
      const updateAssistantMessage = () => {
        if (assistantContent) {
          commitAssistantMessage();
        } else if (assistantArtifacts.length > 0) {
          commitAssistantMessage();
        } else if (statusHint) {
          upsertMessage({
            id: assistantId,
            role: "assistant",
            content: `\u200B${statusHint}`,
            created_at: Date.now(),
          });
        }
      };

      const activeWidgetContexts = activeAgenticSurfacesRef.current
        .map(buildActiveAgenticSurfaceContext);
      const inference = getInferencePreference() ?? undefined;

      for await (
        const event of streamOrchestrate({
          message: trimmed,
          conversationHistory: history,
          interpreterModel: getInterpreterModel(),
          heavyModel: getHeavyModel(),
          inference,
          conversationId,
          userMessageId: userMessage.id,
          assistantMessageId: assistantId,
          systemAgentContext: options?.systemAgentContext,
          signal: abortController.signal,
          activeWidgetContexts: activeWidgetContexts.length > 0
            ? activeWidgetContexts
            : undefined,
        })
      ) {
        switch (event.type) {
          case "ambient_suggestions":
            if (event.suggestions?.length) {
              dispatchAmbientSuggestions(
                event.suggestions.map((suggestion) => ({
                  ...suggestion,
                  intent_id: suggestion.intent_id || event.intent_id,
                  suggestion_set_id: suggestion.suggestion_set_id ||
                    event.suggestion_set_id,
                  conversation_id: conversationId,
                  message_id: userMessage.id,
                })),
              );
            }
            break;
          case "flash_status":
            statusHint = event.text || "Thinking...";
            updateAssistantMessage();
            break;
          case "flash_search":
            statusHint = `Searching ${(event.apps || []).join(", ")}...`;
            updateAssistantMessage();
            break;
          case "flash_found":
            statusHint = `Found ${event.entity}`;
            updateAssistantMessage();
            break;
          case "flash_context":
            statusHint = "Preparing response...";
            updateAssistantMessage();
            break;
          case "flash_prompt":
            statusHint = "Writing...";
            updateAssistantMessage();
            break;
          case "flash_direct":
            statusHint = "";
            assistantContent += event.content || "";
            updateAssistantMessage();
            break;
          case "heavy_status":
            if (!assistantContent) {
              statusHint = event.text || "Writing...";
              updateAssistantMessage();
            }
            break;
          case "heavy_text":
            statusHint = "";
            assistantContent += event.content || "";
            updateAssistantMessage();
            break;
          case "plan_ready": {
            if (!event.plan) break;
            currentPlanId = event.plan.id;
            const fireAt = Date.now() + executeWindowSeconds * 1000;
            const localPlan: ExecutionPlan = {
              id: event.plan.id,
              conversation_id: conversationId,
              message_id: assistantId,
              recipe: event.plan.recipe,
              tools_used: event.plan.tools_used,
              total_cost_light: event.plan.total_cost_light,
              created_at: event.plan.created_at,
              window_seconds: executeWindowSeconds,
              fire_at: fireAt,
              status: "pending",
              result: undefined,
              fired_at: undefined,
              completed_at: undefined,
            };
            try {
              await invoke("db_create_execution_plan", { plan: localPlan });
            } catch (err) {
              commandLogger.warn("Failed to persist Command execution plan", {
                error: err,
                planId: event.plan.id,
              });
            }
            assistantContent += assistantContent
              ? `\n\n{{exec:${event.plan.id}}}`
              : `{{exec:${event.plan.id}}}`;
            updateAssistantMessage();

            if (options?.autoConfirmFirstPlan && !autoConfirmedPlan) {
              autoConfirmedPlan = true;
              try {
                await confirmExecutionPlan(event.plan.id);
              } catch (err) {
                commandLogger.warn(
                  "Failed to auto-confirm Command next-step plan",
                  {
                    error: err,
                    planId: event.plan.id,
                  },
                );
              }
            }
            break;
          }
          case "plan_cancelled":
            statusHint = "";
            if (currentPlanId || event.planId) {
              const cancellationResult = event.reason === "timed_out"
                ? "Execution window expired before approval."
                : "Execution was cancelled before any tools ran.";
              try {
                await invoke("db_update_execution_plan_status", {
                  id: event.planId || currentPlanId,
                  status: "cancelled",
                  result: cancellationResult,
                  fireAt: null,
                  firedAt: null,
                  completedAt: Date.now(),
                });
              } catch (err) {
                commandLogger.warn(
                  "Failed to persist Command plan cancellation",
                  {
                    error: err,
                    planId: event.planId || currentPlanId,
                  },
                );
              }
            }
            updateAssistantMessage();
            break;
          case "exec_start":
            if (currentPlanId) {
              try {
                await invoke("db_update_execution_plan_status", {
                  id: currentPlanId,
                  status: "executing",
                  result: null,
                  fireAt: null,
                  firedAt: Date.now(),
                  completedAt: null,
                });
              } catch (err) {
                commandLogger.warn(
                  "Failed to persist Command executing plan state",
                  {
                    error: err,
                    planId: currentPlanId,
                  },
                );
              }
            }
            if (!assistantContent) {
              statusHint = "Running...";
              updateAssistantMessage();
            }
            break;
          case "exec_result": {
            statusHint = "";
            if (currentPlanId) {
              let serializedResult = "";
              try {
                serializedResult = typeof event.data === "string"
                  ? event.data
                  : JSON.stringify(event.data, null, 2);
              } catch {
                serializedResult = String(event.data);
              }
              try {
                await invoke("db_update_execution_plan_status", {
                  id: currentPlanId,
                  status: "completed",
                  result: serializedResult || null,
                  fireAt: null,
                  firedAt: null,
                  completedAt: Date.now(),
                });
              } catch (err) {
                commandLogger.warn(
                  "Failed to persist Command completed plan state",
                  {
                    error: err,
                    planId: currentPlanId,
                  },
                );
              }
            }
            updateAssistantMessage();
            break;
          }
          case "interface":
            if (event.spec) {
              assistantArtifacts = [
                ...assistantArtifacts.filter((artifact) =>
                  artifact.kind !== "interface"
                ),
                {
                  id: `interface_${assistantId}`,
                  kind: "interface",
                  spec: event.spec,
                  created_at: Date.now(),
                  source: "orchestrate",
                },
              ];
              commitAssistantMessage();
            }
            break;
          case "next_steps":
            assistantArtifacts = [
              ...assistantArtifacts.filter((artifact) =>
                artifact.kind !== "next_steps"
              ),
              {
                id: `next_steps_${assistantId}`,
                kind: "next_steps",
                steps: event.steps || [],
                created_at: Date.now(),
                source: "orchestrate",
              },
            ];
            commitAssistantMessage();
            break;
          case "cancelled": {
            statusHint = "";
            const cancelledAt = event.cancelled_at
              ? new Date(event.cancelled_at).toLocaleTimeString()
              : new Date().toLocaleTimeString();
            assistantContent += assistantContent
              ? `\n\n_Canceled at ${cancelledAt}._`
              : `_Canceled at ${cancelledAt}._`;
            updateAssistantMessage();
            break;
          }
          case "status":
            statusHint = event.text || "";
            updateAssistantMessage();
            break;
          case "text":
            statusHint = "";
            assistantContent += event.content || "";
            updateAssistantMessage();
            break;
          case "result": {
            const result = typeof event.data === "string"
              ? event.data
              : JSON.stringify(event.data, null, 2);
            if (result && result !== "null") {
              assistantContent += `\n\`\`\`json\n${result}\n\`\`\``;
              updateAssistantMessage();
            }
            break;
          }
          // Legacy stream compatibility. Command-native delegations now arrive
          // as ambient suggestions and are accepted through the suggestions UI.
          case "system_agent_spawn":
            if (event.task) {
              assistantContent += `\n\n> Delegation requested: ${event.task}`;
              updateAssistantMessage();
            }
            break;
          case "error":
            statusHint = "";
            assistantContent += `\n\n**Error:** ${
              event.message || "Unknown error"
            }`;
            updateAssistantMessage();
            break;
          case "done":
            statusHint = "";
            if (!assistantContent && assistantArtifacts.length === 0) {
              assistantContent = "Done.";
            }
            updateAssistantMessage();
            break;
          default:
            break;
        }
      }

      await saveMessages(conversationId, localMessages, true);
      await refreshList();
    } catch (err) {
      const errorMessage = err instanceof Error
        ? err.message
        : "Command turn failed";
      upsertMessage({
        id: crypto.randomUUID(),
        role: "assistant",
        content: `**Error:** ${errorMessage}`,
        created_at: Date.now(),
      });
      if (conversationId) {
        await saveMessages(conversationId, localMessages, true);
      }
    } finally {
      commandAbortControllerRef.current = null;
      commandTurnIdRef.current = null;
      setCommandWorking(false);
    }
  }, [
    commandWorking,
    createConversation,
    ensureCommandInferenceReady,
    refreshList,
    saveMessages,
    updateTitle,
  ]);

  const onCommandNextStepClick = useCallback(
    async (step: NextStep, _message?: Message) => {
      if (step.kind === "suggest_prompt") {
        setCommandDraft({ id: crypto.randomUUID(), text: step.prompt });
        if (commandSessionRef.current?.mode === "replay") {
          continueCommandSession();
        }
        return;
      }
      if (commandSessionRef.current?.mode === "replay") {
        continueCommandSession();
      }
      await runCommandTurn(
        buildNextStepActionPrompt(step),
        { autoConfirmFirstPlan: !step.preview },
      );
    },
    [continueCommandSession, runCommandTurn],
  );

  const handleCommandSuggestionAcceptResult = useCallback(async (
    result: SuggestionAcceptResult,
  ) => {
    if (!result.ok) {
      await appendCommandAssistantMessage(
        `**Suggestion error:** ${result.error}`,
      );
      return;
    }

    switch (result.kind) {
      case "installed_app":
        await refreshCommandWidgets();
        break;
      case "inline_discover":
        await appendCommandAssistantMessage(
          result.content || `{{discover:${result.query}}}`,
        );
        break;
      case "start_orchestrate":
        if (commandSessionRef.current?.mode === "replay") {
          continueCommandSession();
        }
        await runCommandTurn(result.message, {
          autoConfirmFirstPlan: result.autoConfirmFirstPlan,
          systemAgentContext: result.systemAgentContext,
          acceptedSuggestionId: result.suggestionId,
        });
        break;
      case "prefill_prompt":
        if (commandSessionRef.current?.mode === "replay") {
          continueCommandSession();
        }
        setCommandDraft({ id: crypto.randomUUID(), text: result.text });
        break;
      case "noop":
        if (result.message) await appendCommandAssistantMessage(result.message);
        break;
    }
  }, [
    appendCommandAssistantMessage,
    continueCommandSession,
    refreshCommandWidgets,
    runCommandTurn,
  ]);

  const handleCommandSuggestionAccept = useCallback(async (
    suggestion: AmbientSuggestion,
  ) => {
    const result = await acceptCommandSuggestion(
      suggestion,
      "command_surface",
    );
    await handleCommandSuggestionAcceptResult(result);
  }, [acceptCommandSuggestion, handleCommandSuggestionAcceptResult]);

  // Resolve each card instance against the widget index. Drops orphans
  // (instances whose widget or card was removed from the manifest).
  const tiles = useMemo<ResolvedTile[]>(() => {
    if (!layout || widgetsIndex.length === 0) return [];
    const resolved: ResolvedTile[] = [];
    for (const instance of layout.cards) {
      const widget = widgetsIndex.find(
        (w) => w.appId === instance.app_id && w.name === instance.widget_id,
      );
      if (!widget) continue;
      const card = widget.cards?.find((c) => c.id === instance.card_id);
      if (!card) continue;
      resolved.push({ instance, widget, card });
    }
    return resolved;
  }, [layout, widgetsIndex]);

  // Per-tile data fetch. Triggers when tiles list changes; uses a ref-tracked
  // dispatch set so the guard doesn't read stale state when tiles change
  // quickly. On failure, the id is removed from the set so a subsequent
  // tiles change retries.
  useEffect(() => {
    let cancelled = false;
    for (const tile of tiles) {
      const id = tile.instance.instance_id;
      if (fetchedInstanceIdsRef.current.has(id)) continue;
      fetchedInstanceIdsRef.current.add(id);
      setCardLoading((s) => ({ ...s, [id]: true }));
      void fetchWidgetDataPayload(
        {
          appUuid: tile.widget.appId,
          appSlug: tile.widget.appSlug ?? "",
          dataFunction: tile.widget.dataFunction ??
            `widget_${tile.widget.name}_data`,
        },
        undefined,
        null,
        {
          card_id: tile.card.id,
          data_view: tile.card.dataView ?? tile.card.id,
        },
      )
        .then((payload) => {
          if (cancelled) return;
          setCardData((s) => ({ ...s, [id]: payload?.raw ?? null }));
        })
        .catch(() => {
          if (cancelled) return;
          // Drop from the dispatch set so a future tiles change retries.
          fetchedInstanceIdsRef.current.delete(id);
          setCardData((s) => ({ ...s, [id]: null }));
        })
        .finally(() => {
          if (cancelled) return;
          setCardLoading((s) => ({ ...s, [id]: false }));
        });
    }
    return () => {
      cancelled = true;
    };
  }, [tiles]);

  const onOpenTile = useCallback((tile: ResolvedTile) => {
    void openWidgetWindow({
      appUuid: tile.widget.appId,
      appSlug: tile.widget.appSlug ?? "",
      appName: tile.widget.appName ?? tile.widget.appSlug ?? "Widget",
      widgetName: tile.widget.name,
      // Convention used by widgetRuntime: widget_<name>_ui / widget_<name>_data.
      uiFunction: tile.widget.uiFunction ?? `widget_${tile.widget.name}_ui`,
      dataFunction: tile.widget.dataFunction ??
        `widget_${tile.widget.name}_data`,
    });
  }, []);

  const onOpenGeneratedWidget = useCallback(
    (request: AgenticOpenWidgetRequest) => {
      const widget = widgetsIndex.find((entry) =>
        entry.appId === request.appId && entry.name === request.widgetId
      );
      void openWidgetWindow({
        appUuid: request.appId,
        appSlug: request.appSlug || widget?.appSlug || "",
        appName: widget?.appName || request.appSlug || "Widget",
        widgetName: request.widgetId,
        uiFunction: widget?.uiFunction || `widget_${request.widgetId}_ui`,
        dataFunction: widget?.dataFunction || `widget_${request.widgetId}_data`,
      }, request.context);
    },
    [widgetsIndex],
  );

  const onGeneratedAction = useCallback(async (
    action: AgenticInterfaceAction,
    args: Record<string, unknown> | undefined,
    context: AgenticInterfaceActionExecutionContext,
  ) => {
    if (!generatedInterface) {
      throw generatedActionError(action, "No generated interface is active.");
    }
    setInterfaceError(null);

    if (action.kind === "widget_action") {
      const activeSurfaces = getActiveWidgetSurfaces();
      const surface = activeSurfaces.find((entry) =>
        action.surface_id
          ? entry.surfaceId === action.surface_id
          : entry.source.widgetName === action.widget_id &&
            (entry.source.appUuid === action.app_id ||
              (action.app_slug && entry.source.appSlug === action.app_slug))
      );
      if (!surface) {
        throw generatedActionError(
          action,
          `Open ${action.widget_id} before running this widget action.`,
        );
      }
      const result = await invokeWidgetSurfaceAction({
        surface_id: surface.surfaceId,
        widget_id: action.widget_id,
        action_id: action.action_id,
        args: actionArgs(action, args),
        turn_id: context.turnId,
        source: "agent",
        agentic_surface_id: context.surfaceId,
        agentic_interface_id: generatedInterface.normalized_spec.id,
        agentic_action_id: action.id,
        agentic_component_id: context.componentId,
      });
      if (!result.ok) {
        throw generatedActionError(
          action,
          result.error || "Widget action failed.",
        );
      }
      return result.data ?? result;
    }

    const result = await executeAgenticInterfaceAction({
      spec: generatedInterface.normalized_spec,
      action_id: action.id,
      args,
      confirmed: context.confirmed,
      surface_id: context.surfaceId,
      turn_id: context.turnId,
      component_id: context.componentId,
    });
    if (result.status === "requires_confirmation") {
      throw generatedActionError(
        action,
        result.error || "Confirmation is required.",
      );
    }
    if (result.status === "client_action_required") {
      throw generatedActionError(
        action,
        "This action must run from an active widget surface.",
      );
    }
    if (result.status === "error") {
      throw generatedActionError(action, result.error || "Action failed.");
    }
    return result.result ?? result.open_widget ??
      result.refreshed_binding_ids ?? result.selected_entity ?? result;
  }, [generatedInterface]);

  const onSaveGeneratedInterface = useCallback(async () => {
    if (!generatedInterface) return;
    setSavingInterface(true);
    setInterfaceError(null);
    try {
      const spec = generatedInterface.normalized_spec;
      const saved = await saveAgenticInterface({
        ...(activeInterfaceKey ? { interface_key: activeInterfaceKey } : {}),
        title: spec.title,
        description: spec.description ?? null,
        spec,
        source_prompt: lastInterfacePrompt ?? spec.provenance?.prompt ?? null,
      });
      setActiveInterfaceKey(saved.interface_key);
      setGeneratedInterface(savedAgenticInterfaceToPlannerResult(saved));
      await refreshSavedInterfaces();
    } catch (err) {
      setInterfaceError(
        err instanceof Error
          ? err.message
          : "Failed to save generated interface",
      );
    } finally {
      setSavingInterface(false);
    }
  }, [
    activeInterfaceKey,
    generatedInterface,
    lastInterfacePrompt,
    refreshSavedInterfaces,
  ]);

  const onOpenSavedInterface = useCallback(async (interfaceKey: string) => {
    setInterfaceLoading(true);
    setInterfaceError(null);
    try {
      const saved = await fetchAgenticInterface(interfaceKey);
      setGeneratedInterface(savedAgenticInterfaceToPlannerResult(saved));
      setActiveInterfaceKey(saved.interface_key);
      setLastInterfacePrompt(saved.source_prompt);
    } catch (err) {
      setInterfaceError(
        err instanceof Error ? err.message : "Failed to open saved interface",
      );
    } finally {
      setInterfaceLoading(false);
    }
  }, []);

  const onDeleteSavedInterface = useCallback(async (interfaceKey: string) => {
    const item = savedInterfaces.find((entry) =>
      entry.interface_key === interfaceKey
    );
    if (!window.confirm(`Delete ${item?.title || "this saved interface"}?`)) {
      return;
    }
    setSavedInterfacesError(null);
    try {
      const ok = await deleteAgenticInterface(interfaceKey);
      if (!ok) {
        setSavedInterfacesError("Failed to delete saved interface");
        return;
      }
      if (activeInterfaceKey === interfaceKey) {
        setActiveInterfaceKey(null);
        setGeneratedInterface((current) =>
          current
            ? {
              ...current,
              draft_spec: { ...current.draft_spec, mode: "temporary" },
              normalized_spec: {
                ...current.normalized_spec,
                mode: "temporary",
              },
              persisted: false,
            }
            : current
        );
      }
      await refreshSavedInterfaces();
    } catch (err) {
      setSavedInterfacesError(
        err instanceof Error ? err.message : "Failed to delete saved interface",
      );
    }
  }, [activeInterfaceKey, refreshSavedInterfaces, savedInterfaces]);

  // Persist a layout change. Optimistic update — UI reflects immediately;
  // server confirms in the background. Reverts on failure.
  const persistLayout = useCallback(async (next: CommandDashboardLayout) => {
    const prev = layout;
    setLayout(next);
    const saved = await saveCommandDashboardLayout(next);
    if (!saved) {
      setLayout(prev);
      setError("Failed to save dashboard. Reverted.");
    }
  }, [layout]);

  const onRemoveTile = useCallback(
    async (instanceId: string) => {
      if (!layout) return;
      const prev = layout;
      const next: CommandDashboardLayout = {
        ...layout,
        cards: layout.cards.filter((c) => c.instance_id !== instanceId),
      };
      // Optimistic layout update.
      setLayout(next);
      const saved = await saveCommandDashboardLayout(next);
      if (!saved) {
        // Revert layout; KEEP cardData intact so the restored tile still has
        // its content. (Bug fix vs. earlier impl that purged data eagerly.)
        setLayout(prev);
        setError("Failed to remove. Reverted.");
        return;
      }
      // Save confirmed — now safe to purge the cache + allow re-fetch if
      // the card is later re-added.
      setCardData((s) => {
        const { [instanceId]: _drop, ...rest } = s;
        return rest;
      });
      fetchedInstanceIdsRef.current.delete(instanceId);
    },
    [layout],
  );

  const onAddCard = useCallback(
    (pick: PickedCard) => {
      const next: CommandDashboardLayout = {
        dashboard_key: layout?.dashboard_key ?? "command_home",
        cards: [
          ...(layout?.cards ?? []),
          {
            instance_id: crypto.randomUUID(),
            app_id: pick.appId,
            app_slug: pick.appSlug,
            widget_id: pick.widgetId,
            card_id: pick.cardId,
            size: pick.size,
            position: { x: 0, y: layout?.cards.length ?? 0 },
          },
        ],
      };
      void persistLayout(next);
      setPickerOpen(false);
    },
    [layout, persistLayout],
  );

  // ── Drag-to-reorder ────────────────────────────────────────────────
  //
  // HTML5 drag-and-drop handlers. Stays inside the addendum's "no new
  // dependencies" rule (vs reaching for react-dnd / dnd-kit). Move-before
  // semantics: dragging tile A onto tile B inserts A immediately before
  // B's slot and shifts the rest right.

  const onTileDragStart = useCallback(
    (instanceId: string, e: React.DragEvent<HTMLDivElement>) => {
      setDraggingId(instanceId);
      // setData is required for Firefox to start a drag.
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", instanceId);
      }
    },
    [],
  );

  const onTileDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    // preventDefault is what tells the browser "this is a valid drop target".
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
  }, []);

  const onTileDragEnter = useCallback((instanceId: string) => {
    setDropTargetId((prev) => (prev === instanceId ? prev : instanceId));
  }, []);

  const onTileDragLeave = useCallback((instanceId: string) => {
    setDropTargetId((prev) => (prev === instanceId ? null : prev));
  }, []);

  const onTileDragEnd = useCallback(() => {
    setDraggingId(null);
    setDropTargetId(null);
  }, []);

  const onTileDrop = useCallback(
    (targetId: string) => {
      if (!layout || !draggingId || draggingId === targetId) {
        setDraggingId(null);
        setDropTargetId(null);
        return;
      }
      const cards = layout.cards;
      const fromIdx = cards.findIndex((c) => c.instance_id === draggingId);
      const toIdx = cards.findIndex((c) => c.instance_id === targetId);
      if (fromIdx === -1 || toIdx === -1) {
        setDraggingId(null);
        setDropTargetId(null);
        return;
      }
      const reordered = [...cards];
      const [moved] = reordered.splice(fromIdx, 1);
      // Inserting at toIdx after the splice naturally lands moved at the
      // target's original visual position when dragging right-to-left, and
      // just-before the target when dragging left-to-right. That matches
      // the iOS app-grid mental model the design references.
      reordered.splice(toIdx, 0, moved);
      const next: CommandDashboardLayout = { ...layout, cards: reordered };
      setDraggingId(null);
      setDropTargetId(null);
      void persistLayout(next);
    },
    [layout, draggingId, persistLayout],
  );

  // Set of widget+card keys currently on the dashboard — drives the
  // "Added" badge on picker rows.
  const takenKeys = useMemo(() => {
    const set = new Set<string>();
    for (const c of layout?.cards ?? []) {
      set.add(buildKey(c.app_id, c.widget_id, c.card_id));
    }
    return set;
  }, [layout]);

  return (
    <div className="bg-ul-warm-paper h-full overflow-auto relative">
      {/* Header */}
      <div className="px-7 pt-6 pb-3.5 flex items-end justify-between">
        <div>
          <div
            className={`text-micro font-mono uppercase tracking-widest mb-1 ${
              edit ? "text-ul-info" : "text-ul-text-muted"
            }`}
          >
            {edit ? "Command · edit mode" : "Command"}
          </div>
          <div className="text-h2 text-ul-text tracking-tight">
            {commandSession ? "Command chat" : edit ? "Drag or remove" : today}
          </div>
        </div>
        <div className="flex gap-2">
          {!commandSession && (
            <>
              {edit
                ? (
                  <button
                    type="button"
                    onClick={() => setEdit(false)}
                    className="font-mono text-caption text-ul-text-secondary bg-ul-bg border border-ul-border px-3.5 py-2 rounded-md cursor-pointer hover:bg-ul-bg-hover"
                  >
                    Done
                  </button>
                )
                : (
                  <button
                    type="button"
                    onClick={() => setEdit(true)}
                    disabled={tiles.length === 0}
                    className="font-mono text-caption text-ul-text-secondary bg-ul-bg border border-ul-border px-3 py-2 rounded-md cursor-pointer hover:bg-ul-bg-hover disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Edit layout
                  </button>
                )}
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                className="font-mono text-caption text-white bg-ul-text border border-ul-text px-3.5 py-2 rounded-md cursor-pointer hover:bg-ul-accent-hover"
              >
                ＋ Widget
              </button>
            </>
          )}
        </div>
      </div>

      {commandSession
        ? (
          <>
            <CommandSessionPanel
              session={commandSession}
              messages={commandMessages}
              working={commandWorking}
              draftOverride={commandDraft}
              inferenceNotice={commandInferenceNotice}
              onHome={returnCommandHome}
              onContinue={continueCommandSession}
              onSend={runCommandTurn}
              onCancel={cancelCommandGeneration}
              onNextStepClick={onCommandNextStepClick}
              onClearInferenceNotice={() => setCommandInferenceNotice(null)}
            />
            <CommandSuggestionsSurface
              suggestions={commandSuggestions}
              hasNew={commandSuggestionsHasNew}
              selectedSuggestion={selectedCommandSuggestion}
              selectedPreview={selectedCommandSuggestionPreview}
              previewLoading={selectedCommandSuggestionPreviewLoading}
              previewError={selectedCommandSuggestionPreviewError}
              acceptStateByKey={commandSuggestionAcceptStateByKey}
              onView={() => markCommandSuggestionsViewed("command_surface")}
              onSelect={selectCommandSuggestion}
              onAccept={handleCommandSuggestionAccept}
            />
          </>
        )
        : (
          <>
            <div className="px-[22px] pt-2">
              <RoutineMonitorPanel
                monitor={routineMonitor}
                loading={routineLoading}
                error={routineError}
                onRefresh={refreshRoutineMonitor}
                onPause={handlePauseRoutine}
                onResume={handleResumeRoutine}
                onRunNow={handleRunRoutineNow}
              />
            </div>

            <CommandComposer
              loading={commandWorking}
              onGenerate={runCommandTurn}
              placeholder="Ask Command to explain, render, combine, or act through your widgets..."
              submitLabel="Send"
              ariaLabel="Command chat prompt"
              draftOverride={commandDraft}
            />
            {commandInferenceNotice && (
              <div className="px-[22px] pb-2">
                <div className="rounded-md border border-ul-border bg-ul-bg px-3 py-2 text-caption text-ul-text-secondary">
                  <div className="font-medium text-ul-text">
                    {commandInferenceNotice.title}
                  </div>
                  <div>{commandInferenceNotice.message}</div>
                </div>
              </div>
            )}
            <RecentCommandSessions
              conversations={recentCommandConversations}
              onOpen={openCommandConversation}
            />
            <AgenticInterfaceLibrary
              interfaces={savedInterfaces}
              loading={savedInterfacesLoading || interfaceLoading}
              saving={savingInterface}
              activeKey={activeInterfaceKey}
              hasCurrent={!!generatedInterface}
              error={savedInterfacesError}
              onSaveCurrent={onSaveGeneratedInterface}
              onOpen={onOpenSavedInterface}
              onDelete={onDeleteSavedInterface}
              onRefresh={refreshSavedInterfaces}
            />
            {interfaceError && (
              <div className="px-[22px] pb-2 text-caption text-ul-text-muted">
                {interfaceError}
              </div>
            )}
            {generatedInterface && (
              <GeneratedInterface
                result={generatedInterface}
                onAction={onGeneratedAction}
                onOpenWidget={onOpenGeneratedWidget}
              />
            )}

            {/* Body */}
            {loading && !layout
              ? (
                <div className="px-7 py-6 text-caption text-ul-text-muted">
                  Loading homescreen…
                </div>
              )
              : error
              ? (
                <div className="px-7 py-6 text-caption text-ul-error">
                  {error}
                </div>
              )
              : tiles.length === 0
              ? <EmptyState onAddWidget={() => setPickerOpen(true)} />
              : (
                <div
                  className="px-[22px] pt-2 pb-6 grid grid-cols-4 gap-3.5"
                  style={{ gridAutoRows: "150px" }}
                >
                  {tiles.map((tile, i) => {
                    const { colSpan, rowSpan } = parseSize(tile.instance.size);
                    const id = tile.instance.instance_id;
                    return (
                      <CozyTile
                        key={id}
                        tile={tile}
                        colSpan={colSpan}
                        rowSpan={rowSpan}
                        data={cardData[id]}
                        loading={cardLoading[id] ?? false}
                        edit={edit}
                        wiggleDelayMs={i * 60}
                        isDragging={draggingId === id}
                        isDropTarget={dropTargetId === id && draggingId !== id}
                        onOpen={() => onOpenTile(tile)}
                        onRemove={() => onRemoveTile(id)}
                        onDragStart={(e) => onTileDragStart(id, e)}
                        onDragOver={onTileDragOver}
                        onDragEnter={() => onTileDragEnter(id)}
                        onDragLeave={() => onTileDragLeave(id)}
                        onDrop={() => onTileDrop(id)}
                        onDragEnd={onTileDragEnd}
                      />
                    );
                  })}
                </div>
              )}
          </>
        )}

      {pickerOpen && (
        <WidgetPickerModal
          widgets={widgetsIndex}
          takenKeys={takenKeys}
          onClose={() => setPickerOpen(false)}
          onPick={onAddCard}
        />
      )}
    </div>
  );
}
