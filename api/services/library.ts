// Library Service
// Generates Skills.md, library.txt, embedding.json per version,
// rebuilds the user-level Library.md from all live app versions,
// and manages the user's memory.md (free-form context).
//
// R2 layout per version:  apps/{appId}/{version}/skills.md, library.txt, embedding.json
// R2 layout per user:     users/{userId}/library.md, users/{userId}/memory.md

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
// USER MEMORY.MD: Read / Write / Append
// ============================================

/** Max memory.md size: 50KB. Prevents runaway writes from blowing out context windows or R2 costs. */
const MEMORY_MAX_BYTES = 50 * 1024;

/**
 * Read a user's memory.md from R2.
 * Returns the full markdown content, or null if none exists.
 */
export async function readUserMemory(userId: string): Promise<string | null> {
  const r2Service = createR2Service();
  try {
    return await r2Service.fetchTextFile(`users/${userId}/memory.md`);
  } catch {
    return null;
  }
}

/**
 * Write (overwrite) a user's memory.md in R2.
 * Saves a timestamped snapshot of the previous version before overwriting.
 * Throws if content exceeds 50KB.
 */
export async function writeUserMemory(userId: string, content: string): Promise<void> {
  const bytes = new TextEncoder().encode(content);
  if (bytes.length > MEMORY_MAX_BYTES) {
    throw new Error(`memory.md exceeds ${MEMORY_MAX_BYTES / 1024}KB limit (${(bytes.length / 1024).toFixed(1)}KB). Trim content or use ul.memory.remember for structured data.`);
  }

  const r2Service = createR2Service();

  // Snapshot previous version (fire-and-forget)
  snapshotMemory(r2Service, userId).catch(err =>
    console.error('Memory snapshot failed:', err)
  );

  await r2Service.uploadFile(`users/${userId}/memory.md`, {
    name: 'memory.md',
    content: bytes,
    contentType: 'text/markdown',
  });
}

/**
 * Append a section to a user's memory.md.
 * Creates the file if it doesn't exist.
 * Throws if result would exceed 50KB.
 */
export async function appendUserMemory(userId: string, section: string): Promise<string> {
  const existing = await readUserMemory(userId);
  const separator = existing ? '\n\n' : '';
  const updated = (existing || '# Memory\n\nPersonal context and preferences.') + separator + section;
  await writeUserMemory(userId, updated);
  return updated;
}

/**
 * Save a timestamped snapshot of the current memory.md before overwriting.
 * Stored at users/{userId}/memory_snapshots/{timestamp}.md
 * Only snapshots if current memory.md exists.
 */
async function snapshotMemory(r2Service: ReturnType<typeof createR2Service>, userId: string): Promise<void> {
  let existing: string;
  try {
    existing = await r2Service.fetchTextFile(`users/${userId}/memory.md`);
  } catch {
    return; // nothing to snapshot
  }
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  await r2Service.uploadFile(`users/${userId}/memory_snapshots/${ts}.md`, {
    name: `${ts}.md`,
    content: new TextEncoder().encode(existing),
    contentType: 'text/markdown',
  });
}

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
  lines.push('');
  lines.push(`Dashboard: /http/${app.id}/ui`);
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
  } catch (err) {
    console.error('Failed to store user library:', err);
  }
}
