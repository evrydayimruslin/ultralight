// Tool call card — inline display of a tool invocation and its result.

import { useState } from 'react';
import type { AccumulatedToolCall } from '../lib/sse';

interface ToolCallCardProps {
  toolCall: AccumulatedToolCall;
  /** The tool result message content (if available) */
  result?: string;
  /** Whether the tool is currently executing */
  executing?: boolean;
}

export default function ToolCallCard({ toolCall, result, executing }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);

  // Parse arguments for display
  let argsDisplay: string;
  try {
    const parsed = JSON.parse(toolCall.function.arguments);
    argsDisplay = JSON.stringify(parsed, null, 2);
  } catch {
    argsDisplay = toolCall.function.arguments;
  }

  // Map tool names to friendly display
  const friendlyName = (name: string) => {
    const map: Record<string, string> = {
      'ul_discover': 'Discover Apps',
      'ul_call': 'Call App',
      'ul_memory': 'Memory',
    };
    return map[name] || name;
  };

  return (
    <div className="my-2 border border-ul-border rounded-md overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-ul-bg-subtle hover:bg-ul-bg-hover transition-colors text-left"
      >
        {/* Status indicator */}
        {executing ? (
          <div className="w-3 h-3 rounded-full border-2 border-ul-text-muted border-t-ul-text animate-spin" />
        ) : result ? (
          <svg className="w-3.5 h-3.5 text-ul-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <div className="w-3 h-3 rounded-full bg-ul-text-muted" />
        )}

        <span className="text-small font-medium text-ul-text">
          {friendlyName(toolCall.function.name)}
        </span>

        <span className="text-caption text-ul-text-muted font-mono">
          {toolCall.function.name}
        </span>

        <svg
          className={`w-3 h-3 ml-auto text-ul-text-muted transition-transform ${expanded ? 'rotate-180' : ''}`}
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
        <div className="px-3 py-2 border-t border-ul-border space-y-2">
          {/* Arguments */}
          <div>
            <span className="text-caption text-ul-text-muted block mb-1">Arguments</span>
            <pre className="text-caption font-mono bg-ul-bg-raised rounded p-2 overflow-x-auto whitespace-pre-wrap">
              {argsDisplay}
            </pre>
          </div>

          {/* Result */}
          {result && (
            <div>
              <span className="text-caption text-ul-text-muted block mb-1">Result</span>
              <pre className="text-caption font-mono bg-ul-bg-raised rounded p-2 overflow-x-auto whitespace-pre-wrap max-h-40 overflow-y-auto">
                {result.length > 2000 ? result.slice(0, 2000) + '...' : result}
              </pre>
            </div>
          )}

          {executing && (
            <p className="text-caption text-ul-text-muted italic">Executing...</p>
          )}
        </div>
      )}
    </div>
  );
}
