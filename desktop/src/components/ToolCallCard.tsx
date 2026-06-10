// Tool call card — clean, non-technical display of tool invocations.
//
// Ports the Batch 7 addendum's A3 (errored treatment) + A7 (inline
// permission grant) decisions:
//   • Borderless cards. State is communicated by fill colour only —
//     running tints info-blue, completed tints faint black, errored
//     tints faint red, awaiting tints warning-soft.
//   • The errored variant drops the inset red banner; the error message
//     surfaces in the header (ellipsised) and again in a 4px-rounded code
//     well inside the expanded body.
//   • A new awaiting-permission state replaces the legacy bounce-through-
//     Settings modal with an inline grant card: scope chip + Deny / Allow
//     once / Always allow buttons. Wired to the existing usePermissions
//     hook via props threaded through MessageBubble + MessageList.
//
// What's NOT in this PR (parked for later):
//   • Retryable footer (Retry / Show me) — needs BE telemetry to set
//     `retryable: true` on the error message; tracked as DESIGN-FOLLOWUPS B3.
//   • OS-prompted scopes ("Open System Settings" primary button variant)
//     — defer until we ship a tool that requests camera / mic / location
//     (no current consumer; documented in the addendum review).

import { useMemo, useEffect, useRef, useState, type CSSProperties } from 'react';
import type { AccumulatedToolCall } from '../lib/sse';
import type { PermissionRequest } from '../hooks/usePermissions';
import ToolResultRenderer from './tool-renderers';

interface ToolCallCardProps {
  toolCall: AccumulatedToolCall;
  result?: string;
  executing?: boolean;
  /** Post-hoc error message (BE telemetry status='error' / 'aborted' / 'timeout',
   *  or a content heuristic from MessageBubble until the BE pipes structured
   *  error metadata into the Message type). When set, the card renders the
   *  errored visual treatment instead of completed. */
  error?: string;
  /** When set AND its `toolName` matches this card's tool, the card flips to
   *  the awaiting-permission state and surfaces inline grant buttons. */
  pendingPermission?: PermissionRequest | null;
  /** Inline grant button handlers. Fed from usePermissions in ChatView. */
  onAllowPermission?: () => void;
  onAlwaysAllowPermission?: () => void;
  onDenyPermission?: () => void;
}

// ── Helpers ──

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '...' : s;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Convert slug/kebab-case to Title Case: "resort-manager" → "Resort Manager" */
function toTitleCase(s: string): string {
  return s
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

/** Build a human-readable action from function name + args. */
function humanizeAction(fnName: string, args?: Record<string, unknown>): string {
  const name = fnName.toLowerCase();
  const vals = args ? Object.values(args).filter(v => v !== undefined && v !== null) : [];
  const firstVal = vals.length > 0 ? String(vals[0]) : '';
  const allVals = vals.map(v => String(v)).join(', ');

  if (name.includes('list') || name.includes('search') || name.includes('find'))
    return firstVal ? `Searching ${firstVal}` : 'Searching...';
  if (name.includes('get') || name.includes('lookup') || name.includes('check') || name.includes('status'))
    return firstVal ? `Checking ${firstVal}` : 'Checking...';
  if (name.includes('summary') || name.includes('detail') || name.includes('info'))
    return firstVal ? `Looking up ${allVals}` : 'Looking up details...';
  if (name.includes('create') || name.includes('add') || name.includes('new') || name.includes('book') || name.includes('reserve'))
    return firstVal ? `Creating ${firstVal}` : 'Creating...';
  if (name.includes('update') || name.includes('edit') || name.includes('modify') || name.includes('change'))
    return firstVal ? `Updating ${firstVal}` : 'Updating...';
  if (name.includes('delete') || name.includes('remove') || name.includes('cancel'))
    return firstVal ? `Removing ${firstVal}` : 'Removing...';
  if (name.includes('today') || name.includes('current') || name.includes('now'))
    return firstVal ? `Checking today's ${firstVal}` : `Checking today's ${toTitleCase(fnName.replace(/today|current|now/gi, '').trim())}`;
  if (name.includes('billing') || name.includes('payment') || name.includes('charge'))
    return firstVal ? `Checking billing for ${firstVal}` : 'Checking billing...';
  if (name.includes('history') || name.includes('log') || name.includes('activity'))
    return firstVal ? `Reviewing history for ${firstVal}` : 'Reviewing history...';

  const readable = fnName.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  return firstVal ? `${readable}: ${truncate(firstVal, 40)}` : readable;
}

/** Format non-app tool calls into human-readable descriptions */
function humanizeToolAction(name: string, args: Record<string, unknown>): { label: string; detail: string } {
  switch (name) {
    case 'ul_discover': {
      const query = String(args.query || args.search || '');
      const scope = String(args.scope || '');
      if (scope === 'inspect') return { label: 'Inspecting App', detail: '' };
      return { label: 'Discovering Apps', detail: query };
    }
    case 'file_read':
      return { label: 'Reading File', detail: String(args.path || '') };
    case 'file_write':
      return { label: 'Writing File', detail: String(args.path || '') };
    case 'file_edit':
      return { label: 'Editing File', detail: String(args.path || '') };
    case 'glob':
      return { label: 'Finding Files', detail: String(args.pattern || '') };
    case 'grep':
      return { label: 'Searching Code', detail: String(args.pattern || '') };
    case 'ls':
      return { label: 'Listing Directory', detail: String(args.path || '.') };
    case 'shell_exec':
      return { label: 'Running Command', detail: truncate(String(args.command || ''), 50) };
    case 'git':
      return { label: 'Git', detail: `${args.subcommand || ''}` };
    case 'spawn_agent':
      return { label: 'Creating Agent', detail: String(args.name || '') };
    case 'check_agent':
      return { label: 'Checking Agent', detail: '' };
    case 'update_card_status':
      return { label: 'Updating Card', detail: `→ ${args.status || ''}` };
    case 'ul_memory':
      return { label: 'Memory', detail: '' };
    default:
      return { label: toTitleCase(name), detail: '' };
  }
}

/** Best-effort scope chip labels derived from tool args. Today the
 *  permissions layer just hands us `args`; future BE work (B3) will likely
 *  carry an explicit `scopes: string[]` list. Until then, we surface
 *  whichever single-string field is most representative — path / pattern /
 *  command — so the user has a concrete target in front of them. */
function deriveScopeChips(toolName: string, args: Record<string, unknown>): string[] {
  const chips: string[] = [];
  for (const key of ['path', 'pattern', 'command', 'url', 'subcommand'] as const) {
    const v = args[key];
    if (typeof v === 'string' && v.length > 0) {
      chips.push(`${key}=${truncate(v, 40)}`);
    }
  }
  if (chips.length === 0) chips.push(toolName);
  return chips;
}

type CardState = 'awaiting' | 'errored' | 'running' | 'completed' | 'idle';

// Fill colours come straight from the addendum's locked state table.
// Kept inline rather than tokenized because the spec is "very specific
// alphas, no token vocabulary for them yet" — adding 3 single-purpose
// tokens for fills used in exactly one component would be churn.
const STATE_STYLE: Record<Exclude<CardState, 'awaiting'>, CSSProperties> = {
  running:   { background: 'rgba(59,130,246,0.04)', boxShadow: '0 0 0 4px rgba(59,130,246,0.06)' },
  completed: { background: 'rgba(0,0,0,0.02)' },
  errored:   { background: 'rgba(239,68,68,0.05)' },
  idle:      { background: 'transparent' },
};

// ── Component ──

export default function ToolCallCard({
  toolCall,
  result,
  executing,
  error,
  pendingPermission,
  onAllowPermission,
  onAlwaysAllowPermission,
  onDenyPermission,
}: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);
  const startTimeRef = useRef<number>(Date.now());
  const [elapsed, setElapsed] = useState(0);

  // Ring-resolve animation: fires once on executing -> completed transition.
  const prevExecutingRef = useRef(executing);
  const [resolving, setResolving] = useState(false);
  useEffect(() => {
    const wasExecuting = prevExecutingRef.current;
    prevExecutingRef.current = executing;
    if (wasExecuting && !executing && result) {
      setResolving(true);
      const timer = setTimeout(() => setResolving(false), 700);
      return () => clearTimeout(timer);
    }
  }, [executing, result]);

  const parsedArgs = useMemo(() => {
    try {
      return JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
    } catch {
      return {} as Record<string, unknown>;
    }
  }, [toolCall.function.arguments]);

  const name = toolCall.function.name;
  const isAppCall = name === 'ul_call';

  // Resolve display info — used for the header label across non-errored states.
  const display = useMemo(() => {
    if (isAppCall) {
      const fnName = String(parsedArgs.function_name || parsedArgs.function || '');
      const fnArgs = parsedArgs.args as Record<string, unknown> | undefined;

      let appDisplayName = '';
      const appId = String(parsedArgs.app_id || '');
      if (appId && !appId.includes('-')) {
        appDisplayName = toTitleCase(appId);
      }

      const action = humanizeAction(fnName, fnArgs);
      return { appName: appDisplayName, action, fnName, fnArgs };
    }
    const { label, detail } = humanizeToolAction(name, parsedArgs);
    return { appName: '', action: detail ? `${label}: ${detail}` : label, fnName: '', fnArgs: undefined };
  }, [isAppCall, name, parsedArgs]);

  // Timer
  useEffect(() => {
    if (!executing) return;
    startTimeRef.current = Date.now();
    const timer = setInterval(() => setElapsed(Date.now() - startTimeRef.current), 500);
    return () => clearInterval(timer);
  }, [executing]);

  useEffect(() => {
    if (result && !executing) setElapsed(Date.now() - startTimeRef.current);
  }, [result, executing]);

  // Rich result
  const richResult = result ? <ToolResultRenderer toolName={name} args={parsedArgs} result={result} /> : null;

  // Derived state — order of precedence reflects what the user needs to act on
  // first: a denial / error explanation wins over a pending grant, which wins
  // over an in-flight run, etc.
  const isErrored = !!error;
  const isAwaiting =
    !isErrored &&
    !result &&
    !!pendingPermission &&
    pendingPermission.toolName === name;
  const cardState: CardState = isErrored
    ? 'errored'
    : isAwaiting
      ? 'awaiting'
      : executing
        ? 'running'
        : result
          ? 'completed'
          : 'idle';

  // Awaiting auto-expands so the user sees the args + scope chips together
  // without having to flip the card open. Once granted, the toggle reverts
  // to manual.
  const effectiveExpanded = expanded || isAwaiting;

  // Style: awaiting uses a tokenized soft-warning bg; everything else uses
  // the alpha fills from the spec.
  const cardStyle: CSSProperties = cardState === 'awaiting' ? {} : STATE_STYLE[cardState];
  const awaitingClass = isAwaiting ? 'bg-ul-warning-soft' : '';

  // Scope chips — only computed for the awaiting state.
  const scopeChips = useMemo(
    () => (isAwaiting ? deriveScopeChips(name, parsedArgs) : []),
    [isAwaiting, name, parsedArgs],
  );

  return (
    <div
      className={`my-2 rounded-lg overflow-hidden transition-colors animate-toolpop ${
        resolving && !isErrored && !isAwaiting ? 'animate-ring-resolve' : ''
      } ${awaitingClass}`}
      style={cardStyle}
    >
      {/* Header — single row. The errored header swaps the humanized action
          for a tool-name + error-message pair (mono, per spec). */}
      <button
        onClick={() => !isAwaiting && setExpanded(e => !e)}
        disabled={isAwaiting}
        className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${
          isAwaiting ? 'cursor-default' : 'hover:bg-black/[0.02]'
        }`}
      >
        {/* Status glyph */}
        {cardState === 'errored' ? (
          <span className="w-3.5 h-3.5 rounded-full bg-ul-error flex-shrink-0 flex items-center justify-center">
            <svg className="w-2 h-2 text-white" fill="none" viewBox="0 0 8 8" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" d="M2 2 L6 6 M6 2 L2 6" />
            </svg>
          </span>
        ) : cardState === 'awaiting' ? (
          // Amber dot-cluster — three filled circles pulsing in sequence.
          // ul-typing keyframes already drive a 3-step opacity wave; reusing
          // them keeps the motion vocabulary consistent with the message-
          // streaming indicator.
          <span className="w-3.5 h-3.5 flex items-center justify-center gap-[2px] flex-shrink-0" aria-hidden="true">
            {[0, 1, 2].map(i => (
              <span
                key={i}
                className="w-1 h-1 rounded-full bg-ul-warning"
                style={{ animation: 'ul-typing 1.2s infinite', animationDelay: `${i * 200}ms` }}
              />
            ))}
          </span>
        ) : cardState === 'running' ? (
          <span
            className="w-3.5 h-3.5 rounded-full animate-spin flex-shrink-0"
            style={{
              borderWidth: '2px',
              borderStyle: 'solid',
              borderColor: 'rgba(59,130,246,0.25)',
              borderTopColor: '#3b82f6',
            }}
          />
        ) : cardState === 'completed' ? (
          <span className="w-3.5 h-3.5 rounded-full bg-ul-success flex-shrink-0 flex items-center justify-center">
            <svg className="w-2 h-2 text-white" fill="none" viewBox="0 0 8 8" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M1.5 4 L3.3 5.8 L6.5 2.5" />
            </svg>
          </span>
        ) : (
          // Idle placeholder — empty 14×14 ring on the muted token. Mostly
          // exists so layout stays put while the first SSE chunk arrives.
          <span className="w-3.5 h-3.5 rounded-full border-2 border-ul-border flex-shrink-0" />
        )}

        {/* Label: errored uses tool-name + error message; others use the
            humanized action. */}
        {cardState === 'errored' ? (
          <>
            <span className="text-micro font-mono font-medium text-ul-text flex-shrink-0 min-w-0 truncate">
              {name}
            </span>
            <span
              className="text-[11px] font-mono flex-1 min-w-0 truncate"
              style={{ color: '#b1473a' }}
              title={error}
            >
              {error}
            </span>
          </>
        ) : cardState === 'awaiting' ? (
          <>
            <span className="text-micro font-mono font-medium text-ul-text flex-shrink-0 min-w-0 truncate">
              {name}
            </span>
            <span className="text-[11px] font-mono flex-1 min-w-0 truncate text-ul-warning">
              waiting for permission…
            </span>
          </>
        ) : (
          <span
            className={`text-small flex-1 min-w-0 truncate ${
              cardState === 'running' ? 'text-ul-info' : 'text-ul-text-secondary'
            }`}
          >
            {display.action}
          </span>
        )}

        {/* Timing — suppressed in errored + awaiting states. */}
        {cardState !== 'errored' && cardState !== 'awaiting' && elapsed > 0 && (
          <span
            className={`text-nano tabular-nums flex-shrink-0 ${
              cardState === 'running' ? 'text-ul-completed' : 'text-ul-text-muted'
            }`}
          >
            {formatDuration(elapsed)}
          </span>
        )}

        {/* Chevron — hidden while awaiting (no toggle). */}
        {!isAwaiting && (
          <svg
            className={`w-3 h-3 text-ul-text-muted transition-transform flex-shrink-0 ${
              effectiveExpanded ? 'rotate-180' : ''
            }`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </button>

      {/* Body: expanded args + result, plus the awaiting permission stanza. */}
      {effectiveExpanded && (
        <div
          className="px-3 py-2 space-y-2 border-t"
          style={{ borderColor: 'rgba(0,0,0,0.04)' }}
        >
          {/* Args — same shape across all states */}
          {isAppCall ? (
            <div className="space-y-0.5">
              {display.fnName && (
                <div className="flex items-baseline gap-2">
                  <span className="text-nano text-ul-text-muted w-16 shrink-0">Function</span>
                  <span className="text-xs font-mono text-ul-text-secondary">{display.fnName}</span>
                </div>
              )}
              {display.fnArgs && Object.keys(display.fnArgs).length > 0 && (
                Object.entries(display.fnArgs).map(([k, v]) => (
                  <div key={k} className="flex items-baseline gap-2">
                    <span className="text-nano text-ul-text-muted w-16 shrink-0">{toTitleCase(k)}</span>
                    <span className="text-xs text-ul-text-secondary">{typeof v === 'string' ? v : JSON.stringify(v)}</span>
                  </div>
                ))
              )}
            </div>
          ) : (
            <pre className="text-xs font-mono bg-ul-bg-sidebar rounded p-2 overflow-x-auto whitespace-pre-wrap text-ul-text-secondary">
              {JSON.stringify(parsedArgs, null, 2)}
            </pre>
          )}

          {/* Errored body — replaces the legacy banner with a code well. */}
          {cardState === 'errored' && error && (
            <div className="flex items-baseline gap-2">
              <span className="text-nano text-ul-text-muted w-16 shrink-0">Error</span>
              <pre
                className="text-xs font-mono rounded-[4px] px-2 py-1.5 whitespace-pre-wrap break-words flex-1 m-0"
                style={{ background: 'rgba(239,68,68,0.06)', color: '#7c2424' }}
              >
                {error}
              </pre>
            </div>
          )}

          {/* Awaiting body — scope chips + description + button row. */}
          {cardState === 'awaiting' && pendingPermission && (
            <div className="space-y-2 pt-1">
              {scopeChips.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {scopeChips.map(chip => (
                    <span
                      key={chip}
                      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[4px] bg-ul-warning-soft text-[11px] font-mono font-medium"
                      style={{ color: '#7a5410' }}
                    >
                      <span className="w-[5px] h-[5px] rounded-full bg-ul-warning flex-shrink-0" />
                      {chip}
                    </span>
                  ))}
                </div>
              )}
              <p className="text-small text-ul-text-secondary">
                {pendingPermission.description}
              </p>
              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={onDenyPermission}
                  disabled={!onDenyPermission}
                  className="px-3 py-1.5 text-caption text-ul-text-muted hover:text-ul-error disabled:opacity-40 transition-colors bg-transparent border-none cursor-pointer"
                >
                  Deny
                </button>
                <button
                  type="button"
                  onClick={onAllowPermission}
                  disabled={!onAllowPermission}
                  className="px-3 py-1.5 text-caption font-medium rounded-md text-ul-text bg-ul-bg hover:bg-ul-bg-hover border border-ul-border disabled:opacity-40 cursor-pointer"
                >
                  Allow once
                </button>
                <button
                  type="button"
                  onClick={onAlwaysAllowPermission}
                  disabled={!onAlwaysAllowPermission}
                  className="px-3 py-1.5 text-caption font-medium rounded-md bg-ul-accent text-white hover:bg-ul-accent-hover disabled:opacity-40 cursor-pointer"
                >
                  Always allow
                </button>
              </div>
            </div>
          )}

          {/* Result — completed path */}
          {result && richResult ? (
            <div className="pt-1">{richResult}</div>
          ) : result ? (
            <pre className="text-xs font-mono bg-ul-bg-sidebar rounded-md p-2.5 overflow-x-auto whitespace-pre-wrap max-h-60 overflow-y-auto text-ul-text-secondary">
              {result.length > 3000 ? result.slice(0, 3000) + '\n... (truncated)' : result}
            </pre>
          ) : cardState === 'running' ? (
            <div className="flex items-center gap-2 text-caption text-ul-info py-1">
              <span
                className="w-3 h-3 rounded-full animate-spin"
                style={{
                  borderWidth: '2px',
                  borderStyle: 'solid',
                  borderColor: 'rgba(59,130,246,0.25)',
                  borderTopColor: '#3b82f6',
                }}
              />
              Working...
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
