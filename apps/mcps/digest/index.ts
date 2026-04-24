// Digest MCP — Synthesis Engine
//
// Processes undigested content, clusters related items,
// synthesizes insights using AI, and manages the newsletter pipeline.
// Designed for micro-step execution (each function <30s) driven by cron.
//
// Pipeline: collect -> synthesize -> review -> compose -> approve
//
// Storage: Ultralight D1
// AI: ultralight.ai() for LLM synthesis + embeddings
// Permissions: ai:call (synthesis + embeddings), net:fetch (external APIs)

const ultralight = globalThis.ultralight;

type JsonObject = Record<string, unknown>;

interface CountRow {
  cnt: number;
}

interface EmbedContentRow {
  id: string;
  source_type: string | null;
  title: string | null;
  body: string | null;
  author: string | null;
  theme_id: string | null;
}

interface InsightRow {
  id: string;
  digest_run_id: string | null;
  source_content_ids: string | null;
  title: string;
  body: string;
  themes: string | null;
  tags: string | null;
  theme_id: string | null;
  newsletter_section: string | null;
  newsletter_id: string | null;
  approved: number;
  approved_at: string | null;
  rejected: number;
  revision_notes: string | null;
  codebase_relevance: string | null;
  created_at: string;
  updated_at: string;
}

interface ParsedInsight extends Omit<InsightRow, 'source_content_ids' | 'themes' | 'tags' | 'approved' | 'rejected' | 'codebase_relevance'> {
  source_content_ids: string[];
  themes: string[];
  tags: string[];
  approved: boolean;
  rejected: boolean;
  codebase_relevance: JsonObject | null;
}

interface SynthesizedInsight {
  title: string;
  body: string;
  themes: string[];
  source_indices: number[];
  newsletter_section: string | null;
}

interface SynthesizeAiResponse {
  insights: SynthesizedInsight[];
}

interface NewsletterSection {
  section: string;
  insight_id: string;
  content: string;
  order: number;
}

interface NewsletterRow {
  id: string;
  title: string;
  slug: string | null;
  sections: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

interface ParsedNewsletter extends Omit<NewsletterRow, 'sections'> {
  sections: NewsletterSection[];
}

interface RenderedNewsletter extends ParsedNewsletter {
  rendered_markdown: string;
}

interface DigestRunRow {
  id: string;
  user_id: string;
  step: string;
  status: string;
  items_processed: number;
  items_created: number;
  error_message: string | null;
  duration_ms: number | null;
  ai_input_tokens: number | null;
  ai_output_tokens: number | null;
  ai_cost_light: number | string | null;
  started_at: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface DashboardInsightRow {
  id: string;
  title: string;
  themes: string | null;
  approved: number;
  rejected: number;
  created_at: string;
}

interface DashboardInsight extends Omit<DashboardInsightRow, 'themes' | 'approved' | 'rejected'> {
  themes: string[];
  approved: boolean;
  rejected: boolean;
}

interface DashboardPipelineData {
  undigested: number;
  pending: number;
  approved: number;
  drafts: number;
  sent: number;
  recentInsights: DashboardInsight[];
}

function parseStringArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value: string | null | undefined): JsonObject | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as JsonObject : null;
  } catch {
    return null;
  }
}

function parseNewsletterSections(value: string | null | undefined): NewsletterSection[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is NewsletterSection =>
        !!item
        && typeof item === 'object'
        && typeof item.section === 'string'
        && typeof item.insight_id === 'string'
        && typeof item.content === 'string'
        && typeof item.order === 'number')
      .map((item) => ({
        section: item.section,
        insight_id: item.insight_id,
        content: item.content,
        order: item.order,
      }));
  } catch {
    return [];
  }
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
    throw new Error('Embedding generation failed');
  }
  return response.embedding;
}

async function logDigestRun(step: string, status: string, metrics: {
  items_processed?: number;
  items_created?: number;
  error_message?: string;
  duration_ms?: number;
  ai_input_tokens?: number;
  ai_output_tokens?: number;
  ai_cost_light?: number;
}): Promise<string> {
  const runId = crypto.randomUUID();
  const now = new Date().toISOString();

  await ultralight.db.run(
    'INSERT INTO digest_runs (id, user_id, step, status, items_processed, items_created, error_message, duration_ms, ai_input_tokens, ai_output_tokens, ai_cost_light, started_at, completed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [runId, ultralight.user.id, step, status, metrics.items_processed || 0, metrics.items_created || 0, metrics.error_message || null, metrics.duration_ms || null, metrics.ai_input_tokens || 0, metrics.ai_output_tokens || 0, metrics.ai_cost_light || 0, now, status === 'running' ? null : now, now, now]
  );

  return runId;
}

function parseInsightRow(row: InsightRow): ParsedInsight {
  return {
    ...row,
    source_content_ids: parseStringArray(row.source_content_ids),
    themes: parseStringArray(row.themes),
    tags: parseStringArray(row.tags),
    codebase_relevance: parseJsonObject(row.codebase_relevance),
    approved: !!row.approved,
    rejected: !!row.rejected,
  };
}

function parseNewsletterRow(row: NewsletterRow): ParsedNewsletter {
  return {
    ...row,
    sections: parseNewsletterSections(row.sections),
  };
}

// Insight columns — excludes embedding for payload size
const INSIGHT_SELECT = 'id, digest_run_id, source_content_ids, title, body, themes, tags, theme_id, newsletter_section, newsletter_id, approved, approved_at, rejected, revision_notes, codebase_relevance, created_at, updated_at';

// ============================================
// 1. SYNTHESIZE — Process undigested content into insights
// ============================================

export async function synthesize(args: {
  batch_size?: number;
  source_type?: string;
  focus?: string;
}): Promise<{
  success: boolean;
  insights_created: number;
  content_digested: number;
  run_id: string;
}> {
  const batchSize = args.batch_size || 15;
  const sourceFilter = args.source_type || null;
  const focus = args.focus || null;

  const startTime = Date.now();

  // Fetch undigested content from the embeds table (shared store)
  // Note: This assumes the embeds MCP is also using D1 and the table is accessible
  // In practice, this would query the embeds table or a local content mirror
  let undigestedQuery = 'SELECT id, source_type, title, body, author, theme_id FROM embeds WHERE digested_at IS NULL AND embedded_at IS NOT NULL AND user_id = ?';
  const params: Array<string | number | null> = [ultralight.user.id];

  if (sourceFilter) {
    undigestedQuery += ' AND source_type = ?';
    params.push(sourceFilter);
  }

  undigestedQuery += ' ORDER BY created_at DESC LIMIT ?';
  params.push(batchSize);

  let undigested: EmbedContentRow[];
  try {
    undigested = await ultralight.db.all(undigestedQuery, params);
  } catch (e) {
    // If embeds table doesn't exist in this DB, return empty
    const runId = await logDigestRun('synthesize', 'completed', {
      items_processed: 0,
      items_created: 0,
      duration_ms: Date.now() - startTime,
    });
    return { success: true, insights_created: 0, content_digested: 0, run_id: runId };
  }

  if (!undigested || undigested.length === 0) {
    const runId = await logDigestRun('synthesize', 'completed', {
      items_processed: 0,
      items_created: 0,
      duration_ms: Date.now() - startTime,
    });
    return { success: true, insights_created: 0, content_digested: 0, run_id: runId };
  }

  // Prepare content summaries for AI
  const contentSummaries = undigested.map((item: EmbedContentRow, idx: number) => {
    const source = item.source_type || 'unknown';
    const author = item.author ? ' by @' + item.author : '';
    const title = item.title ? ' — ' + item.title : '';
    const body = (item.body || '').slice(0, 500);
    return (idx + 1) + '. [' + source + author + title + '] ' + body;
  }).join('\n\n');

  // Synthesize with AI
  const systemPrompt = 'You are a research intelligence analyst. Given a batch of content (tweets, notes, articles), identify 1-5 key insights. Each insight should synthesize multiple pieces of content into a coherent observation, trend, or actionable takeaway.\n\n'
    + 'Output ONLY valid JSON in this exact format:\n'
    + '{\n'
    + '  "insights": [\n'
    + '    {\n'
    + '      "title": "Concise insight title",\n'
    + '      "body": "2-4 sentences explaining the insight, connecting the sources, and why it matters",\n'
    + '      "themes": ["theme1", "theme2"],\n'
    + '      "source_indices": [1, 3, 5],\n'
    + '      "newsletter_section": "lead" | "analysis" | "links" | "coda" | null\n'
    + '    }\n'
    + '  ]\n'
    + '}';

  let userPrompt = 'Analyze this batch of ' + undigested.length + ' content items and extract key insights:\n\n' + contentSummaries;
  if (focus) {
    userPrompt = userPrompt + '\n\nFocus area: ' + focus;
  }

  let aiResponse;
  try {
    aiResponse = await ultralight.ai({
      model: 'openai/gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });
  } catch (err) {
    await logDigestRun('synthesize', 'failed', {
      items_processed: undigested.length,
      error_message: 'AI synthesis failed: ' + (err instanceof Error ? err.message : String(err)),
      duration_ms: Date.now() - startTime,
    });
    throw new Error('AI synthesis failed: ' + (err instanceof Error ? err.message : String(err)));
  }

  // Parse AI response
  let parsed: SynthesizeAiResponse;
  try {
    const content = aiResponse.content || aiResponse.text || '';
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, content];
    parsed = JSON.parse(jsonMatch[1] || content);
  } catch (err) {
    await logDigestRun('synthesize', 'failed', {
      items_processed: undigested.length,
      error_message: 'Failed to parse AI response as JSON',
      duration_ms: Date.now() - startTime,
    });
    throw new Error('Failed to parse AI synthesis response as JSON');
  }

  if (!parsed.insights || !Array.isArray(parsed.insights)) {
    await logDigestRun('synthesize', 'failed', {
      items_processed: undigested.length,
      error_message: 'AI response missing insights array',
      duration_ms: Date.now() - startTime,
    });
    throw new Error('AI response missing insights array');
  }

  const digestRunId = crypto.randomUUID();
  let insightsCreated = 0;

  // Insert insights
  for (const insight of parsed.insights) {
    try {
      const sourceIds = (insight.source_indices || [])
        .filter((i: number) => i >= 1 && i <= undigested.length)
        .map((i: number) => undigested[i - 1].id);

      // Generate embedding for the insight
      let embedding: string | null = null;
      try {
        const embeddingArr = await generateEmbedding(insight.title + '\n\n' + insight.body);
        embedding = JSON.stringify(embeddingArr);
      } catch (e) {
        console.warn('Insight embedding failed:', e);
      }

      const insightId = crypto.randomUUID();
      const now = new Date().toISOString();

      await ultralight.db.run(
        'INSERT INTO insights (id, user_id, digest_run_id, source_content_ids, title, body, themes, tags, theme_id, embedding, newsletter_section, newsletter_id, approved, approved_at, rejected, revision_notes, codebase_relevance, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [insightId, ultralight.user.id, digestRunId, JSON.stringify(sourceIds), insight.title, insight.body, JSON.stringify(insight.themes || []), '[]', null, embedding, insight.newsletter_section || null, null, 0, null, 0, null, null, now, now]
      );

      insightsCreated = insightsCreated + 1;
    } catch (err) {
      console.error('Error processing insight:', err);
    }
  }

  // Mark content as digested in the embeds table
  const contentIds = undigested.map((item: EmbedContentRow) => item.id);
  const now = new Date().toISOString();
  const placeholders = contentIds.map(() => '?').join(', ');
  try {
    await ultralight.db.run(
      'UPDATE embeds SET digested_at = ?, digest_run_id = ?, updated_at = ? WHERE id IN (' + placeholders + ') AND user_id = ?',
      [now, digestRunId, now, ...contentIds, ultralight.user.id]
    );
  } catch (e) {
    console.error('Failed to mark content as digested:', e);
  }

  const durationMs = Date.now() - startTime;

  await logDigestRun('synthesize', 'completed', {
    items_processed: undigested.length,
    items_created: insightsCreated,
    duration_ms: durationMs,
    ai_input_tokens: aiResponse.usage?.input_tokens || 0,
    ai_output_tokens: aiResponse.usage?.output_tokens || 0,
    ai_cost_light: aiResponse.usage?.cost_light || 0,
  });

  return {
    success: true,
    insights_created: insightsCreated,
    content_digested: undigested.length,
    run_id: digestRunId,
  };
}

// ============================================
// 2. REVIEW — Approve, reject, or revise insights
// ============================================

export async function review(args: {
  action: string;
  insight_id?: string;
  revision_notes?: string;
  newsletter_section?: string;
  limit?: number;
}): Promise<{ insights: ParsedInsight[]; total: number; action: string }> {
  const { action, insight_id, revision_notes, newsletter_section, limit } = args;

  if (!action) {
    throw new Error('action is required: "pending", "approve", "reject", "revise", "approved", "rejected"');
  }

  // LIST PENDING
  if (action === 'pending') {
    const pageSize = limit || 20;
    const rows: InsightRow[] = await ultralight.db.all(
      'SELECT ' + INSIGHT_SELECT + ' FROM insights WHERE approved = 0 AND rejected = 0 AND user_id = ? ORDER BY created_at DESC LIMIT ?',
      [ultralight.user.id, pageSize]
    );
    const parsed = rows.map(parseInsightRow);
    return { insights: parsed, total: parsed.length, action: 'pending' };
  }

  // LIST APPROVED
  if (action === 'approved') {
    const pageSize = limit || 20;
    const rows: InsightRow[] = await ultralight.db.all(
      'SELECT ' + INSIGHT_SELECT + ' FROM insights WHERE approved = 1 AND user_id = ? ORDER BY approved_at DESC LIMIT ?',
      [ultralight.user.id, pageSize]
    );
    const parsed = rows.map(parseInsightRow);
    return { insights: parsed, total: parsed.length, action: 'approved' };
  }

  // LIST REJECTED
  if (action === 'rejected') {
    const pageSize = limit || 20;
    const rows: InsightRow[] = await ultralight.db.all(
      'SELECT ' + INSIGHT_SELECT + ' FROM insights WHERE rejected = 1 AND user_id = ? ORDER BY updated_at DESC LIMIT ?',
      [ultralight.user.id, pageSize]
    );
    const parsed = rows.map(parseInsightRow);
    return { insights: parsed, total: parsed.length, action: 'rejected' };
  }

  // APPROVE
  if (action === 'approve') {
    if (!insight_id) {
      throw new Error('insight_id is required for action "approve"');
    }

    const now = new Date().toISOString();
    let sql = 'UPDATE insights SET approved = 1, approved_at = ?, rejected = 0, updated_at = ?';
    const params: Array<string | number | null> = [now, now];

    if (newsletter_section) {
      sql += ', newsletter_section = ?';
      params.push(newsletter_section);
    }

    sql += ' WHERE id = ? AND user_id = ?';
    params.push(insight_id, ultralight.user.id);

    await ultralight.db.run(sql, params);

    const updated: InsightRow | null = await ultralight.db.first(
      'SELECT ' + INSIGHT_SELECT + ' FROM insights WHERE id = ? AND user_id = ?',
      [insight_id, ultralight.user.id]
    );

    return { insights: updated ? [parseInsightRow(updated)] : [], total: 1, action: 'approve' };
  }

  // REJECT
  if (action === 'reject') {
    if (!insight_id) {
      throw new Error('insight_id is required for action "reject"');
    }

    const now = new Date().toISOString();
    await ultralight.db.run(
      'UPDATE insights SET rejected = 1, approved = 0, revision_notes = ?, updated_at = ? WHERE id = ? AND user_id = ?',
      [revision_notes || null, now, insight_id, ultralight.user.id]
    );

    const updated: InsightRow | null = await ultralight.db.first(
      'SELECT ' + INSIGHT_SELECT + ' FROM insights WHERE id = ? AND user_id = ?',
      [insight_id, ultralight.user.id]
    );

    return { insights: updated ? [parseInsightRow(updated)] : [], total: 1, action: 'reject' };
  }

  // REVISE
  if (action === 'revise') {
    if (!insight_id || !revision_notes) {
      throw new Error('insight_id and revision_notes are required for action "revise"');
    }

    const now = new Date().toISOString();
    await ultralight.db.run(
      'UPDATE insights SET revision_notes = ?, approved = 0, rejected = 0, updated_at = ? WHERE id = ? AND user_id = ?',
      [revision_notes, now, insight_id, ultralight.user.id]
    );

    const updated: InsightRow | null = await ultralight.db.first(
      'SELECT ' + INSIGHT_SELECT + ' FROM insights WHERE id = ? AND user_id = ?',
      [insight_id, ultralight.user.id]
    );

    return { insights: updated ? [parseInsightRow(updated)] : [], total: 1, action: 'revise' };
  }

  throw new Error('Unknown action: ' + action + '. Use "pending", "approve", "reject", "revise", "approved", or "rejected".');
}

// ============================================
// 3. COMPOSE — Build newsletter from approved insights
// ============================================

export async function compose(args: {
  title: string;
  insight_ids?: string[];
  auto_select?: boolean;
  max_sections?: number;
}): Promise<{
  success: boolean;
  newsletter_id: string;
  title: string;
  section_count: number;
  status: string;
}> {
  const { title, insight_ids, auto_select, max_sections } = args;

  if (!title) {
    throw new Error('title is required');
  }

  const maxSections = max_sections || 8;
  let selectedInsights: ParsedInsight[];

  if (insight_ids && insight_ids.length > 0) {
    const placeholders = insight_ids.map(() => '?').join(', ');
    const rows: InsightRow[] = await ultralight.db.all(
      'SELECT ' + INSIGHT_SELECT + ' FROM insights WHERE id IN (' + placeholders + ') AND approved = 1 AND user_id = ?',
      [...insight_ids, ultralight.user.id]
    );
    selectedInsights = rows.map(parseInsightRow);
  } else if (auto_select !== false) {
    const rows: InsightRow[] = await ultralight.db.all(
      'SELECT ' + INSIGHT_SELECT + ' FROM insights WHERE approved = 1 AND newsletter_id IS NULL AND user_id = ? ORDER BY created_at DESC LIMIT ?',
      [ultralight.user.id, maxSections]
    );
    selectedInsights = rows.map(parseInsightRow);
  } else {
    throw new Error('Either insight_ids or auto_select must be provided');
  }

  if (selectedInsights.length === 0) {
    throw new Error('No approved insights available for newsletter composition');
  }

  // Create newsletter
  const newsletterId = crypto.randomUUID();
  const now = new Date().toISOString();

  // Build sections
  const sectionOrder: Record<string, number> = { lead: 1, analysis: 2, links: 3, coda: 4 };
  const sections = selectedInsights
    .sort((a, b) => {
      const orderA = sectionOrder[a.newsletter_section || ''] || 3;
      const orderB = sectionOrder[b.newsletter_section || ''] || 3;
      return orderA - orderB;
    })
    .map((insight, idx: number) => ({
      section: insight.newsletter_section || 'analysis',
      insight_id: insight.id,
      content: '## ' + insight.title + '\n\n' + insight.body,
      order: idx + 1,
    }));

  await ultralight.db.run(
    'INSERT INTO newsletters (id, user_id, title, slug, sections, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [newsletterId, ultralight.user.id, title, null, JSON.stringify(sections), 'draft', now, now]
  );

  // Link insights to this newsletter
  const insightIdsToLink = selectedInsights.map((insight) => insight.id);
  const placeholders = insightIdsToLink.map(() => '?').join(', ');
  await ultralight.db.run(
    'UPDATE insights SET newsletter_id = ?, updated_at = ? WHERE id IN (' + placeholders + ') AND user_id = ?',
    [newsletterId, now, ...insightIdsToLink, ultralight.user.id]
  );

  return {
    success: true,
    newsletter_id: newsletterId,
    title: title,
    section_count: sections.length,
    status: 'draft',
  };
}

// ============================================
// 4. NEWSLETTER — Manage newsletter pipeline
// ============================================

export async function newsletter(args: {
  action: string;
  newsletter_id?: string;
  status_filter?: string;
  title?: string;
  sections?: Array<{ section: string; insight_id: string; content: string; order: number }>;
  limit?: number;
}): Promise<{ newsletters: Array<ParsedNewsletter | RenderedNewsletter>; total: number; action: string }> {
  const { action, newsletter_id, status_filter, title, sections, limit } = args;

  if (!action) {
    throw new Error('action is required: "list", "get", "update", "approve", or "render"');
  }

  // LIST
  if (action === 'list') {
    const pageSize = limit || 20;
    let sql = 'SELECT * FROM newsletters WHERE user_id = ?';
    const params: Array<string | number | null> = [ultralight.user.id];

    if (status_filter) {
      sql += ' AND status = ?';
      params.push(status_filter);
    }

    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(pageSize);

    const rows: NewsletterRow[] = await ultralight.db.all(sql, params);
    const parsed = rows.map(parseNewsletterRow);
    return { newsletters: parsed, total: parsed.length, action: 'list' };
  }

  // GET
  if (action === 'get') {
    if (!newsletter_id) {
      throw new Error('newsletter_id is required for action "get"');
    }

    const row: NewsletterRow | null = await ultralight.db.first(
      'SELECT * FROM newsletters WHERE id = ? AND user_id = ?',
      [newsletter_id, ultralight.user.id]
    );

    if (!row) {
      throw new Error('Newsletter not found: ' + newsletter_id);
    }

    const parsed = parseNewsletterRow(row);
    return { newsletters: [parsed], total: 1, action: 'get' };
  }

  // UPDATE
  if (action === 'update') {
    if (!newsletter_id) {
      throw new Error('newsletter_id is required for action "update"');
    }

    const now = new Date().toISOString();
    const setClauses: string[] = ['updated_at = ?'];
    const params: Array<string | number | null> = [now];

    if (title) {
      setClauses.push('title = ?');
      params.push(title);
    }
    if (sections) {
      setClauses.push('sections = ?');
      params.push(JSON.stringify(sections));
    }

    params.push(newsletter_id, ultralight.user.id);
    await ultralight.db.run(
      'UPDATE newsletters SET ' + setClauses.join(', ') + ' WHERE id = ? AND user_id = ?',
      params
    );

    const updated: NewsletterRow | null = await ultralight.db.first(
      'SELECT * FROM newsletters WHERE id = ? AND user_id = ?',
      [newsletter_id, ultralight.user.id]
    );
    const parsed = updated ? parseNewsletterRow(updated) : null;
    return { newsletters: parsed ? [parsed] : [], total: 1, action: 'update' };
  }

  // APPROVE
  if (action === 'approve') {
    if (!newsletter_id) {
      throw new Error('newsletter_id is required for action "approve"');
    }

    const now = new Date().toISOString();
    await ultralight.db.run(
      'UPDATE newsletters SET status = ?, updated_at = ? WHERE id = ? AND status = ? AND user_id = ?',
      ['approved', now, newsletter_id, 'draft', ultralight.user.id]
    );

    const updated: NewsletterRow | null = await ultralight.db.first(
      'SELECT * FROM newsletters WHERE id = ? AND user_id = ?',
      [newsletter_id, ultralight.user.id]
    );
    const parsed = updated ? parseNewsletterRow(updated) : null;
    return { newsletters: parsed ? [parsed] : [], total: 1, action: 'approve' };
  }

  // RENDER
  if (action === 'render') {
    if (!newsletter_id) {
      throw new Error('newsletter_id is required for action "render"');
    }

    const row: NewsletterRow | null = await ultralight.db.first(
      'SELECT * FROM newsletters WHERE id = ? AND user_id = ?',
      [newsletter_id, ultralight.user.id]
    );

    if (!row) {
      throw new Error('Newsletter not found: ' + newsletter_id);
    }

    const nl = parseNewsletterRow(row);
    const nlSections = nl.sections || [];
    const sortedSections = [...nlSections].sort((a, b) => (a.order || 0) - (b.order || 0));

    let markdown = '# ' + nl.title + '\n\n';
    for (const section of sortedSections) {
      markdown = markdown + section.content + '\n\n---\n\n';
    }

    const rendered = { ...nl, rendered_markdown: markdown };
    return { newsletters: [rendered], total: 1, action: 'render' };
  }

  throw new Error('Unknown action: ' + action + '. Use "list", "get", "update", "approve", or "render".');
}

// ============================================
// 5. STATUS — Digest pipeline overview
// ============================================

export async function status(args?: Record<string, never>): Promise<{
  health: string;
  pipeline: {
    undigested_content: number;
    pending_insights: number;
    approved_insights: number;
    rejected_insights: number;
    draft_newsletters: number;
    approved_newsletters: number;
    sent_newsletters: number;
  };
  recent_runs: DigestRunRow[];
  ai_usage: {
    total_input_tokens: number;
    total_output_tokens: number;
    total_cost_light: number;
  };
}> {
  // Pipeline stats
  let undigestedCount = 0;
  try {
    const row: CountRow | null = await ultralight.db.first(
      'SELECT COUNT(*) as cnt FROM embeds WHERE digested_at IS NULL AND embedded_at IS NOT NULL AND user_id = ?',
      [ultralight.user.id]
    );
    undigestedCount = row ? row.cnt : 0;
  } catch (e) {
    // embeds table may not exist in this DB
  }

  const pendingRow: CountRow | null = await ultralight.db.first(
    'SELECT COUNT(*) as cnt FROM insights WHERE approved = 0 AND rejected = 0 AND user_id = ?',
    [ultralight.user.id]
  );
  const approvedRow: CountRow | null = await ultralight.db.first(
    'SELECT COUNT(*) as cnt FROM insights WHERE approved = 1 AND user_id = ?',
    [ultralight.user.id]
  );
  const rejectedRow: CountRow | null = await ultralight.db.first(
    'SELECT COUNT(*) as cnt FROM insights WHERE rejected = 1 AND user_id = ?',
    [ultralight.user.id]
  );
  const draftRow: CountRow | null = await ultralight.db.first(
    'SELECT COUNT(*) as cnt FROM newsletters WHERE status = ? AND user_id = ?',
    ['draft', ultralight.user.id]
  );
  const approvedNlRow: CountRow | null = await ultralight.db.first(
    'SELECT COUNT(*) as cnt FROM newsletters WHERE status = ? AND user_id = ?',
    ['approved', ultralight.user.id]
  );
  const sentRow: CountRow | null = await ultralight.db.first(
    'SELECT COUNT(*) as cnt FROM newsletters WHERE status = ? AND user_id = ?',
    ['sent', ultralight.user.id]
  );

  // Recent digest runs
  const recentRuns: DigestRunRow[] = await ultralight.db.all(
    'SELECT * FROM digest_runs WHERE user_id = ? ORDER BY started_at DESC LIMIT 10',
    [ultralight.user.id]
  );

  // AI usage totals
  const aiUsageRows: Pick<DigestRunRow, 'ai_input_tokens' | 'ai_output_tokens' | 'ai_cost_light'>[] = await ultralight.db.all(
    'SELECT ai_input_tokens, ai_output_tokens, ai_cost_light FROM digest_runs WHERE user_id = ?',
    [ultralight.user.id]
  );

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCostLight = 0;
  for (const run of aiUsageRows) {
    totalInputTokens = totalInputTokens + (run.ai_input_tokens || 0);
    totalOutputTokens = totalOutputTokens + (run.ai_output_tokens || 0);
    totalCostLight = totalCostLight + (Number(run.ai_cost_light) || 0);
  }

  return {
    health: 'healthy',
    pipeline: {
      undigested_content: undigestedCount,
      pending_insights: pendingRow ? pendingRow.cnt : 0,
      approved_insights: approvedRow ? approvedRow.cnt : 0,
      rejected_insights: rejectedRow ? rejectedRow.cnt : 0,
      draft_newsletters: draftRow ? draftRow.cnt : 0,
      approved_newsletters: approvedNlRow ? approvedNlRow.cnt : 0,
      sent_newsletters: sentRow ? sentRow.cnt : 0,
    },
    recent_runs: recentRuns,
    ai_usage: {
      total_input_tokens: totalInputTokens,
      total_output_tokens: totalOutputTokens,
      total_cost_light: totalCostLight,
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
}): Promise<unknown> {
  let pipelineData: DashboardPipelineData | null = null;
  try {
    let undigestedCount = 0;
    try {
      const row: CountRow | null = await ultralight.db.first(
        'SELECT COUNT(*) as cnt FROM embeds WHERE digested_at IS NULL AND embedded_at IS NOT NULL AND user_id = ?',
        [ultralight.user.id]
      );
      undigestedCount = row ? row.cnt : 0;
    } catch (e) { /* embeds table may not exist */ }

    const pendingRow: CountRow | null = await ultralight.db.first(
      'SELECT COUNT(*) as cnt FROM insights WHERE approved = 0 AND rejected = 0 AND user_id = ?',
      [ultralight.user.id]
    );
    const approvedRow: CountRow | null = await ultralight.db.first(
      'SELECT COUNT(*) as cnt FROM insights WHERE approved = 1 AND user_id = ?',
      [ultralight.user.id]
    );
    const draftRow: CountRow | null = await ultralight.db.first(
      'SELECT COUNT(*) as cnt FROM newsletters WHERE status = ? AND user_id = ?',
      ['draft', ultralight.user.id]
    );
    const sentRow: CountRow | null = await ultralight.db.first(
      'SELECT COUNT(*) as cnt FROM newsletters WHERE status = ? AND user_id = ?',
      ['sent', ultralight.user.id]
    );

    // Recent insights
    const recentInsights: DashboardInsightRow[] = await ultralight.db.all(
      'SELECT id, title, themes, approved, rejected, created_at FROM insights WHERE user_id = ? ORDER BY created_at DESC LIMIT 10',
      [ultralight.user.id]
    );

    pipelineData = {
      undigested: undigestedCount,
      pending: pendingRow ? pendingRow.cnt : 0,
      approved: approvedRow ? approvedRow.cnt : 0,
      drafts: draftRow ? draftRow.cnt : 0,
      sent: sentRow ? sentRow.cnt : 0,
      recentInsights: recentInsights.map((row) => ({
        id: row.id,
        title: row.title,
        created_at: row.created_at,
        themes: parseStringArray(row.themes),
        approved: !!row.approved,
        rejected: !!row.rejected,
      })),
    };
  } catch (e) {
    console.error('Dashboard data fetch failed:', e);
  }

  const p: DashboardPipelineData = pipelineData || { undigested: 0, pending: 0, approved: 0, drafts: 0, sent: 0, recentInsights: [] };

  const insightRows = p.recentInsights
    .map((item) => {
      const statusBadge = item.approved ? '<span class="badge green">Approved</span>'
        : item.rejected ? '<span class="badge red">Rejected</span>'
        : '<span class="badge yellow">Pending</span>';
      const themes = (item.themes || []).slice(0, 3).map((t: string) => '<span class="theme">' + t + '</span>').join('');
      return '<tr><td>' + (item.title || '-') + '</td><td>' + statusBadge + '</td><td>' + themes + '</td><td>' + new Date(item.created_at).toLocaleDateString() + '</td></tr>';
    })
    .join('');

  const htmlContent = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>Digest — Research Intelligence Hub</title>'
    + '<style>'
    + '*{margin:0;padding:0;box-sizing:border-box}'
    + 'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0a0a0a;color:#e5e5e5;padding:24px}'
    + '.container{max-width:800px;margin:0 auto}'
    + 'h1{font-size:24px;font-weight:700;background:linear-gradient(90deg,#f97316,#eab308);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:4px}'
    + '.subtitle{color:#888;font-size:14px;margin-bottom:32px}'
    + '.pipeline{display:flex;align-items:center;gap:8px;margin-bottom:32px;flex-wrap:wrap}'
    + '.step{background:#141414;border:1px solid #2a2a2a;border-radius:12px;padding:16px 20px;text-align:center;flex:1;min-width:100px}'
    + '.step-value{font-size:24px;font-weight:700}'
    + '.step-label{font-size:10px;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-top:4px}'
    + '.arrow{color:#444;font-size:20px}'
    + '.step-value.orange{color:#f97316}.step-value.yellow{color:#eab308}.step-value.green{color:#22c55e}.step-value.blue{color:#3b82f6}.step-value.purple{color:#8b5cf6}'
    + '.section{margin-bottom:32px}'
    + '.section h2{font-size:16px;color:#ccc;margin-bottom:12px}'
    + 'table{width:100%;border-collapse:collapse}'
    + 'th,td{text-align:left;padding:10px 12px;border-bottom:1px solid #1e1e1e;font-size:13px}'
    + 'th{color:#888;font-weight:600;text-transform:uppercase;font-size:11px;letter-spacing:.5px}'
    + 'td{color:#ccc}'
    + '.badge{padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600}'
    + '.badge.green{background:#052e16;color:#22c55e}.badge.red{background:#2e0505;color:#ef4444}.badge.yellow{background:#2e2a05;color:#eab308}'
    + '.theme{background:#1e1e1e;padding:2px 8px;border-radius:8px;font-size:11px;color:#aaa;margin-right:4px}'
    + '</style></head><body>'
    + '<div class="container">'
    + '<h1>Digest</h1>'
    + '<p class="subtitle">Research Intelligence Hub — Synthesis Pipeline</p>'
    + '<div class="pipeline">'
    + '<div class="step"><div class="step-value orange">' + p.undigested + '</div><div class="step-label">Undigested</div></div>'
    + '<span class="arrow">&rarr;</span>'
    + '<div class="step"><div class="step-value yellow">' + p.pending + '</div><div class="step-label">Pending Review</div></div>'
    + '<span class="arrow">&rarr;</span>'
    + '<div class="step"><div class="step-value green">' + p.approved + '</div><div class="step-label">Approved</div></div>'
    + '<span class="arrow">&rarr;</span>'
    + '<div class="step"><div class="step-value blue">' + p.drafts + '</div><div class="step-label">Draft</div></div>'
    + '<span class="arrow">&rarr;</span>'
    + '<div class="step"><div class="step-value purple">' + p.sent + '</div><div class="step-label">Sent</div></div>'
    + '</div>'
    + '<div class="section"><h2>Recent Insights</h2>'
    + '<table><thead><tr><th>Title</th><th>Status</th><th>Themes</th><th>Date</th></tr></thead>'
    + '<tbody>' + (insightRows || '<tr><td colspan="4" style="color:#666;text-align:center;padding:24px">No insights generated yet. Run synthesize to start the pipeline.</td></tr>') + '</tbody></table>'
    + '</div>'
    + '</div></body></html>';

  return http.html(htmlContent);
}
