// Code Originality Service — Layer 2: Publish Gate
// Enforces originality checks before apps go public/unlisted.
// Detects exact clones (fingerprint), semantic duplicates (embedding), and seller-relist.
// Called at all three publish gate points: upload, publish-draft, set-visibility.

import { getEnv } from '../lib/env.ts';
import {
  createEmbeddingService,
  searchAppsByEmbedding,
} from './embedding.ts';

// ============================================
// TYPES
// ============================================

export interface OriginalityMatch {
  app_id: string;
  name: string;
  similarity: number;
  is_exact_fingerprint: boolean;
}

export interface OriginalityResult {
  passed: boolean;
  score: number;              // 0.0 (exact clone) to 1.0 (fully unique)
  fingerprint: string;        // SHA-256 hex of normalized source
  reason?: string;            // Human-readable reason for blocking
  matches: OriginalityMatch[];
  seller_relist: boolean;
}

// ============================================
// THRESHOLDS (env-configurable with defaults)
// ============================================

function getThresholds() {
  return {
    // Below this score: block publish entirely
    BLOCK_THRESHOLD: parseFloat(getEnv('ORIGINALITY_BLOCK_THRESHOLD') || '0.25'),
    // Between WARN and BLOCK: publish with warning flag
    WARN_THRESHOLD: parseFloat(getEnv('ORIGINALITY_WARN_THRESHOLD') || '0.60'),
    // Embedding similarity above this triggers a match report
    EMBEDDING_SIMILARITY_ALERT: parseFloat(getEnv('ORIGINALITY_SIMILARITY_ALERT') || '0.92'),
    // Embedding similarity above this + matching fingerprint = block
    EXACT_CLONE_THRESHOLD: parseFloat(getEnv('ORIGINALITY_EXACT_CLONE') || '0.97'),
  };
}

// ============================================
// SUPABASE HELPERS
// ============================================

function dbHeaders() {
  return {
    'apikey': getEnv('SUPABASE_SERVICE_ROLE_KEY'),
    'Authorization': `Bearer ${getEnv('SUPABASE_SERVICE_ROLE_KEY')}`,
  };
}

function rpcHeaders() {
  return {
    ...dbHeaders(),
    'Content-Type': 'application/json',
  };
}

// ============================================
// FINGERPRINT COMPUTATION
// ============================================

/**
 * Normalize source code for fingerprinting:
 * 1. Strip single-line comments (// ...)
 * 2. Strip multi-line comments (/* ... *‌/)
 * 3. Strip string literal contents (replace "..." and '...' contents with "")
 * 4. Collapse all whitespace to single space
 * 5. Lowercase
 */
function normalizeForFingerprint(source: string): string {
  let normalized = source;

  // Strip single-line comments
  normalized = normalized.replace(/\/\/[^\n]*/g, '');

  // Strip multi-line comments
  normalized = normalized.replace(/\/\*[\s\S]*?\*\//g, '');

  // Strip string literal contents (preserve quotes, clear contents)
  // Handle escaped quotes inside strings
  normalized = normalized.replace(/"(?:[^"\\]|\\.)*"/g, '""');
  normalized = normalized.replace(/'(?:[^'\\]|\\.)*'/g, "''");
  normalized = normalized.replace(/`(?:[^`\\]|\\.)*`/g, '``');

  // Collapse whitespace
  normalized = normalized.replace(/\s+/g, ' ').trim();

  // Lowercase
  normalized = normalized.toLowerCase();

  return normalized;
}

/**
 * Compute SHA-256 fingerprint of normalized source code.
 * Includes .md file content if present for description-level originality.
 */
export async function computeFingerprint(
  source: string,
  mdContent?: string
): Promise<string> {
  let textToHash = normalizeForFingerprint(source);

  // If .md content exists, include it in the fingerprint
  if (mdContent && mdContent.trim().length > 0) {
    const normalizedMd = mdContent.replace(/\s+/g, ' ').trim().toLowerCase();
    textToHash = textToHash + '|||MD|||' + normalizedMd;
  }

  const encoder = new TextEncoder();
  const data = encoder.encode(textToHash);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ============================================
// ORIGINALITY CHECKS
// ============================================

/**
 * Check for exact fingerprint match in existing public/unlisted apps.
 * Excludes the uploading user's own apps and the current app being checked.
 */
async function checkExactFingerprint(
  fingerprint: string,
  uploaderId: string,
  appId: string
): Promise<OriginalityMatch[]> {
  if (!getEnv('SUPABASE_URL') || !getEnv('SUPABASE_SERVICE_ROLE_KEY')) return [];

  try {
    const url = `${getEnv('SUPABASE_URL')}/rest/v1/apps?` + new URLSearchParams({
      'source_fingerprint': `eq.${fingerprint}`,
      'id': `neq.${appId}`,
      'owner_id': `neq.${uploaderId}`,
      'visibility': 'in.(public,unlisted)',
      'select': 'id,name',
    }).toString();

    // Also exclude deleted apps
    const res = await fetch(url + '&deleted_at=is.null', {
      headers: dbHeaders(),
    });

    if (!res.ok) {
      console.error('[ORIGINALITY] Fingerprint check failed:', await res.text());
      return [];
    }

    const matches = await res.json() as Array<{ id: string; name: string }>;
    return matches.map((m: { id: string; name: string }) => ({
      app_id: m.id,
      name: m.name || 'Unknown',
      similarity: 1.0,
      is_exact_fingerprint: true,
    }));
  } catch (err) {
    console.error('[ORIGINALITY] Fingerprint check error:', err);
    return [];
  }
}

/**
 * Check if the uploader has previously sold an app with this fingerprint.
 * This catches the seller-relist pattern: sell app, then re-upload same code.
 * Buyer exemption is implicit — only seller_id is checked.
 */
async function checkSellerRelist(
  uploaderId: string,
  fingerprint: string
): Promise<boolean> {
  if (!getEnv('SUPABASE_URL') || !getEnv('SUPABASE_SERVICE_ROLE_KEY')) return false;

  try {
    const res = await fetch(`${getEnv('SUPABASE_URL')}/rest/v1/rpc/check_seller_relist`, {
      method: 'POST',
      headers: rpcHeaders(),
      body: JSON.stringify({
        p_uploader_id: uploaderId,
        p_fingerprint: fingerprint,
      }),
    });

    if (!res.ok) {
      console.error('[ORIGINALITY] Seller-relist check failed:', await res.text());
      return false;
    }

    return await res.json();
  } catch (err) {
    console.error('[ORIGINALITY] Seller-relist check error:', err);
    return false;
  }
}

/**
 * Check embedding similarity against existing public apps.
 * Uses the existing searchAppsByEmbedding infrastructure.
 * Filters out the uploader's own apps client-side.
 */
async function checkEmbeddingSimilarity(
  embedding: number[],
  uploaderId: string,
  appId: string
): Promise<OriginalityMatch[]> {
  const thresholds = getThresholds();

  try {
    const results = await searchAppsByEmbedding(
      embedding,
      uploaderId, // The RPC uses this for access control, we filter further below
      {
        limit: 10,
        threshold: thresholds.EMBEDDING_SIMILARITY_ALERT,
      }
    );

    // Filter out the uploader's own apps and the current app
    return results
      .filter(r => r.owner_id !== uploaderId && r.id !== appId)
      .map(r => ({
        app_id: r.id,
        name: r.name || 'Unknown',
        similarity: r.similarity,
        is_exact_fingerprint: false,
      }));
  } catch (err) {
    console.error('[ORIGINALITY] Embedding similarity check error:', err);
    return [];
  }
}

// ============================================
// MAIN ORIGINALITY CHECK
// ============================================

/**
 * Run full originality check on code about to be published.
 *
 * Algorithm:
 * 1. Compute source fingerprint (SHA-256 of normalized source)
 * 2. Check for exact fingerprint match in existing public apps
 * 3. Check seller-relist pattern (has uploader sold code with this fingerprint?)
 * 4. Check embedding similarity (if embedding available)
 * 5. Compute originality score and decide pass/fail
 *
 * @param uploaderId - The user ID of the person trying to publish
 * @param appId - The app ID being published
 * @param files - Source files (at minimum the entry file)
 * @param existingEmbedding - Reuse embedding from Skills generation if available
 */
export async function runOriginalityCheck(
  uploaderId: string,
  appId: string,
  files: Array<{ name: string; content: string }>,
  existingEmbedding?: number[]
): Promise<OriginalityResult> {
  const thresholds = getThresholds();
  const allMatches: OriginalityMatch[] = [];

  // Find entry file and optional .md content
  const entryFile = files.find(f =>
    f.name.endsWith('.ts') || f.name.endsWith('.tsx') ||
    f.name.endsWith('.js') || f.name.endsWith('.jsx')
  );

  if (!entryFile) {
    // No code to check — pass by default (shouldn't happen in practice)
    return {
      passed: true,
      score: 1.0,
      fingerprint: '',
      matches: [],
      seller_relist: false,
    };
  }

  // Collect .md content for description-level originality
  const mdFiles = files.filter(f => f.name.endsWith('.md'));
  const mdContent = mdFiles.map(f => f.content).join('\n');

  // Step 1: Compute fingerprint
  const fingerprint = await computeFingerprint(entryFile.content, mdContent);

  // Step 2: Exact fingerprint check (fast SQL query)
  const exactMatches = await checkExactFingerprint(fingerprint, uploaderId, appId);
  allMatches.push(...exactMatches);

  if (exactMatches.length > 0) {
    return {
      passed: false,
      score: 0.0,
      fingerprint,
      reason: `Exact code clone detected. Matches existing app: "${exactMatches[0].name}" (${exactMatches[0].app_id})`,
      matches: allMatches,
      seller_relist: false,
    };
  }

  // Step 3: Seller-relist check (fast SQL query)
  const isSellerRelist = await checkSellerRelist(uploaderId, fingerprint);

  if (isSellerRelist) {
    return {
      passed: false,
      score: 0.0,
      fingerprint,
      reason: 'Seller-relist detected: this code matches an app you previously sold. Original buyers have exclusive rights to relist.',
      matches: allMatches,
      seller_relist: true,
    };
  }

  // Step 4: Embedding similarity check (may require API call)
  let embeddingMatches: OriginalityMatch[] = [];
  let bestEmbeddingSimilarity = 0;

  if (existingEmbedding && existingEmbedding.length > 0) {
    // Reuse embedding from Skills generation (zero additional cost)
    embeddingMatches = await checkEmbeddingSimilarity(existingEmbedding, uploaderId, appId);
  } else {
    // Try to generate embedding on-the-fly
    const embeddingService = createEmbeddingService();
    if (embeddingService) {
      try {
        // Build a quick embedding text from the source (simplified version of generateEmbeddingText)
        const embeddingText = buildQuickEmbeddingText(entryFile.content, files);
        const result = await embeddingService.embed(embeddingText);
        embeddingMatches = await checkEmbeddingSimilarity(result.embedding, uploaderId, appId);
      } catch (err) {
        console.warn('[ORIGINALITY] Embedding generation failed, skipping similarity check:', err);
      }
    } else {
      console.warn('[ORIGINALITY] No embedding service available, skipping similarity check');
    }
  }

  allMatches.push(...embeddingMatches);

  if (embeddingMatches.length > 0) {
    bestEmbeddingSimilarity = Math.max(...embeddingMatches.map(m => m.similarity));
  }

  // Step 5: Compute originality score
  const score = 1.0 - bestEmbeddingSimilarity;

  // Check if best embedding match is above the exact clone threshold
  if (bestEmbeddingSimilarity >= thresholds.EXACT_CLONE_THRESHOLD) {
    return {
      passed: false,
      score,
      fingerprint,
      reason: `Near-identical app detected (${(bestEmbeddingSimilarity * 100).toFixed(1)}% similarity). Matches: "${embeddingMatches[0].name}" (${embeddingMatches[0].app_id})`,
      matches: allMatches,
      seller_relist: false,
    };
  }

  // Check if score is below block threshold
  if (score < thresholds.BLOCK_THRESHOLD) {
    return {
      passed: false,
      score,
      fingerprint,
      reason: `Originality score too low (${(score * 100).toFixed(1)}%). Code is too similar to existing apps.`,
      matches: allMatches,
      seller_relist: false,
    };
  }

  // Passed (possibly with warnings if score < WARN_THRESHOLD)
  if (score < thresholds.WARN_THRESHOLD) {
    return {
      passed: true,
      score,
      fingerprint,
      reason: `Low originality warning (${(score * 100).toFixed(1)}%) — similar apps exist but publish is allowed.`,
      matches: allMatches,
      seller_relist: false,
    };
  }

  return {
    passed: true,
    score,
    fingerprint,
    matches: allMatches,
    seller_relist: false,
  };
}

// ============================================
// SALE FINGERPRINT RECORDING
// ============================================

/**
 * Record the current source fingerprint of an app at the time of sale.
 * Called from marketplace.acceptBid() after a successful sale.
 * Fire-and-forget — failure is logged but doesn't block the sale.
 */
export async function recordSaleFingerprint(
  saleId: string,
  appId: string,
  sellerId: string,
  buyerId: string
): Promise<void> {
  if (!getEnv('SUPABASE_URL') || !getEnv('SUPABASE_SERVICE_ROLE_KEY')) {
    console.warn('[ORIGINALITY] Supabase not configured, skipping fingerprint recording');
    return;
  }

  const res = await fetch(`${getEnv('SUPABASE_URL')}/rest/v1/rpc/record_sale_fingerprint`, {
    method: 'POST',
    headers: rpcHeaders(),
    body: JSON.stringify({
      p_sale_id: saleId,
      p_app_id: appId,
      p_seller_id: sellerId,
      p_buyer_id: buyerId,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error('[ORIGINALITY] record_sale_fingerprint RPC failed:', errText);
    throw new Error(`Failed to record sale fingerprint: ${errText}`);
  }

  console.log(`[ORIGINALITY] Fingerprint recorded for sale ${saleId} (app: ${appId}, seller: ${sellerId})`);
}

// ============================================
// FINGERPRINT STORAGE
// ============================================

/**
 * Store source fingerprint and originality results on the app record.
 * Called after computing fingerprint (on upload) and after originality check (on publish).
 */
export async function storeIntegrityResults(
  appId: string,
  results: {
    source_fingerprint?: string;
    originality_score?: number;
    safety_status?: string;
    integrity_checked_at?: string;
  }
): Promise<void> {
  if (!getEnv('SUPABASE_URL') || !getEnv('SUPABASE_SERVICE_ROLE_KEY')) return;

  try {
    const res = await fetch(`${getEnv('SUPABASE_URL')}/rest/v1/apps?id=eq.${appId}`, {
      method: 'PATCH',
      headers: {
        ...dbHeaders(),
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify(results),
    });

    if (!res.ok) {
      console.error('[ORIGINALITY] Failed to store integrity results:', await res.text());
    }
  } catch (err) {
    console.error('[ORIGINALITY] Error storing integrity results:', err);
  }
}

// ============================================
// HELPERS
// ============================================

/**
 * Build a quick embedding text from source code for originality comparison.
 * Simplified version of docgen.ts generateEmbeddingText.
 * Used when we don't have an existing embedding from Skills generation.
 */
function buildQuickEmbeddingText(
  entryContent: string,
  files: Array<{ name: string; content: string }>
): string {
  const parts: string[] = [];

  // Extract function names and signatures (quick regex, not full AST)
  const functionRegex = /export\s+(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/g;
  let match;
  const functions: string[] = [];

  while ((match = functionRegex.exec(entryContent)) !== null) {
    functions.push(`${match[1]}(${match[2]})`);
  }

  // Also check arrow functions
  const arrowRegex = /export\s+(?:const|let)\s+(\w+)\s*=\s*(?:async\s+)?\(([^)]*)\)/g;
  while ((match = arrowRegex.exec(entryContent)) !== null) {
    functions.push(`${match[1]}(${match[2]})`);
  }

  if (functions.length > 0) {
    parts.push('Functions: ' + functions.join(', '));
  }

  // Include file-level comments/descriptions
  const descMatch = entryContent.match(/\/\*\*\s*([\s\S]*?)\s*\*\//);
  if (descMatch) {
    const desc = descMatch[1].replace(/^\s*\*\s?/gm, '').trim();
    if (desc.length > 10) {
      parts.push(desc);
    }
  }

  // Include .md content
  const mdFiles = files.filter(f => f.name.endsWith('.md'));
  for (const md of mdFiles) {
    if (md.content.trim().length > 10) {
      parts.push(md.content.trim().slice(0, 500));
    }
  }

  // Fallback: first 500 chars of entry file
  if (parts.length === 0) {
    parts.push(entryContent.slice(0, 500));
  }

  return parts.join('\n\n');
}
