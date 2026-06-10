// Permission system — controls which tool calls need user approval.
// Mirrors Claude Code's 4-level permission model.

// ── Permission Levels ──

export type PermissionLevel = 'ask' | 'auto_edit' | 'plan' | 'bypass';

export const PERMISSION_LEVELS: { value: PermissionLevel; label: string; description: string }[] = [
  {
    value: 'auto_edit',
    label: 'Auto-edit',
    description: 'Auto-approve file reads/writes, ask for shell & git mutations',
  },
  {
    value: 'ask',
    label: 'Ask always',
    description: 'Ask before every write operation',
  },
  {
    value: 'plan',
    label: 'Plan mode',
    description: 'Read-only — block all write tools',
  },
  {
    value: 'bypass',
    label: 'YOLO',
    description: 'Auto-approve everything (use with caution)',
  },
];

// ── Read-Only Tools ──

/** Tools that never modify anything — always auto-approved */
const READ_ONLY_TOOLS = new Set([
  'file_read',
  'glob',
  'grep',
  'ls',
]);

/** Git subcommands that are read-only */
const READ_ONLY_GIT = new Set([
  'status',
  'diff',
  'log',
  'show',
  'branch',
  'remote',
  'stash list',
  'tag',
  'blame',
  'shortlog',
]);

/** Tools that write files but don't execute arbitrary code */
const FILE_WRITE_TOOLS = new Set([
  'file_write',
  'file_edit',
]);

// ── Core Logic ──

export function isReadOnlyTool(name: string, args?: Record<string, unknown>): boolean {
  if (READ_ONLY_TOOLS.has(name)) return true;

  // Git with a read-only subcommand
  if (name === 'git' && args?.subcommand) {
    const sub = String(args.subcommand).toLowerCase();
    return READ_ONLY_GIT.has(sub);
  }

  // MCP platform tools are read-only from local perspective
  if (name.startsWith('ul_')) return true;

  return false;
}

export function isFileWriteTool(name: string): boolean {
  return FILE_WRITE_TOOLS.has(name);
}

/**
 * Determine if a tool call needs user permission at the given level.
 * Returns: 'allow' | 'ask' | 'deny'
 */
export function checkPermission(
  level: PermissionLevel,
  toolName: string,
  args?: Record<string, unknown>,
): 'allow' | 'ask' | 'deny' {
  // Read-only tools are always allowed (except in plan mode they're still allowed)
  if (isReadOnlyTool(toolName, args)) {
    return 'allow';
  }

  switch (level) {
    case 'bypass':
      return 'allow';

    case 'auto_edit':
      // Auto-approve file writes, ask for shell/git mutations
      if (isFileWriteTool(toolName)) return 'allow';
      return 'ask';

    case 'ask':
      return 'ask';

    case 'plan':
      // Block all non-read-only operations
      return 'deny';

    default:
      return 'ask';
  }
}

// ── Display Helpers ──

/** Build a human-readable description of what the tool call will do */
export function buildDescription(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case 'file_write':
      return `Write to ${args.path || 'file'}`;
    case 'file_edit':
      return `Edit ${args.path || 'file'}`;
    case 'shell_exec':
      return `Run: ${truncate(String(args.command || ''), 80)}`;
    case 'git': {
      const sub = String(args.subcommand || '');
      const extra = Array.isArray(args.args) ? args.args.join(' ') : '';
      return `git ${sub}${extra ? ' ' + truncate(extra, 60) : ''}`;
    }
    default:
      return `${name}(${Object.keys(args).join(', ')})`;
  }
}

/** Get a risk-level color hint for the tool */
export function getRiskLevel(name: string, args?: Record<string, unknown>): 'safe' | 'moderate' | 'high' {
  if (isReadOnlyTool(name, args)) return 'safe';
  if (isFileWriteTool(name)) return 'moderate';
  // shell_exec and mutating git = high
  return 'high';
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…' : s;
}
