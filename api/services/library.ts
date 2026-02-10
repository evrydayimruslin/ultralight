// Library Service
// Generates Skills.md, library.txt, embedding.json per version,
// and rebuilds the user-level Library.md from all live app versions.
//
// R2 layout per version:  apps/{appId}/{version}/skills.md, library.txt, embedding.json
// R2 layout per user:     users/{userId}/library.md, library.json

import { createR2Service } from './storage.ts';
import { createAppsService } from './apps.ts';
import { parseTypeScript, toSkillsParsed } from './parser.ts';
import {
  generateSkillsMd,
  validateAndParseSkillsMd,
  generateEmbeddingText,
} from './docgen.ts';
import { createEmbeddingService } from './embedding.ts';
import type { App, AppWithDraft, ParsedSkills } from '../../shared/types/index.ts';
import type { ParseResult } from './parser.ts';

// ============================================
// PER-VERSION: Skills + Library Entry + Embedding
// ============================================

export interface VersionArtifacts {
  skillsMd: string | null;
  libraryTxt: string | null;
  embeddingJson: number[] | null;
}

/**
 * Auto-generate Skills.md, library.txt, and embedding.json for a specific
 * version of an app. Stores artifacts in R2 at the version's storage key
 * and also updates the app DB record with the latest skills/embedding.
 *
 * @param app       The app record (needs .id, .name, .slug, .description, .exports)
 * @param storageKey  The R2 prefix for this version, e.g. "apps/{id}/{ver}/"
 * @param _version    Version string (currently unused but kept for future use)
 */
export async function generateSkillsForVersion(
  app: App,
  storageKey: string,
  _version: string
): Promise<VersionArtifacts> {
  const r2Service = createR2Service();

  // Fetch source code (prefer _source_ file, fall back to bundled)
  let code: string | null = null;
  const entryNames = [
    '_source_index.ts', '_source_index.tsx',
    'index.ts', 'index.tsx', 'index.js', 'index.jsx',
  ];
  for (const entry of entryNames) {
    try {
      code = await r2Service.fetchTextFile(`${storageKey}${entry}`);
      break;
    } catch { /* try next */ }
  }

  if (!code) return { skillsMd: null, libraryTxt: null, embeddingJson: null };

  // Parse code → generate Skills.md
  const parseResult = parseTypeScript(code);
  const skillsMd = generateSkillsMd(app.name || app.slug, parseResult);

  // Generate compact library entry (header + functions summary)
  const libraryTxt = generateLibraryEntry(app, parseResult);

  // Generate embedding from library entry
  let embeddingJson: number[] | null = null;
  try {
    const embeddingService = createEmbeddingService();
    if (embeddingService) {
      const skills = toSkillsParsed(parseResult);
      const embeddingText = generateEmbeddingText(app.name, app.description, skills);
      const result = await embeddingService.embed(embeddingText);
      embeddingJson = result.embedding;
    }
  } catch (err) {
    console.error('Embedding generation failed:', err);
  }

  // Store per-version in R2
  try {
    await r2Service.uploadFile(`${storageKey}skills.md`, {
      name: 'skills.md',
      content: new TextEncoder().encode(skillsMd),
      contentType: 'text/markdown',
    });
    if (libraryTxt) {
      await r2Service.uploadFile(`${storageKey}library.txt`, {
        name: 'library.txt',
        content: new TextEncoder().encode(libraryTxt),
        contentType: 'text/plain',
      });
    }
    if (embeddingJson) {
      await r2Service.uploadFile(`${storageKey}embedding.json`, {
        name: 'embedding.json',
        content: new TextEncoder().encode(JSON.stringify(embeddingJson)),
        contentType: 'application/json',
      });
    }
  } catch (err) {
    console.error('Failed to store skills artifacts in R2:', err);
  }

  // Also update the app record with skills_md and parsed skills
  try {
    const validation = validateAndParseSkillsMd(skillsMd);
    const appsService = createAppsService();
    await appsService.update(app.id, {
      skills_md: skillsMd,
      skills_parsed: validation.skills_parsed,
      docs_generated_at: new Date().toISOString(),
    } as Partial<AppWithDraft>);

    if (embeddingJson) {
      await appsService.updateEmbedding(app.id, embeddingJson);
    }
  } catch (err) {
    console.error('Failed to update app with skills:', err);
  }

  return { skillsMd, libraryTxt, embeddingJson };
}

// ============================================
// LIBRARY ENTRY (compact per-app)
// ============================================

/**
 * Generate a compact library entry from parse result.
 * This is stored as library.txt per version and compiled into Library.md.
 */
export function generateLibraryEntry(
  app: App,
  parseResult: ParseResult
): string {
  const lines: string[] = [];
  lines.push(`## ${app.name || app.slug}`);
  if (app.description) lines.push(app.description);
  lines.push('');
  lines.push('Functions:');
  for (const fn of parseResult.functions) {
    const params = fn.parameters.map(p => p.name).join(', ');
    lines.push(`- ${fn.name}(${params}): ${fn.description || 'No description'}`);
  }
  return lines.join('\n');
}

// ============================================
// USER LIBRARY: Rebuild Library.md
// ============================================

/**
 * Rebuild Library.md for a user from all their live app versions.
 * Reads library.txt from each app's live version in R2,
 * compiles them into a single Library.md, and stores per-user in R2.
 *
 * Fire-and-forget safe — catches all errors.
 */
export async function rebuildUserLibrary(userId: string): Promise<void> {
  const appsService = createAppsService();
  const r2Service = createR2Service();
  const apps = await appsService.listByOwner(userId);

  const libraryParts: string[] = [];
  const embeddings: Array<{ appId: string; embedding: number[] }> = [];

  for (const app of apps) {
    if (!app.current_version || !app.storage_key) continue;

    // Try to read library.txt from live version
    try {
      const libraryTxt = await r2Service.fetchTextFile(`${app.storage_key}library.txt`);
      libraryParts.push(libraryTxt);
    } catch {
      // Fall back to inline generation
      libraryParts.push(`## ${app.name || app.slug}\n${app.description || 'No description'}\nMCP: /mcp/${app.id}`);
    }

    // Try to read embedding
    try {
      const embeddingStr = await r2Service.fetchTextFile(`${app.storage_key}embedding.json`);
      const embedding = JSON.parse(embeddingStr);
      if (Array.isArray(embedding)) {
        embeddings.push({ appId: app.id, embedding });
      }
    } catch { /* no embedding for this app */ }

    libraryParts.push(''); // separator
  }

  const libraryMd = `# Library\n\nAll your apps and their capabilities.\n\n${libraryParts.join('\n')}`;

  // Store per-user in R2
  try {
    await r2Service.uploadFile(`users/${userId}/library.md`, {
      name: 'library.md',
      content: new TextEncoder().encode(libraryMd),
      contentType: 'text/markdown',
    });
    await r2Service.uploadFile(`users/${userId}/library.json`, {
      name: 'library.json',
      content: new TextEncoder().encode(JSON.stringify(embeddings)),
      contentType: 'application/json',
    });
  } catch (err) {
    console.error('Failed to store user library:', err);
  }
}
