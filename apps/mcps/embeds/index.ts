// Embeds MCP — Shared Embedding Backbone
//
// The central vector store for the Research Intelligence Hub.
// All MCPs (tweets, digest, sending) write content here and
// query it via semantic search. Backed by BYOS Supabase with pgvector.
//
// Storage: BYOS Supabase (research-intelligence-hub) + pgvector
// AI: ultralight.ai() with text-embedding-3-small for embeddings
// Permissions: ai:call (embeddings), supabase (BYOS)

const supabase = (globalThis as any).supabase;
const ultralight = (globalThis as any).ultralight;
const uuid = (globalThis as any).uuid;

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

interface InsightResult {
  id: string;
  title: string;
  body: string;
  themes: string[];
  tags: string[];
  theme_id: string | null;
  approved: boolean;
  newsletter_section: string | null;
  similarity: number;
  created_at: string;
}

interface ContentRow {
  id: string;
  source_type: string;
  source_id: string | null;
  source_url: string | null;
  source_meta: Record<string, unknown>;
  title: string | null;
  body: string;
  author: string | null;
  tags: string[];
  theme_id: string | null;
  embedded_at: string | null;
  digested_at: string | null;
  source_created_at: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================
// INTERNAL HELPERS
// ============================================

async function generateEmbedding(text: string): Promise<number[]> {
  // Truncate to ~8000 tokens (~32000 chars) for embedding model limits
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

// Select columns for content reads (excludes embedding — too large for MCP payloads)
const CONTENT_COLUMNS = 'id, source_type, source_id, source_url, source_meta, title, body, author, tags, theme_id, embedded_at, digested_at, source_created_at, created_at, updated_at';

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
    const { data: existing } = await supabase
      .from('content')
      .select('id')
      .eq('source_type', source_type)
      .eq('source_id', source_id)
      .single();

    if (existing) {
      return { success: true, content_id: existing.id, embedded: false, duplicate: true };
    }
  }

  const contentId = uuid.v4();
  let embedding: number[] | null = null;
  let embeddedAt: string | null = null;
  const shouldEmbed = auto_embed !== false; // Default: true

  if (shouldEmbed) {
    try {
      const textToEmbed = title ? title + '\n\n' + body : body;
      embedding = await generateEmbedding(textToEmbed);
      embeddedAt = new Date().toISOString();
    } catch (err) {
      // Embedding failed — ingest anyway, catch up via embedBatch
      console.warn('Auto-embed failed, content saved without embedding:', err);
    }
  }

  const now = new Date().toISOString();
  const row = {
    id: contentId,
    source_type: source_type,
    source_id: source_id || null,
    source_url: source_url || null,
    source_meta: source_meta || {},
    title: title || null,
    body: body,
    author: author || null,
    tags: tags || [],
    embedding: embedding,
    embedded_at: embeddedAt,
    digested_at: null,
    digest_run_id: null,
    source_created_at: source_created_at || null,
    created_at: now,
    updated_at: now,
  };

  const { error } = await supabase.from('content').insert(row);
  if (error) {
    throw new Error('Failed to ingest content: ' + error.message);
  }

  return {
    success: true,
    content_id: contentId,
    embedded: embedding !== null,
    duplicate: false,
  };
}

// ============================================
// 2. SEARCH — Semantic search across content or insights
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
  results: Array<SearchResult | InsightResult>;
  query: string;
  scope: string;
  total: number;
}> {
  const { query, scope, source_type, tags, theme_id, theme_slug, limit, threshold } = args;

  if (!query) {
    throw new Error('query is required');
  }

  const searchScope = scope || 'content';
  const matchLimit = limit || 20;
  const matchThreshold = threshold || 0.3;
  const queryEmbedding = await generateEmbedding(query);

  // Resolve theme_id from slug if needed
  let resolvedThemeId: string | null = theme_id || null;
  if (!resolvedThemeId && theme_slug) {
    const { data: themeRow } = await supabase
      .from('themes')
      .select('id')
      .eq('slug', theme_slug)
      .single();
    if (themeRow) {
      resolvedThemeId = themeRow.id;
    }
  }

  if (searchScope === 'insights') {
    const { data, error } = await supabase.rpc('search_insights', {
      query_embedding: queryEmbedding,
      match_threshold: matchThreshold,
      match_count: matchLimit,
      filter_theme_id: resolvedThemeId,
    });

    if (error) {
      throw new Error('Insight search failed: ' + error.message);
    }

    const results: InsightResult[] = (data || []).map((row: any) => ({
      id: row.id,
      title: row.title,
      body: row.body,
      themes: row.themes,
      tags: row.tags,
      theme_id: row.theme_id || null,
      approved: row.approved,
      newsletter_section: row.newsletter_section,
      similarity: row.similarity,
      created_at: row.created_at,
    }));

    return { results: results, query: query, scope: 'insights', total: results.length };
  }

  // Default: content search
  const { data, error } = await supabase.rpc('search_content', {
    query_embedding: queryEmbedding,
    match_threshold: matchThreshold,
    match_count: matchLimit,
    filter_source_type: source_type || null,
    filter_tags: tags || null,
    filter_theme_id: resolvedThemeId,
  });

  if (error) {
    throw new Error('Search failed: ' + error.message);
  }

  const results: SearchResult[] = (data || []).map((row: any) => ({
    id: row.id,
    source_type: row.source_type,
    title: row.title,
    body: row.body,
    author: row.author,
    tags: row.tags,
    source_url: row.source_url,
    source_meta: row.source_meta,
    theme_id: row.theme_id || null,
    similarity: row.similarity,
    created_at: row.created_at,
  }));

  return { results: results, query: query, scope: 'content', total: results.length };
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

  const { data: source, error: sourceError } = await supabase
    .from('content')
    .select('id, embedding, source_type')
    .eq('id', content_id)
    .single();

  if (sourceError || !source) {
    throw new Error('Content not found: ' + content_id);
  }

  if (!source.embedding) {
    throw new Error('Content has no embedding. Run embedBatch first.');
  }

  const matchLimit = limit || 10;
  const matchThreshold = threshold || 0.3;
  const filterType = cross_type === false ? source.source_type : null;

  const { data, error } = await supabase.rpc('search_content', {
    query_embedding: source.embedding,
    match_threshold: matchThreshold,
    match_count: matchLimit + 1,
    filter_source_type: filterType,
    filter_tags: null,
  });

  if (error) {
    throw new Error('Related search failed: ' + error.message);
  }

  const results: SearchResult[] = (data || [])
    .filter((row: any) => row.id !== content_id)
    .slice(0, matchLimit)
    .map((row: any) => ({
      id: row.id,
      source_type: row.source_type,
      title: row.title,
      body: row.body,
      author: row.author,
      tags: row.tags,
      source_url: row.source_url,
      source_meta: row.source_meta,
      theme_id: row.theme_id || null,
      similarity: row.similarity,
      created_at: row.created_at,
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

  const { data: unembedded, error: fetchError } = await supabase.rpc('get_unembedded', {
    batch_limit: batchSize,
  });

  if (fetchError) {
    throw new Error('Failed to fetch unembedded content: ' + fetchError.message);
  }

  if (!unembedded || unembedded.length === 0) {
    return { processed: 0, failed: 0, remaining: 0 };
  }

  let processed = 0;
  let failed = 0;

  for (const item of unembedded) {
    try {
      const textToEmbed = item.title ? item.title + '\n\n' + item.body : item.body;
      const embedding = await generateEmbedding(textToEmbed);
      const now = new Date().toISOString();

      const { error: updateError } = await supabase
        .from('content')
        .update({ embedding: embedding, embedded_at: now })
        .eq('id', item.id);

      if (updateError) {
        console.error('Failed to update embedding for ' + item.id + ':', updateError.message);
        failed = failed + 1;
      } else {
        processed = processed + 1;
      }
    } catch (err) {
      console.error('Embedding failed for ' + item.id + ':', err);
      failed = failed + 1;
    }
  }

  // Count remaining unembedded
  const { count: remainCount } = await supabase
    .from('content')
    .select('id', { count: 'exact', head: true })
    .is('embedding', null);

  return { processed: processed, failed: failed, remaining: remainCount || 0 };
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
}): Promise<{ items: ContentRow[]; total: number; action: string }> {
  const { action, id, ids, source_type, limit, offset, undigested_only, add_tags, remove_tags } = args;

  if (!action) {
    throw new Error('action is required: "get", "list", or "tag"');
  }

  // GET — single item by ID
  if (action === 'get') {
    if (!id) {
      throw new Error('id is required for action "get"');
    }

    const { data, error } = await supabase
      .from('content')
      .select(CONTENT_COLUMNS)
      .eq('id', id)
      .single();

    if (error || !data) {
      throw new Error('Content not found: ' + id);
    }

    return { items: [data], total: 1, action: 'get' };
  }

  // TAG — add/remove tags on an item
  if (action === 'tag') {
    if (!id) {
      throw new Error('id is required for action "tag"');
    }

    const { data: existing, error: fetchError } = await supabase
      .from('content')
      .select('tags')
      .eq('id', id)
      .single();

    if (fetchError || !existing) {
      throw new Error('Content not found: ' + id);
    }

    let currentTags: string[] = existing.tags || [];

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

    const { error: updateError } = await supabase
      .from('content')
      .update({ tags: currentTags })
      .eq('id', id);

    if (updateError) {
      throw new Error('Tag update failed: ' + updateError.message);
    }

    // Return the updated item
    const { data: updated } = await supabase.from('content').select(CONTENT_COLUMNS).eq('id', id).single();
    return { items: updated ? [updated] : [], total: 1, action: 'tag' };
  }

  // LIST — paginated listing with filters
  if (action === 'list') {
    // Batch fetch by IDs
    if (ids && ids.length > 0) {
      const { data, error } = await supabase
        .from('content')
        .select(CONTENT_COLUMNS)
        .in('id', ids);

      if (error) {
        throw new Error('Batch fetch failed: ' + error.message);
      }

      return { items: data || [], total: (data || []).length, action: 'list' };
    }

    const pageSize = limit || 20;
    let query = supabase
      .from('content')
      .select(CONTENT_COLUMNS)
      .order('created_at', { ascending: false })
      .limit(pageSize);

    if (offset) {
      query = query.range(offset, offset + pageSize - 1);
    }
    if (source_type) {
      query = query.eq('source_type', source_type);
    }
    if (undigested_only) {
      query = query.is('digested_at', null);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error('List failed: ' + error.message);
    }

    return { items: data || [], total: (data || []).length, action: 'list' };
  }

  throw new Error('Unknown action: ' + action + '. Use "get", "list", or "tag".');
}

// ============================================
// 6. STATUS — Hub overview stats + health check
// ============================================

export async function status(args?: Record<string, never>): Promise<{
  health: string;
  supabase_ok: boolean;
  ai_ok: boolean;
  total_content: number;
  total_embedded: number;
  total_unembedded: number;
  total_digested: number;
  total_undigested: number;
  total_insights: number;
  total_approved_insights: number;
  total_newsletters: number;
  total_subscribers: number;
  by_source_type: Record<string, number>;
}> {
  let supabaseOk = false;
  let aiOk = false;

  // Health checks
  try {
    await supabase.from('content').select('id').limit(1);
    supabaseOk = true;
  } catch (e) {
    console.error('Supabase health check failed:', e);
  }

  try {
    const testEmbed = await generateEmbedding('health check');
    aiOk = testEmbed.length > 0;
  } catch (e) {
    console.error('AI health check failed:', e);
  }

  // Stats — parallel queries
  const [
    contentCount,
    embeddedCount,
    digestedCount,
    insightCount,
    approvedInsightCount,
    newsletterCount,
    subscriberCount,
  ] = await Promise.all([
    supabase.from('content').select('id', { count: 'exact', head: true }),
    supabase.from('content').select('id', { count: 'exact', head: true }).not('embedding', 'is', null),
    supabase.from('content').select('id', { count: 'exact', head: true }).not('digested_at', 'is', null),
    supabase.from('insights').select('id', { count: 'exact', head: true }),
    supabase.from('insights').select('id', { count: 'exact', head: true }).eq('approved', true),
    supabase.from('newsletters').select('id', { count: 'exact', head: true }),
    supabase.from('subscribers').select('id', { count: 'exact', head: true }).eq('subscribed', true),
  ]);

  const totalContent = contentCount.count || 0;
  const totalEmbedded = embeddedCount.count || 0;
  const totalDigested = digestedCount.count || 0;

  // Source type breakdown
  const { data: sourceRows } = await supabase.from('content').select('source_type');
  const bySourceType: Record<string, number> = {};
  if (sourceRows) {
    for (const row of sourceRows) {
      const st = row.source_type || 'unknown';
      bySourceType[st] = (bySourceType[st] || 0) + 1;
    }
  }

  return {
    health: supabaseOk && aiOk ? 'healthy' : 'degraded',
    supabase_ok: supabaseOk,
    ai_ok: aiOk,
    total_content: totalContent,
    total_embedded: totalEmbedded,
    total_unembedded: totalContent - totalEmbedded,
    total_digested: totalDigested,
    total_undigested: totalContent - totalDigested,
    total_insights: insightCount.count || 0,
    total_approved_insights: approvedInsightCount.count || 0,
    total_newsletters: newsletterCount.count || 0,
    total_subscribers: subscriberCount.count || 0,
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
  // Fetch stats for the dashboard
  let statsData: any = null;
  try {
    const [
      contentCount,
      embeddedCount,
      digestedCount,
      insightCount,
    ] = await Promise.all([
      supabase.from('content').select('id', { count: 'exact', head: true }),
      supabase.from('content').select('id', { count: 'exact', head: true }).not('embedding', 'is', null),
      supabase.from('content').select('id', { count: 'exact', head: true }).not('digested_at', 'is', null),
      supabase.from('insights').select('id', { count: 'exact', head: true }),
    ]);

    // Source breakdown
    const { data: sourceRows } = await supabase.from('content').select('source_type');
    const bySource: Record<string, number> = {};
    if (sourceRows) {
      for (const row of sourceRows) {
        const st = row.source_type || 'unknown';
        bySource[st] = (bySource[st] || 0) + 1;
      }
    }

    // Recent items
    const { data: recentItems } = await supabase
      .from('content')
      .select('id, source_type, title, author, created_at')
      .order('created_at', { ascending: false })
      .limit(10);

    statsData = {
      total: contentCount.count || 0,
      embedded: embeddedCount.count || 0,
      digested: digestedCount.count || 0,
      insights: insightCount.count || 0,
      bySource: bySource,
      recent: recentItems || [],
    };
  } catch (e) {
    console.error('Dashboard data fetch failed:', e);
  }

  const s = statsData || { total: 0, embedded: 0, digested: 0, insights: 0, bySource: {}, recent: [] };
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
    + '.card-value.cyan{color:#06b6d4}.card-value.green{color:#22c55e}.card-value.purple{color:#8b5cf6}.card-value.yellow{color:#eab308}'
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
    + '<div class="card"><div class="card-value yellow">' + s.insights + '</div><div class="card-label">Insights</div></div>'
    + '</div>'
    + '<div class="section"><h2>Sources</h2><div class="chips">' + (sourceChips || '<span class="chip">No content yet</span>') + '</div></div>'
    + '<div class="section"><h2>Recent Content</h2>'
    + '<table><thead><tr><th>Type</th><th>Title</th><th>Author</th><th>Date</th></tr></thead>'
    + '<tbody>' + (recentRows || '<tr><td colspan="4" style="color:#666;text-align:center;padding:24px">No content ingested yet</td></tr>') + '</tbody></table>'
    + '</div>'
    + '</div></body></html>';

  return http.html(htmlContent);
}
