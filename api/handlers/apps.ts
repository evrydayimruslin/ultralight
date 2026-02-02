// Apps Handler
// Handles app listing, discovery, and app-specific operations

import { json, error } from './app.ts';
import { authenticate } from './auth.ts';
import { createAppsService } from '../services/apps.ts';
import { createR2Service } from '../services/storage.ts';

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
