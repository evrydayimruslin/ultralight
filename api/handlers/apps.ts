// Apps Handler
// Handles app listing, discovery, and app-specific operations

import { json, error } from './app.ts';
import { authenticate } from './auth.ts';
import { createAppsService } from '../services/apps.ts';
import { createR2Service } from '../services/storage.ts';
import { parseTypeScript, toSkillsParsed } from '../services/parser.ts';
import {
  generateSkillsMd,
  validateAndParseSkillsMd,
  generateEmbeddingText
} from '../services/docgen.ts';
import {
  createEmbeddingService,
  isEmbeddingAvailable,
  storeAppEmbedding
} from '../services/embedding.ts';
import type { GenerationResult, GenerationError } from '../../shared/types/index.ts';

// Type for user with optional API key
interface User {
  id: string;
  openrouter_api_key?: string;
}

/**
 * Handle /api/apps routes
 */
export async function handleApps(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  console.log('[APPS] handleApps called:', method, path);

  // GET /api/apps - List public apps
  if (path === '/api/apps' && method === 'GET') {
    console.log('[APPS] Routing to handleListPublicApps');
    return handleListPublicApps(request);
  }

  // GET /api/apps/me - List user's own apps (authenticated)
  if (path === '/api/apps/me' && method === 'GET') {
    console.log('[APPS] Routing to handleListMyApps');
    return handleListMyApps(request);
  }

  // Routes with app ID: /api/apps/:appId/*
  const appIdMatch = path.match(/^\/api\/apps\/([^\/]+)(\/.*)?$/);
  if (appIdMatch) {
    const appId = appIdMatch[1];
    const subPath = appIdMatch[2] || '';

    // GET /api/apps/:appId - Get app details
    if (subPath === '' && method === 'GET') {
      return handleGetApp(request, appId);
    }

    // GET /api/apps/:appId/code - Get app code (for client-side execution)
    if (subPath === '/code' && method === 'GET') {
      return handleGetAppCode(request, appId);
    }

    // PATCH /api/apps/:appId - Update app
    if (subPath === '' && method === 'PATCH') {
      return handleUpdateApp(request, appId);
    }

    // DELETE /api/apps/:appId - Delete app
    if (subPath === '' && method === 'DELETE') {
      return handleDeleteApp(request, appId);
    }

    // POST /api/apps/:appId/icon - Upload app icon
    if (subPath === '/icon' && method === 'POST') {
      return handleUploadIcon(request, appId);
    }

    // GET /api/apps/:appId/icon - Serve app icon
    if (subPath === '/icon' && method === 'GET') {
      return handleGetIcon(request, appId);
    }

    // GET /api/apps/:appId/download - Download app code as zip
    if (subPath === '/download' && method === 'GET') {
      return handleDownloadCode(request, appId);
    }

    // POST /api/apps/:appId/generate-docs - Generate Skills.md and parse skills
    if (subPath === '/generate-docs' && method === 'POST') {
      return handleGenerateDocs(request, appId);
    }

    // GET /api/apps/:appId/skills.md - Get Skills.md documentation
    if (subPath === '/skills.md' && method === 'GET') {
      return handleGetSkillsMd(request, appId);
    }

    // PATCH /api/apps/:appId/skills - Update skills (with validation)
    if (subPath === '/skills' && method === 'PATCH') {
      return handleUpdateSkills(request, appId);
    }

    // POST /api/apps/:appId/draft - Upload new code as draft
    if (subPath === '/draft' && method === 'POST') {
      // Import and call draft upload handler
      const { handleDraftUpload } = await import('./upload.ts');
      return handleDraftUpload(request, appId);
    }

    // POST /api/apps/:appId/publish - Publish draft to production
    if (subPath === '/publish' && method === 'POST') {
      return handlePublishDraft(request, appId);
    }

    // DELETE /api/apps/:appId/draft - Discard draft
    if (subPath === '/draft' && method === 'DELETE') {
      return handleDiscardDraft(request, appId);
    }

    // GET /api/apps/:appId/draft - Get draft info
    if (subPath === '/draft' && method === 'GET') {
      return handleGetDraft(request, appId);
    }
  }

  return error('Not found', 404);
}

/**
 * List public apps for discovery
 */
async function handleListPublicApps(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const search = url.searchParams.get('q') || '';

  // TODO: Query database for public apps with search
  // For now, return empty array
  const apps: unknown[] = [];

  return json({ apps });
}

/**
 * List authenticated user's own apps
 */
async function handleListMyApps(request: Request): Promise<Response> {
  console.log('handleListMyApps: called');

  // Step 1: Authenticate
  let user;
  try {
    console.log('handleListMyApps: starting auth check');
    user = await authenticate(request);
    console.log('handleListMyApps: authenticated user:', user.id);
  } catch (authErr) {
    console.error('handleListMyApps: auth failed:', authErr);
    return error('Authentication required', 401);
  }

  // Step 2: Create service
  let appsService;
  try {
    console.log('handleListMyApps: creating apps service');
    appsService = createAppsService();
    console.log('handleListMyApps: apps service created');
  } catch (serviceErr) {
    console.error('handleListMyApps: failed to create service:', serviceErr);
    return error('Service initialization failed', 500);
  }

  // Step 3: List apps
  try {
    console.log('handleListMyApps: listing apps for user:', user.id);
    const apps = await appsService.listByOwner(user.id);
    console.log('handleListMyApps: found', apps.length, 'apps');
    return json(apps);
  } catch (listErr) {
    console.error('handleListMyApps: failed to list apps:', listErr);
    return error('Failed to list apps', 500);
  }
}

/**
 * Get app details
 */
async function handleGetApp(request: Request, appId: string): Promise<Response> {
  try {
    const appsService = createAppsService();
    const app = await appsService.findById(appId);

    if (!app) {
      return error('App not found', 404);
    }

    // Check visibility - only owner can see private apps
    if (app.visibility === 'private') {
      try {
        const user = await authenticate(request);
        if (user.id !== app.owner_id) {
          return error('App not found', 404);
        }
      } catch {
        return error('App not found', 404);
      }
    }

    return json(app);
  } catch (err) {
    console.error('Failed to get app:', err);
    return error('Failed to get app', 500);
  }
}

/**
 * Get app code for client-side execution
 */
async function handleGetAppCode(request: Request, appId: string): Promise<Response> {
  try {
    console.log('handleGetAppCode: fetching app', appId);
    const appsService = createAppsService();
    const r2Service = createR2Service();

    const app = await appsService.findById(appId);
    console.log('handleGetAppCode: app found:', !!app, app?.visibility);

    if (!app) {
      console.log('handleGetAppCode: app not found in database');
      return error('App not found', 404);
    }

    // Check visibility - only owner can access private apps
    if (app.visibility === 'private') {
      console.log('handleGetAppCode: app is private, checking auth');
      try {
        const user = await authenticate(request);
        console.log('handleGetAppCode: authenticated user:', user.id, 'owner:', app.owner_id);
        if (user.id !== app.owner_id) {
          console.log('handleGetAppCode: user is not owner');
          return error('App not found', 404);
        }
      } catch (authErr) {
        console.log('handleGetAppCode: auth failed for private app:', authErr);
        return error('App not found', 404);
      }
    }

    // Fetch code from R2 - try different entry file extensions
    const storageKey = app.storage_key;
    console.log('handleGetAppCode: fetching code from R2, storageKey:', storageKey);
    let code: string | null = null;

    // Try entry files in order of preference: tsx, ts, jsx, js
    const entryFiles = ['index.tsx', 'index.ts', 'index.jsx', 'index.js'];
    for (const entryFile of entryFiles) {
      try {
        code = await r2Service.fetchTextFile(`${storageKey}${entryFile}`);
        console.log(`handleGetAppCode: loaded ${entryFile}, length:`, code?.length);
        break;
      } catch {
        console.log(`handleGetAppCode: ${entryFile} not found, trying next...`);
      }
    }

    if (!code) {
      console.log('handleGetAppCode: no entry file found');
      return error('App code not found', 404);
    }

    return json({
      code,
      name: app.name || app.slug,
      appId: app.id,
    });
  } catch (err) {
    console.error('Failed to get app code:', err);
    return error('Failed to get app code', 500);
  }
}

/**
 * Update app settings
 */
async function handleUpdateApp(request: Request, appId: string): Promise<Response> {
  try {
    const user = await authenticate(request);
    const appsService = createAppsService();

    const app = await appsService.findById(appId);

    if (!app) {
      return error('App not found', 404);
    }

    // Only owner can update
    if (app.owner_id !== user.id) {
      return error('Unauthorized', 403);
    }

    const updates = await request.json();

    // Whitelist allowed updates
    const allowedFields = ['name', 'description', 'visibility', 'icon_url', 'tags', 'category', 'download_access'];
    const filteredUpdates: Record<string, unknown> = {};

    for (const field of allowedFields) {
      if (field in updates) {
        filteredUpdates[field] = updates[field];
      }
    }

    if (Object.keys(filteredUpdates).length === 0) {
      return error('No valid fields to update', 400);
    }

    const updatedApp = await appsService.update(appId, filteredUpdates);

    return json(updatedApp);
  } catch (err) {
    if (err instanceof Error && err.message.includes('Authentication')) {
      return error('Authentication required', 401);
    }
    console.error('Failed to update app:', err);
    return error('Failed to update app', 500);
  }
}

/**
 * Soft delete an app
 */
async function handleDeleteApp(request: Request, appId: string): Promise<Response> {
  try {
    const user = await authenticate(request);
    const appsService = createAppsService();

    const app = await appsService.findById(appId);

    if (!app) {
      return error('App not found', 404);
    }

    // Only owner can delete
    if (app.owner_id !== user.id) {
      return error('Unauthorized', 403);
    }

    // Soft delete - set deleted_at timestamp
    await appsService.update(appId, {
      deleted_at: new Date().toISOString(),
    });

    return json({ success: true, message: 'App deleted' });
  } catch (err) {
    if (err instanceof Error && err.message.includes('Authentication')) {
      return error('Authentication required', 401);
    }
    console.error('Failed to delete app:', err);
    return error('Failed to delete app', 500);
  }
}

/**
 * Upload app icon
 */
async function handleUploadIcon(request: Request, appId: string): Promise<Response> {
  try {
    const user = await authenticate(request);
    const appsService = createAppsService();
    const r2Service = createR2Service();

    const app = await appsService.findById(appId);

    if (!app) {
      return error('App not found', 404);
    }

    // Only owner can upload icon
    if (app.owner_id !== user.id) {
      return error('Unauthorized', 403);
    }

    // Parse multipart form data
    const formData = await request.formData();
    const iconFile = formData.get('icon') as File | null;

    if (!iconFile) {
      return error('No icon file provided', 400);
    }

    // Validate file type
    const allowedTypes = ['image/png', 'image/jpeg', 'image/webp'];
    if (!allowedTypes.includes(iconFile.type)) {
      return error('Invalid file type. Use PNG, JPG, or WebP.', 400);
    }

    // Validate file size (1MB max)
    if (iconFile.size > 1024 * 1024) {
      return error('Icon must be less than 1MB', 400);
    }

    // Get file extension
    const ext = iconFile.type === 'image/png' ? 'png' : iconFile.type === 'image/jpeg' ? 'jpg' : 'webp';
    const iconKey = `apps/${appId}/icon.${ext}`;

    // Upload to R2
    const content = new Uint8Array(await iconFile.arrayBuffer());
    await r2Service.uploadFile(iconKey, {
      name: `icon.${ext}`,
      content,
      contentType: iconFile.type,
    });

    // Generate icon URL (using the app route to serve it)
    const iconUrl = `/api/apps/${appId}/icon`;

    // Update app record
    await appsService.update(appId, { icon_url: iconUrl });

    return json({ success: true, icon_url: iconUrl });
  } catch (err) {
    if (err instanceof Error && err.message.includes('Authentication')) {
      return error('Authentication required', 401);
    }
    console.error('Failed to upload icon:', err);
    return error('Failed to upload icon', 500);
  }
}

/**
 * Serve app icon
 */
async function handleGetIcon(request: Request, appId: string): Promise<Response> {
  try {
    const r2Service = createR2Service();

    // Try different extensions
    const extensions = ['png', 'jpg', 'webp'];
    let iconContent: Uint8Array | null = null;
    let contentType = 'image/png';

    for (const ext of extensions) {
      try {
        iconContent = await r2Service.fetchFile(`apps/${appId}/icon.${ext}`);
        contentType = ext === 'png' ? 'image/png' : ext === 'jpg' ? 'image/jpeg' : 'image/webp';
        break;
      } catch {
        // Try next extension
      }
    }

    if (!iconContent) {
      return error('Icon not found', 404);
    }

    return new Response(iconContent, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400', // Cache for 1 day
      },
    });
  } catch (err) {
    console.error('Failed to get icon:', err);
    return error('Failed to get icon', 500);
  }
}

/**
 * Download app code as zip
 */
async function handleDownloadCode(request: Request, appId: string): Promise<Response> {
  try {
    const appsService = createAppsService();
    const r2Service = createR2Service();

    const app = await appsService.findById(appId);

    if (!app) {
      return error('App not found', 404);
    }

    // Check download access
    const downloadAccess = (app as Record<string, unknown>).download_access || 'owner';

    if (downloadAccess === 'owner') {
      // Only owner can download
      try {
        const user = await authenticate(request);
        if (user.id !== app.owner_id) {
          return error('Download not allowed', 403);
        }
      } catch {
        return error('Authentication required', 401);
      }
    }
    // If download_access is 'public', anyone can download

    // List all files in the app's storage
    const storageKey = app.storage_key;
    const fileKeys = await r2Service.listFiles(storageKey);

    if (fileKeys.length === 0) {
      return error('No files found', 404);
    }

    // Create a simple zip file manually (without external dependencies)
    // Using a basic ZIP format implementation
    const files: Array<{ name: string; content: Uint8Array }> = [];

    for (const key of fileKeys) {
      try {
        const content = await r2Service.fetchFile(key);
        // Remove the storage prefix from the filename
        const fileName = key.replace(storageKey, '');
        if (fileName) {
          files.push({ name: fileName, content });
        }
      } catch (e) {
        console.error(`Failed to fetch file ${key}:`, e);
      }
    }

    if (files.length === 0) {
      return error('No files could be read', 500);
    }

    // Build ZIP file
    const zipContent = buildZip(files);

    return new Response(zipContent, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${app.name || app.slug}.zip"`,
      },
    });
  } catch (err) {
    console.error('Failed to download code:', err);
    return error('Failed to download code', 500);
  }
}

/**
 * Build a ZIP file from files array
 * Simple implementation without external dependencies
 */
function buildZip(files: Array<{ name: string; content: Uint8Array }>): Uint8Array {
  const localFileHeaders: Uint8Array[] = [];
  const centralDirectoryHeaders: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const fileName = new TextEncoder().encode(file.name);
    const content = file.content;

    // Local file header
    const localHeader = new Uint8Array(30 + fileName.length);
    const localView = new DataView(localHeader.buffer);

    localView.setUint32(0, 0x04034b50, true); // Local file header signature
    localView.setUint16(4, 20, true); // Version needed to extract
    localView.setUint16(6, 0, true); // General purpose bit flag
    localView.setUint16(8, 0, true); // Compression method (stored)
    localView.setUint16(10, 0, true); // File last modification time
    localView.setUint16(12, 0, true); // File last modification date
    localView.setUint32(14, crc32(content), true); // CRC-32
    localView.setUint32(18, content.length, true); // Compressed size
    localView.setUint32(22, content.length, true); // Uncompressed size
    localView.setUint16(26, fileName.length, true); // File name length
    localView.setUint16(28, 0, true); // Extra field length
    localHeader.set(fileName, 30);

    localFileHeaders.push(localHeader);
    localFileHeaders.push(content);

    // Central directory header
    const centralHeader = new Uint8Array(46 + fileName.length);
    const centralView = new DataView(centralHeader.buffer);

    centralView.setUint32(0, 0x02014b50, true); // Central directory signature
    centralView.setUint16(4, 20, true); // Version made by
    centralView.setUint16(6, 20, true); // Version needed to extract
    centralView.setUint16(8, 0, true); // General purpose bit flag
    centralView.setUint16(10, 0, true); // Compression method
    centralView.setUint16(12, 0, true); // File last modification time
    centralView.setUint16(14, 0, true); // File last modification date
    centralView.setUint32(16, crc32(content), true); // CRC-32
    centralView.setUint32(20, content.length, true); // Compressed size
    centralView.setUint32(24, content.length, true); // Uncompressed size
    centralView.setUint16(28, fileName.length, true); // File name length
    centralView.setUint16(30, 0, true); // Extra field length
    centralView.setUint16(32, 0, true); // File comment length
    centralView.setUint16(34, 0, true); // Disk number start
    centralView.setUint16(36, 0, true); // Internal file attributes
    centralView.setUint32(38, 0, true); // External file attributes
    centralView.setUint32(42, offset, true); // Relative offset of local header
    centralHeader.set(fileName, 46);

    centralDirectoryHeaders.push(centralHeader);
    offset += localHeader.length + content.length;
  }

  // End of central directory record
  const centralDirSize = centralDirectoryHeaders.reduce((sum, h) => sum + h.length, 0);
  const endRecord = new Uint8Array(22);
  const endView = new DataView(endRecord.buffer);

  endView.setUint32(0, 0x06054b50, true); // End of central directory signature
  endView.setUint16(4, 0, true); // Number of this disk
  endView.setUint16(6, 0, true); // Disk where central directory starts
  endView.setUint16(8, files.length, true); // Number of central directory records on this disk
  endView.setUint16(10, files.length, true); // Total number of central directory records
  endView.setUint32(12, centralDirSize, true); // Size of central directory
  endView.setUint32(16, offset, true); // Offset of start of central directory
  endView.setUint16(20, 0, true); // Comment length

  // Combine all parts
  const totalSize = offset + centralDirSize + 22;
  const zip = new Uint8Array(totalSize);
  let pos = 0;

  for (const header of localFileHeaders) {
    zip.set(header, pos);
    pos += header.length;
  }

  for (const header of centralDirectoryHeaders) {
    zip.set(header, pos);
    pos += header.length;
  }

  zip.set(endRecord, pos);

  return zip;
}

/**
 * CRC-32 calculation for ZIP files
 */
function crc32(data: Uint8Array): number {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c;
  }

  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc = table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ============================================
// DOCUMENTATION GENERATION HANDLERS
// ============================================

/**
 * Generate Skills.md documentation from app code
 * POST /api/apps/:appId/generate-docs
 */
async function handleGenerateDocs(request: Request, appId: string): Promise<Response> {
  const errors: GenerationError[] = [];
  const warnings: string[] = [];

  try {
    // Authenticate - only owner can generate docs
    const user = await authenticate(request);
    const appsService = createAppsService();
    const r2Service = createR2Service();

    const app = await appsService.findById(appId);
    if (!app) {
      return error('App not found', 404);
    }

    if (app.owner_id !== user.id) {
      return error('Unauthorized', 403);
    }

    // Check if generation is already in progress (debounce/lock)
    if ((app as Record<string, unknown>).generation_in_progress) {
      return error('Documentation generation already in progress', 409);
    }

    // Set generation lock
    await appsService.update(appId, { generation_in_progress: true });

    try {
      // Parse request body for options
      let options = { ai_enhance: false };
      try {
        const body = await request.json();
        options = { ...options, ...body };
      } catch {
        // No body or invalid JSON - use defaults
      }

      // Fetch app code from R2
      const storageKey = app.storage_key;
      let code: string | null = null;
      let filename = 'index.ts';

      const entryFiles = ['index.tsx', 'index.ts', 'index.jsx', 'index.js'];
      for (const entryFile of entryFiles) {
        try {
          code = await r2Service.fetchTextFile(`${storageKey}${entryFile}`);
          filename = entryFile;
          break;
        } catch {
          // Try next
        }
      }

      if (!code) {
        errors.push({
          phase: 'parse',
          message: 'No entry file found (index.ts, index.tsx, index.js, or index.jsx)',
          suggestion: 'Make sure your app has an entry file named index.ts or similar.',
        });

        const result: GenerationResult = {
          success: false,
          partial: false,
          skills_md: null,
          skills_parsed: null,
          embedding_text: null,
          errors,
          warnings,
        };

        return json(result, 400);
      }

      // Phase 1: Parse TypeScript code
      console.log('[GENERATE] Parsing code...');
      const parseResult = parseTypeScript(code, filename);

      // Collect parse errors and warnings
      for (const err of parseResult.parseErrors) {
        errors.push({
          phase: 'parse',
          message: err,
          suggestion: 'Check your TypeScript syntax.',
        });
      }
      warnings.push(...parseResult.parseWarnings);

      if (parseResult.functions.length === 0) {
        warnings.push('No exported functions found. Make sure to export your functions with `export` keyword.');
      }

      // Phase 2: Generate Skills.md
      console.log('[GENERATE] Generating Skills.md...');
      let skills_md: string;
      try {
        skills_md = generateSkillsMd(app.name || app.slug, parseResult, {
          includeExamples: true,
          includePermissions: true,
        });
      } catch (genErr) {
        errors.push({
          phase: 'generate_skills',
          message: `Failed to generate Skills.md: ${genErr instanceof Error ? genErr.message : String(genErr)}`,
        });

        const result: GenerationResult = {
          success: false,
          partial: parseResult.functions.length > 0,
          skills_md: null,
          skills_parsed: parseResult.functions.length > 0 ? toSkillsParsed(parseResult) : null,
          embedding_text: null,
          errors,
          warnings,
        };

        return json(result, 500);
      }

      // Phase 3: Convert to ParsedSkills for storage
      const skills_parsed = toSkillsParsed(parseResult);

      // Phase 4: Generate embedding text
      console.log('[GENERATE] Generating embedding text...');
      const embedding_text = generateEmbeddingText(
        app.name || app.slug,
        app.description,
        skills_parsed
      );

      // Phase 5: AI Enhancement (if requested and user has BYOK)
      if (options.ai_enhance) {
        // Check if user has BYOK enabled
        if (!user.openrouter_api_key) {
          warnings.push('AI enhancement requested but BYOK not enabled. Enable BYOK for AI-enhanced descriptions.');
        } else {
          // TODO: Implement AI enhancement using OpenRouter
          warnings.push('AI enhancement is not yet implemented.');
        }
      }

      // Phase 6: Generate and store embedding
      console.log('[GENERATE] Generating embedding...');
      let embeddingGenerated = false;
      const embeddingService = createEmbeddingService((user as User).openrouter_api_key);

      if (embeddingService && embedding_text) {
        try {
          const embeddingResult = await embeddingService.embed(embedding_text);
          await storeAppEmbedding(appId, embeddingResult.embedding);
          embeddingGenerated = true;
          console.log('[GENERATE] Embedding stored successfully');
        } catch (embErr) {
          console.error('[GENERATE] Failed to generate/store embedding:', embErr);
          warnings.push(`Failed to generate embedding: ${embErr instanceof Error ? embErr.message : String(embErr)}. App will not appear in semantic search.`);
        }
      } else if (!embeddingService) {
        warnings.push('Embedding service not available. Enable BYOK or contact admin to enable semantic search.');
      }

      // Phase 7: Save to database
      console.log('[GENERATE] Saving to database...');
      await appsService.update(appId, {
        skills_md,
        skills_parsed,
        docs_generated_at: new Date().toISOString(),
        generation_in_progress: false,
      });

      // Success response
      const result: GenerationResult = {
        success: errors.length === 0,
        partial: errors.length > 0 && parseResult.functions.length > 0,
        skills_md,
        skills_parsed,
        embedding_text,
        embedding_generated: embeddingGenerated,
        errors,
        warnings,
      };

      return json(result);

    } finally {
      // Always release the lock
      await appsService.update(appId, { generation_in_progress: false }).catch(console.error);
    }

  } catch (err) {
    if (err instanceof Error && err.message.includes('Authentication')) {
      return error('Authentication required', 401);
    }
    console.error('Failed to generate docs:', err);
    return error('Failed to generate documentation', 500);
  }
}

/**
 * Get Skills.md documentation
 * GET /api/apps/:appId/skills.md
 */
async function handleGetSkillsMd(request: Request, appId: string): Promise<Response> {
  try {
    const appsService = createAppsService();
    const app = await appsService.findById(appId);

    if (!app) {
      return error('App not found', 404);
    }

    // Check visibility - only owner can access private app docs
    if (app.visibility === 'private') {
      try {
        const user = await authenticate(request);
        if (user.id !== app.owner_id) {
          return error('App not found', 404);
        }
      } catch {
        return error('App not found', 404);
      }
    }

    if (!app.skills_md) {
      return error('Skills documentation not generated yet. Use POST /api/apps/:appId/generate-docs to generate.', 404);
    }

    // Return as markdown
    return new Response(app.skills_md, {
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
      },
    });

  } catch (err) {
    console.error('Failed to get skills.md:', err);
    return error('Failed to get skills documentation', 500);
  }
}

/**
 * Update skills documentation (with validation)
 * PATCH /api/apps/:appId/skills
 */
async function handleUpdateSkills(request: Request, appId: string): Promise<Response> {
  try {
    // Authenticate - only owner can update
    const user = await authenticate(request);
    const appsService = createAppsService();

    const app = await appsService.findById(appId);
    if (!app) {
      return error('App not found', 404);
    }

    if (app.owner_id !== user.id) {
      return error('Unauthorized', 403);
    }

    // Parse request body
    const body = await request.json();
    const { skills_md } = body;

    if (!skills_md || typeof skills_md !== 'string') {
      return error('skills_md field is required and must be a string', 400);
    }

    // Validate the markdown and parse back to structured data
    console.log('[UPDATE_SKILLS] Validating markdown...');
    const validation = validateAndParseSkillsMd(skills_md);

    if (!validation.valid) {
      return json({
        success: false,
        errors: validation.errors,
        warnings: validation.warnings,
      }, 400);
    }

    // Generate new embedding text from updated skills
    const embedding_text = validation.skills_parsed
      ? generateEmbeddingText(app.name || app.slug, app.description, validation.skills_parsed)
      : null;

    // Regenerate embedding if embedding text changed
    let embeddingGenerated = false;
    const embeddingService = createEmbeddingService((user as User).openrouter_api_key);

    if (embeddingService && embedding_text) {
      try {
        console.log('[UPDATE_SKILLS] Regenerating embedding...');
        const embeddingResult = await embeddingService.embed(embedding_text);
        await storeAppEmbedding(appId, embeddingResult.embedding);
        embeddingGenerated = true;
        console.log('[UPDATE_SKILLS] Embedding updated successfully');
      } catch (embErr) {
        console.error('[UPDATE_SKILLS] Failed to regenerate embedding:', embErr);
        validation.warnings.push(`Failed to regenerate embedding: ${embErr instanceof Error ? embErr.message : String(embErr)}`);
      }
    } else if (!embeddingService) {
      validation.warnings.push('Embedding service not available. Enable BYOK to update semantic search indexing.');
    }

    // Update database with both markdown and parsed data
    console.log('[UPDATE_SKILLS] Saving to database...');
    await appsService.update(appId, {
      skills_md,
      skills_parsed: validation.skills_parsed,
    });

    return json({
      success: true,
      skills_parsed: validation.skills_parsed,
      embedding_text,
      embedding_generated: embeddingGenerated,
      warnings: validation.warnings,
    });

  } catch (err) {
    if (err instanceof Error && err.message.includes('Authentication')) {
      return error('Authentication required', 401);
    }
    console.error('Failed to update skills:', err);
    return error('Failed to update skills documentation', 500);
  }
}

// ============================================
// DRAFT/PUBLISH HANDLERS
// ============================================

/**
 * Get draft info for an app
 * GET /api/apps/:appId/draft
 */
async function handleGetDraft(request: Request, appId: string): Promise<Response> {
  try {
    const user = await authenticate(request);
    const appsService = createAppsService();

    const app = await appsService.findById(appId);
    if (!app) {
      return error('App not found', 404);
    }

    if (app.owner_id !== user.id) {
      return error('Unauthorized', 403);
    }

    const appWithDraft = app as Record<string, unknown>;

    if (!appWithDraft.draft_storage_key) {
      return json({
        has_draft: false,
        message: 'No draft available',
      });
    }

    return json({
      has_draft: true,
      draft_version: appWithDraft.draft_version,
      draft_uploaded_at: appWithDraft.draft_uploaded_at,
      draft_exports: appWithDraft.draft_exports,
      published_version: app.current_version,
      published_storage_key: app.storage_key,
    });

  } catch (err) {
    if (err instanceof Error && err.message.includes('Authentication')) {
      return error('Authentication required', 401);
    }
    console.error('Failed to get draft:', err);
    return error('Failed to get draft info', 500);
  }
}

/**
 * Publish draft to production
 * POST /api/apps/:appId/publish
 *
 * This replaces the published version with the draft and optionally regenerates docs.
 */
async function handlePublishDraft(request: Request, appId: string): Promise<Response> {
  try {
    const user = await authenticate(request);
    const appsService = createAppsService();
    const r2Service = createR2Service();

    const app = await appsService.findById(appId);
    if (!app) {
      return error('App not found', 404);
    }

    if (app.owner_id !== user.id) {
      return error('Unauthorized', 403);
    }

    const appWithDraft = app as Record<string, unknown>;

    if (!appWithDraft.draft_storage_key) {
      return error('No draft to publish', 400);
    }

    // Parse request options
    let options = { regenerate_docs: true };
    try {
      const body = await request.json();
      options = { ...options, ...body };
    } catch {
      // Use defaults
    }

    console.log('[PUBLISH] Starting publish for app:', appId);

    // Generate new version number
    const currentVersion = app.current_version || '1.0.0';
    const newVersion = incrementVersion(currentVersion);
    const newStorageKey = `apps/${appId}/${newVersion}/`;

    // Copy draft files to new version location
    console.log('[PUBLISH] Copying draft files to new version...');
    const draftStorageKey = appWithDraft.draft_storage_key as string;
    const draftFiles = await r2Service.listFiles(draftStorageKey);

    for (const fileKey of draftFiles) {
      const fileName = fileKey.replace(draftStorageKey, '');
      if (fileName) {
        const content = await r2Service.fetchFile(fileKey);
        await r2Service.uploadFile(`${newStorageKey}${fileName}`, {
          name: fileName,
          content,
          contentType: getContentTypeFromName(fileName),
        });
      }
    }

    // Update app record with new version
    console.log('[PUBLISH] Updating app record...');
    await appsService.update(appId, {
      storage_key: newStorageKey,
      current_version: newVersion,
      versions: [...(app.versions || []), newVersion],
      exports: appWithDraft.draft_exports,
      // Clear draft fields
      draft_storage_key: null,
      draft_version: null,
      draft_uploaded_at: null,
      draft_exports: null,
    });

    // Optionally regenerate docs
    let docsResult = null;
    if (options.regenerate_docs && app.skills_md) {
      console.log('[PUBLISH] Regenerating documentation...');
      try {
        // Fetch the new code
        let code: string | null = null;
        const entryFiles = ['index.tsx', 'index.ts', 'index.jsx', 'index.js'];
        for (const entryFile of entryFiles) {
          try {
            code = await r2Service.fetchTextFile(`${newStorageKey}${entryFile}`);
            break;
          } catch {
            // Try next
          }
        }

        if (code) {
          const parseResult = parseTypeScript(code, 'index.ts');
          const skills_md = generateSkillsMd(app.name || app.slug, parseResult);
          const skills_parsed = toSkillsParsed(parseResult);
          const embedding_text = generateEmbeddingText(app.name || app.slug, app.description, skills_parsed);

          // Generate embedding
          let embeddingGenerated = false;
          const embeddingService = createEmbeddingService((user as User).openrouter_api_key);
          if (embeddingService && embedding_text) {
            try {
              const embeddingResult = await embeddingService.embed(embedding_text);
              await storeAppEmbedding(appId, embeddingResult.embedding);
              embeddingGenerated = true;
            } catch (embErr) {
              console.error('[PUBLISH] Failed to generate embedding:', embErr);
            }
          }

          await appsService.update(appId, {
            skills_md,
            skills_parsed,
            docs_generated_at: new Date().toISOString(),
          });

          docsResult = {
            regenerated: true,
            embedding_generated: embeddingGenerated,
          };
        }
      } catch (docsErr) {
        console.error('[PUBLISH] Failed to regenerate docs:', docsErr);
        docsResult = {
          regenerated: false,
          error: docsErr instanceof Error ? docsErr.message : String(docsErr),
        };
      }
    }

    // Clean up old draft files (optional, could be done async)
    try {
      console.log('[PUBLISH] Cleaning up draft files...');
      for (const fileKey of draftFiles) {
        await r2Service.deleteFile(fileKey);
      }
    } catch (cleanupErr) {
      console.error('[PUBLISH] Failed to cleanup draft files:', cleanupErr);
      // Non-fatal, continue
    }

    console.log('[PUBLISH] Publish complete!');

    return json({
      success: true,
      app_id: appId,
      new_version: newVersion,
      storage_key: newStorageKey,
      url: `/a/${appId}`,
      docs: docsResult,
      message: 'Draft published successfully',
    });

  } catch (err) {
    if (err instanceof Error && err.message.includes('Authentication')) {
      return error('Authentication required', 401);
    }
    console.error('Failed to publish draft:', err);
    return error('Failed to publish draft', 500);
  }
}

/**
 * Discard draft without publishing
 * DELETE /api/apps/:appId/draft
 */
async function handleDiscardDraft(request: Request, appId: string): Promise<Response> {
  try {
    const user = await authenticate(request);
    const appsService = createAppsService();
    const r2Service = createR2Service();

    const app = await appsService.findById(appId);
    if (!app) {
      return error('App not found', 404);
    }

    if (app.owner_id !== user.id) {
      return error('Unauthorized', 403);
    }

    const appWithDraft = app as Record<string, unknown>;

    if (!appWithDraft.draft_storage_key) {
      return json({
        success: true,
        message: 'No draft to discard',
      });
    }

    console.log('[DISCARD] Discarding draft for app:', appId);

    // Delete draft files from R2
    const draftStorageKey = appWithDraft.draft_storage_key as string;
    try {
      const draftFiles = await r2Service.listFiles(draftStorageKey);
      for (const fileKey of draftFiles) {
        await r2Service.deleteFile(fileKey);
      }
    } catch (deleteErr) {
      console.error('[DISCARD] Failed to delete draft files:', deleteErr);
      // Continue - clear the database record anyway
    }

    // Clear draft fields in database
    await appsService.update(appId, {
      draft_storage_key: null,
      draft_version: null,
      draft_uploaded_at: null,
      draft_exports: null,
    });

    console.log('[DISCARD] Draft discarded');

    return json({
      success: true,
      message: 'Draft discarded',
    });

  } catch (err) {
    if (err instanceof Error && err.message.includes('Authentication')) {
      return error('Authentication required', 401);
    }
    console.error('Failed to discard draft:', err);
    return error('Failed to discard draft', 500);
  }
}

/**
 * Increment version number (semver minor bump)
 */
function incrementVersion(version: string): string {
  const parts = version.split('.');
  if (parts.length !== 3) {
    return '1.0.1';
  }
  const [major, minor, patch] = parts.map(Number);
  return `${major}.${minor}.${patch + 1}`;
}

/**
 * Get content type from file name
 */
function getContentTypeFromName(filename: string): string {
  if (filename.endsWith('.tsx')) return 'text/typescript-jsx';
  if (filename.endsWith('.ts')) return 'text/typescript';
  if (filename.endsWith('.jsx')) return 'text/javascript-jsx';
  if (filename.endsWith('.js')) return 'application/javascript';
  if (filename.endsWith('.json')) return 'application/json';
  if (filename.endsWith('.md')) return 'text/markdown';
  if (filename.endsWith('.css')) return 'text/css';
  return 'text/plain';
}
