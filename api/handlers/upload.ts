// Upload Handler
// Processes file uploads, validates, bundles, stores to R2, creates app record
// Supports both new app creation and draft uploads for existing apps

import { error, json } from './app.ts';
import type { BuildLogEntry, UploadResponse, AppManifest } from '../../shared/types/index.ts';
import {
  ALLOWED_EXTENSIONS,
  MAX_FILES_PER_UPLOAD,
  MAX_UPLOAD_SIZE_BYTES,
  validateManifest,
} from '../../shared/types/index.ts';
import { createR2Service } from '../services/storage.ts';
import { createAppsService } from '../services/apps.ts';
import { bundleCode, quickBundle } from '../services/bundler.ts';
import { authenticate } from './auth.ts';
import {
  checkVisibilityAllowed,
  getUserTier,
} from '../services/tier-enforcement.ts';
import {
  generateSkillsForVersion,
  rebuildUserLibrary,
} from '../services/library.ts';
import { recordUploadStorage } from '../services/storage-quota.ts';

// Export file type for programmatic uploads
export interface UploadFile {
  name: string;
  content: string;
  size: number;
}

// Draft upload response type
interface DraftUploadResponse {
  app_id: string;
  draft_version: string;
  draft_storage_key: string;
  exports: string[];
  build_success: boolean;
  build_logs: BuildLogEntry[];
  message: string;
}

// @ts-ignore - Deno is available in Deno Deploy
const Deno = globalThis.Deno;

export async function handleUpload(request: Request): Promise<Response> {
  try {
    // Debug: Log all headers
    console.log('=== UPLOAD REQUEST ===');
    console.log('Headers:', Object.fromEntries(request.headers.entries()));

    // Authenticate user - required for upload
    let userId: string;
    try {
      const user = await authenticate(request);
      userId = user.id;
      console.log('Auth successful, userId:', userId);
    } catch (authErr: unknown) {
      console.error('Auth failed:', authErr instanceof Error ? authErr.message : authErr);
      return error('Authentication required. Please sign in to upload.', 401);
    }
    // Note: FK constraint on apps.owner_id has been removed, so no user record needed

    // Parse multipart form data
    const formData = await request.formData();
    const files: File[] = [];
    let providedName: string | null = null;
    let providedDescription: string | null = null;
    let providedAppType: 'mcp' | null = null;
    let providedFunctionsEntry: string | null = null;

    for (const [name, value] of formData.entries()) {
      if (value instanceof File) {
        files.push(value);
      } else if (name === 'name' && typeof value === 'string') {
        providedName = value.trim();
      } else if (name === 'description' && typeof value === 'string') {
        providedDescription = value.trim();
      } else if (name === 'app_type' && typeof value === 'string') {
        if (value === 'mcp') {
          providedAppType = 'mcp';
        }
      } else if (name === 'functions_entry' && typeof value === 'string') {
        providedFunctionsEntry = value.trim();
      }
    }

    // Validate file count
    if (files.length === 0) {
      return error('No files uploaded');
    }
    if (files.length > MAX_FILES_PER_UPLOAD) {
      return error(`Maximum ${MAX_FILES_PER_UPLOAD} files allowed`);
    }

    // Validate file types and size
    let totalSize = 0;
    const validatedFiles: Array<{ name: string; content: string }> = [];

    for (const file of files) {
      // Check extension
      const hasValidExt = ALLOWED_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext));
      if (!hasValidExt) {
        return error(`File type not allowed: ${file.name}`);
      }

      // Check size
      totalSize += file.size;
      if (totalSize > MAX_UPLOAD_SIZE_BYTES) {
        return error(`Total upload size exceeds ${MAX_UPLOAD_SIZE_BYTES / 1024 / 1024}MB limit`);
      }

      // Read content
      const content = await file.text();
      validatedFiles.push({ name: file.name, content });
    }

    // Check for manifest.json (v2 architecture)
    const manifestFile = validatedFiles.find((f) => {
      const fileName = f.name.split('/').pop() || f.name;
      return fileName === 'manifest.json';
    });

    let manifest: AppManifest | null = null;
    if (manifestFile) {
      try {
        const manifestJson = JSON.parse(manifestFile.content);
        const validation = validateManifest(manifestJson);
        if (!validation.valid) {
          return error(`Invalid manifest.json: ${validation.errors.map(e => `${e.path}: ${e.message}`).join(', ')}`, 400);
        }
        manifest = validation.manifest!;
        console.log('Manifest found:', manifest.name, 'type:', manifest.type);
      } catch (parseErr) {
        return error(`Failed to parse manifest.json: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`, 400);
      }
    }

    // Override manifest with form fields if provided (form fields take precedence)
    // This allows users to specify entry points without creating a manifest.json
    if (providedAppType || providedFunctionsEntry) {
      const formManifest: AppManifest = manifest ? { ...manifest } : {
        name: providedName || 'Untitled App',
        version: '1.0.0',
        type: providedAppType || 'mcp',
        entry: {},
      };

      // Override with form field values
      if (providedAppType) {
        formManifest.type = providedAppType;
      }
      if (providedFunctionsEntry) {
        formManifest.entry.functions = providedFunctionsEntry;
      }
      if (providedDescription) {
        formManifest.description = providedDescription;
      }

      manifest = formManifest;
      console.log('Using form-provided manifest override:', manifest.type, manifest.entry);
    }

    // Determine entry file based on manifest, form fields, or fallback to auto-detection
    let entryFile: { name: string; content: string } | undefined;
    let functionsFile: { name: string; content: string } | undefined;

    if (manifest) {
      // Use manifest-specified entry points
      if (manifest.entry.functions) {
        functionsFile = validatedFiles.find((f) => {
          const fileName = f.name.split('/').pop() || f.name;
          return fileName === manifest!.entry.functions;
        });
        if (!functionsFile) {
          return error(`Functions entry file not found: ${manifest.entry.functions}`);
        }
      }

      // For bundling, use the functions file as primary entry
      entryFile = functionsFile;
    } else {
      // Legacy: auto-detect entry file
      // Check for entry file - handle both flat files and folder uploads
      // When uploading a folder, file.name includes path like "myapp/index.ts"
      // Support: index.ts, index.tsx, index.js, index.jsx
      const entryFileNames = ['index.tsx', 'index.ts', 'index.jsx', 'index.js'];
      entryFile = validatedFiles.find((f) => {
        const fileName = f.name.split('/').pop() || f.name;
        return entryFileNames.includes(fileName);
      });
    }

    if (!entryFile) {
      console.log('Files received:', validatedFiles.map(f => f.name));
      return error('Entry file required. Either provide manifest.json or include index.ts/index.tsx');
    }
    console.log('Entry file found:', entryFile.name);

    // Build logs
    const buildLogs: BuildLogEntry[] = [];
    const log = (level: BuildLogEntry['level'], message: string) => {
      buildLogs.push({ time: new Date().toISOString(), level, message });
    };

    log('info', `Starting build for ${validatedFiles.length} files...`);

    if (manifest) {
      log('info', `Using manifest.json (type: ${manifest.type})`);
    }

    // Extract exports - prefer manifest declarations over code parsing
    log('info', 'Determining exports...');
    let exports: string[];
    if (manifest?.functions) {
      // Use manifest-declared functions
      exports = Object.keys(manifest.functions);
      log('success', `Found ${exports.length} functions from manifest: ${exports.join(', ')}`);
    } else {
      // Fallback to parsing code (legacy behavior)
      exports = extractExports(entryFile.content);
      log('success', `Found ${exports.length} exports from code: ${exports.join(', ')}`);
    }

    // Bundle the code
    // IMPORTANT: We must bundle ALL imports (relative and external) into a single file
    // because data URL imports cannot resolve relative paths
    log('info', 'Bundling code...');
    let bundledCode = entryFile.content;  // IIFE format for MCP sandbox
    let esmBundledCode: string | undefined;  // ESM format for browser UI
    let bundleUsed = false;

    try {
      // Always use esbuild for proper bundling - it handles all import types correctly
      log('info', 'Running esbuild bundler...');
      const bundleResult = await bundleCode(validatedFiles, entryFile.name);

      if (!bundleResult.success) {
        for (const err of bundleResult.errors) {
          log('error', err);
        }
        return error('Build failed: ' + bundleResult.errors.join(', '), 400);
      }

      for (const warn of bundleResult.warnings) {
        log('warn', warn);
      }

      // Only use bundled code if bundling actually changed something
      if (bundleResult.code !== entryFile.content) {
        bundledCode = bundleResult.code;
        esmBundledCode = bundleResult.esmCode;
        bundleUsed = true;
        log('success', 'Bundle complete (IIFE + ESM)');
      } else {
        log('success', 'No bundling needed (no imports)');
      }
    } catch (bundleErr) {
      // Bundling failed - try to continue with original code
      log('warn', `Bundling skipped: ${bundleErr instanceof Error ? bundleErr.message : String(bundleErr)}`);
      bundledCode = entryFile.content;
    }

    // Generate app ID and version
    const appId = crypto.randomUUID();
    const version = manifest?.version || '1.0.0';
    // Use manifest name, provided name, or generate slug
    const slug = generateSlug(validatedFiles.find((f) => f.name === 'package.json')?.content);
    const appName = manifest?.name || providedName || slug;
    // Form field description takes precedence over manifest
    const appDescription = providedDescription || manifest?.description || null;
    const appType = manifest?.type || null; // null means legacy auto-detect

    // Initialize services
    const r2Service = createR2Service();
    const appsService = createAppsService();

    // Normalize file names - strip folder prefix for consistent storage
    // e.g., "myapp/index.ts" -> "index.ts", "myapp/lib/utils.ts" -> "lib/utils.ts"
    const normalizeFileName = (name: string): string => {
      const parts = name.split('/');
      // If all files share a common prefix folder, strip it
      if (parts.length > 1) {
        // Check if this looks like a folder upload (has a common root folder)
        const firstPart = validatedFiles[0]?.name.split('/')[0];
        const allSameRoot = validatedFiles.every(f => f.name.startsWith(firstPart + '/'));
        if (allSameRoot && parts[0] === firstPart) {
          return parts.slice(1).join('/');
        }
      }
      return name;
    };

    // Get normalized entry file name
    const normalizedEntryName = normalizeFileName(entryFile.name);
    log('info', `Entry file normalized: ${entryFile.name} -> ${normalizedEntryName}`);

    // Prepare files for upload
    // We store multiple versions:
    // - index.tsx (IIFE bundle) - for MCP sandbox execution
    // - index.esm.js (ESM bundle) - for browser UI rendering
    // - _source_index.tsx - original source for generate-docs
    const filesToUpload = bundleUsed
      ? [
          // Upload IIFE bundled code as the entry file (for MCP sandbox)
          {
            name: normalizedEntryName,
            content: new TextEncoder().encode(bundledCode),
            contentType: getContentType(normalizedEntryName),
          },
          // Upload ESM bundled code for browser UI rendering
          ...(esmBundledCode ? [{
            name: normalizedEntryName.replace(/\.(tsx?|jsx?)$/, '.esm.js'),
            content: new TextEncoder().encode(esmBundledCode),
            contentType: 'application/javascript',
          }] : []),
          // Upload original entry file with _source_ prefix for generate-docs parsing
          // This preserves the original TypeScript code with export statements
          {
            name: `_source_${normalizedEntryName}`,
            content: new TextEncoder().encode(entryFile.content),
            contentType: getContentType(normalizedEntryName),
          },
          // Also upload original files for reference/debugging
          ...validatedFiles
            .filter(f => f.name !== entryFile.name)
            .map(f => ({
              name: normalizeFileName(f.name),
              content: new TextEncoder().encode(f.content),
              contentType: getContentType(f.name),
            })),
        ]
      : validatedFiles.map(f => ({
          name: normalizeFileName(f.name),
          content: new TextEncoder().encode(f.content),
          contentType: getContentType(f.name),
        }));

    // Upload files to R2
    log('info', 'Uploading to storage...');
    const storageKey = `apps/${appId}/${version}/`;
    await r2Service.uploadFiles(storageKey, filesToUpload);
    log('success', 'Upload complete');

    // Create app record in database
    log('info', 'Creating app record...');
    await appsService.create({
      id: appId,
      owner_id: userId,
      slug,
      name: appName,
      description: appDescription,
      storage_key: storageKey,
      exports,
      // Store manifest data for later use
      manifest: manifest ? JSON.stringify(manifest) : null,
      app_type: appType,
    });
    log('success', 'App record created');

    // Record storage usage for billing (fire-and-forget)
    const totalSizeBytes = filesToUpload.reduce((sum, f) => sum + f.content.byteLength, 0);
    recordUploadStorage(userId, appId, version, totalSizeBytes).catch(err =>
      console.error('[STORAGE] recordUploadStorage failed:', err)
    );

    // Auto-generate Skills.md + library entry + embedding (fire-and-forget for speed)
    log('info', 'Generating Skills.md...');
    const appsForSkills = await appsService.findById(appId);
    if (appsForSkills) {
      generateSkillsForVersion(appsForSkills, storageKey, version)
        .then(skills => {
          if (skills.skillsMd) {
            console.log(`Skills.md generated for ${appId}`);
          }
          // Rebuild user library with the new app
          rebuildUserLibrary(userId).catch(err => console.error('Library rebuild failed:', err));
        })
        .catch(err => console.error('Skills generation failed:', err));
    }

    log('success', 'Build complete!');

    const response: UploadResponse = {
      app_id: appId,
      slug,
      version,
      url: `/a/${appId}`,
      exports,
      build_success: true,
      build_logs: buildLogs,
    };

    return json(response, 201);
  } catch (err) {
    console.error('Upload error:', err);
    return error(err instanceof Error ? err.message : 'Upload failed', 500);
  }
}

/**
 * Extract export names from TypeScript/JavaScript code
 * Basic regex-based extraction for MVP
 */
function extractExports(code: string): string[] {
  const exports: string[] = [];

  // Match: export function name(...) or export async function name(...)
  const functionRegex = /export\s+(?:async\s+)?function\s+(\w+)/g;
  let match;
  while ((match = functionRegex.exec(code)) !== null) {
    exports.push(match[1]);
  }

  // Match: export const name = ... or export let name = ...
  const constRegex = /export\s+(?:const|let|var)\s+(\w+)\s*=/g;
  while ((match = constRegex.exec(code)) !== null) {
    exports.push(match[1]);
  }

  // Match: export { name1, name2 }
  const namedExportRegex = /export\s*\{([^}]+)\}/g;
  while ((match = namedExportRegex.exec(code)) !== null) {
    const names = match[1].split(',').map((s) => s.trim().split(' as ')[0].trim());
    exports.push(...names);
  }

  // Match: export default ...
  if (/export\s+default/.test(code)) {
    exports.push('default');
  }

  return [...new Set(exports)]; // Deduplicate
}

/**
 * Generate slug from package.json or fallback
 */
function generateSlug(packageJson?: string): string {
  if (packageJson) {
    try {
      const pkg = JSON.parse(packageJson);
      if (pkg.name) {
        return pkg.name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
      }
    } catch {
      // Ignore parse error
    }
  }

  // Fallback: random slug
  return `app-${Math.random().toString(36).slice(2, 8)}`;
}

function getContentType(filename: string): string {
  if (filename.endsWith('.tsx')) return 'text/typescript-jsx';
  if (filename.endsWith('.ts')) return 'text/typescript';
  if (filename.endsWith('.jsx')) return 'text/javascript-jsx';
  if (filename.endsWith('.js')) return 'application/javascript';
  if (filename.endsWith('.json')) return 'application/json';
  if (filename.endsWith('.md')) return 'text/markdown';
  if (filename.endsWith('.css')) return 'text/css';
  return 'text/plain';
}

/**
 * Handle draft upload for an existing app
 * POST /api/apps/:appId/draft
 *
 * This uploads new code as a draft without replacing the published version.
 * The draft can then be published via POST /api/apps/:appId/publish
 */
export async function handleDraftUpload(request: Request, appId: string): Promise<Response> {
  try {
    // Authenticate user
    let userId: string;
    try {
      const user = await authenticate(request);
      userId = user.id;
    } catch (authErr: unknown) {
      console.error('Auth failed:', authErr instanceof Error ? authErr.message : authErr);
      return error('Authentication required', 401);
    }

    // Get the app and verify ownership
    const appsService = createAppsService();
    const app = await appsService.findById(appId);

    if (!app) {
      return error('App not found', 404);
    }

    if (app.owner_id !== userId) {
      return error('Unauthorized', 403);
    }

    // Check if there's already a draft - warn but allow overwrite
    const hasDraft = !!(app as Record<string, unknown>).draft_storage_key;

    // Parse multipart form data
    const formData = await request.formData();
    const files: File[] = [];

    for (const [name, value] of formData.entries()) {
      if (value instanceof File) {
        files.push(value);
      }
    }

    // Validate file count
    if (files.length === 0) {
      return error('No files uploaded');
    }
    if (files.length > MAX_FILES_PER_UPLOAD) {
      return error(`Maximum ${MAX_FILES_PER_UPLOAD} files allowed`);
    }

    // Validate file types and size
    let totalSize = 0;
    const validatedFiles: Array<{ name: string; content: string }> = [];

    for (const file of files) {
      const hasValidExt = ALLOWED_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext));
      if (!hasValidExt) {
        return error(`File type not allowed: ${file.name}`);
      }

      totalSize += file.size;
      if (totalSize > MAX_UPLOAD_SIZE_BYTES) {
        return error(`Total upload size exceeds ${MAX_UPLOAD_SIZE_BYTES / 1024 / 1024}MB limit`);
      }

      const content = await file.text();
      validatedFiles.push({ name: file.name, content });
    }

    // Check for entry file
    const entryFileNames = ['index.tsx', 'index.ts', 'index.jsx', 'index.js'];
    const entryFile = validatedFiles.find((f) => {
      const fileName = f.name.split('/').pop() || f.name;
      return entryFileNames.includes(fileName);
    });
    if (!entryFile) {
      return error('Entry file (index.ts, index.tsx, index.js, or index.jsx) required');
    }

    // Build logs
    const buildLogs: BuildLogEntry[] = [];
    const log = (level: BuildLogEntry['level'], message: string) => {
      buildLogs.push({ time: new Date().toISOString(), level, message });
    };

    if (hasDraft) {
      log('warn', 'Overwriting existing draft');
    }

    log('info', `Starting draft build for ${validatedFiles.length} files...`);

    // Extract exports
    log('info', 'Parsing entry file...');
    const exports = extractExports(entryFile.content);
    log('success', `Found ${exports.length} exports: ${exports.join(', ')}`);

    // Bundle the code
    log('info', 'Bundling code...');
    let bundledCode = entryFile.content;
    let esmBundledCode: string | undefined;
    let bundleUsed = false;

    try {
      log('info', 'Running esbuild bundler...');
      const bundleResult = await bundleCode(validatedFiles, entryFile.name);

      if (!bundleResult.success) {
        for (const err of bundleResult.errors) {
          log('error', err);
        }
        return error('Build failed: ' + bundleResult.errors.join(', '), 400);
      }

      for (const warn of bundleResult.warnings) {
        log('warn', warn);
      }

      if (bundleResult.code !== entryFile.content) {
        bundledCode = bundleResult.code;
        esmBundledCode = bundleResult.esmCode;
        bundleUsed = true;
        log('success', 'Bundle complete (IIFE + ESM)');
      } else {
        log('success', 'No bundling needed (no imports)');
      }
    } catch (bundleErr) {
      log('warn', `Bundling skipped: ${bundleErr instanceof Error ? bundleErr.message : String(bundleErr)}`);
      bundledCode = entryFile.content;
    }

    // Generate draft version
    const draftVersion = `draft-${Date.now()}`;

    // Initialize R2 service
    const r2Service = createR2Service();

    // Normalize file names
    const normalizeFileName = (name: string): string => {
      const parts = name.split('/');
      if (parts.length > 1) {
        const firstPart = validatedFiles[0]?.name.split('/')[0];
        const allSameRoot = validatedFiles.every(f => f.name.startsWith(firstPart + '/'));
        if (allSameRoot && parts[0] === firstPart) {
          return parts.slice(1).join('/');
        }
      }
      return name;
    };

    const normalizedEntryName = normalizeFileName(entryFile.name);

    // Prepare files for upload
    const filesToUpload = bundleUsed
      ? [
          {
            name: normalizedEntryName,
            content: new TextEncoder().encode(bundledCode),
            contentType: getContentType(normalizedEntryName),
          },
          // Upload ESM bundle for browser rendering
          ...(esmBundledCode ? [{
            name: normalizedEntryName.replace(/\.(tsx?|jsx?)$/, '.esm.js'),
            content: new TextEncoder().encode(esmBundledCode),
            contentType: 'application/javascript',
          }] : []),
          // Upload original entry file with _source_ prefix for generate-docs parsing
          {
            name: `_source_${normalizedEntryName}`,
            content: new TextEncoder().encode(entryFile.content),
            contentType: getContentType(normalizedEntryName),
          },
          ...validatedFiles
            .filter(f => f.name !== entryFile.name)
            .map(f => ({
              name: normalizeFileName(f.name),
              content: new TextEncoder().encode(f.content),
              contentType: getContentType(f.name),
            })),
        ]
      : validatedFiles.map(f => ({
          name: normalizeFileName(f.name),
          content: new TextEncoder().encode(f.content),
          contentType: getContentType(f.name),
        }));

    // Upload to draft storage location
    log('info', 'Uploading draft to storage...');
    const draftStorageKey = `apps/${appId}/draft/`;
    await r2Service.uploadFiles(draftStorageKey, filesToUpload);
    log('success', 'Draft upload complete');

    // Update app record with draft info
    log('info', 'Updating app record...');
    await appsService.update(appId, {
      draft_storage_key: draftStorageKey,
      draft_version: draftVersion,
      draft_uploaded_at: new Date().toISOString(),
      draft_exports: exports,
    });
    log('success', 'Draft record updated');

    log('success', 'Draft build complete! Use POST /api/apps/:appId/publish to publish.');

    const response: DraftUploadResponse = {
      app_id: appId,
      draft_version: draftVersion,
      draft_storage_key: draftStorageKey,
      exports,
      build_success: true,
      build_logs: buildLogs,
      message: 'Draft uploaded successfully. Publish when ready to update the app and regenerate documentation.',
    };

    return json(response, 200);
  } catch (err) {
    console.error('Draft upload error:', err);
    return error(err instanceof Error ? err.message : 'Draft upload failed', 500);
  }
}

// ============================================
// PROGRAMMATIC UPLOAD FUNCTIONS
// For use by Platform MCP and CLI
// ============================================

interface UploadOptions {
  name?: string;
  slug?: string;
  description?: string;
  visibility?: 'private' | 'unlisted' | 'public';
  // v2 architecture: explicit entry points and app type
  app_type?: 'mcp';
  functions_entry?: string;  // e.g., "functions.ts"
  gap_id?: string;  // Links upload to a platform gap for assessment
}

/**
 * Programmatic upload handler for Platform MCP
 * Creates a new app from file array
 */
export async function handleUploadFiles(
  userId: string,
  files: UploadFile[],
  options: UploadOptions = {}
): Promise<UploadResponse & { docs_generated?: boolean; docs_error?: string }> {
  // Validate file count
  if (files.length === 0) {
    throw new Error('No files provided');
  }
  if (files.length > MAX_FILES_PER_UPLOAD) {
    throw new Error(`Maximum ${MAX_FILES_PER_UPLOAD} files allowed`);
  }

  // Validate file types and size
  let totalSize = 0;
  const validatedFiles: Array<{ name: string; content: string }> = [];

  for (const file of files) {
    const hasValidExt = ALLOWED_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext));
    if (!hasValidExt) {
      throw new Error(`File type not allowed: ${file.name}`);
    }

    totalSize += file.size;
    if (totalSize > MAX_UPLOAD_SIZE_BYTES) {
      throw new Error(`Total upload size exceeds ${MAX_UPLOAD_SIZE_BYTES / 1024 / 1024}MB limit`);
    }

    validatedFiles.push({ name: file.name, content: file.content });
  }

  // Check for manifest.json
  const manifestFile = validatedFiles.find((f) => {
    const fileName = f.name.split('/').pop() || f.name;
    return fileName === 'manifest.json';
  });

  let manifest: AppManifest | null = null;
  if (manifestFile) {
    try {
      const manifestJson = JSON.parse(manifestFile.content);
      const validation = validateManifest(manifestJson);
      if (validation.valid) {
        manifest = validation.manifest!;
      }
    } catch {
      // Ignore parse errors, fall back to options/auto-detect
    }
  }

  // Override manifest with options if provided (options take precedence)
  if (options.app_type || options.functions_entry) {
    const optionsManifest: AppManifest = manifest ? { ...manifest } : {
      name: options.name || 'Untitled App',
      version: '1.0.0',
      type: options.app_type || 'mcp',
      entry: {},
    };

    if (options.app_type) {
      optionsManifest.type = options.app_type;
    }
    if (options.functions_entry) {
      optionsManifest.entry.functions = options.functions_entry;
    }
    if (options.description) {
      optionsManifest.description = options.description;
    }

    manifest = optionsManifest;
  }

  // Determine entry file based on manifest or fallback to auto-detection
  let entryFile: { name: string; content: string } | undefined;
  let functionsFile: { name: string; content: string } | undefined;

  if (manifest) {
    if (manifest.entry.functions) {
      functionsFile = validatedFiles.find((f) => {
        const fileName = f.name.split('/').pop() || f.name;
        return fileName === manifest!.entry.functions;
      });
      if (!functionsFile) {
        throw new Error(`Functions entry file not found: ${manifest.entry.functions}`);
      }
    }

    entryFile = functionsFile;
  } else {
    // Legacy: auto-detect entry file
    const entryFileNames = ['index.tsx', 'index.ts', 'index.jsx', 'index.js'];
    entryFile = validatedFiles.find((f) => {
      const fileName = f.name.split('/').pop() || f.name;
      return entryFileNames.includes(fileName);
    });
  }

  if (!entryFile) {
    throw new Error('Entry file required. Either provide manifest.json, options.functions_entry, or include index.ts/index.tsx');
  }

  // Build logs
  const buildLogs: BuildLogEntry[] = [];
  const log = (level: BuildLogEntry['level'], message: string) => {
    buildLogs.push({ time: new Date().toISOString(), level, message });
  };

  log('info', `Starting build for ${validatedFiles.length} files...`);

  if (manifest) {
    log('info', `Using manifest (type: ${manifest.type})`);
  }

  // Extract exports - prefer manifest declarations over code parsing
  log('info', 'Determining exports...');
  let exports: string[];
  if (manifest?.functions) {
    exports = Object.keys(manifest.functions);
    log('success', `Found ${exports.length} functions from manifest: ${exports.join(', ')}`);
  } else {
    exports = extractExports(entryFile.content);
    log('success', `Found ${exports.length} exports from code: ${exports.join(', ')}`);
  }

  // Bundle the code
  log('info', 'Bundling code...');
  let bundledCode = entryFile.content;
  let esmBundledCode: string | undefined;
  let bundleUsed = false;

  try {
    log('info', 'Running esbuild bundler...');
    const bundleResult = await bundleCode(validatedFiles, entryFile.name);

    if (!bundleResult.success) {
      for (const err of bundleResult.errors) {
        log('error', err);
      }
      throw new Error('Build failed: ' + bundleResult.errors.join(', '));
    }

    for (const warn of bundleResult.warnings) {
      log('warn', warn);
    }

    if (bundleResult.code !== entryFile.content) {
      bundledCode = bundleResult.code;
      esmBundledCode = bundleResult.esmCode;
      bundleUsed = true;
      log('success', 'Bundle complete (IIFE + ESM)');
    } else {
      log('success', 'No bundling needed (no imports)');
    }
  } catch (bundleErr) {
    log('warn', `Bundling skipped: ${bundleErr instanceof Error ? bundleErr.message : String(bundleErr)}`);
    bundledCode = entryFile.content;
  }

  // Generate app ID and version
  const appId = crypto.randomUUID();
  const version = manifest?.version || '1.0.0';
  const slug = options.slug || generateSlug(validatedFiles.find((f) => f.name === 'package.json')?.content);
  const appName = manifest?.name || options.name || slug;
  const appDescription = options.description || manifest?.description || null;
  const appType = manifest?.type || null;

  // Initialize services
  const r2Service = createR2Service();
  const appsService = createAppsService();

  // Normalize file names
  const normalizeFileName = (name: string): string => {
    const parts = name.split('/');
    if (parts.length > 1) {
      const firstPart = validatedFiles[0]?.name.split('/')[0];
      const allSameRoot = validatedFiles.every(f => f.name.startsWith(firstPart + '/'));
      if (allSameRoot && parts[0] === firstPart) {
        return parts.slice(1).join('/');
      }
    }
    return name;
  };

  const normalizedEntryName = normalizeFileName(entryFile.name);
  log('info', `Entry file normalized: ${entryFile.name} -> ${normalizedEntryName}`);

  // Prepare files for upload
  const filesToUpload = bundleUsed
    ? [
        {
          name: normalizedEntryName,
          content: new TextEncoder().encode(bundledCode),
          contentType: getContentType(normalizedEntryName),
        },
        // Upload ESM bundle for browser rendering
        ...(esmBundledCode ? [{
          name: normalizedEntryName.replace(/\.(tsx?|jsx?)$/, '.esm.js'),
          content: new TextEncoder().encode(esmBundledCode),
          contentType: 'application/javascript',
        }] : []),
        // Upload original entry file with _source_ prefix for generate-docs parsing
        {
          name: `_source_${normalizedEntryName}`,
          content: new TextEncoder().encode(entryFile.content),
          contentType: getContentType(normalizedEntryName),
        },
        ...validatedFiles
          .filter(f => f.name !== entryFile.name)
          .map(f => ({
            name: normalizeFileName(f.name),
            content: new TextEncoder().encode(f.content),
            contentType: getContentType(f.name),
          })),
      ]
    : validatedFiles.map(f => ({
        name: normalizeFileName(f.name),
        content: new TextEncoder().encode(f.content),
        contentType: getContentType(f.name),
      }));

  // Upload files to R2
  log('info', 'Uploading to storage...');
  const storageKey = `apps/${appId}/${version}/`;
  await r2Service.uploadFiles(storageKey, filesToUpload);
  log('success', 'Upload complete');

  // Gate visibility by tier before creating app
  const requestedVisibility = options.visibility || 'private';
  if (requestedVisibility !== 'private') {
    const userTier = await getUserTier(userId);
    const visibilityErr = checkVisibilityAllowed(userTier, requestedVisibility);
    if (visibilityErr) {
      throw new Error(visibilityErr);
    }
  }

  // Create app record in database
  log('info', 'Creating app record...');
  const createPayload: Record<string, unknown> = {
    id: appId,
    owner_id: userId,
    slug,
    name: appName,
    description: appDescription,
    visibility: requestedVisibility,
    storage_key: storageKey,
    exports,
    // Store manifest data for later use
    manifest: manifest ? JSON.stringify(manifest) : null,
    app_type: appType,
  };
  if (options.gap_id) createPayload.gap_id = options.gap_id;
  await appsService.create(createPayload as Parameters<typeof appsService.create>[0]);
  log('success', 'App record created');

  // Record storage usage for billing (fire-and-forget)
  const totalSizeBytes = filesToUpload.reduce((sum, f) => sum + f.content.byteLength, 0);
  recordUploadStorage(userId, appId, version, totalSizeBytes).catch(err =>
    console.error('[STORAGE] recordUploadStorage failed:', err)
  );

  // Auto-generate Skills.md + library entry + embedding (fire-and-forget)
  log('info', 'Generating Skills.md...');
  const appsForSkills = await appsService.findById(appId);
  if (appsForSkills) {
    generateSkillsForVersion(appsForSkills, storageKey, version)
      .then(skills => {
        if (skills.skillsMd) {
          console.log(`Skills.md generated for ${appId}`);
        }
        rebuildUserLibrary(userId).catch(err => console.error('Library rebuild failed:', err));
      })
      .catch(err => console.error('Skills generation failed:', err));
  }

  log('success', 'Build complete!');

  return {
    app_id: appId,
    slug,
    version,
    url: `/a/${appId}`,
    exports,
    build_success: true,
    build_logs: buildLogs,
  };
}

/**
 * Programmatic draft upload handler for Platform MCP
 * Uploads files as draft for an existing app
 */
export async function handleDraftUploadFiles(
  appId: string,
  userId: string,
  files: UploadFile[]
): Promise<{
  app_id: string;
  draft_version: string;
  draft_storage_key: string;
  exports: string[];
  build_success: boolean;
  build_logs: BuildLogEntry[];
  message: string;
}> {
  // Get the app and verify ownership
  const appsService = createAppsService();
  const app = await appsService.findById(appId);

  if (!app) {
    throw new Error('App not found');
  }

  if (app.owner_id !== userId) {
    throw new Error('Unauthorized');
  }

  // Validate file count
  if (files.length === 0) {
    throw new Error('No files provided');
  }
  if (files.length > MAX_FILES_PER_UPLOAD) {
    throw new Error(`Maximum ${MAX_FILES_PER_UPLOAD} files allowed`);
  }

  // Validate file types and size
  let totalSize = 0;
  const validatedFiles: Array<{ name: string; content: string }> = [];

  for (const file of files) {
    const hasValidExt = ALLOWED_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext));
    if (!hasValidExt) {
      throw new Error(`File type not allowed: ${file.name}`);
    }

    totalSize += file.size;
    if (totalSize > MAX_UPLOAD_SIZE_BYTES) {
      throw new Error(`Total upload size exceeds ${MAX_UPLOAD_SIZE_BYTES / 1024 / 1024}MB limit`);
    }

    validatedFiles.push({ name: file.name, content: file.content });
  }

  // Check for entry file
  const entryFileNames = ['index.tsx', 'index.ts', 'index.jsx', 'index.js'];
  const entryFile = validatedFiles.find((f) => {
    const fileName = f.name.split('/').pop() || f.name;
    return entryFileNames.includes(fileName);
  });
  if (!entryFile) {
    throw new Error('Entry file (index.ts, index.tsx, index.js, or index.jsx) required');
  }

  // Build logs
  const buildLogs: BuildLogEntry[] = [];
  const log = (level: BuildLogEntry['level'], message: string) => {
    buildLogs.push({ time: new Date().toISOString(), level, message });
  };

  const hasDraft = !!(app as Record<string, unknown>).draft_storage_key;
  if (hasDraft) {
    log('warn', 'Overwriting existing draft');
  }

  log('info', `Starting draft build for ${validatedFiles.length} files...`);

  // Extract exports
  log('info', 'Parsing entry file...');
  const exports = extractExports(entryFile.content);
  log('success', `Found ${exports.length} exports: ${exports.join(', ')}`);

  // Bundle the code
  log('info', 'Bundling code...');
  let bundledCode = entryFile.content;
  let esmBundledCode: string | undefined;
  let bundleUsed = false;

  try {
    log('info', 'Running esbuild bundler...');
    const bundleResult = await bundleCode(validatedFiles, entryFile.name);

    if (!bundleResult.success) {
      for (const err of bundleResult.errors) {
        log('error', err);
      }
      throw new Error('Build failed: ' + bundleResult.errors.join(', '));
    }

    for (const warn of bundleResult.warnings) {
      log('warn', warn);
    }

    if (bundleResult.code !== entryFile.content) {
      bundledCode = bundleResult.code;
      esmBundledCode = bundleResult.esmCode;
      bundleUsed = true;
      log('success', 'Bundle complete (IIFE + ESM)');
    } else {
      log('success', 'No bundling needed (no imports)');
    }
  } catch (bundleErr) {
    log('warn', `Bundling skipped: ${bundleErr instanceof Error ? bundleErr.message : String(bundleErr)}`);
    bundledCode = entryFile.content;
  }

  // Generate draft version
  const draftVersion = `draft-${Date.now()}`;

  // Initialize R2 service
  const r2Service = createR2Service();

  // Normalize file names
  const normalizeFileName = (name: string): string => {
    const parts = name.split('/');
    if (parts.length > 1) {
      const firstPart = validatedFiles[0]?.name.split('/')[0];
      const allSameRoot = validatedFiles.every(f => f.name.startsWith(firstPart + '/'));
      if (allSameRoot && parts[0] === firstPart) {
        return parts.slice(1).join('/');
      }
    }
    return name;
  };

  const normalizedEntryName = normalizeFileName(entryFile.name);

  // Prepare files for upload
  const filesToUpload = bundleUsed
    ? [
        {
          name: normalizedEntryName,
          content: new TextEncoder().encode(bundledCode),
          contentType: getContentType(normalizedEntryName),
        },
        // Upload ESM bundle for browser rendering
        ...(esmBundledCode ? [{
          name: normalizedEntryName.replace(/\.(tsx?|jsx?)$/, '.esm.js'),
          content: new TextEncoder().encode(esmBundledCode),
          contentType: 'application/javascript',
        }] : []),
        // Upload original entry file with _source_ prefix for generate-docs parsing
        {
          name: `_source_${normalizedEntryName}`,
          content: new TextEncoder().encode(entryFile.content),
          contentType: getContentType(normalizedEntryName),
        },
        ...validatedFiles
          .filter(f => f.name !== entryFile.name)
          .map(f => ({
            name: normalizeFileName(f.name),
            content: new TextEncoder().encode(f.content),
            contentType: getContentType(f.name),
          })),
      ]
    : validatedFiles.map(f => ({
        name: normalizeFileName(f.name),
        content: new TextEncoder().encode(f.content),
        contentType: getContentType(f.name),
      }));

  // Upload to draft storage location
  log('info', 'Uploading draft to storage...');
  const draftStorageKey = `apps/${appId}/draft/`;
  await r2Service.uploadFiles(draftStorageKey, filesToUpload);
  log('success', 'Draft upload complete');

  // Update app record with draft info
  log('info', 'Updating app record...');
  await appsService.update(appId, {
    draft_storage_key: draftStorageKey,
    draft_version: draftVersion,
    draft_uploaded_at: new Date().toISOString(),
    draft_exports: exports,
  });
  log('success', 'Draft record updated');

  log('success', 'Draft build complete!');

  return {
    app_id: appId,
    draft_version: draftVersion,
    draft_storage_key: draftStorageKey,
    exports,
    build_success: true,
    build_logs: buildLogs,
    message: 'Draft uploaded successfully. Publish when ready.',
  };
}
