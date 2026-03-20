// Embeds MCP — Shared Embedding Backbone
//
// The central vector store for the content hub.
// All MCPs write content here and query it via semantic search.
//
// Storage: Ultralight D1
// AI: ultralight.ai() with text-embedding-3-small for embeddings
// Permissions: ai:call (embeddings)

const ultralight = (globalThis as any).ultralight;

// ============================================
// TYPES
// ============================================

interface SearchResult {
  id: string;
  source_type: string;
  title: string | null;
  body: string;
  author: string | null;
  tags: string[];
  source_url: string | null;
  source_meta: Record<string, unknown>;
  theme_id: string | null;
  similarity: number;
  created_at: string;
}

// ============================================
// INTERNAL HELPERS
// ============================================

async function generateEmbedding(text: string): Promise<number[]> {
  const truncated = text.length > 32000 ? text.slice(0, 32000) : text;

  const response = await ultralight.ai({
    model: 'openai/text-embedding-3-small',
    input: truncated,
  });

  if (!response.embedding) {
    throw new Error('Embedding generation failed: no embedding in response');
  }
  return response.embedding;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dotProduct / denom;
}

function parseRow(row: any): any {
  return {
    ...row,
    source_meta: JSON.parse(row.source_meta || '{}'),
    tags: JSON.parse(row.tags || '[]'),
    embedding: row.embedding ? JSON.parse(row.embedding) : null,
  };
}

// ============================================
// 1. INGEST — Add content to the shared store
// ============================================

export async function ingest(args: {
  source_type: string;
  body: string;
  source_id?: string;
  source_url?: string;
  source_meta?: Record<string, unknown>;
  title?: string;
  author?: string;
  tags?: string[];
  source_created_at?: string;
  auto_embed?: boolean;
}): Promise<{ success: boolean; content_id: string; embedded: boolean; duplicate: boolean }> {
  const {
    source_type,
    body,
    source_id,
    source_url,
    source_meta,
    title,
    author,
    tags,
    source_created_at,
    auto_embed,
  } = args;

  if (!source_type || !body) {
    throw new Error('source_type and body are required');
  }

  // Deduplicate by source_type + source_id
  if (source_id) {
    const existing = await ultralight.db.first(
      'SELECT id FROM embeds WHERE source_type = ? AND source_id = ? AND user_id = ?',
      [source_type, source_id, ultralight.user.id]
    );

    if (existing) {
      return { success: true, content_id: existing.id, embedded: false, duplicate: true };
    }
  }

  const contentId = crypto.randomUUID();
  let embedding: string | null = null;
  let embeddedAt: string | null = null;
  const shouldEmbed = auto_embed !== false;

  if (shouldEmbed) {
    try {
      const textToEmbed = title ? title + '\n\n' + body : body;
      const embeddingArr = await generateEmbedding(textToEmbed);
      embedding = JSON.stringify(embeddingArr);
      embeddedAt = new Date().toISOString();
    } catch (err) {
      console.warn('Auto-embed failed, content saved without embedding:', err);
    }
  }

  const now = new Date().toISOString();

  await ultralight.db.run(
    'INSERT INTO embeds (id, user_id, source_type, source_id, source_url, source_meta, title, body, author, tags, theme_id, embedding, embedded_at, digested_at, digest_run_id, source_created_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [contentId, ultralight.user.id, source_type, source_id || null, source_url || null, JSON.stringify(source_meta || {}), title || null, body, author || null, JSON.stringify(tags || []), null, embedding, embeddedAt, null, null, source_created_at || null, now, now]
  );

  return {
    success: true,
    content_id: contentId,
    embedded: embedding !== null,
    duplicate: false,
  };
}

// ============================================
// 2. SEARCH — Semantic search across content
// ============================================

export async function search(args: {
  query: string;
  scope?: string;
  source_type?: string;
  tags?: string[];
  theme_id?: string;
  theme_slug?: string;
  limit?: number;
  threshold?: number;
}): Promise<{
  results: SearchResult[];
  query: string;
  scope: string;
  total: number;
}> {
  const { query, scope, source_type, tags, theme_id, limit, threshold } = args;

  if (!query) {
    throw new Error('query is required');
  }

  const searchScope = scope || 'content';
  const matchLimit = limit || 20;
  const matchThreshold = threshold || 0.3;
  const queryEmbedding = await generateEmbedding(query);

  // Fetch all content with embeddings for this user
  let sql = 'SELECT * FROM embeds WHERE user_id = ? AND embedding IS NOT NULL';
  const params: any[] = [ultralight.user.id];

  if (source_type) {
    sql += ' AND source_type = ?';
    params.push(source_type);
  }
  if (theme_id) {
    sql += ' AND theme_id = ?';
    params.push(theme_id);
  }

  const rows = await ultralight.db.all(sql, params);

  // Compute similarities
  let scored: Array<{ row: any; similarity: number }> = [];
  for (const row of rows) {
    const parsed = parseRow(row);
    if (parsed.embedding && parsed.embedding.length > 0) {
      const sim = cosineSimilarity(queryEmbedding, parsed.embedding);
      if (sim >= matchThreshold) {
        scored.push({ row: parsed, similarity: sim });
      }
    }
  }

  // Filter by tags if needed
  if (tags && tags.length > 0) {
    scored = scored.filter((s) => {
      const rowTags = s.row.tags || [];
      return tags.some((t: string) => rowTags.includes(t));
    });
  }

  scored.sort((a, b) => b.similarity - a.similarity);
  const topResults = scored.slice(0, matchLimit);

  const results: SearchResult[] = topResults.map((s) => ({
    id: s.row.id,
    source_type: s.row.source_type,
    title: s.row.title,
    body: s.row.body,
    author: s.row.author,
    tags: s.row.tags,
    source_url: s.row.source_url,
    source_meta: s.row.source_meta,
    theme_id: s.row.theme_id || null,
    similarity: Math.round(s.similarity * 1000) / 1000,
    created_at: s.row.created_at,
  }));

  return { results: results, query: query, scope: searchScope, total: results.length };
}

// ============================================
// 3. GET RELATED — Similar content to a given item
// ============================================

export async function getRelated(args: {
  content_id: string;
  limit?: number;
  threshold?: number;
  cross_type?: boolean;
}): Promise<{ results: SearchResult[]; source_id: string; total: number }> {
  const { content_id, limit, threshold, cross_type } = args;

  if (!content_id) {
    throw new Error('content_id is required');
  }

  const source = await ultralight.db.first(
    'SELECT id, embedding, source_type FROM embeds WHERE id = ? AND user_id = ?',
    [content_id, ultralight.user.id]
  );

  if (!source) {
    throw new Error('Content not found: ' + content_id);
  }

  const sourceEmbedding = source.embedding ? JSON.parse(source.embedding) : null;
  if (!sourceEmbedding) {
    throw new Error('Content has no embedding. Run embedBatch first.');
  }

  const matchLimit = limit || 10;
  const matchThreshold = threshold || 0.3;

  let sql = 'SELECT * FROM embeds WHERE user_id = ? AND embedding IS NOT NULL AND id != ?';
  const params: any[] = [ultralight.user.id, content_id];

  if (cross_type === false) {
    sql += ' AND source_type = ?';
    params.push(source.source_type);
  }

  const rows = await ultralight.db.all(sql, params);

  let scored: Array<{ row: any; similarity: number }> = [];
  for (const row of rows) {
    const parsed = parseRow(row);
    if (parsed.embedding && parsed.embedding.length > 0) {
      const sim = cosineSimilarity(sourceEmbedding, parsed.embedding);
      if (sim >= matchThreshold) {
        scored.push({ row: parsed, similarity: sim });
      }
    }
  }

  scored.sort((a, b) => b.similarity - a.similarity);
  const topResults = scored.slice(0, matchLimit);

  const results: SearchResult[] = topResults.map((s) => ({
    id: s.row.id,
    source_type: s.row.source_type,
    title: s.row.title,
    body: s.row.body,
    author: s.row.author,
    tags: s.row.tags,
    source_url: s.row.source_url,
    source_meta: s.row.source_meta,
    theme_id: s.row.theme_id || null,
    similarity: Math.round(s.similarity * 1000) / 1000,
    created_at: s.row.created_at,
  }));

  return { results: results, source_id: content_id, total: results.length };
}

// ============================================
// 4. EMBED BATCH — Process unembedded content
// ============================================

export async function embedBatch(args: {
  batch_size?: number;
}): Promise<{ processed: number; failed: number; remaining: number }> {
  const batchSize = args.batch_size || 15;

  const unembedded = await ultralight.db.all(
    'SELECT id, title, body FROM embeds WHERE embedding IS NULL AND user_id = ? LIMIT ?',
    [ultralight.user.id, batchSize]
  );

  if (unembedded.length === 0) {
    return { processed: 0, failed: 0, remaining: 0 };
  }

  let processed = 0;
  let failed = 0;

  for (const item of unembedded) {
    try {
      const textToEmbed = item.title ? item.title + '\n\n' + item.body : item.body;
      const embeddingArr = await generateEmbedding(textToEmbed);
      const now = new Date().toISOString();

      await ultralight.db.run(
        'UPDATE embeds SET embedding = ?, embedded_at = ?, updated_at = ? WHERE id = ? AND user_id = ?',
        [JSON.stringify(embeddingArr), now, now, item.id, ultralight.user.id]
      );
      processed = processed + 1;
    } catch (err) {
      console.error('Embedding failed for ' + item.id + ':', err);
      failed = failed + 1;
    }
  }

  // Count remaining unembedded
  const remainRow = await ultralight.db.first(
    'SELECT COUNT(*) as cnt FROM embeds WHERE embedding IS NULL AND user_id = ?',
    [ultralight.user.id]
  );

  return { processed: processed, failed: failed, remaining: remainRow ? remainRow.cnt : 0 };
}

// ============================================
// 5. MANAGE — Read, list, tag, and update content
// ============================================

export async function manage(args: {
  action: string;
  id?: string;
  ids?: string[];
  source_type?: string;
  limit?: number;
  offset?: number;
  undigested_only?: boolean;
  add_tags?: string[];
  remove_tags?: string[];
}): Promise<{ items: any[]; total: number; action: string }> {
  const { action, id, ids, source_type, limit, offset, undigested_only, add_tags, remove_tags } = args;

  if (!action) {
    throw new Error('action is required: "get", "list", or "tag"');
  }

  // GET — single item by ID
  if (action === 'get') {
    if (!id) {
      throw new Error('id is required for action "get"');
    }

    const row = await ultralight.db.first(
      'SELECT id, source_type, source_id, source_url, source_meta, title, body, author, tags, theme_id, embedded_at, digested_at, source_created_at, created_at, updated_at FROM embeds WHERE id = ? AND user_id = ?',
      [id, ultralight.user.id]
    );

    if (!row) {
      throw new Error('Content not found: ' + id);
    }

    const parsed = { ...row, source_meta: JSON.parse(row.source_meta || '{}'), tags: JSON.parse(row.tags || '[]') };
    return { items: [parsed], total: 1, action: 'get' };
  }

  // TAG — add/remove tags on an item
  if (action === 'tag') {
    if (!id) {
      throw new Error('id is required for action "tag"');
    }

    const existing = await ultralight.db.first(
      'SELECT id, tags FROM embeds WHERE id = ? AND user_id = ?',
      [id, ultralight.user.id]
    );

    if (!existing) {
      throw new Error('Content not found: ' + id);
    }

    let currentTags: string[] = JSON.parse(existing.tags || '[]');

    if (add_tags && add_tags.length > 0) {
      const tagSet = new Set(currentTags);
      for (const t of add_tags) {
        tagSet.add(t.toLowerCase().trim());
      }
      currentTags = Array.from(tagSet);
    }

    if (remove_tags && remove_tags.length > 0) {
      const removeSet = new Set(remove_tags.map((t: string) => t.toLowerCase().trim()));
      currentTags = currentTags.filter((t: string) => !removeSet.has(t));
    }

    const now = new Date().toISOString();
    await ultralight.db.run(
      'UPDATE embeds SET tags = ?, updated_at = ? WHERE id = ? AND user_id = ?',
      [JSON.stringify(currentTags), now, id, ultralight.user.id]
    );

    const updated = await ultralight.db.first(
      'SELECT id, source_type, source_id, source_url, source_meta, title, body, author, tags, theme_id, embedded_at, digested_at, source_created_at, created_at, updated_at FROM embeds WHERE id = ? AND user_id = ?',
      [id, ultralight.user.id]
    );
    const parsed = updated ? { ...updated, source_meta: JSON.parse(updated.source_meta || '{}'), tags: JSON.parse(updated.tags || '[]') } : null;
    return { items: parsed ? [parsed] : [], total: 1, action: 'tag' };
  }

  // LIST — paginated listing with filters
  if (action === 'list') {
    // Batch fetch by IDs
    if (ids && ids.length > 0) {
      const placeholders = ids.map(() => '?').join(', ');
      const rows = await ultralight.db.all(
        'SELECT id, source_type, source_id, source_url, source_meta, title, body, author, tags, theme_id, embedded_at, digested_at, source_created_at, created_at, updated_at FROM embeds WHERE id IN (' + placeholders + ') AND user_id = ?',
        [...ids, ultralight.user.id]
      );

      const parsed = rows.map((r: any) => ({ ...r, source_meta: JSON.parse(r.source_meta || '{}'), tags: JSON.parse(r.tags || '[]') }));
      return { items: parsed, total: parsed.length, action: 'list' };
    }

    const pageSize = limit || 20;
    let sql = 'SELECT id, source_type, source_id, source_url, source_meta, title, body, author, tags, theme_id, embedded_at, digested_at, source_created_at, created_at, updated_at FROM embeds WHERE user_id = ?';
    const params: any[] = [ultralight.user.id];

    if (source_type) {
      sql += ' AND source_type = ?';
      params.push(source_type);
    }
    if (undigested_only) {
      sql += ' AND digested_at IS NULL';
    }

    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(pageSize);

    if (offset) {
      sql = sql.replace('LIMIT ?', 'LIMIT ? OFFSET ?');
      params.push(offset);
    }

    const rows = await ultralight.db.all(sql, params);
    const parsed = rows.map((r: any) => ({ ...r, source_meta: JSON.parse(r.source_meta || '{}'), tags: JSON.parse(r.tags || '[]') }));
    return { items: parsed, total: parsed.length, action: 'list' };
  }

  throw new Error('Unknown action: ' + action + '. Use "get", "list", or "tag".');
}

// ============================================
// 6. STATUS — Hub overview stats + health check
// ============================================

export async function status(args?: Record<string, never>): Promise<{
  health: string;
  total_content: number;
  total_embedded: number;
  total_unembedded: number;
  total_digested: number;
  total_undigested: number;
  by_source_type: Record<string, number>;
}> {
  const totalRow = await ultralight.db.first(
    'SELECT COUNT(*) as cnt FROM embeds WHERE user_id = ?',
    [ultralight.user.id]
  );
  const embeddedRow = await ultralight.db.first(
    'SELECT COUNT(*) as cnt FROM embeds WHERE user_id = ? AND embedded_at IS NOT NULL',
    [ultralight.user.id]
  );
  const digestedRow = await ultralight.db.first(
    'SELECT COUNT(*) as cnt FROM embeds WHERE user_id = ? AND digested_at IS NOT NULL',
    [ultralight.user.id]
  );

  const totalContent = totalRow ? totalRow.cnt : 0;
  const totalEmbedded = embeddedRow ? embeddedRow.cnt : 0;
  const totalDigested = digestedRow ? digestedRow.cnt : 0;

  // Source type breakdown
  const sourceRows = await ultralight.db.all(
    'SELECT source_type, COUNT(*) as cnt FROM embeds WHERE user_id = ? GROUP BY source_type',
    [ultralight.user.id]
  );
  const bySourceType: Record<string, number> = {};
  for (const row of sourceRows) {
    bySourceType[row.source_type || 'unknown'] = row.cnt;
  }

  // Test AI health
  let aiOk = false;
  try {
    const testEmbed = await generateEmbedding('health check');
    aiOk = testEmbed.length > 0;
  } catch (e) {
    console.error('AI health check failed:', e);
  }

  return {
    health: aiOk ? 'healthy' : 'degraded',
    total_content: totalContent,
    total_embedded: totalEmbedded,
    total_unembedded: totalContent - totalEmbedded,
    total_digested: totalDigested,
    total_undigested: totalContent - totalDigested,
    by_source_type: bySourceType,
  };
}

// ============================================
// 7. UI — Web dashboard at GET /http/{appId}/ui
// ============================================

export async function ui(args: {
  method?: string;
  url?: string;
  path?: string;
  query?: Record<string, string>;
  headers?: Record<string, string>;
}): Promise<any> {
  let statsData: any = null;
  try {
    const totalRow = await ultralight.db.first(
      'SELECT COUNT(*) as cnt FROM embeds WHERE user_id = ?',
      [ultralight.user.id]
    );
    const embeddedRow = await ultralight.db.first(
      'SELECT COUNT(*) as cnt FROM embeds WHERE user_id = ? AND embedded_at IS NOT NULL',
      [ultralight.user.id]
    );
    const digestedRow = await ultralight.db.first(
      'SELECT COUNT(*) as cnt FROM embeds WHERE user_id = ? AND digested_at IS NOT NULL',
      [ultralight.user.id]
    );

    // Source breakdown
    const sourceRows = await ultralight.db.all(
      'SELECT source_type, COUNT(*) as cnt FROM embeds WHERE user_id = ? GROUP BY source_type',
      [ultralight.user.id]
    );
    const bySource: Record<string, number> = {};
    for (const row of sourceRows) {
      bySource[row.source_type || 'unknown'] = row.cnt;
    }

    // Recent items
    const recentItems = await ultralight.db.all(
      'SELECT id, source_type, title, author, created_at FROM embeds WHERE user_id = ? ORDER BY created_at DESC LIMIT 10',
      [ultralight.user.id]
    );

    statsData = {
      total: totalRow ? totalRow.cnt : 0,
      embedded: embeddedRow ? embeddedRow.cnt : 0,
      digested: digestedRow ? digestedRow.cnt : 0,
      bySource: bySource,
      recent: recentItems || [],
    };
  } catch (e) {
    console.error('Dashboard data fetch failed:', e);
  }

  const s = statsData || { total: 0, embedded: 0, digested: 0, bySource: {}, recent: [] };
  const sourceChips = Object.entries(s.bySource)
    .map(([type, count]: [string, any]) => '<span class="chip">' + type + ' <b>' + count + '</b></span>')
    .join('');

  const recentRows = s.recent
    .map((item: any) => '<tr><td>' + (item.source_type || '-') + '</td><td>' + (item.title || item.id.slice(0, 8) + '...') + '</td><td>' + (item.author || '-') + '</td><td>' + new Date(item.created_at).toLocaleDateString() + '</td></tr>')
    .join('');

  const htmlContent = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>Embeds — Research Intelligence Hub</title>'
    + '<style>'
    + '*{margin:0;padding:0;box-sizing:border-box}'
    + 'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0a0a0a;color:#e5e5e5;padding:24px}'
    + '.container{max-width:800px;margin:0 auto}'
    + 'h1{font-size:24px;font-weight:700;background:linear-gradient(90deg,#06b6d4,#8b5cf6);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:4px}'
    + '.subtitle{color:#888;font-size:14px;margin-bottom:32px}'
    + '.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:32px}'
    + '.card{background:#141414;border:1px solid #2a2a2a;border-radius:12px;padding:20px}'
    + '.card-value{font-size:28px;font-weight:700}'
    + '.card-label{font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-top:4px}'
    + '.card-value.cyan{color:#06b6d4}.card-value.green{color:#22c55e}.card-value.purple{color:#8b5cf6}'
    + '.section{margin-bottom:32px}'
    + '.section h2{font-size:16px;color:#ccc;margin-bottom:12px}'
    + '.chips{display:flex;gap:8px;flex-wrap:wrap}'
    + '.chip{background:#1e1e1e;border:1px solid #2a2a2a;border-radius:20px;padding:6px 14px;font-size:13px;color:#aaa}'
    + '.chip b{color:#06b6d4;margin-left:4px}'
    + 'table{width:100%;border-collapse:collapse}'
    + 'th,td{text-align:left;padding:10px 12px;border-bottom:1px solid #1e1e1e;font-size:13px}'
    + 'th{color:#888;font-weight:600;text-transform:uppercase;font-size:11px;letter-spacing:.5px}'
    + 'td{color:#ccc}'
    + '</style></head><body>'
    + '<div class="container">'
    + '<h1>Embeds</h1>'
    + '<p class="subtitle">Research Intelligence Hub — Shared Vector Store</p>'
    + '<div class="grid">'
    + '<div class="card"><div class="card-value cyan">' + s.total + '</div><div class="card-label">Total Content</div></div>'
    + '<div class="card"><div class="card-value green">' + s.embedded + '</div><div class="card-label">Embedded</div></div>'
    + '<div class="card"><div class="card-value purple">' + s.digested + '</div><div class="card-label">Digested</div></div>'
    + '</div>'
    + '<div class="section"><h2>Sources</h2><div class="chips">' + (sourceChips || '<span class="chip">No content yet</span>') + '</div></div>'
    + '<div class="section"><h2>Recent Content</h2>'
    + '<table><thead><tr><th>Type</th><th>Title</th><th>Author</th><th>Date</th></tr></thead>'
    + '<tbody>' + (recentRows || '<tr><td colspan="4" style="color:#666;text-align:center;padding:24px">No content ingested yet</td></tr>') + '</tbody></table>'
    + '</div>'
    + '</div></body></html>';

  return http.html(htmlContent);
}
