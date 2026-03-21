// Tool call card — inline display of a tool invocation and its result.
// Shows app name, formatted function signature, progress states, and timing.

import { useState, useMemo, useEffect, useRef } from 'react';
import type { AccumulatedToolCall } from '../lib/sse';
import ToolResultRenderer from './tool-renderers';

interface ToolCallCardProps {
  toolCall: AccumulatedToolCall;
  /** The tool result message content (if available) */
  result?: string;
  /** Whether the tool is currently executing */
  executing?: boolean;
}

/** Map tool names to friendly display names and icons */
const TOOL_INFO: Record<string, { label: string; icon: 'app' | 'file' | 'search' | 'cmd' | 'git' | 'agent' | 'card' | 'memory' }> = {
  'ul_discover': { label: 'Discover', icon: 'search' },
  'ul_call': { label: 'Call', icon: 'app' },
  'ul_memory': { label: 'Memory', icon: 'memory' },
  'file_read': { label: 'Read', icon: 'file' },
  'file_write': { label: 'Write', icon: 'file' },
  'file_edit': { label: 'Edit', icon: 'file' },
  'glob': { label: 'Find', icon: 'search' },
  'grep': { label: 'Search', icon: 'search' },
  'ls': { label: 'List', icon: 'file' },
  'shell_exec': { label: 'Run', icon: 'cmd' },
  'git': { label: 'Git', icon: 'git' },
  'spawn_agent': { label: 'Spawn', icon: 'agent' },
  'check_agent': { label: 'Check', icon: 'agent' },
  'update_card_status': { label: 'Update', icon: 'card' },
};

/** Format ul_call args into a readable function signature */
function formatCallSignature(args: Record<string, unknown>): { appName: string; fnCall: string } {
  const appId = String(args.app_id || args.app || '');
  const fnName = String(args.function_name || args.function || '');
  const fnArgs = args.args as Record<string, unknown> | undefined;

  // Extract app name from app_id (last part if UUID-like, or the whole thing)
  const appName = appId.includes('-') && appId.length > 20
    ? '' // Will be resolved from connected apps context
    : appId;

  if (!fnName) return { appName, fnCall: '' };

  // Format args as key: value pairs
  const argParts: string[] = [];
  if (fnArgs && typeof fnArgs === 'object') {
    for (const [k, v] of Object.entries(fnArgs)) {
      if (typeof v === 'string') {
        argParts.push(`${k}: "${truncate(v, 30)}"`);
      } else if (v !== undefined && v !== null) {
        argParts.push(`${k}: ${JSON.stringify(v)}`);
      }
    }
  }

  const argsStr = argParts.length > 0 ? argParts.join(', ') : '';
  return { appName, fnCall: `${fnName}(${argsStr})` };
}

/** Format discover args into a readable string */
function formatDiscoverSummary(args: Record<string, unknown>): string {
  const scope = String(args.scope || '');
  const query = String(args.query || args.search || '');
  if (scope === 'inspect') return `inspect ${args.app_id || ''}`;
  if (query) return query;
  return scope || '';
}

/** Get a compact summary for non-app tools */
function formatToolSummary(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case 'file_read':
    case 'file_write':
    case 'file_edit':
      return String(args.path || '');
    case 'glob':
      return String(args.pattern || '');
    case 'grep':
      return `/${args.pattern || ''}/${args.include ? ` in ${args.include}` : ''}`;
    case 'ls':
      return args.path ? String(args.path) : '.';
    case 'shell_exec':
      return truncate(String(args.command || ''), 60);
    case 'git': {
      const sub = String(args.subcommand || '');
      const gitArgs = Array.isArray(args.args) ? (args.args as string[]).join(' ') : '';
      return truncate(`${sub} ${gitArgs}`.trim(), 60);
    }
    case 'spawn_agent':
      return `${args.name || ''} (${args.role || 'general'})`;
    case 'check_agent':
      return truncate(String(args.agent_id || ''), 20);
    case 'update_card_status':
      return `→ ${args.status || ''}`;
    default:
      return '';
  }
}

/** Progress messages that cycle while executing */
const PROGRESS_MESSAGES: Record<string, string[]> = {
  'ul_call': ['Calling function...', 'Waiting for response...', 'Processing...'],
  'ul_discover': ['Searching apps...', 'Querying library...', 'Matching...'],
  'file_read': ['Reading file...'],
  'file_write': ['Writing file...'],
  'file_edit': ['Editing file...'],
  'shell_exec': ['Running command...', 'Waiting for output...'],
  'git': ['Running git...'],
  'spawn_agent': ['Creating agent...', 'Initializing...'],
};

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '...' : s;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export default function ToolCallCard({ toolCall, result, executing }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);
  const autoExpanded = useRef(false);
  const startTimeRef = useRef<number>(Date.now());
  const [elapsed, setElapsed] = useState(0);
  const [progressIdx, setProgressIdx] = useState(0);

  // Parse arguments
  const parsedArgs = useMemo(() => {
    try {
      return JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
    } catch {
      return {} as Record<string, unknown>;
    }
  }, [toolCall.function.arguments]);

  const name = toolCall.function.name;
  const info = TOOL_INFO[name] || { label: name, icon: 'app' as const };
  const isAppCall = name === 'ul_call';
  const isDiscover = name === 'ul_discover';

  // For ul_call: extract app name and formatted function call
  const { appName, fnCall } = useMemo(() => {
    if (isAppCall) return formatCallSignature(parsedArgs);
    return { appName: '', fnCall: '' };
  }, [isAppCall, parsedArgs]);

  // Display name for the card header
  const headerLabel = useMemo(() => {
    if (isAppCall) {
      return appName || info.label;
    }
    if (isDiscover) return 'Discover Apps';
    return info.label;
  }, [isAppCall, isDiscover, appName, info.label]);

  // Summary line
  const summaryText = useMemo(() => {
    if (isAppCall) return fnCall;
    if (isDiscover) return formatDiscoverSummary(parsedArgs);
    return formatToolSummary(name, parsedArgs);
  }, [isAppCall, isDiscover, name, parsedArgs, fnCall]);

  // Timer and progress message cycling
  useEffect(() => {
    if (!executing) return;
    startTimeRef.current = Date.now();
    const timer = setInterval(() => {
      setElapsed(Date.now() - startTimeRef.current);
      setProgressIdx(prev => prev + 1);
    }, 1500);
    return () => clearInterval(timer);
  }, [executing]);

  // Capture final elapsed time
  useEffect(() => {
    if (result && !executing) {
      setElapsed(Date.now() - startTimeRef.current);
    }
  }, [result, executing]);

  // Auto-expand when result first arrives (but don't auto-collapse)
  useEffect(() => {
    if (result && !autoExpanded.current && !executing) {
      autoExpanded.current = true;
      // Don't auto-expand for completed tool calls — keep collapsed by default
    }
  }, [result, executing]);

  // Progress message
  const progressMsgs = PROGRESS_MESSAGES[name] || ['Processing...'];
  const progressText = progressMsgs[progressIdx % progressMsgs.length];

  // Rich result renderer
  const richResult = result
    ? <ToolResultRenderer toolName={name} args={parsedArgs} result={result} />
    : null;

  // Result preview (first line or character count)
  const resultPreview = useMemo(() => {
    if (!result) return '';
    const firstLine = result.split('\n')[0].trim();
    if (firstLine.length > 80) return `${firstLine.slice(0, 80)}...`;
    if (result.length > 200) return `${firstLine} (${result.length} chars)`;
    return firstLine;
  }, [result]);

  return (
    <div className={`my-2 rounded-lg overflow-hidden border ${executing ? 'border-blue-200 bg-blue-50/20' : result ? 'border-ul-border' : 'border-ul-border'}`}>
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-50 transition-colors text-left"
      >
        {/* Status indicator */}
        {executing ? (
          <div className="w-4 h-4 rounded-full border-2 border-blue-300 border-t-blue-600 animate-spin flex-shrink-0" />
        ) : result ? (
          <svg className="w-4 h-4 text-emerald-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <div className="w-4 h-4 rounded-full border-2 border-gray-300 flex-shrink-0" />
        )}

        {/* Label + signature */}
        <div className="flex-1 min-w-0 flex items-center gap-1.5">
          <span className={`text-small font-medium flex-shrink-0 ${executing ? 'text-blue-700' : 'text-ul-text'}`}>
            {headerLabel}
          </span>
          {summaryText && (
            <span className="text-caption text-ul-text-muted font-mono truncate">
              {summaryText}
            </span>
          )}
        </div>

        {/* Timing */}
        {(result || executing) && elapsed > 0 && (
          <span className={`text-[10px] tabular-nums flex-shrink-0 ${executing ? 'text-blue-500' : 'text-ul-text-muted'}`}>
            {formatDuration(elapsed)}
          </span>
        )}

        {/* Expand/collapse */}
        <svg
          className={`w-3 h-3 text-ul-text-muted transition-transform flex-shrink-0 ${expanded ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Progress bar while executing */}
      {executing && (
        <div className="px-3 pb-2 flex items-center gap-2">
          <div className="flex-1 h-0.5 bg-blue-100 rounded-full overflow-hidden">
            <div className="h-full bg-blue-400 rounded-full animate-pulse" style={{ width: '60%' }} />
          </div>
          <span className="text-[10px] text-blue-500 flex-shrink-0">{progressText}</span>
        </div>
      )}

      {/* Collapsed result preview */}
      {result && !expanded && resultPreview && (
        <div className="px-3 pb-2 pt-0">
          <span className="text-[11px] text-ul-text-muted truncate block">{resultPreview}</span>
        </div>
      )}

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-ul-border">
          {/* Rich result or raw fallback */}
          {result && richResult ? (
            <div className="p-2.5">
              {richResult}
            </div>
          ) : result ? (
            <div className="p-2.5">
              <pre className="text-xs font-mono bg-gray-50 rounded-md p-2.5 overflow-x-auto whitespace-pre-wrap max-h-60 overflow-y-auto text-ul-text-secondary border border-gray-100">
                {result.length > 3000 ? result.slice(0, 3000) + '\n... (truncated)' : result}
              </pre>
            </div>
          ) : executing ? (
            <div className="px-3 py-3">
              <div className="flex items-center gap-2 text-caption text-blue-600">
                <div className="w-3.5 h-3.5 rounded-full border-2 border-blue-300 border-t-blue-600 animate-spin" />
                {progressText}
              </div>
            </div>
          ) : null}

          {/* Raw args — collapsed by default inside expanded view */}
          <details className="border-t border-gray-100">
            <summary className="px-3 py-1.5 text-[11px] text-ul-text-muted cursor-pointer hover:bg-gray-50 transition-colors select-none">
              Raw Arguments
            </summary>
            <pre className="px-3 py-2 text-xs font-mono bg-gray-50 overflow-x-auto whitespace-pre-wrap text-ul-text-secondary">
              {JSON.stringify(parsedArgs, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </div>
  );
}
