// Renders a confirmation card for file_write results.
// Shows the file path, bytes written, and a preview of the content.

interface WriteConfirmationProps {
  filename: string;
  content: string;
  resultMessage: string;
}

export default function WriteConfirmation({ filename, content, resultMessage }: WriteConfirmationProps) {
  // Show a small preview of what was written
  const previewLines = content.split('\n').slice(0, 5);
  const totalLines = content.split('\n').length;
  const hasMore = totalLines > 5;

  return (
    <div className="rounded-md overflow-hidden border border-green-200">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-green-50 border-b border-green-200">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-green-600 flex-shrink-0">
          <path d="M9 1H4a1 1 0 00-1 1v12a1 1 0 001 1h8a1 1 0 001-1V5L9 1z" />
          <path d="M9 1v4h4" />
          <path d="M6 9l2 2 3-3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="text-caption font-mono text-green-800 truncate">{filename}</span>
        <span className="text-caption text-green-600 ml-auto">{resultMessage}</span>
      </div>

      {/* Preview */}
      <div className="overflow-x-auto bg-[#1e1e1e] px-3 py-2">
        {previewLines.map((line, i) => (
          <div key={i} className="text-xs font-mono text-green-300/80 whitespace-pre">
            <span className="text-green-500/50 mr-2">+</span>{line}
          </div>
        ))}
        {hasMore && (
          <div className="text-xs font-mono text-gray-500 mt-1">
            ... {totalLines - 5} more lines
          </div>
        )}
      </div>
    </div>
  );
}
