// Renders a side-by-side or inline diff for file_edit results.
// Shows old_string (removed) and new_string (added) from the tool args.

interface DiffViewProps {
  filename: string;
  oldString: string;
  newString: string;
  resultMessage: string;
}

function DiffLine({ type, content }: { type: '+' | '-' | ' '; content: string }) {
  const styles = {
    '+': 'bg-green-50 text-green-800 before:content-["+"] before:text-green-500',
    '-': 'bg-red-50 text-red-800 before:content-["-"] before:text-red-500 line-through decoration-red-300',
    ' ': 'text-ul-text-secondary',
  };

  return (
    <div className={`px-3 py-0 text-xs font-mono whitespace-pre ${styles[type]} before:inline-block before:w-4 before:mr-2 before:text-center before:font-bold`}>
      {content}
    </div>
  );
}

export default function DiffView({ filename, oldString, newString, resultMessage }: DiffViewProps) {
  const oldLines = oldString.split('\n');
  const newLines = newString.split('\n');

  return (
    <div className="rounded-md overflow-hidden border border-ul-border">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-100 border-b border-ul-border">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-amber-500 flex-shrink-0">
          <path d="M11 1H4a1 1 0 00-1 1v12a1 1 0 001 1h8a1 1 0 001-1V5L9 1z" />
          <circle cx="8" cy="9" r="1.5" />
          <path d="M8 6v1" />
        </svg>
        <span className="text-caption font-mono text-ul-text-secondary truncate">{filename}</span>
        <span className="text-caption text-ul-text-muted ml-auto">{resultMessage}</span>
      </div>

      {/* Diff content */}
      <div className="overflow-x-auto bg-white">
        {/* Removed lines */}
        {oldLines.map((line, i) => (
          <DiffLine key={`old-${i}`} type="-" content={line} />
        ))}

        {/* Separator */}
        <div className="border-t border-dashed border-ul-border my-0.5" />

        {/* Added lines */}
        {newLines.map((line, i) => (
          <DiffLine key={`new-${i}`} type="+" content={line} />
        ))}
      </div>
    </div>
  );
}
