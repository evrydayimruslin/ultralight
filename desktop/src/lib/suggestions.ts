// Local knowledge suggestion engine.
// Scans .ultralight/knowledge/*.md and matches against task descriptions
// using keyword/tag matching. No embeddings needed.

import {
  parseFrontmatter,
  readAbsoluteFile,
  listMdFiles,
  fileNameWithoutExt,
} from './templates';

// ── Types ──

export interface KnowledgeSuggestion {
  /** Absolute path to the .md file */
  path: string;
  /** Display name (from filename) */
  name: string;
  /** Tags from frontmatter */
  tags: string[];
  /** Match score (higher = more relevant) */
  relevance_score: number;
  /** First 200 chars of body for preview */
  preview: string;
}

// ── Tokenizer ──

/**
 * Tokenize text into lowercase keywords, stripping punctuation.
 * Skips very short words (< 3 chars) to avoid noise.
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2);
}

// ── Suggestion Engine ──

/**
 * Scan .ultralight/knowledge/*.md files and rank them by relevance to a task.
 * Scoring:
 *   - Filename keyword match: +3 per token
 *   - YAML frontmatter tag match: +2 per token
 *   - Body keyword match (first 500 chars): +0.5 per token
 *
 * @returns Ranked suggestions (highest score first), excluding score=0.
 */
export async function suggestContext(
  task: string,
  projectDir: string,
): Promise<KnowledgeSuggestion[]> {
  const knowledgeDir = `${projectDir}/.ultralight/knowledge`;
  const files = await listMdFiles(knowledgeDir);
  if (files.length === 0) return [];

  const taskTokens = tokenize(task);
  if (taskTokens.length === 0) return [];

  const suggestions: KnowledgeSuggestion[] = [];

  for (const filePath of files) {
    const content = await readAbsoluteFile(filePath);
    if (!content) continue;

    const { frontmatter, body } = parseFrontmatter(content);
    const name = fileNameWithoutExt(filePath);
    const tags = (frontmatter.tags as string[]) || [];

    // Build token sets for matching
    const nameTokens = tokenize(name.replace(/-/g, ' '));
    const tagTokens = tags.flatMap(t => tokenize(t));
    const bodyTokens = tokenize(body.slice(0, 500));

    // Score against task tokens
    let score = 0;
    for (const token of taskTokens) {
      if (nameTokens.includes(token)) score += 3;
      if (tagTokens.includes(token)) score += 2;
      if (bodyTokens.includes(token)) score += 0.5;
    }

    if (score > 0) {
      suggestions.push({
        path: filePath,
        name,
        tags,
        relevance_score: score,
        preview: body.slice(0, 200),
      });
    }
  }

  return suggestions.sort((a, b) => b.relevance_score - a.relevance_score);
}
