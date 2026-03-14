// Template loader + frontmatter parser + context file loader.
// Scans .ultralight/ directories for agent templates and context files.
// Uses shell_exec to read files outside the project root (e.g. ~/.ultralight/).

import { invoke } from '@tauri-apps/api/core';

// ── Types ──

export interface AgentTemplate {
  /** Absolute path to the .md file */
  path: string;
  /** Where the template came from */
  source: 'project' | 'global';
  /** Display name (from frontmatter or filename) */
  name: string;
  /** Agent role (builder, analyst, support, general) */
  role: string;
  /** Optional tool subset */
  tools?: string[];
  /** Default launch mode */
  launch_mode?: string;
  /** Tags for matching against tasks */
  tags?: string[];
  /** Markdown body after frontmatter — becomes additional system prompt content */
  body: string;
}

export interface ContextFile {
  path: string;
  name: string;
  content: string;
  source: 'project' | 'global';
}

// ── Frontmatter Parser ──

/**
 * Parse simple YAML frontmatter from markdown.
 * Handles: string scalars, string arrays (inline `[a, b]` and block `- item`), and `---` delimiters.
 * No external dependency needed.
 */
export function parseFrontmatter(raw: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  const lines = raw.split('\n');
  if (lines[0]?.trim() !== '---') {
    return { frontmatter: {}, body: raw };
  }

  let endIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      endIndex = i;
      break;
    }
  }

  if (endIndex === -1) {
    return { frontmatter: {}, body: raw };
  }

  const fmLines = lines.slice(1, endIndex);
  const frontmatter: Record<string, unknown> = {};
  let currentKey: string | null = null;
  let currentArray: string[] | null = null;

  for (const line of fmLines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Block array item: "- value"
    if (trimmed.startsWith('- ') && currentKey && currentArray) {
      currentArray.push(trimmed.slice(2).trim());
      continue;
    }

    // Flush any pending block array
    if (currentKey && currentArray) {
      frontmatter[currentKey] = currentArray;
      currentKey = null;
      currentArray = null;
    }

    // Key: value pair
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;

    const key = trimmed.slice(0, colonIdx).trim();
    const value = trimmed.slice(colonIdx + 1).trim();

    if (!value) {
      // Empty value — could be start of a block array
      currentKey = key;
      currentArray = [];
      continue;
    }

    // Inline array: [a, b, c]
    if (value.startsWith('[') && value.endsWith(']')) {
      const inner = value.slice(1, -1);
      frontmatter[key] = inner
        .split(',')
        .map(s => s.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
      continue;
    }

    // Strip quotes from string values
    frontmatter[key] = value.replace(/^['"]|['"]$/g, '');
  }

  // Flush final block array
  if (currentKey && currentArray) {
    frontmatter[currentKey] = currentArray;
  }

  const body = lines.slice(endIndex + 1).join('\n').trimStart();
  return { frontmatter, body };
}

// ── File System Helpers ──

/**
 * Read a file from an absolute path via shell_exec.
 * Works for paths outside the project root (e.g. ~/.ultralight/).
 */
export async function readAbsoluteFile(absolutePath: string): Promise<string | null> {
  try {
    const result = await invoke<string>('shell_exec', {
      projectRoot: '/',
      command: `cat "${absolutePath}" 2>/dev/null`,
    });
    return result || null;
  } catch {
    return null;
  }
}

/**
 * List .md files in a directory.
 */
export async function listMdFiles(dirPath: string): Promise<string[]> {
  try {
    const result = await invoke<string>('shell_exec', {
      projectRoot: '/',
      command: `find "${dirPath}" -maxdepth 1 -name "*.md" -type f 2>/dev/null`,
    });
    return result.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Get the user's home directory.
 */
let cachedHomeDir: string | null = null;
export async function getHomeDir(): Promise<string> {
  if (cachedHomeDir) return cachedHomeDir;
  try {
    const result = await invoke<string>('shell_exec', {
      projectRoot: '/',
      command: 'echo $HOME',
    });
    cachedHomeDir = result.trim();
    return cachedHomeDir;
  } catch {
    return '/tmp';
  }
}

/**
 * Extract filename without extension from a path.
 */
export function fileNameWithoutExt(path: string): string {
  const parts = path.split('/');
  const name = parts[parts.length - 1];
  return name.replace(/\.md$/, '');
}

// ── Template + Context Loading ──

/**
 * Scan for agent templates from both project-local and global directories.
 * Project-local: {projectDir}/.ultralight/agents/*.md
 * Global: ~/.ultralight/agents/*.md
 */
export async function loadTemplates(projectDir: string | null): Promise<AgentTemplate[]> {
  const templates: AgentTemplate[] = [];
  const homedir = await getHomeDir();

  // 1. Project-local templates
  if (projectDir) {
    const projectAgentsDir = `${projectDir}/.ultralight/agents`;
    const files = await listMdFiles(projectAgentsDir);
    for (const filePath of files) {
      const content = await readAbsoluteFile(filePath);
      if (content) {
        const { frontmatter, body } = parseFrontmatter(content);
        templates.push({
          path: filePath,
          source: 'project',
          name: (frontmatter.name as string) || fileNameWithoutExt(filePath),
          role: (frontmatter.role as string) || 'general',
          tools: frontmatter.tools as string[] | undefined,
          launch_mode: frontmatter.launch_mode as string | undefined,
          tags: frontmatter.tags as string[] | undefined,
          body,
        });
      }
    }
  }

  // 2. Global templates
  const globalAgentsDir = `${homedir}/.ultralight/agents`;
  const globalFiles = await listMdFiles(globalAgentsDir);
  for (const filePath of globalFiles) {
    const content = await readAbsoluteFile(filePath);
    if (content) {
      const { frontmatter, body } = parseFrontmatter(content);
      templates.push({
        path: filePath,
        source: 'global',
        name: (frontmatter.name as string) || fileNameWithoutExt(filePath),
        role: (frontmatter.role as string) || 'general',
        tools: frontmatter.tools as string[] | undefined,
        launch_mode: frontmatter.launch_mode as string | undefined,
        tags: frontmatter.tags as string[] | undefined,
        body,
      });
    }
  }

  return templates;
}

/**
 * Load always-injected context files:
 * - {projectDir}/.ultralight/context/project.md
 * - ~/.ultralight/profile.md
 */
export async function loadBaseContext(projectDir: string | null): Promise<ContextFile[]> {
  const files: ContextFile[] = [];
  const homedir = await getHomeDir();

  if (projectDir) {
    const projectCtx = await readAbsoluteFile(`${projectDir}/.ultralight/context/project.md`);
    if (projectCtx) {
      files.push({
        path: `${projectDir}/.ultralight/context/project.md`,
        name: 'Project Context',
        content: projectCtx,
        source: 'project',
      });
    }
  }

  const profile = await readAbsoluteFile(`${homedir}/.ultralight/profile.md`);
  if (profile) {
    files.push({
      path: `${homedir}/.ultralight/profile.md`,
      name: 'User Profile',
      content: profile,
      source: 'global',
    });
  }

  return files;
}
