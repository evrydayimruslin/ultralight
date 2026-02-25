// Digest MCP — Synthesis Engine
//
// Processes undigested content from the shared store, clusters related items,
// synthesizes insights using AI, and manages the newsletter pipeline.
// Designed for micro-step execution (each function <30s) driven by cron.
//
// Pipeline: collect → synthesize → review → compose → approve
//
// Storage: BYOS Supabase (research-intelligence-hub) — shared with all MCPs
// AI: ultralight.ai() for LLM synthesis + embeddings
// Permissions: ai:call (synthesis + embeddings), net:fetch (external APIs)

const supabase = (globalThis as any).supabase;
const ultralight = (globalThis as any).ultralight;
const uuid = (globalThis as any).uuid;

// ============================================
// TYPES
// ============================================

interface InsightRow {
  id: string;
  digest_run_id: string | null;
  source_content_ids: string[];
  title: string;
  body: string;
  themes: string[];
  tags: string[];
  newsletter_section: string | null;
  newsletter_id: string | null;
  approved: boolean;
  approved_at: string | null;
  rejected: boolean;
  revision_notes: string | null;
  codebase_relevance: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

interface DigestRunRow {
  id: string;
  step: string;
  status: string;
  items_processed: number;
  items_created: number;
  error_message: string | null;
  duration_ms: number | null;
  ai_input_tokens: number;
  ai_output_tokens: number;
  ai_cost_cents: number;
  started_at: string;
  completed_at: string | null;
}

interface NewsletterRow {
  id: string;
  title: string;
  slug: string | null;
  sections: Array<{
    section: string;
    insight_id: string;
    content: string;
    order: number;
  }>;
  status: string;
  published_url: string | null;
  email_sent_at: string | null;
  email_send_count: number;
  created_at: string;
}

// Insight columns — excludes embedding for payload size
const INSIGHT_COLUMNS = 'id, digest_run_id, source_content_ids, title, body, themes, tags, newsletter_section, newsletter_id, approved, approved_at, rejected, revision_notes, codebase_relevance, created_at, updated_at';

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
  ai_cost_cents?: number;
}): Promise<string> {
  const runId = uuid.v4();
  const now = new Date().toISOString();

  await supabase.from('digest_runs').insert({
    id: runId,
    step: step,
    status: status,
    items_processed: metrics.items_processed || 0,
    items_created: metrics.items_created || 0,
    error_message: metrics.error_message || null,
    duration_ms: metrics.duration_ms || null,
    ai_input_tokens: metrics.ai_input_tokens || 0,
    ai_output_tokens: metrics.ai_output_tokens || 0,
    ai_cost_cents: metrics.ai_cost_cents || 0,
    started_at: now,
    completed_at: status === 'running' ? null : now,
  });

  return runId;
}

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

  // Fetch undigested content
  const { data: undigested, error: fetchError } = await supabase.rpc('get_undigested', {
    batch_limit: batchSize,
    source_filter: sourceFilter,
  });

  if (fetchError) {
    throw new Error('Failed to fetch undigested content: ' + fetchError.message);
  }

  if (!undigested || undigested.length === 0) {
    const runId = await logDigestRun('synthesize', 'completed', {
      items_processed: 0,
      items_created: 0,
      duration_ms: Date.now() - startTime,
    });
    return { success: true, insights_created: 0, content_digested: 0, run_id: runId };
  }

  // Load available themes for AI routing
  const { data: allThemes } = await supabase
    .from('themes')
    .select('id, slug, name, hemisphere, cluster, room_name')
    .eq('hemisphere', 'digest')
    .order('sort_order', { ascending: true });

  const themeMap: Record<string, string> = {}; // slug → id
  const themeSlugs: string[] = [];
  if (allThemes) {
    for (const t of allThemes) {
      themeMap[t.slug] = t.id;
      themeSlugs.push(t.slug);
    }
  }

  const themeList = (allThemes || [])
    .map((t: any) => '  - "' + t.slug + '" (' + t.name + ' → #' + t.room_name + ')')
    .join('\n');

  // Prepare content summaries for AI
  const contentSummaries = undigested.map((item: any, idx: number) => {
    const source = item.source_type || 'unknown';
    const author = item.author ? ' by @' + item.author : '';
    const title = item.title ? ' — ' + item.title : '';
    const body = (item.body || '').slice(0, 500);
    const themeTag = item.theme_id ? ' [theme:pre-assigned]' : '';
    return (idx + 1) + '. [' + source + author + title + themeTag + '] ' + body;
  }).join('\n\n');

  // Synthesize with AI
  const systemPrompt = 'You are a research intelligence analyst. Given a batch of content (tweets, notes, articles), identify 1-5 key insights. Each insight should synthesize multiple pieces of content into a coherent observation, trend, or actionable takeaway.\n\n'
    + 'Each insight MUST be assigned to exactly one theme_slug from this list:\n'
    + themeList + '\n\n'
    + 'Output ONLY valid JSON in this exact format:\n'
    + '{\n'
    + '  "insights": [\n'
    + '    {\n'
    + '      "title": "Concise insight title",\n'
    + '      "body": "2-4 sentences explaining the insight, connecting the sources, and why it matters",\n'
    + '      "theme_slug": "ai",\n'
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
    const runId = await logDigestRun('synthesize', 'failed', {
      items_processed: undigested.length,
      error_message: 'AI synthesis failed: ' + (err instanceof Error ? err.message : String(err)),
      duration_ms: Date.now() - startTime,
    });
    throw new Error('AI synthesis failed: ' + (err instanceof Error ? err.message : String(err)));
  }

  // Parse AI response
  let parsed: { insights: Array<{ title: string; body: string; theme_slug?: string; themes: string[]; source_indices: number[]; newsletter_section: string | null }> };
  try {
    const content = aiResponse.content || aiResponse.text || '';
    // Extract JSON from possible markdown code blocks
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, content];
    parsed = JSON.parse(jsonMatch[1] || content);
  } catch (err) {
    const runId = await logDigestRun('synthesize', 'failed', {
      items_processed: undigested.length,
      error_message: 'Failed to parse AI response as JSON',
      duration_ms: Date.now() - startTime,
    });
    throw new Error('Failed to parse AI synthesis response as JSON');
  }

  if (!parsed.insights || !Array.isArray(parsed.insights)) {
    const runId = await logDigestRun('synthesize', 'failed', {
      items_processed: undigested.length,
      error_message: 'AI response missing insights array',
      duration_ms: Date.now() - startTime,
    });
    throw new Error('AI response missing insights array');
  }

  const digestRunId = uuid.v4();
  let insightsCreated = 0;

  // Insert insights
  for (const insight of parsed.insights) {
    try {
      // Map source_indices to content IDs
      const sourceIds = (insight.source_indices || [])
        .filter((i: number) => i >= 1 && i <= undigested.length)
        .map((i: number) => undigested[i - 1].id);

      // Generate embedding for the insight
      let embedding: number[] | null = null;
      try {
        embedding = await generateEmbedding(insight.title + '\n\n' + insight.body);
      } catch (e) {
        console.warn('Insight embedding failed:', e);
      }

      // Resolve theme_id from AI-assigned slug, or inherit from majority source content
      let resolvedThemeId: string | null = null;
      if (insight.theme_slug && themeMap[insight.theme_slug]) {
        resolvedThemeId = themeMap[insight.theme_slug];
      } else {
        // Fallback: use the most common theme_id from source content
        const sourceThemes = sourceIds
          .map((sid: string) => {
            const item = undigested.find((u: any) => u.id === sid);
            return item?.theme_id || null;
          })
          .filter(Boolean);
        if (sourceThemes.length > 0) {
          // Pick the most frequent theme_id
          const freq: Record<string, number> = {};
          for (const tid of sourceThemes) {
            freq[tid] = (freq[tid] || 0) + 1;
          }
          resolvedThemeId = Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0];
        }
      }

      const insightId = uuid.v4();
      const now = new Date().toISOString();

      const { error: insertError } = await supabase.from('insights').insert({
        id: insightId,
        digest_run_id: digestRunId,
        source_content_ids: sourceIds,
        title: insight.title,
        body: insight.body,
        themes: insight.themes || [],
        tags: [],
        theme_id: resolvedThemeId,
        embedding: embedding,
        newsletter_section: insight.newsletter_section || null,
        newsletter_id: null,
        approved: false,
        rejected: false,
        created_at: now,
        updated_at: now,
      });

      if (insertError) {
        console.error('Failed to insert insight:', insertError.message);
      } else {
        insightsCreated = insightsCreated + 1;
      }
    } catch (err) {
      console.error('Error processing insight:', err);
    }
  }

  // Mark content as digested
  const contentIds = undigested.map((item: any) => item.id);
  const now = new Date().toISOString();
  const { error: updateError } = await supabase
    .from('content')
    .update({ digested_at: now, digest_run_id: digestRunId })
    .in('id', contentIds);

  if (updateError) {
    console.error('Failed to mark content as digested:', updateError.message);
  }

  const durationMs = Date.now() - startTime;

  // Log the run
  await logDigestRun('synthesize', 'completed', {
    items_processed: undigested.length,
    items_created: insightsCreated,
    duration_ms: durationMs,
    ai_input_tokens: aiResponse.usage?.input_tokens || 0,
    ai_output_tokens: aiResponse.usage?.output_tokens || 0,
    ai_cost_cents: aiResponse.usage?.cost_cents || 0,
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
}): Promise<{ insights: InsightRow[]; total: number; action: string }> {
  const { action, insight_id, revision_notes, newsletter_section, limit } = args;

  if (!action) {
    throw new Error('action is required: "pending", "approve", "reject", "revise", "approved", "rejected"');
  }

  // LIST PENDING — insights awaiting review
  if (action === 'pending') {
    const pageSize = limit || 20;
    const { data, error } = await supabase
      .from('insights')
      .select(INSIGHT_COLUMNS)
      .eq('approved', false)
      .eq('rejected', false)
      .order('created_at', { ascending: false })
      .limit(pageSize);

    if (error) {
      throw new Error('Failed to fetch pending insights: ' + error.message);
    }

    return { insights: data || [], total: (data || []).length, action: 'pending' };
  }

  // LIST APPROVED
  if (action === 'approved') {
    const pageSize = limit || 20;
    const { data, error } = await supabase
      .from('insights')
      .select(INSIGHT_COLUMNS)
      .eq('approved', true)
      .order('approved_at', { ascending: false })
      .limit(pageSize);

    if (error) {
      throw new Error('Failed to fetch approved insights: ' + error.message);
    }

    return { insights: data || [], total: (data || []).length, action: 'approved' };
  }

  // LIST REJECTED
  if (action === 'rejected') {
    const pageSize = limit || 20;
    const { data, error } = await supabase
      .from('insights')
      .select(INSIGHT_COLUMNS)
      .eq('rejected', true)
      .order('updated_at', { ascending: false })
      .limit(pageSize);

    if (error) {
      throw new Error('Failed to fetch rejected insights: ' + error.message);
    }

    return { insights: data || [], total: (data || []).length, action: 'rejected' };
  }

  // APPROVE
  if (action === 'approve') {
    if (!insight_id) {
      throw new Error('insight_id is required for action "approve"');
    }

    const now = new Date().toISOString();
    const updates: Record<string, unknown> = {
      approved: true,
      approved_at: now,
      rejected: false,
    };
    if (newsletter_section) {
      updates.newsletter_section = newsletter_section;
    }

    const { error } = await supabase
      .from('insights')
      .update(updates)
      .eq('id', insight_id);

    if (error) {
      throw new Error('Failed to approve insight: ' + error.message);
    }

    const { data: updated } = await supabase
      .from('insights')
      .select(INSIGHT_COLUMNS)
      .eq('id', insight_id)
      .single();

    return { insights: updated ? [updated] : [], total: 1, action: 'approve' };
  }

  // REJECT
  if (action === 'reject') {
    if (!insight_id) {
      throw new Error('insight_id is required for action "reject"');
    }

    const { error } = await supabase
      .from('insights')
      .update({
        rejected: true,
        approved: false,
        revision_notes: revision_notes || null,
      })
      .eq('id', insight_id);

    if (error) {
      throw new Error('Failed to reject insight: ' + error.message);
    }

    const { data: updated } = await supabase
      .from('insights')
      .select(INSIGHT_COLUMNS)
      .eq('id', insight_id)
      .single();

    return { insights: updated ? [updated] : [], total: 1, action: 'reject' };
  }

  // REVISE — Add notes for the next synthesis pass
  if (action === 'revise') {
    if (!insight_id || !revision_notes) {
      throw new Error('insight_id and revision_notes are required for action "revise"');
    }

    const { error } = await supabase
      .from('insights')
      .update({
        revision_notes: revision_notes,
        approved: false,
        rejected: false,
      })
      .eq('id', insight_id);

    if (error) {
      throw new Error('Failed to add revision notes: ' + error.message);
    }

    const { data: updated } = await supabase
      .from('insights')
      .select(INSIGHT_COLUMNS)
      .eq('id', insight_id)
      .single();

    return { insights: updated ? [updated] : [], total: 1, action: 'revise' };
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
  let selectedInsights: InsightRow[];

  if (insight_ids && insight_ids.length > 0) {
    // Use specified insights
    const { data, error } = await supabase
      .from('insights')
      .select(INSIGHT_COLUMNS)
      .in('id', insight_ids)
      .eq('approved', true);

    if (error) {
      throw new Error('Failed to fetch insights: ' + error.message);
    }

    selectedInsights = data || [];
  } else if (auto_select !== false) {
    // Auto-select approved insights not yet in a newsletter
    const { data, error } = await supabase
      .from('insights')
      .select(INSIGHT_COLUMNS)
      .eq('approved', true)
      .is('newsletter_id', null)
      .order('created_at', { ascending: false })
      .limit(maxSections);

    if (error) {
      throw new Error('Failed to auto-select insights: ' + error.message);
    }

    selectedInsights = data || [];
  } else {
    throw new Error('Either insight_ids or auto_select must be provided');
  }

  if (selectedInsights.length === 0) {
    throw new Error('No approved insights available for newsletter composition');
  }

  // Create newsletter
  const newsletterId = uuid.v4();
  const now = new Date().toISOString();

  // Build sections — order by newsletter_section priority, then by creation date
  const sectionOrder: Record<string, number> = { lead: 1, analysis: 2, links: 3, coda: 4 };
  const sections = selectedInsights
    .sort((a, b) => {
      const orderA = sectionOrder[a.newsletter_section || ''] || 3;
      const orderB = sectionOrder[b.newsletter_section || ''] || 3;
      return orderA - orderB;
    })
    .map((insight, idx) => ({
      section: insight.newsletter_section || 'analysis',
      insight_id: insight.id,
      content: '## ' + insight.title + '\n\n' + insight.body,
      order: idx + 1,
    }));

  const { error: insertError } = await supabase.from('newsletters').insert({
    id: newsletterId,
    title: title,
    slug: null,
    sections: sections,
    status: 'draft',
    created_at: now,
    updated_at: now,
  });

  if (insertError) {
    throw new Error('Failed to create newsletter: ' + insertError.message);
  }

  // Link insights to this newsletter
  const insightIdsToLink = selectedInsights.map((i) => i.id);
  const { error: linkError } = await supabase
    .from('insights')
    .update({ newsletter_id: newsletterId })
    .in('id', insightIdsToLink);

  if (linkError) {
    console.error('Failed to link insights to newsletter:', linkError.message);
  }

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
}): Promise<{ newsletters: NewsletterRow[]; total: number; action: string }> {
  const { action, newsletter_id, status_filter, title, sections, limit } = args;

  if (!action) {
    throw new Error('action is required: "list", "get", "update", "approve", or "render"');
  }

  // LIST — filter by status
  if (action === 'list') {
    const pageSize = limit || 20;
    let query = supabase
      .from('newsletters')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(pageSize);

    if (status_filter) {
      query = query.eq('status', status_filter);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error('Failed to fetch newsletters: ' + error.message);
    }

    return { newsletters: data || [], total: (data || []).length, action: 'list' };
  }

  // GET — single newsletter by ID
  if (action === 'get') {
    if (!newsletter_id) {
      throw new Error('newsletter_id is required for action "get"');
    }

    const { data, error } = await supabase
      .from('newsletters')
      .select('*')
      .eq('id', newsletter_id)
      .single();

    if (error || !data) {
      throw new Error('Newsletter not found: ' + newsletter_id);
    }

    return { newsletters: [data], total: 1, action: 'get' };
  }

  // UPDATE — edit title or sections
  if (action === 'update') {
    if (!newsletter_id) {
      throw new Error('newsletter_id is required for action "update"');
    }

    const updates: Record<string, unknown> = {};
    if (title) updates.title = title;
    if (sections) updates.sections = sections;

    const { error } = await supabase
      .from('newsletters')
      .update(updates)
      .eq('id', newsletter_id);

    if (error) {
      throw new Error('Failed to update newsletter: ' + error.message);
    }

    const { data: updated } = await supabase
      .from('newsletters')
      .select('*')
      .eq('id', newsletter_id)
      .single();

    return { newsletters: updated ? [updated] : [], total: 1, action: 'update' };
  }

  // APPROVE — mark newsletter as approved (ready for sending)
  if (action === 'approve') {
    if (!newsletter_id) {
      throw new Error('newsletter_id is required for action "approve"');
    }

    const { error } = await supabase
      .from('newsletters')
      .update({ status: 'approved' })
      .eq('id', newsletter_id)
      .eq('status', 'draft');

    if (error) {
      throw new Error('Failed to approve newsletter: ' + error.message);
    }

    const { data: updated } = await supabase
      .from('newsletters')
      .select('*')
      .eq('id', newsletter_id)
      .single();

    return { newsletters: updated ? [updated] : [], total: 1, action: 'approve' };
  }

  // RENDER — generate markdown for a newsletter
  if (action === 'render') {
    if (!newsletter_id) {
      throw new Error('newsletter_id is required for action "render"');
    }

    const { data: nl, error } = await supabase
      .from('newsletters')
      .select('*')
      .eq('id', newsletter_id)
      .single();

    if (error || !nl) {
      throw new Error('Newsletter not found: ' + newsletter_id);
    }

    // Build markdown from sections
    const nlSections = nl.sections || [];
    const sortedSections = [...nlSections].sort((a: any, b: any) => (a.order || 0) - (b.order || 0));

    let markdown = '# ' + nl.title + '\n\n';
    for (const section of sortedSections) {
      markdown = markdown + section.content + '\n\n---\n\n';
    }

    // Return as a virtual newsletter with the rendered markdown in a special field
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
    total_cost_cents: number;
  };
}> {
  let supabaseOk = false;

  try {
    await supabase.from('content').select('id').limit(1);
    supabaseOk = true;
  } catch (e) {
    console.error('Health check failed:', e);
  }

  // Parallel pipeline stats
  const [
    undigestedCount,
    pendingInsights,
    approvedInsights,
    rejectedInsights,
    draftNewsletters,
    approvedNewsletters,
    sentNewsletters,
  ] = await Promise.all([
    supabase.from('content').select('id', { count: 'exact', head: true }).is('digested_at', null).not('embedding', 'is', null),
    supabase.from('insights').select('id', { count: 'exact', head: true }).eq('approved', false).eq('rejected', false),
    supabase.from('insights').select('id', { count: 'exact', head: true }).eq('approved', true),
    supabase.from('insights').select('id', { count: 'exact', head: true }).eq('rejected', true),
    supabase.from('newsletters').select('id', { count: 'exact', head: true }).eq('status', 'draft'),
    supabase.from('newsletters').select('id', { count: 'exact', head: true }).eq('status', 'approved'),
    supabase.from('newsletters').select('id', { count: 'exact', head: true }).eq('status', 'sent'),
  ]);

  // Recent digest runs
  const { data: recentRuns } = await supabase
    .from('digest_runs')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(10);

  // AI usage totals
  const { data: aiUsage } = await supabase
    .from('digest_runs')
    .select('ai_input_tokens, ai_output_tokens, ai_cost_cents');

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCostCents = 0;
  if (aiUsage) {
    for (const run of aiUsage) {
      totalInputTokens = totalInputTokens + (run.ai_input_tokens || 0);
      totalOutputTokens = totalOutputTokens + (run.ai_output_tokens || 0);
      totalCostCents = totalCostCents + (Number(run.ai_cost_cents) || 0);
    }
  }

  return {
    health: supabaseOk ? 'healthy' : 'degraded',
    pipeline: {
      undigested_content: undigestedCount.count || 0,
      pending_insights: pendingInsights.count || 0,
      approved_insights: approvedInsights.count || 0,
      rejected_insights: rejectedInsights.count || 0,
      draft_newsletters: draftNewsletters.count || 0,
      approved_newsletters: approvedNewsletters.count || 0,
      sent_newsletters: sentNewsletters.count || 0,
    },
    recent_runs: recentRuns || [],
    ai_usage: {
      total_input_tokens: totalInputTokens,
      total_output_tokens: totalOutputTokens,
      total_cost_cents: totalCostCents,
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
  let pipelineData: any = null;
  try {
    const [
      undigestedCount,
      pendingCount,
      approvedCount,
      draftCount,
      sentCount,
    ] = await Promise.all([
      supabase.from('content').select('id', { count: 'exact', head: true }).is('digested_at', null).not('embedding', 'is', null),
      supabase.from('insights').select('id', { count: 'exact', head: true }).eq('approved', false).eq('rejected', false),
      supabase.from('insights').select('id', { count: 'exact', head: true }).eq('approved', true),
      supabase.from('newsletters').select('id', { count: 'exact', head: true }).eq('status', 'draft'),
      supabase.from('newsletters').select('id', { count: 'exact', head: true }).eq('status', 'sent'),
    ]);

    // Recent insights
    const { data: recentInsights } = await supabase
      .from('insights')
      .select('id, title, themes, approved, rejected, created_at')
      .order('created_at', { ascending: false })
      .limit(10);

    pipelineData = {
      undigested: undigestedCount.count || 0,
      pending: pendingCount.count || 0,
      approved: approvedCount.count || 0,
      drafts: draftCount.count || 0,
      sent: sentCount.count || 0,
      recentInsights: recentInsights || [],
    };
  } catch (e) {
    console.error('Dashboard data fetch failed:', e);
  }

  const p = pipelineData || { undigested: 0, pending: 0, approved: 0, drafts: 0, sent: 0, recentInsights: [] };

  const insightRows = p.recentInsights
    .map((item: any) => {
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
