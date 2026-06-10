// Terminal-style block for shell_exec and git results.
// Dark background, monospace, optional command header.

import { useState } from 'react';

interface TerminalBlockProps {
  output: string;
  command?: string;
  /** Exit code if command failed */
  exitCode?: number;
  maxLines?: number;
}

/** Parse ANSI-ish color hints from git output */
function colorizeGitDiff(line: string): { text: string; className: string } {
  // Git diff coloring
  if (line.startsWith('+') && !line.startsWith('+++')) {
    return { text: line, className: 'text-green-400' };
  }
  if (line.startsWith('-') && !line.startsWith('---')) {
    return { text: line, className: 'text-red-400' };
  }
  if (line.startsWith('@@')) {
    return { text: line, className: 'text-cyan-400' };
  }
  if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++')) {
    return { text: line, className: 'text-yellow-300/70' };
  }
  // Git status coloring
  if (/^\s*M\s/.test(line) || line.startsWith('\tmodified:')) {
    return { text: line, className: 'text-yellow-300' };
  }
  if (/^\s*A\s/.test(line) || line.startsWith('\tnew file:')) {
    return { text: line, className: 'text-green-400' };
  }
  if (/^\s*D\s/.test(line) || line.startsWith('\tdeleted:')) {
    return { text: line, className: 'text-red-400' };
  }
  if (/^\?\?\s/.test(line)) {
    return { text: line, className: 'text-gray-400' };
  }
  // stderr marker
  if (line === '[stderr]') {
    return { text: line, className: 'text-red-400 font-bold' };
  }
  // Exit code marker
  if (line.startsWith('[exit code')) {
    return { text: line, className: 'text-red-400' };
  }
  return { text: line, className: 'text-gray-200' };
}

export default function TerminalBlock({ output, command, exitCode, maxLines = 30 }: TerminalBlockProps) {
  const [expanded, setExpanded] = useState(false);

  const allLines = output.split('\n');
  const totalLines = allLines.length;
  const shouldCollapse = totalLines > maxLines && !expanded;
  const visibleLines = shouldCollapse ? allLines.slice(0, maxLines) : allLines;

  const isError = exitCode !== undefined && exitCode !== 0;

  return (
    <div className={`rounded-md overflow-hidden border ${isError ? 'border-red-300' : 'border-ul-border'}`}>
      {/* Command header */}
      {command && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-[#2d2d2d] border-b border-white/10">
          <span className="text-green-400 text-xs font-bold">$</span>
          <span className="text-caption font-mono text-gray-300 truncate">{command}</span>
          {exitCode !== undefined && (
            <span className={`text-caption ml-auto px-1.5 py-0.5 rounded ${isError ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'}`}>
              {isError ? `exit ${exitCode}` : 'ok'}
            </span>
          )}
        </div>
      )}

      {/* Output */}
      <div className="overflow-x-auto bg-[#1e1e1e] px-3 py-2">
        {visibleLines.map((line, i) => {
          const { text, className } = colorizeGitDiff(line);
          return (
            <div key={i} className={`text-xs font-mono whitespace-pre ${className}`}>
              {text || '\u00A0'}
            </div>
          );
        })}
      </div>

      {/* Collapse/expand */}
      {totalLines > maxLines && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full px-3 py-1 text-caption text-gray-400 bg-[#252525] hover:bg-[#2a2a2a] border-t border-white/10 transition-colors"
        >
          {expanded ? 'Show less' : `Show ${totalLines - maxLines} more lines`}
        </button>
      )}
    </div>
  );
}
