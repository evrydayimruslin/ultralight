// Tweets MCP — Twitter/X Content Feeder
//
// Ingests tweets into the Research Intelligence Hub's shared content store.
// Handles tweet parsing (URLs, threads, batch), auto-embeds via the shared
// Supabase, and provides tweet-specific queries (by author, timeline, threads).
//
// Storage: BYOS Supabase (research-intelligence-hub) — shared with all MCPs
// AI: ultralight.ai() with text-embedding-3-small for embeddings
// Permissions: ai:call (embeddings), net:fetch (tweet scraping)

const supabase = (globalThis as any).supabase;
const ultralight = (globalThis as any).ultralight;
const uuid = (globalThis as any).uuid;

// ============================================
// TYPES
// ============================================

interface TweetInput {
  url?: string;
  content: string;
  author_handle: string;
  author_name?: string;
  posted_at?: string;
  metrics?: {
    likes?: number;
    retweets?: number;
    replies?: number;
    views?: number;
  };
  thread_id?: string;
  thread_position?: number;
  tags?: string[];
}

interface TweetRow {
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

// Select columns for content reads (excludes embedding — too large for MCP payloads)
const CONTENT_COLUMNS = 'id, source_type, source_id, source_url, source_meta, title, body, author, tags, theme_id, embedded_at, digested_at, source_created_at, created_at, updated_at';

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

function extractTweetId(url: string): string | null {
  const match = url.match(/(?:twitter\.com|x\.com)\/(\w+)\/status\/(\d+)/);
  return match ? match[2] : null;
}

function extractAuthorFromUrl(url: string): string | null {
  const match = url.match(/(?:twitter\.com|x\.com)\/(\w+)\/status/);
  return match ? match[1] : null;
}

function normalizeTwitterUrl(url: string): string {
  return url.replace('twitter.com', 'x.com');
}

async function resolveThemeId(tags: string[]): Promise<string | null> {
  if (!tags || tags.length === 0) return null;

  try {
    // Use the DB helper resolve_theme_from_tags(text[])
    const { data, error } = await supabase.rpc('resolve_theme_from_tags', {
      input_tags: tags,
    });

    if (error || !data) return null;
    return data; // Returns uuid or null
  } catch {
    return null;
  }
}

// ============================================
// 1. SAVE — Ingest a single tweet into the hub
// ============================================

export async function save(args: {
  content: string;
  author_handle: string;
  url?: string;
  author_name?: string;
  posted_at?: string;
  metrics?: {
    likes?: number;
    retweets?: number;
    replies?: number;
    views?: number;
  };
  thread_id?: string;
  thread_position?: number;
  tags?: string[];
  auto_embed?: boolean;
}): Promise<{ success: boolean; content_id: string; embedded: boolean; duplicate: boolean; theme_id: string | null }> {
  const {
    content,
    author_handle,
    url,
    author_name,
    posted_at,
    metrics,
    thread_id,
    thread_position,
    tags,
    auto_embed,
  } = args;

  if (!content || !author_handle) {
    throw new Error('content and author_handle are required');
  }

  // Extract tweet_id from URL for deduplication
  const tweetId = url ? extractTweetId(url) : null;
  const normalizedUrl = url ? normalizeTwitterUrl(url) : null;

  // Deduplicate by source_type + source_id (tweet_id)
  if (tweetId) {
    const { data: existing } = await supabase
      .from('content')
      .select('id')
      .eq('source_type', 'tweet')
      .eq('source_id', tweetId)
      .single();

    if (existing) {
      return { success: true, content_id: existing.id, embedded: false, duplicate: true, theme_id: null };
    }
  }

  const contentId = uuid.v4();
  let embedding: number[] | null = null;
  let embeddedAt: string | null = null;
  const shouldEmbed = auto_embed !== false;

  if (shouldEmbed) {
    try {
      const textToEmbed = '@' + author_handle + ': ' + content;
      embedding = await generateEmbedding(textToEmbed);
      embeddedAt = new Date().toISOString();
    } catch (err) {
      console.warn('Auto-embed failed, tweet saved without embedding:', err);
    }
  }

  // Build source_meta with tweet-specific data
  const sourceMeta: Record<string, unknown> = {};
  if (author_name) sourceMeta.author_name = author_name;
  if (metrics) sourceMeta.metrics = metrics;
  if (thread_id) sourceMeta.thread_id = thread_id;
  if (thread_position !== undefined) sourceMeta.thread_position = thread_position;

  // Resolve theme from bookmark tags (e.g. ['ai', 'tech'] → AI theme)
  const tweetTags = tags || [];
  const themeId = await resolveThemeId(tweetTags);

  const now = new Date().toISOString();
  const row = {
    id: contentId,
    source_type: 'tweet',
    source_id: tweetId || null,
    source_url: normalizedUrl,
    source_meta: sourceMeta,
    title: null,
    body: content,
    author: author_handle,
    tags: tweetTags,
    theme_id: themeId,
    embedding: embedding,
    embedded_at: embeddedAt,
    digested_at: null,
    digest_run_id: null,
    source_created_at: posted_at || null,
    created_at: now,
    updated_at: now,
  };

  const { error } = await supabase.from('content').insert(row);
  if (error) {
    throw new Error('Failed to save tweet: ' + error.message);
  }

  return {
    success: true,
    content_id: contentId,
    embedded: embedding !== null,
    duplicate: false,
    theme_id: themeId,
  };
}

// ============================================
// 2. BATCH — Ingest multiple tweets at once
// ============================================

export async function batch(args: {
  tweets: Array<{
    content: string;
    author_handle: string;
    url?: string;
    author_name?: string;
    posted_at?: string;
    metrics?: {
      likes?: number;
      retweets?: number;
      replies?: number;
      views?: number;
    };
    thread_id?: string;
    thread_position?: number;
    tags?: string[];
  }>;
  auto_embed?: boolean;
}): Promise<{ saved: number; duplicates: number; failed: number; ids: string[] }> {
  const { tweets, auto_embed } = args;

  if (!tweets || !Array.isArray(tweets) || tweets.length === 0) {
    throw new Error('tweets array is required and must not be empty');
  }

  // Cap batch size to stay under 30s execution limit
  const maxBatch = 10;
  const batch = tweets.slice(0, maxBatch);

  let saved = 0;
  let duplicates = 0;
  let failed = 0;
  const ids: string[] = [];

  for (const tweet of batch) {
    try {
      const result = await save({
        content: tweet.content,
        author_handle: tweet.author_handle,
        url: tweet.url,
        author_name: tweet.author_name,
        posted_at: tweet.posted_at,
        metrics: tweet.metrics,
        thread_id: tweet.thread_id,
        thread_position: tweet.thread_position,
        tags: tweet.tags,
        auto_embed: auto_embed,
      });

      if (result.duplicate) {
        duplicates = duplicates + 1;
      } else {
        saved = saved + 1;
      }
      ids.push(result.content_id);
    } catch (err) {
      console.error('Failed to save tweet in batch:', err);
      failed = failed + 1;
    }
  }

  return {
    saved: saved,
    duplicates: duplicates,
    failed: failed,
    ids: ids,
  };
}

// ============================================
// 3. FEED — Query tweets with filters
// ============================================

export async function feed(args: {
  action?: string;
  author?: string;
  thread_id?: string;
  tags?: string[];
  since?: string;
  limit?: number;
  offset?: number;
  id?: string;
  add_tags?: string[];
  remove_tags?: string[];
}): Promise<{ tweets: TweetRow[]; total: number; action: string }> {
  const { action, author, thread_id, tags, since, limit, offset, id, add_tags, remove_tags } = args;
  const feedAction = action || 'list';

  // GET — single tweet by content ID
  if (feedAction === 'get') {
    if (!id) {
      throw new Error('id is required for action "get"');
    }

    const { data, error } = await supabase
      .from('content')
      .select(CONTENT_COLUMNS)
      .eq('id', id)
      .eq('source_type', 'tweet')
      .single();

    if (error || !data) {
      throw new Error('Tweet not found: ' + id);
    }

    return { tweets: [data], total: 1, action: 'get' };
  }

  // TAG — add/remove tags on a tweet
  if (feedAction === 'tag') {
    if (!id) {
      throw new Error('id is required for action "tag"');
    }

    const { data: existing, error: fetchError } = await supabase
      .from('content')
      .select('tags')
      .eq('id', id)
      .eq('source_type', 'tweet')
      .single();

    if (fetchError || !existing) {
      throw new Error('Tweet not found: ' + id);
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

    const { data: updated } = await supabase
      .from('content')
      .select(CONTENT_COLUMNS)
      .eq('id', id)
      .single();

    return { tweets: updated ? [updated] : [], total: 1, action: 'tag' };
  }

  // THREAD — get all tweets in a thread, ordered by position
  if (feedAction === 'thread') {
    if (!thread_id) {
      throw new Error('thread_id is required for action "thread"');
    }

    const { data, error } = await supabase
      .from('content')
      .select(CONTENT_COLUMNS)
      .eq('source_type', 'tweet')
      .contains('source_meta', { thread_id: thread_id })
      .order('created_at', { ascending: true });

    if (error) {
      throw new Error('Thread fetch failed: ' + error.message);
    }

    // Sort by thread_position if available
    const sorted = (data || []).sort((a: any, b: any) => {
      const posA = a.source_meta?.thread_position ?? 999;
      const posB = b.source_meta?.thread_position ?? 999;
      return posA - posB;
    });

    return { tweets: sorted, total: sorted.length, action: 'thread' };
  }

  // LIST — paginated listing with filters (default)
  const pageSize = limit || 20;
  let query = supabase
    .from('content')
    .select(CONTENT_COLUMNS)
    .eq('source_type', 'tweet')
    .order('created_at', { ascending: false })
    .limit(pageSize);

  if (offset) {
    query = query.range(offset, offset + pageSize - 1);
  }
  if (author) {
    query = query.eq('author', author);
  }
  if (since) {
    query = query.gte('created_at', since);
  }
  if (tags && tags.length > 0) {
    query = query.overlaps('tags', tags);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error('Feed query failed: ' + error.message);
  }

  return { tweets: data || [], total: (data || []).length, action: 'list' };
}

// ============================================
// 4. PARSE — Extract tweet data from URL or raw text
// ============================================

export async function parse(args: {
  input: string;
  format?: string;
}): Promise<{
  parsed: boolean;
  tweets: Array<{
    content: string;
    author_handle: string;
    url: string | null;
    tweet_id: string | null;
  }>;
}> {
  const { input, format } = args;

  if (!input) {
    throw new Error('input is required — paste a tweet URL, raw tweet text, or a thread');
  }

  const parseFormat = format || 'auto';
  const tweets: Array<{
    content: string;
    author_handle: string;
    url: string | null;
    tweet_id: string | null;
  }> = [];

  // Auto-detect format
  if (parseFormat === 'auto' || parseFormat === 'url') {
    // Check if input contains tweet URLs
    const urlRegex = /https?:\/\/(?:twitter\.com|x\.com)\/(\w+)\/status\/(\d+)/g;
    let urlMatch;
    while ((urlMatch = urlRegex.exec(input)) !== null) {
      tweets.push({
        content: '', // Content must be provided separately or fetched
        author_handle: urlMatch[1],
        url: normalizeTwitterUrl(urlMatch[0]),
        tweet_id: urlMatch[2],
      });
    }

    if (tweets.length > 0) {
      return { parsed: true, tweets: tweets };
    }
  }

  if (parseFormat === 'auto' || parseFormat === 'text') {
    // Try to parse as "@handle: content" format
    const textRegex = /^@(\w+)[:\s]+(.+)/gm;
    let textMatch;
    while ((textMatch = textRegex.exec(input)) !== null) {
      tweets.push({
        content: textMatch[2].trim(),
        author_handle: textMatch[1],
        url: null,
        tweet_id: null,
      });
    }

    if (tweets.length > 0) {
      return { parsed: true, tweets: tweets };
    }

    // Fallback: treat entire input as a single tweet, author unknown
    if (input.trim().length > 0) {
      tweets.push({
        content: input.trim(),
        author_handle: 'unknown',
        url: null,
        tweet_id: null,
      });
      return { parsed: true, tweets: tweets };
    }
  }

  return { parsed: false, tweets: [] };
}

// ============================================
// 5. STATUS — Tweet-specific stats + health
// ============================================

export async function status(args?: Record<string, never>): Promise<{
  health: string;
  total_tweets: number;
  total_embedded: number;
  total_unembedded: number;
  total_digested: number;
  total_undigested: number;
  top_authors: Array<{ author: string; count: number }>;
  recent_activity: { last_24h: number; last_7d: number };
}> {
  let supabaseOk = false;

  try {
    await supabase.from('content').select('id').limit(1);
    supabaseOk = true;
  } catch (e) {
    console.error('Supabase health check failed:', e);
  }

  // Parallel stat queries — all filtered to source_type='tweet'
  const [
    totalCount,
    embeddedCount,
    digestedCount,
  ] = await Promise.all([
    supabase.from('content').select('id', { count: 'exact', head: true }).eq('source_type', 'tweet'),
    supabase.from('content').select('id', { count: 'exact', head: true }).eq('source_type', 'tweet').not('embedding', 'is', null),
    supabase.from('content').select('id', { count: 'exact', head: true }).eq('source_type', 'tweet').not('digested_at', 'is', null),
  ]);

  const totalTweets = totalCount.count || 0;
  const totalEmbedded = embeddedCount.count || 0;
  const totalDigested = digestedCount.count || 0;

  // Top authors
  const { data: authorRows } = await supabase
    .from('content')
    .select('author')
    .eq('source_type', 'tweet')
    .not('author', 'is', null);

  const authorCounts: Record<string, number> = {};
  if (authorRows) {
    for (const row of authorRows) {
      const a = row.author || 'unknown';
      authorCounts[a] = (authorCounts[a] || 0) + 1;
    }
  }

  const topAuthors = Object.entries(authorCounts)
    .map(([author, count]) => ({ author: author, count: count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Recent activity
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [last24h, last7d] = await Promise.all([
    supabase.from('content').select('id', { count: 'exact', head: true }).eq('source_type', 'tweet').gte('created_at', oneDayAgo),
    supabase.from('content').select('id', { count: 'exact', head: true }).eq('source_type', 'tweet').gte('created_at', sevenDaysAgo),
  ]);

  return {
    health: supabaseOk ? 'healthy' : 'degraded',
    total_tweets: totalTweets,
    total_embedded: totalEmbedded,
    total_unembedded: totalTweets - totalEmbedded,
    total_digested: totalDigested,
    total_undigested: totalTweets - totalDigested,
    top_authors: topAuthors,
    recent_activity: {
      last_24h: last24h.count || 0,
      last_7d: last7d.count || 0,
    },
  };
}

// ============================================
// 6. UI — Web dashboard at GET /http/{appId}/ui
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
    const [totalCount, embeddedCount] = await Promise.all([
      supabase.from('content').select('id', { count: 'exact', head: true }).eq('source_type', 'tweet'),
      supabase.from('content').select('id', { count: 'exact', head: true }).eq('source_type', 'tweet').not('embedding', 'is', null),
    ]);

    // Top authors
    const { data: authorRows } = await supabase
      .from('content')
      .select('author')
      .eq('source_type', 'tweet')
      .not('author', 'is', null);

    const authorCounts: Record<string, number> = {};
    if (authorRows) {
      for (const row of authorRows) {
        const a = row.author || 'unknown';
        authorCounts[a] = (authorCounts[a] || 0) + 1;
      }
    }

    const topAuthors = Object.entries(authorCounts)
      .map(([author, count]) => ({ author: author, count: count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Recent tweets
    const { data: recentTweets } = await supabase
      .from('content')
      .select('id, body, author, source_url, created_at')
      .eq('source_type', 'tweet')
      .order('created_at', { ascending: false })
      .limit(10);

    statsData = {
      total: totalCount.count || 0,
      embedded: embeddedCount.count || 0,
      topAuthors: topAuthors,
      recent: recentTweets || [],
    };
  } catch (e) {
    console.error('Dashboard data fetch failed:', e);
  }

  const s = statsData || { total: 0, embedded: 0, topAuthors: [], recent: [] };

  const authorChips = s.topAuthors
    .map((a: any) => '<span class="chip">@' + a.author + ' <b>' + a.count + '</b></span>')
    .join('');

  const recentRows = s.recent
    .map((item: any) => {
      const bodyPreview = (item.body || '').slice(0, 100) + ((item.body || '').length > 100 ? '...' : '');
      const link = item.source_url ? '<a href="' + item.source_url + '" target="_blank" class="link">open</a>' : '';
      return '<tr><td>@' + (item.author || 'unknown') + '</td><td>' + bodyPreview + '</td><td>' + new Date(item.created_at).toLocaleDateString() + '</td><td>' + link + '</td></tr>';
    })
    .join('');

  const htmlContent = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>Tweets — Research Intelligence Hub</title>'
    + '<style>'
    + '*{margin:0;padding:0;box-sizing:border-box}'
    + 'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0a0a0a;color:#e5e5e5;padding:24px}'
    + '.container{max-width:800px;margin:0 auto}'
    + 'h1{font-size:24px;font-weight:700;background:linear-gradient(90deg,#1d9bf0,#8b5cf6);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:4px}'
    + '.subtitle{color:#888;font-size:14px;margin-bottom:32px}'
    + '.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:32px}'
    + '.card{background:#141414;border:1px solid #2a2a2a;border-radius:12px;padding:20px}'
    + '.card-value{font-size:28px;font-weight:700}'
    + '.card-label{font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-top:4px}'
    + '.card-value.blue{color:#1d9bf0}.card-value.green{color:#22c55e}'
    + '.section{margin-bottom:32px}'
    + '.section h2{font-size:16px;color:#ccc;margin-bottom:12px}'
    + '.chips{display:flex;gap:8px;flex-wrap:wrap}'
    + '.chip{background:#1e1e1e;border:1px solid #2a2a2a;border-radius:20px;padding:6px 14px;font-size:13px;color:#aaa}'
    + '.chip b{color:#1d9bf0;margin-left:4px}'
    + 'table{width:100%;border-collapse:collapse}'
    + 'th,td{text-align:left;padding:10px 12px;border-bottom:1px solid #1e1e1e;font-size:13px}'
    + 'th{color:#888;font-weight:600;text-transform:uppercase;font-size:11px;letter-spacing:.5px}'
    + 'td{color:#ccc}'
    + '.link{color:#1d9bf0;text-decoration:none}'
    + '.link:hover{text-decoration:underline}'
    + '</style></head><body>'
    + '<div class="container">'
    + '<h1>Tweets</h1>'
    + '<p class="subtitle">Research Intelligence Hub — Twitter/X Feed</p>'
    + '<div class="grid">'
    + '<div class="card"><div class="card-value blue">' + s.total + '</div><div class="card-label">Total Tweets</div></div>'
    + '<div class="card"><div class="card-value green">' + s.embedded + '</div><div class="card-label">Embedded</div></div>'
    + '</div>'
    + '<div class="section"><h2>Top Authors</h2><div class="chips">' + (authorChips || '<span class="chip">No tweets yet</span>') + '</div></div>'
    + '<div class="section"><h2>Recent Tweets</h2>'
    + '<table><thead><tr><th>Author</th><th>Content</th><th>Date</th><th></th></tr></thead>'
    + '<tbody>' + (recentRows || '<tr><td colspan="4" style="color:#666;text-align:center;padding:24px">No tweets ingested yet</td></tr>') + '</tbody></table>'
    + '</div>'
    + '</div></body></html>';

  return http.html(htmlContent);
}
