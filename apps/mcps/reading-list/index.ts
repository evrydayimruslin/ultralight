// Reading List — Ultralight MCP App
// Track books, articles, tweets, and papers. Save highlights, notes, and search semantically.
// Storage: Ultralight KV | Permissions: ai:call, net:fetch

const ultralight = (globalThis as any).ultralight;

// ── SAVE URL / ITEM ──

export async function save(args: {
  url?: string;
  title?: string;
  type?: string;
  tags?: string[];
  notes?: string;
}): Promise<unknown> {
  const { url, title, type, tags, notes } = args;
  const id = crypto.randomUUID();

  let itemTitle = title || '';
  let contentSnippet = '';
  let itemType = type || 'article';

  // Fetch URL content if provided
  if (url) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Ultralight-ReadingList/1.0' },
      });
      const html = await response.text();

      // Extract title from HTML
      if (!itemTitle) {
        const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        if (titleMatch) {
          itemTitle = titleMatch[1].trim();
        }
      }

      // Extract meta description
      const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i);
      if (descMatch) {
        contentSnippet = descMatch[1].trim();
      }

      // Fallback: extract first meaningful text
      if (!contentSnippet) {
        const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
        if (bodyMatch) {
          const text = bodyMatch[1]
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
          contentSnippet = text.slice(0, 500);
        }
      }

      // Detect type from URL
      if (!type) {
        if (url.includes('twitter.com') || url.includes('x.com')) {
          itemType = 'tweet';
        } else if (url.includes('arxiv.org') || url.includes('scholar.google')) {
          itemType = 'paper';
        } else if (url.includes('youtube.com') || url.includes('youtu.be')) {
          itemType = 'video';
        }
      }
    } catch (e) {
      // URL fetch failed — still save the item with what we have
    }
  }

  if (!itemTitle && !url) {
    return { success: false, error: 'Provide at least a URL or title.' };
  }

  // Generate embedding for semantic search
  let embedding: number[] | null = null;
  const embeddingText = (itemTitle + ' ' + contentSnippet + ' ' + (tags || []).join(' ')).trim();
  if (embeddingText) {
    try {
      const response = await ultralight.ai({
        model: 'openai/text-embedding-3-small',
        input: embeddingText,
      });
      if (response && response.embedding) {
        embedding = response.embedding;
      }
    } catch (e) {
      // Embedding failed — save without it
    }
  }

  const item = {
    id: id,
    url: url || null,
    title: itemTitle || url || 'Untitled',
    type: itemType,
    content_snippet: contentSnippet,
    tags: tags || [],
    highlights: [],
    notes: notes || '',
    embedding: embedding,
    read_status: 'unread',
    saved_at: new Date().toISOString(),
  };

  await ultralight.store('items/' + id, item);

  return {
    success: true,
    item_id: id,
    title: item.title,
    type: itemType,
    has_content: contentSnippet.length > 0,
    has_embedding: embedding !== null,
  };
}

// ── LIST ITEMS ──

export async function list(args: {
  tags?: string[];
  type?: string;
  status?: string;
  limit?: number;
}): Promise<unknown> {
  const { tags, type, status, limit } = args;

  const results = await ultralight.query('items/', {
    filter: (item: any) => {
      if (type && item.type !== type) return false;
      if (status && item.read_status !== status) return false;
      if (tags && tags.length > 0) {
        const itemTags = item.tags || [];
        if (!tags.some((t: string) => itemTags.includes(t))) return false;
      }
      return true;
    },
    sort: { field: 'saved_at', order: 'desc' },
    limit: limit || 20,
  });

  const items = results.map((r: any) => {
    const item = r.value as any;
    return {
      id: item.id,
      title: item.title,
      url: item.url,
      type: item.type,
      tags: item.tags,
      read_status: item.read_status,
      saved_at: item.saved_at,
      highlights_count: (item.highlights || []).length,
    };
  });

  return {
    items: items,
    count: items.length,
  };
}

// ── SEARCH (SEMANTIC) ──

export async function search(args: {
  query: string;
  limit?: number;
}): Promise<unknown> {
  const { query, limit } = args;

  // Generate query embedding
  let queryEmbedding: number[] | null = null;
  try {
    const response = await ultralight.ai({
      model: 'openai/text-embedding-3-small',
      input: query,
    });
    if (response && response.embedding) {
      queryEmbedding = response.embedding;
    }
  } catch (e) {
    // Fall back to text search
  }

  const results = await ultralight.query('items/', {});
  const items = results.map((r: any) => r.value);

  let scored: Array<{ item: any; score: number }> = [];

  if (queryEmbedding) {
    // Semantic search via cosine similarity
    for (const item of items) {
      if (item.embedding && item.embedding.length > 0) {
        const score = cosineSimilarity(queryEmbedding, item.embedding);
        scored.push({ item: item, score: score });
      } else {
        // Text fallback for items without embeddings
        const textScore = textMatch(query, item);
        if (textScore > 0) {
          scored.push({ item: item, score: textScore * 0.5 });
        }
      }
    }
  } else {
    // Pure text search fallback
    for (const item of items) {
      const textScore = textMatch(query, item);
      if (textScore > 0) {
        scored.push({ item: item, score: textScore });
      }
    }
  }

  scored.sort((a, b) => b.score - a.score);
  const topResults = scored.slice(0, limit || 10);

  return {
    query: query,
    results: topResults.map((s) => ({
      id: s.item.id,
      title: s.item.title,
      url: s.item.url,
      type: s.item.type,
      tags: s.item.tags,
      score: Math.round(s.score * 100) / 100,
      snippet: s.item.content_snippet ? s.item.content_snippet.slice(0, 200) : '',
    })),
    count: topResults.length,
    method: queryEmbedding ? 'semantic' : 'text',
  };
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

function textMatch(query: string, item: any): number {
  const q = query.toLowerCase();
  let score = 0;
  if (item.title && item.title.toLowerCase().includes(q)) score += 1;
  if (item.content_snippet && item.content_snippet.toLowerCase().includes(q)) score += 0.5;
  if (item.notes && item.notes.toLowerCase().includes(q)) score += 0.3;
  if (item.tags && item.tags.some((t: string) => t.toLowerCase().includes(q))) score += 0.3;
  return score;
}

// ── HIGHLIGHT ──

export async function highlight(args: {
  item_id: string;
  text: string;
  note?: string;
}): Promise<unknown> {
  const { item_id, text, note } = args;

  const item = await ultralight.load('items/' + item_id) as any;
  if (!item) {
    return { success: false, error: 'Item not found: ' + item_id };
  }

  if (!item.highlights) {
    item.highlights = [];
  }

  item.highlights.push({
    text: text,
    note: note || '',
    created_at: new Date().toISOString(),
  });

  // Mark as read if adding highlights
  if (item.read_status === 'unread') {
    item.read_status = 'reading';
  }

  await ultralight.store('items/' + item_id, item);

  return {
    success: true,
    item_title: item.title,
    highlights_count: item.highlights.length,
  };
}

// ── STATUS ──

export async function status(args?: {}): Promise<unknown> {
  const results = await ultralight.query('items/', {});
  const items = results.map((r: any) => r.value);

  const byType: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  let totalHighlights = 0;

  for (const item of items) {
    byType[item.type] = (byType[item.type] || 0) + 1;
    byStatus[item.read_status] = (byStatus[item.read_status] || 0) + 1;
    totalHighlights += (item.highlights || []).length;
  }

  return {
    total_items: items.length,
    by_type: byType,
    by_status: byStatus,
    total_highlights: totalHighlights,
  };
}
