// Tool result dispatcher — routes tool output to the appropriate rich renderer.
// Falls back to raw text for unrecognized tools or parse failures.

import CodeBlock from './CodeBlock';
import DiffView from './DiffView';
import TerminalBlock from './TerminalBlock';
import FileList from './FileList';
import WriteConfirmation from './WriteConfirmation';

interface ToolResultRendererProps {
  toolName: string;
  args: Record<string, unknown>;
  result: string;
}

/**
 * Renders a tool result using the appropriate rich renderer.
 * Returns null if no rich renderer is available (caller should fall back to raw text).
 */
export default function ToolResultRenderer({ toolName, args, result }: ToolResultRendererProps) {
  // Don't rich-render error messages — show them raw
  if (result.startsWith('Tool error:') || result.startsWith('Permission denied')) {
    return null;
  }

  switch (toolName) {
    case 'file_read': {
      const filename = String(args.path || '');
      // Check for error responses
      if (result.startsWith('(file has') || result.startsWith('Not a file')) return null;
      return <CodeBlock content={result} filename={filename} />;
    }

    case 'file_edit': {
      const filename = String(args.path || '');
      const oldString = String(args.old_string || '');
      const newString = String(args.new_string || '');
      // Only show diff if the edit succeeded
      if (result.startsWith('Edited ')) {
        return <DiffView filename={filename} oldString={oldString} newString={newString} resultMessage={result} />;
      }
      return null; // Error — fall back to raw text
    }

    case 'file_write': {
      const filename = String(args.path || '');
      const content = String(args.content || '');
      if (result.startsWith('Wrote ')) {
        return <WriteConfirmation filename={filename} content={content} resultMessage={result} />;
      }
      return null;
    }

    case 'glob': {
      return <FileList content={result} mode="glob" />;
    }

    case 'grep': {
      const pattern = String(args.pattern || '');
      return <FileList content={result} mode="grep" pattern={pattern} />;
    }

    case 'ls': {
      return <FileList content={result} mode="ls" />;
    }

    case 'shell_exec': {
      const command = String(args.command || '');
      // Parse exit code from result
      let exitCode: number | undefined;
      const exitMatch = result.match(/^\[exit code (\d+)\]/);
      if (exitMatch) {
        exitCode = parseInt(exitMatch[1], 10);
      } else if (!result.startsWith('(command completed')) {
        exitCode = 0; // Success
      }
      return <TerminalBlock output={result} command={command} exitCode={exitCode} />;
    }

    case 'git': {
      const subcommand = String(args.subcommand || '');
      const gitArgs = Array.isArray(args.args) ? (args.args as string[]).join(' ') : '';
      const fullCommand = `git ${subcommand}${gitArgs ? ' ' + gitArgs : ''}`;

      // Parse exit code if present
      let exitCode: number | undefined;
      const exitMatch = result.match(/^\[exit code (\d+)\]/);
      if (exitMatch) {
        exitCode = parseInt(exitMatch[1], 10);
      } else if (result !== '(no output)') {
        exitCode = 0;
      }

      return <TerminalBlock output={result} command={fullCommand} exitCode={exitCode} />;
    }

    // ── Agent Tools ──

    case 'spawn_agent': {
      try {
        const data = JSON.parse(result);
        if (data.error) return null;
        return (
          <div className="flex items-center gap-3 p-3 bg-ul-bg-secondary rounded-lg border border-ul-border">
            <div className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-small font-medium text-ul-text-primary">
                  {String(args.name || 'Agent')}
                </span>
                <span className="text-caption px-1.5 py-0.5 rounded bg-ul-bg-tertiary text-ul-text-secondary">
                  {String(args.role || 'general')}
                </span>
              </div>
              <p className="text-caption text-ul-text-muted mt-0.5 truncate">
                {String(args.task || '').slice(0, 120)}
              </p>
            </div>
            <span className="text-caption text-green-600 font-medium shrink-0">Running</span>
          </div>
        );
      } catch {
        return null;
      }
    }

    case 'check_agent': {
      try {
        const data = JSON.parse(result);
        if (data.error) return null;
        const statusColor =
          data.status === 'running' ? 'bg-green-500' :
          data.status === 'completed' ? 'bg-blue-500' :
          data.status === 'error' ? 'bg-red-500' : 'bg-gray-400';
        const statusLabel =
          data.status === 'running' ? 'text-green-600' :
          data.status === 'completed' ? 'text-blue-600' :
          data.status === 'error' ? 'text-red-600' : 'text-ul-text-muted';
        return (
          <div className="p-3 bg-ul-bg-secondary rounded-lg border border-ul-border">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${statusColor} shrink-0`} />
              <span className="text-small font-medium text-ul-text-primary">{data.name}</span>
              <span className="text-caption px-1.5 py-0.5 rounded bg-ul-bg-tertiary text-ul-text-secondary">
                {data.role}
              </span>
              <span className={`text-caption ${statusLabel} ml-auto font-medium`}>{data.status}</span>
            </div>
            {data.task && (
              <p className="text-caption text-ul-text-muted mt-1 truncate">{data.task}</p>
            )}
            {data.recent_messages?.length > 0 && (
              <div className="mt-2 space-y-1 border-t border-ul-border pt-2">
                {data.recent_messages.map((msg: { role: string; content: string }, i: number) => (
                  <div key={i} className="text-caption text-ul-text-secondary">
                    <span className="font-medium">{msg.role}:</span>{' '}
                    <span className="text-ul-text-muted">{msg.content.slice(0, 200)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      } catch {
        return null;
      }
    }

    case 'update_card_status': {
      try {
        const data = JSON.parse(result);
        return (
          <div className="flex items-center gap-2 p-2 bg-ul-bg-secondary rounded border border-ul-border">
            <span className="text-small text-green-600">✓</span>
            <span className="text-small text-ul-text-primary">{data.message}</span>
          </div>
        );
      } catch {
        return null;
      }
    }

    default:
      return null; // Unknown tool — fall back to raw text
  }
}
