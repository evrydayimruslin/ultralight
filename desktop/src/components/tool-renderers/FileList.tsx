// Renders file listing results from glob, ls, and grep tools.
// Shows icons based on file type and optional match highlighting.

interface FileListProps {
  content: string;
  mode: 'glob' | 'ls' | 'grep';
  pattern?: string;
}

/** Get a color class for a file extension */
function extColor(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const colors: Record<string, string> = {
    ts: 'text-blue-500', tsx: 'text-blue-400',
    js: 'text-yellow-500', jsx: 'text-yellow-400',
    rs: 'text-orange-500',
    py: 'text-green-500',
    json: 'text-yellow-600', yaml: 'text-pink-500', yml: 'text-pink-500', toml: 'text-orange-400',
    css: 'text-purple-500', scss: 'text-purple-400',
    html: 'text-red-500',
    md: 'text-gray-500',
    sh: 'text-green-600',
  };
  return colors[ext] || 'text-ul-text-muted';
}

function FileIcon({ isDir }: { isDir: boolean }) {
  if (isDir) {
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-amber-500 flex-shrink-0">
        <path d="M2 3h4l2 2h6v8H2V3z" fill="currentColor" opacity="0.2" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" className="text-ul-text-muted flex-shrink-0">
      <path d="M9 1H4a1 1 0 00-1 1v12a1 1 0 001 1h8a1 1 0 001-1V5L9 1z" />
      <path d="M9 1v4h4" />
    </svg>
  );
}

function GlobResult({ content }: { content: string }) {
  const files = content.split('\n').filter(Boolean);

  if (files.length === 1 && files[0].startsWith('No files')) {
    return <div className="px-3 py-2 text-caption text-ul-text-muted italic">{files[0]}</div>;
  }

  return (
    <div className="divide-y divide-gray-50">
      {files.map((file, i) => {
        const isDir = file.endsWith('/');
        return (
          <div key={i} className="flex items-center gap-2 px-3 py-1 hover:bg-gray-50 transition-colors">
            <FileIcon isDir={isDir} />
            <span className={`text-xs font-mono ${extColor(file)}`}>{file}</span>
          </div>
        );
      })}
    </div>
  );
}

function LsResult({ content }: { content: string }) {
  const lines = content.split('\n').filter(Boolean);

  if (lines.length === 1 && lines[0].includes('empty directory')) {
    return <div className="px-3 py-2 text-caption text-ul-text-muted italic">{lines[0]}</div>;
  }

  return (
    <div className="divide-y divide-gray-50">
      {lines.map((line, i) => {
        const trimmed = line.trim();
        const isDir = trimmed.endsWith('/');
        // Parse "  filename  (size)" format
        const sizeMatch = trimmed.match(/^(.+?)\s+\((.+?)\)$/);
        const name = isDir ? trimmed : (sizeMatch ? sizeMatch[1] : trimmed);
        const size = sizeMatch ? sizeMatch[2] : null;

        return (
          <div key={i} className="flex items-center gap-2 px-3 py-1 hover:bg-gray-50 transition-colors">
            <FileIcon isDir={isDir} />
            <span className={`text-xs font-mono flex-1 ${isDir ? 'text-amber-700 font-medium' : extColor(name)}`}>
              {name}
            </span>
            {size && <span className="text-caption text-ul-text-muted">{size}</span>}
          </div>
        );
      })}
    </div>
  );
}

function GrepResult({ content, pattern }: { content: string; pattern?: string }) {
  const lines = content.split('\n').filter(Boolean);

  if (lines.length === 1 && lines[0].startsWith('No matches')) {
    return <div className="px-3 py-2 text-caption text-ul-text-muted italic">{lines[0]}</div>;
  }

  // Group by file
  const groups = new Map<string, { lineNum: string; text: string }[]>();
  for (const line of lines) {
    if (line.startsWith('...')) {
      // Truncation marker
      continue;
    }
    const firstColon = line.indexOf(':');
    const secondColon = line.indexOf(':', firstColon + 1);
    if (firstColon === -1 || secondColon === -1) continue;

    const file = line.slice(0, firstColon);
    const lineNum = line.slice(firstColon + 1, secondColon);
    const text = line.slice(secondColon + 1);

    if (!groups.has(file)) groups.set(file, []);
    groups.get(file)!.push({ lineNum, text });
  }

  // Try to build a regex for highlighting
  let highlightRe: RegExp | null = null;
  if (pattern) {
    try {
      highlightRe = new RegExp(`(${pattern})`, 'gi');
    } catch {
      // Invalid regex, skip highlighting
    }
  }

  return (
    <div className="divide-y divide-ul-border">
      {Array.from(groups.entries()).map(([file, matches]) => (
        <div key={file}>
          {/* File header */}
          <div className="flex items-center gap-2 px-3 py-1 bg-gray-50">
            <FileIcon isDir={false} />
            <span className={`text-xs font-mono font-medium ${extColor(file)}`}>{file}</span>
            <span className="text-caption text-ul-text-muted">{matches.length} match{matches.length !== 1 ? 'es' : ''}</span>
          </div>
          {/* Matches */}
          {matches.map((m, i) => (
            <div key={i} className="flex gap-0 px-0 hover:bg-blue-50/50 transition-colors">
              <span className="text-xs font-mono text-ul-text-muted text-right px-2 py-0.5 bg-gray-50 border-r border-ul-border select-none" style={{ minWidth: '3rem' }}>
                {m.lineNum}
              </span>
              <span className="text-xs font-mono text-ul-text px-2 py-0.5 whitespace-pre overflow-hidden text-ellipsis">
                {highlightRe
                  ? m.text.split(highlightRe).map((part, j) =>
                      j % 2 === 1
                        ? <mark key={j} className="bg-yellow-200 text-yellow-900 rounded-sm px-0.5">{part}</mark>
                        : part
                    )
                  : m.text
                }
              </span>
            </div>
          ))}
        </div>
      ))}
      {lines.some(l => l.startsWith('...')) && (
        <div className="px-3 py-1 text-caption text-ul-text-muted italic bg-gray-50">
          Results truncated
        </div>
      )}
    </div>
  );
}

export default function FileList({ content, mode, pattern }: FileListProps) {
  const count = content.split('\n').filter(Boolean).length;
  const isNoResults = content.startsWith('No ');

  return (
    <div className="rounded-md overflow-hidden border border-ul-border">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 border-b border-ul-border">
        {mode === 'grep' ? (
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-ul-text-muted flex-shrink-0">
            <circle cx="7" cy="7" r="4" />
            <path d="M10 10l3.5 3.5" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="text-amber-500 flex-shrink-0">
            <path d="M2 3h4l2 2h6v8H2V3z" fill="currentColor" opacity="0.2" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        )}
        <span className="text-caption text-ul-text-secondary">
          {mode === 'grep' ? 'Search results' : mode === 'glob' ? 'Matching files' : 'Directory listing'}
        </span>
        {!isNoResults && (
          <span className="text-caption text-ul-text-muted ml-auto">
            {mode === 'grep' ? `${count} results` : `${count} items`}
          </span>
        )}
      </div>

      {/* Content */}
      <div className="max-h-64 overflow-y-auto bg-white">
        {mode === 'glob' && <GlobResult content={content} />}
        {mode === 'ls' && <LsResult content={content} />}
        {mode === 'grep' && <GrepResult content={content} pattern={pattern} />}
      </div>
    </div>
  );
}
