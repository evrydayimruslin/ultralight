// Renders file content with line numbers and a file header.
// Used by file_read results.

import { useState } from 'react';

interface CodeBlockProps {
  content: string;
  filename?: string;
  /** Max lines to show before collapsing (default: 25) */
  maxLines?: number;
}

/** Detect language from file extension for future syntax highlighting */
function detectLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    rs: 'rust', py: 'python', rb: 'ruby', go: 'go', java: 'java',
    css: 'css', scss: 'css', html: 'html', vue: 'html',
    json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml',
    md: 'markdown', sql: 'sql', sh: 'shell', bash: 'shell',
    dockerfile: 'docker', xml: 'xml', svg: 'xml',
  };
  return map[ext] || 'text';
}

export default function CodeBlock({ content, filename, maxLines = 25 }: CodeBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const lang = filename ? detectLanguage(filename) : 'text';

  // Parse lines — content from file_read has "{:>6}\t{line}" format
  const rawLines = content.split('\n').filter(l => l.length > 0 || content.endsWith('\n'));
  const hasLineNumbers = rawLines.length > 0 && /^\s*\d+\t/.test(rawLines[0]);

  const parsedLines = rawLines.map(raw => {
    if (hasLineNumbers) {
      const tabIdx = raw.indexOf('\t');
      if (tabIdx !== -1) {
        return {
          num: raw.slice(0, tabIdx).trim(),
          text: raw.slice(tabIdx + 1),
        };
      }
    }
    return { num: '', text: raw };
  });

  const totalLines = parsedLines.length;
  const shouldCollapse = totalLines > maxLines && !expanded;
  const visibleLines = shouldCollapse ? parsedLines.slice(0, maxLines) : parsedLines;

  return (
    <div className="rounded-md overflow-hidden border border-ul-border">
      {/* File header */}
      {filename && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 border-b border-ul-border">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-ul-text-muted flex-shrink-0">
            <path d="M9 1H4a1 1 0 00-1 1v12a1 1 0 001 1h8a1 1 0 001-1V5L9 1z" />
            <path d="M9 1v4h4" />
          </svg>
          <span className="text-caption font-mono text-ul-text-secondary truncate">{filename}</span>
          <span className="text-caption text-ul-text-muted ml-auto">{totalLines} lines</span>
          <span className="text-caption text-ul-text-muted px-1.5 py-0.5 bg-gray-200 rounded">{lang}</span>
        </div>
      )}

      {/* Code area */}
      <div className="overflow-x-auto bg-[#1e1e1e]">
        <table className="w-full border-collapse" style={{ tableLayout: 'auto' }}>
          <tbody>
            {visibleLines.map((line, i) => (
              <tr key={i} className="hover:bg-white/5">
                {hasLineNumbers && (
                  <td className="text-right pr-3 pl-3 py-0 select-none text-[#858585] text-xs font-mono whitespace-nowrap border-r border-white/10" style={{ width: '1%' }}>
                    {line.num}
                  </td>
                )}
                <td className="pl-3 pr-4 py-0 text-[#d4d4d4] text-xs font-mono whitespace-pre">
                  {line.text}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Collapse/expand */}
      {totalLines > maxLines && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full px-3 py-1 text-caption text-ul-text-secondary bg-gray-50 hover:bg-gray-100 border-t border-ul-border transition-colors"
        >
          {expanded ? 'Show less' : `Show ${totalLines - maxLines} more lines`}
        </button>
      )}
    </div>
  );
}
