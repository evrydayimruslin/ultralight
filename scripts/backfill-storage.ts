#!/usr/bin/env -S deno run --allow-net --allow-env

/**
 * Backfill Storage Calculations
 *
 * One-time migration script to populate:
 * - apps.version_metadata (per-version size from R2)
 * - apps.storage_bytes (current version size)
 * - users.storage_used_bytes (sum of all owned app version sizes)
 *
 * Usage:
 *   deno run --allow-net --allow-env scripts/backfill-storage.ts
 *
 * Required env vars:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME
 *
 * This script is idempotent — safe to re-run. It overwrites version_metadata
 * and recalculates storage_used_bytes from scratch.
 */

// @ts-ignore - Deno
const Deno = globalThis.Deno;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  Deno.exit(1);
}

// Import R2 service (relative to project root)
const R2_ACCOUNT_ID = Deno.env.get('R2_ACCOUNT_ID')!;
const R2_ACCESS_KEY_ID = Deno.env.get('R2_ACCESS_KEY_ID')!;
const R2_SECRET_ACCESS_KEY = Deno.env.get('R2_SECRET_ACCESS_KEY')!;
const R2_BUCKET_NAME = Deno.env.get('R2_BUCKET_NAME')!;

if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME) {
  console.error('Missing R2 credentials');
  Deno.exit(1);
}

// ============================================
// Minimal R2 client (inline to avoid import issues)
// ============================================

async function hmacSha256(key: ArrayBuffer | string, message: string): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  const keyData = typeof key === 'string' ? encoder.encode(key) : key;
  const cryptoKey = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
}

async function sha256(message: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(message));
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function r2ListFilesWithSizes(prefix: string): Promise<Array<{ key: string; size: number }>> {
  const endpoint = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const host = `${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const now = new Date();
  const dateStamp = now.toISOString().slice(0, 10).replace(/-/g, '');
  const amzDate = now.toISOString().replace(/[-:]|\.\d{3}/g, '');
  const region = 'auto';

  const queryParams = `list-type=2&prefix=${encodeURIComponent(prefix)}`;
  const payloadHash = await sha256('');
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const canonicalQueryString = queryParams.split('&').sort().join('&');

  const canonicalRequest = `GET\n/${R2_BUCKET_NAME}\n${canonicalQueryString}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
  const canonicalRequestHash = await sha256(canonicalRequest);
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${canonicalRequestHash}`;

  const kDate = await hmacSha256(`AWS4${R2_SECRET_ACCESS_KEY}`, dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, 's3');
  const kSigning = await hmacSha256(kService, 'aws4_request');
  const signature = toHex(await hmacSha256(kSigning, stringToSign));

  const authHeader = `AWS4-HMAC-SHA256 Credential=${R2_ACCESS_KEY_ID}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const response = await fetch(`${endpoint}/${R2_BUCKET_NAME}?${queryParams}`, {
    method: 'GET',
    headers: {
      'Host': host,
      'X-Amz-Date': amzDate,
      'X-Amz-Content-SHA256': payloadHash,
      'Authorization': authHeader,
    },
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`R2 list failed: ${response.status} - ${err}`);
  }

  const xml = await response.text();
  const results: Array<{ key: string; size: number }> = [];

  // Parse <Contents> blocks for Key and Size
  const contentsRegex = /<Contents>[\s\S]*?<Key>([^<]+)<\/Key>[\s\S]*?<Size>(\d+)<\/Size>[\s\S]*?<\/Contents>/g;
  let match;
  while ((match = contentsRegex.exec(xml)) !== null) {
    results.push({ key: match[1], size: parseInt(match[2], 10) });
  }

  return results;
}

// ============================================
// Supabase helpers
// ============================================

async function supabaseGet(path: string): Promise<unknown> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'apikey': SUPABASE_KEY,
    },
  });
  if (!response.ok) throw new Error(`Supabase GET ${path}: ${await response.text()}`);
  return response.json();
}

async function supabasePatch(table: string, id: string, updates: Record<string, unknown>): Promise<void> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'apikey': SUPABASE_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ...updates, updated_at: new Date().toISOString() }),
  });
  if (!response.ok) throw new Error(`Supabase PATCH ${table}/${id}: ${await response.text()}`);
}

// ============================================
// Main backfill logic
// ============================================

interface AppRecord {
  id: string;
  owner_id: string;
  slug: string;
  current_version: string;
  versions: string[];
  storage_key: string;
  deleted_at: string | null;
}

async function main() {
  console.log('=== Storage Backfill Script ===');
  console.log(`Supabase: ${SUPABASE_URL}`);
  console.log(`R2 Bucket: ${R2_BUCKET_NAME}`);
  console.log('');

  // 1. Fetch all apps (including soft-deleted, to track everything)
  const apps = await supabaseGet('apps?select=id,owner_id,slug,current_version,versions,storage_key,deleted_at&order=created_at.asc') as AppRecord[];
  console.log(`Found ${apps.length} total apps`);

  // Track per-user storage totals
  const userStorageTotals = new Map<string, number>();

  let processed = 0;
  let errors = 0;

  for (const app of apps) {
    try {
      const versions: string[] = app.versions || [];
      const versionMetadata: Array<{ version: string; size_bytes: number; created_at: string }> = [];
      let appTotalBytes = 0;
      let currentVersionBytes = 0;

      // For each version, list files and sum sizes
      for (const version of versions) {
        const prefix = `apps/${app.id}/${version}/`;

        try {
          const files = await r2ListFilesWithSizes(prefix);
          const versionSize = files.reduce((sum, f) => sum + f.size, 0);

          versionMetadata.push({
            version,
            size_bytes: versionSize,
            created_at: new Date().toISOString(), // We don't have original timestamps
          });

          appTotalBytes += versionSize;

          if (version === app.current_version) {
            currentVersionBytes = versionSize;
          }
        } catch (err) {
          console.warn(`  Warning: Could not list files for ${app.slug}/${version}: ${err}`);
        }

        // Throttle R2 API calls slightly
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      // Update app record
      await supabasePatch('apps', app.id, {
        version_metadata: versionMetadata,
        storage_bytes: currentVersionBytes,
      });

      // Accumulate user storage (only for non-deleted apps)
      if (!app.deleted_at) {
        const current = userStorageTotals.get(app.owner_id) || 0;
        userStorageTotals.set(app.owner_id, current + appTotalBytes);
      }

      processed++;
      const sizeStr = appTotalBytes > 0 ? `${(appTotalBytes / 1024).toFixed(1)} KB` : '0 B';
      console.log(`  [${processed}/${apps.length}] ${app.slug}: ${versions.length} versions, ${sizeStr} total`);

    } catch (err) {
      errors++;
      console.error(`  ERROR processing app ${app.slug} (${app.id}):`, err);
    }
  }

  // 2. Update user storage totals
  console.log('');
  console.log(`Updating ${userStorageTotals.size} user storage totals...`);

  for (const [userId, totalBytes] of userStorageTotals) {
    try {
      await supabasePatch('users', userId, {
        storage_used_bytes: totalBytes,
      });
      console.log(`  User ${userId}: ${(totalBytes / 1024).toFixed(1)} KB`);
    } catch (err) {
      console.error(`  ERROR updating user ${userId}:`, err);
      errors++;
    }
  }

  console.log('');
  console.log('=== Backfill Complete ===');
  console.log(`Processed: ${processed}/${apps.length} apps`);
  console.log(`Users updated: ${userStorageTotals.size}`);
  console.log(`Errors: ${errors}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  Deno.exit(1);
});
