// Tests for the permission system core logic.

import { describe, it, expect } from 'vitest';
import {
  checkPermission,
  isReadOnlyTool,
  isFileWriteTool,
  buildDescription,
  getRiskLevel,
  type PermissionLevel,
} from './permissions';

// ── isReadOnlyTool ──

describe('isReadOnlyTool', () => {
  it('classifies filesystem read tools as read-only', () => {
    expect(isReadOnlyTool('file_read')).toBe(true);
    expect(isReadOnlyTool('glob')).toBe(true);
    expect(isReadOnlyTool('grep')).toBe(true);
    expect(isReadOnlyTool('ls')).toBe(true);
  });

  it('classifies write tools as NOT read-only', () => {
    expect(isReadOnlyTool('file_write')).toBe(false);
    expect(isReadOnlyTool('file_edit')).toBe(false);
    expect(isReadOnlyTool('shell_exec')).toBe(false);
  });

  it('classifies read-only git subcommands', () => {
    expect(isReadOnlyTool('git', { subcommand: 'status' })).toBe(true);
    expect(isReadOnlyTool('git', { subcommand: 'diff' })).toBe(true);
    expect(isReadOnlyTool('git', { subcommand: 'log' })).toBe(true);
    expect(isReadOnlyTool('git', { subcommand: 'show' })).toBe(true);
    expect(isReadOnlyTool('git', { subcommand: 'branch' })).toBe(true);
    expect(isReadOnlyTool('git', { subcommand: 'remote' })).toBe(true);
  });

  it('classifies mutating git subcommands as NOT read-only', () => {
    expect(isReadOnlyTool('git', { subcommand: 'commit' })).toBe(false);
    expect(isReadOnlyTool('git', { subcommand: 'push' })).toBe(false);
    expect(isReadOnlyTool('git', { subcommand: 'reset' })).toBe(false);
    expect(isReadOnlyTool('git', { subcommand: 'rebase' })).toBe(false);
    expect(isReadOnlyTool('git', { subcommand: 'checkout' })).toBe(false);
  });

  it('classifies platform tools as read-only', () => {
    expect(isReadOnlyTool('ul_discover')).toBe(true);
    expect(isReadOnlyTool('ul_call')).toBe(true);
    expect(isReadOnlyTool('ul_memory')).toBe(true);
  });

  it('classifies git without subcommand as NOT read-only', () => {
    expect(isReadOnlyTool('git')).toBe(false);
    expect(isReadOnlyTool('git', {})).toBe(false);
  });
});

// ── isFileWriteTool ──

describe('isFileWriteTool', () => {
  it('identifies file write tools', () => {
    expect(isFileWriteTool('file_write')).toBe(true);
    expect(isFileWriteTool('file_edit')).toBe(true);
  });

  it('rejects non-file-write tools', () => {
    expect(isFileWriteTool('file_read')).toBe(false);
    expect(isFileWriteTool('shell_exec')).toBe(false);
    expect(isFileWriteTool('git')).toBe(false);
  });
});

// ── checkPermission ──

describe('checkPermission', () => {
  // Bypass mode
  describe('bypass level', () => {
    it('allows everything', () => {
      expect(checkPermission('bypass', 'file_read')).toBe('allow');
      expect(checkPermission('bypass', 'file_write')).toBe('allow');
      expect(checkPermission('bypass', 'shell_exec')).toBe('allow');
      expect(checkPermission('bypass', 'git', { subcommand: 'push' })).toBe('allow');
    });
  });

  // Plan mode
  describe('plan level', () => {
    it('allows read-only tools', () => {
      expect(checkPermission('plan', 'file_read')).toBe('allow');
      expect(checkPermission('plan', 'glob')).toBe('allow');
      expect(checkPermission('plan', 'grep')).toBe('allow');
      expect(checkPermission('plan', 'ls')).toBe('allow');
      expect(checkPermission('plan', 'git', { subcommand: 'status' })).toBe('allow');
    });

    it('denies all write operations', () => {
      expect(checkPermission('plan', 'file_write')).toBe('deny');
      expect(checkPermission('plan', 'file_edit')).toBe('deny');
      expect(checkPermission('plan', 'shell_exec')).toBe('deny');
      expect(checkPermission('plan', 'git', { subcommand: 'commit' })).toBe('deny');
    });
  });

  // Ask mode
  describe('ask level', () => {
    it('allows read-only tools', () => {
      expect(checkPermission('ask', 'file_read')).toBe('allow');
      expect(checkPermission('ask', 'glob')).toBe('allow');
      expect(checkPermission('ask', 'git', { subcommand: 'diff' })).toBe('allow');
    });

    it('asks for all write operations', () => {
      expect(checkPermission('ask', 'file_write')).toBe('ask');
      expect(checkPermission('ask', 'file_edit')).toBe('ask');
      expect(checkPermission('ask', 'shell_exec')).toBe('ask');
      expect(checkPermission('ask', 'git', { subcommand: 'commit' })).toBe('ask');
    });
  });

  // Auto-edit mode
  describe('auto_edit level', () => {
    it('allows read-only tools', () => {
      expect(checkPermission('auto_edit', 'file_read')).toBe('allow');
      expect(checkPermission('auto_edit', 'glob')).toBe('allow');
    });

    it('auto-approves file write tools', () => {
      expect(checkPermission('auto_edit', 'file_write')).toBe('allow');
      expect(checkPermission('auto_edit', 'file_edit')).toBe('allow');
    });

    it('asks for shell and mutating git', () => {
      expect(checkPermission('auto_edit', 'shell_exec')).toBe('ask');
      expect(checkPermission('auto_edit', 'git', { subcommand: 'commit' })).toBe('ask');
      expect(checkPermission('auto_edit', 'git', { subcommand: 'push' })).toBe('ask');
    });

    it('allows read-only git even in auto_edit', () => {
      expect(checkPermission('auto_edit', 'git', { subcommand: 'status' })).toBe('allow');
      expect(checkPermission('auto_edit', 'git', { subcommand: 'log' })).toBe('allow');
    });
  });
});

// ── buildDescription ──

describe('buildDescription', () => {
  it('describes file_write', () => {
    const desc = buildDescription('file_write', { path: 'src/index.ts' });
    expect(desc).toContain('src/index.ts');
  });

  it('describes file_edit', () => {
    const desc = buildDescription('file_edit', { path: 'foo.ts' });
    expect(desc).toContain('foo.ts');
  });

  it('describes shell_exec with command', () => {
    const desc = buildDescription('shell_exec', { command: 'npm test' });
    expect(desc).toContain('npm test');
  });

  it('describes git subcommand', () => {
    const desc = buildDescription('git', { subcommand: 'commit', args: ['-m', 'fix bug'] });
    expect(desc).toContain('git commit');
  });

  it('truncates long commands', () => {
    const longCmd = 'a'.repeat(200);
    const desc = buildDescription('shell_exec', { command: longCmd });
    expect(desc.length).toBeLessThan(200);
    expect(desc).toContain('…');
  });
});

// ── getRiskLevel ──

describe('getRiskLevel', () => {
  it('rates read-only tools as safe', () => {
    expect(getRiskLevel('file_read')).toBe('safe');
    expect(getRiskLevel('glob')).toBe('safe');
    expect(getRiskLevel('git', { subcommand: 'status' })).toBe('safe');
  });

  it('rates file writes as moderate', () => {
    expect(getRiskLevel('file_write')).toBe('moderate');
    expect(getRiskLevel('file_edit')).toBe('moderate');
  });

  it('rates shell and mutating git as high', () => {
    expect(getRiskLevel('shell_exec')).toBe('high');
    expect(getRiskLevel('git', { subcommand: 'push' })).toBe('high');
  });
});
