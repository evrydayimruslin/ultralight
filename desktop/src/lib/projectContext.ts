// Project context gathering — reads local project files via Tauri Rust tools
// and assembles a context snapshot for the Flash/Heavy model pipeline.
// Designed to be fast (<500ms) with smart heuristics for relevance.

import { invoke } from '@tauri-apps/api/core';

const MAX_TOTAL_CHARS = 20_000;
const MAX_TREE_CHARS = 2_000;
const MAX_CONFIG_CHARS = 4_000;
const MAX_RELEVANT_CHARS = 14_000;

// Priority config files to always try reading
const CONFIG_FILES = [
  'package.json',
  'tsconfig.json',
  'Cargo.toml',
  'pyproject.toml',
  'go.mod',
  'deno.json',
  '.ultralight/context/project.md',
];

/**
 * Gather project context for the Flash/Heavy model pipeline.
 * Reads directory structure, config files, and message-relevant source files.
 * Returns a markdown-formatted context string capped at ~20K chars.
 */
export async function gatherProjectContext(
  projectRoot: string,
  userMessage: string,
): Promise<string> {
  const sections: string[] = [];

  // ── 1. Directory tree ──
  try {
    const [rootListing, globResult] = await Promise.all([
      invoke<string>('ls', { projectRoot }).catch(() => ''),
      invoke<string>('glob_search', { projectRoot, pattern: '**/*' }).catch(() => ''),
    ]);

    let tree = '';
    if (rootListing) {
      tree += rootListing;
    }
    if (globResult) {
      // Glob returns newline-separated paths sorted by mtime
      const paths = globResult.split('\n').filter(Boolean).slice(0, 100);
      if (paths.length > 0) {
        tree += '\n\nAll files (newest first):\n' + paths.join('\n');
      }
    }

    if (tree) {
      sections.push(`## Project Structure\n${truncate(tree, MAX_TREE_CHARS)}`);
    }
  } catch {
    // Non-fatal — continue without tree
  }

  // ── 2. Config files ──
  try {
    const configResults = await Promise.all(
      CONFIG_FILES.map(async (path) => {
        try {
          const content = await invoke<string>('file_read', {
            projectRoot,
            path,
            limit: 100, // First 100 lines only
          });
          return { path, content };
        } catch {
          return null; // File doesn't exist — skip
        }
      })
    );

    const configs = configResults.filter(Boolean) as { path: string; content: string }[];
    if (configs.length > 0) {
      let configSection = '';
      for (const cfg of configs) {
        const entry = `### ${cfg.path}\n\`\`\`\n${cfg.content}\n\`\`\`\n\n`;
        if (configSection.length + entry.length > MAX_CONFIG_CHARS) break;
        configSection += entry;
      }
      sections.push(`## Configuration\n${configSection}`);
    }
  } catch {
    // Non-fatal
  }

  // ── 3. Message-relevant files ──
  try {
    const relevantFiles = await findRelevantFiles(projectRoot, userMessage);
    if (relevantFiles.length > 0) {
      let relevantSection = '';
      for (const file of relevantFiles) {
        const entry = `### ${file.path}\n\`\`\`\n${file.content}\n\`\`\`\n\n`;
        if (relevantSection.length + entry.length > MAX_RELEVANT_CHARS) break;
        relevantSection += entry;
      }
      sections.push(`## Relevant Files\n${relevantSection}`);
    }
  } catch {
    // Non-fatal
  }

  // ── 4. Assemble and cap ──
  let result = sections.join('\n\n');
  if (result.length > MAX_TOTAL_CHARS) {
    result = result.slice(0, MAX_TOTAL_CHARS) + '\n... (truncated)';
  }

  return result;
}

// ── Helpers ──

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '\n... (truncated)';
}

/**
 * Extract file paths and identifiers from the user's message,
 * then grep/read relevant source files.
 */
async function findRelevantFiles(
  projectRoot: string,
  message: string,
): Promise<{ path: string; content: string }[]> {
  const files: { path: string; content: string }[] = [];

  // Extract explicit file paths from message (e.g., src/auth.ts, ./lib/utils.js)
  const pathRegex = /(?:^|\s)((?:\.\/|src\/|lib\/|app\/|pages\/|components\/|hooks\/|api\/|services\/|utils?\/|desktop\/|web\/)?[\w./-]+\.\w{1,10})(?:\s|$|,|\.)/gm;
  const mentionedPaths: string[] = [];
  let match;
  while ((match = pathRegex.exec(message)) !== null) {
    mentionedPaths.push(match[1]);
  }

  // Read explicitly mentioned files
  for (const path of mentionedPaths.slice(0, 3)) {
    try {
      const content = await invoke<string>('file_read', {
        projectRoot,
        path,
        limit: 150,
      });
      files.push({ path, content });
    } catch {
      // File doesn't exist at that path — skip
    }
  }

  // Extract identifiers and grep for them if we don't have enough files yet
  if (files.length < 2) {
    const identifiers = extractIdentifiers(message);
    for (const id of identifiers.slice(0, 3)) {
      if (files.length >= 3) break;
      try {
        const grepResult = await invoke<string>('grep_search', {
          projectRoot,
          pattern: id,
          maxResults: 3,
        });
        // Parse grep results (format: "path:line:content")
        const grepPaths = grepResult
          .split('\n')
          .filter(Boolean)
          .map(line => line.split(':')[0])
          .filter((p, i, arr) => arr.indexOf(p) === i); // dedupe

        for (const grepPath of grepPaths.slice(0, 1)) {
          if (files.some(f => f.path === grepPath)) continue;
          try {
            const content = await invoke<string>('file_read', {
              projectRoot,
              path: grepPath,
              limit: 150,
            });
            files.push({ path: grepPath, content });
          } catch {
            // Skip
          }
        }
      } catch {
        // Grep failed — skip this identifier
      }
    }
  }

  return files;
}

/**
 * Extract likely code identifiers from the user's message.
 * Looks for camelCase, PascalCase, snake_case patterns that are likely
 * function/class/variable names.
 */
function extractIdentifiers(message: string): string[] {
  const ids: string[] = [];

  // camelCase / PascalCase identifiers (3+ chars, not common English)
  const camelRegex = /\b([A-Z][a-zA-Z0-9]{2,}|[a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*)\b/g;
  let match;
  while ((match = camelRegex.exec(message)) !== null) {
    const id = match[1];
    // Skip very common words
    if (!COMMON_WORDS.has(id.toLowerCase())) {
      ids.push(id);
    }
  }

  // snake_case identifiers
  const snakeRegex = /\b([a-z][a-z0-9]*_[a-z0-9_]+)\b/g;
  while ((match = snakeRegex.exec(message)) !== null) {
    ids.push(match[1]);
  }

  return [...new Set(ids)];
}

const COMMON_WORDS = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'have', 'been',
  'will', 'can', 'not', 'are', 'was', 'but', 'all', 'when', 'your',
  'how', 'about', 'would', 'make', 'like', 'just', 'should', 'could',
  'what', 'there', 'their', 'which', 'each', 'other', 'into', 'more',
]);
