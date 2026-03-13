// Project directory indicator — shows the current working directory
// and allows changing it via a folder picker.

interface ProjectDirIndicatorProps {
  projectDir: string | null;
  onPickDirectory: () => void;
}

export default function ProjectDirIndicator({
  projectDir,
  onPickDirectory,
}: ProjectDirIndicatorProps) {
  // Show just the last segment of the path for brevity
  const displayPath = projectDir
    ? projectDir.split('/').filter(Boolean).slice(-2).join('/')
    : null;

  return (
    <button
      onClick={onPickDirectory}
      className="flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-ul-bg-hover transition-colors text-left max-w-[200px]"
      title={projectDir || 'No project directory selected — click to open a folder'}
    >
      {/* Folder icon */}
      <svg
        className="w-3.5 h-3.5 text-ul-text-muted flex-shrink-0"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
        />
      </svg>

      {displayPath ? (
        <span className="text-caption text-ul-text-secondary truncate">
          {displayPath}
        </span>
      ) : (
        <span className="text-caption text-ul-text-muted italic">
          Open folder…
        </span>
      )}
    </button>
  );
}
