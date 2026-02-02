// Upload Handler
// Processes file uploads, validates, bundles, stores to R2, creates app record

import { error, json } from './app.ts';
import type { BuildLogEntry, UploadResponse } from '../../shared/types/index.ts';
import {
  ALLOWED_EXTENSIONS,
  MAX_FILES_PER_UPLOAD,
  MAX_UPLOAD_SIZE_BYTES,
} from '../../shared/types/index.ts';
import { createR2Service } from '../services/storage.ts';
import { createAppsService } from '../services/apps.ts';
import { bundleCode, quickBundle } from '../services/bundler.ts';
import { authenticate } from './auth.ts';

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

    // Check for entry file - handle both flat files and folder uploads
    // When uploading a folder, file.name includes path like "myapp/index.ts"
    const entryFile = validatedFiles.find((f) => {
      const fileName = f.name.split('/').pop() || f.name;
      return fileName === 'index.ts' || fileName === 'index.js';
    });
    if (!entryFile) {
      console.log('Files received:', validatedFiles.map(f => f.name));
      return error('Entry file (index.ts or index.js) required');
    }
    console.log('Entry file found:', entryFile.name);

    // Build logs
    const buildLogs: BuildLogEntry[] = [];
    const log = (level: BuildLogEntry['level'], message: string) => {
      buildLogs.push({ time: new Date().toISOString(), level, message });
    };

    log('info', `Starting build for ${validatedFiles.length} files...`);

    // Extract exports from original code (before bundling)
    log('info', 'Parsing entry file...');
    const exports = extractExports(entryFile.content);
    log('success', `Found ${exports.length} exports: ${exports.join(', ')}`);

    // Bundle the code
    // IMPORTANT: We must bundle ALL imports (relative and external) into a single file
    // because data URL imports cannot resolve relative paths
    log('info', 'Bundling code...');
    let bundledCode = entryFile.content;
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
        bundleUsed = true;
        log('success', 'Bundle complete');
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
    const version = '1.0.0';
    const slug = generateSlug(validatedFiles.find((f) => f.name === 'package.json')?.content);

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
    const filesToUpload = bundleUsed
      ? [
          // Upload bundled code as the entry file
          {
            name: normalizedEntryName,
            content: new TextEncoder().encode(bundledCode),
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
      name: slug,
      storage_key: storageKey,
      exports,
    });
    log('success', 'App record created');

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
  if (filename.endsWith('.ts')) return 'text/typescript';
  if (filename.endsWith('.js')) return 'application/javascript';
  if (filename.endsWith('.json')) return 'application/json';
  if (filename.endsWith('.md')) return 'text/markdown';
  return 'text/plain';
}
