// Tool call card — inline display of a tool invocation and its result.
// Uses rich renderers for known tools, falls back to raw text.

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

/** Map tool names to friendly display names */
const FRIENDLY_NAMES: Record<string, string> = {
  // Platform tools
  'ul_discover': 'Discover Apps',
  'ul_call': 'Call App',
  'ul_memory': 'Memory',
  // Local tools
  'file_read': 'Read File',
  'file_write': 'Write File',
  'file_edit': 'Edit File',
  'glob': 'Find Files',
  'grep': 'Search Code',
  'ls': 'List Directory',
  'shell_exec': 'Run Command',
  'git': 'Git',
  // Subagent tools
  'spawn_agent': 'Spawn Agent',
  'check_agent': 'Check Agent',
  'update_card_status': 'Update Card',
};

/** Get a compact summary of args for the collapsed header */
function argsSummary(name: string, args: Record<string, unknown>): string {
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
      return truncate(String(args.command || ''), 50);
    case 'git': {
      const sub = String(args.subcommand || '');
      const gitArgs = Array.isArray(args.args) ? (args.args as string[]).join(' ') : '';
      return truncate(`${sub} ${gitArgs}`.trim(), 50);
    }
    case 'ul_discover':
      return String(args.query || args.search || '');
    case 'ul_call':
      return String(args.app || args.function || '');
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

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '...' : s;
}

export default function ToolCallCard({ toolCall, result, executing }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);
  const autoExpanded = useRef(false);

  // Parse arguments
  const parsedArgs = useMemo(() => {
    try {
      return JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
    } catch {
      return {} as Record<string, unknown>;
    }
  }, [toolCall.function.arguments]);

  const name = toolCall.function.name;
  const friendly = FRIENDLY_NAMES[name] || name;
  const summary = argsSummary(name, parsedArgs);

  // Auto-expand when result first arrives
  useEffect(() => {
    if (result && !autoExpanded.current && !executing) {
      autoExpanded.current = true;
      setExpanded(true);
    }
  }, [result, executing]);

  // Attempt rich rendering
  const richResult = result
    ? <ToolResultRenderer toolName={name} args={parsedArgs} result={result} />
    : null;

  return (
    <div className="my-2 rounded-md overflow-hidden border border-ul-border">
      {/* Header — always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-1.5 bg-ul-bg-subtle hover:bg-ul-bg-hover transition-colors text-left"
      >
        {/* Status indicator */}
        {executing ? (
          <div className="w-3 h-3 rounded-full border-2 border-ul-text-muted border-t-ul-text animate-spin flex-shrink-0" />
        ) : result ? (
          <svg className="w-3.5 h-3.5 text-ul-success flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <div className="w-3 h-3 rounded-full bg-ul-text-muted flex-shrink-0" />
        )}

        {/* Tool name */}
        <span className="text-small font-medium text-ul-text flex-shrink-0">
          {friendly}
        </span>

        {/* Args summary */}
        {summary && (
          <span className="text-caption text-ul-text-muted font-mono truncate">
            {summary}
          </span>
        )}

        {/* Expand/collapse */}
        <svg
          className={`w-3 h-3 ml-auto text-ul-text-muted transition-transform flex-shrink-0 ${expanded ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-ul-border">
          {/* Rich result or raw fallback */}
          {result && richResult ? (
            <div className="p-2">
              {richResult}
            </div>
          ) : result ? (
            <div className="p-2">
              <pre className="text-xs font-mono bg-ul-bg-raised rounded p-2 overflow-x-auto whitespace-pre-wrap max-h-48 overflow-y-auto text-ul-text-secondary">
                {result.length > 3000 ? result.slice(0, 3000) + '\n... (truncated)' : result}
              </pre>
            </div>
          ) : executing ? (
            <div className="px-3 py-2">
              <div className="flex items-center gap-2 text-caption text-ul-text-muted">
                <div className="w-3 h-3 rounded-full border-2 border-ul-text-muted border-t-ul-text animate-spin" />
                Executing...
              </div>
            </div>
          ) : null}

          {/* Raw args — collapsed by default inside expanded view */}
          <details className="border-t border-ul-border">
            <summary className="px-3 py-1 text-caption text-ul-text-muted cursor-pointer hover:bg-ul-bg-subtle transition-colors">
              Arguments
            </summary>
            <pre className="px-3 py-2 text-xs font-mono bg-ul-bg-raised overflow-x-auto whitespace-pre-wrap text-ul-text-secondary">
              {JSON.stringify(parsedArgs, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </div>
  );
}
