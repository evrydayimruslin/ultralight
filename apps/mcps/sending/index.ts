// Sending MCP — Distribution Layer
//
// Handles the final mile of the Research Intelligence Hub pipeline:
// publishes newsletters as web pages, sends emails via Resend,
// posts to Discord via webhook, and manages the subscriber list.
//
// Storage: BYOS Supabase (research-intelligence-hub) — shared with all MCPs
// Network: Resend API (email), Discord webhooks, ul.markdown.publish (web)
// Permissions: net:fetch (Resend API, Discord webhook)

const supabase = (globalThis as any).supabase;
const ultralight = (globalThis as any).ultralight;
const uuid = (globalThis as any).uuid;

// ============================================
// TYPES
// ============================================

interface SubscriberRow {
  id: string;
  email: string;
  name: string | null;
  subscribed: boolean;
  tags: string[];
  source: string;
  subscribed_at: string;
  unsubscribed_at: string | null;
  created_at: string;
}

interface SendResult {
  channel: string;
  success: boolean;
  message: string;
  details?: Record<string, unknown>;
}

interface ThemeRow {
  id: string;
  name: string;
  slug: string;
  hemisphere: string;
  cluster: number | null;
  room_name: string;
  discord_webhook_url: string | null;
  color: string | null;
  icon: string | null;
}

interface InsightForBroadcast {
  id: string;
  title: string;
  body: string;
  theme_id: string | null;
  themes: string[];
  source_content_ids: string[];
  created_at: string;
}

// ============================================
// INTERNAL HELPERS
// ============================================

async function getEnvVar(key: string): Promise<string | null> {
  // Env vars are injected by the sandbox via ul.set.supabase / env config
  // But for API keys like RESEND_API_KEY and DISCORD_WEBHOOK_URL, we load from
  // ultralight KV storage as a fallback
  try {
    const value = await ultralight.load('env_' + key);
    return value || null;
  } catch {
    return null;
  }
}

async function loadThemeMap(): Promise<Record<string, ThemeRow>> {
  const { data, error } = await supabase
    .from('themes')
    .select('id, name, slug, hemisphere, cluster, room_name, discord_webhook_url, color, icon');

  if (error || !data) return {};

  const map: Record<string, ThemeRow> = {};
  for (const t of data) {
    map[t.id] = t;
  }
  return map;
}

function buildDiscordEmbed(insight: InsightForBroadcast, theme: ThemeRow | null): Record<string, unknown> {
  const colorInt = theme?.color
    ? parseInt(theme.color.replace('#', ''), 16)
    : 3447003; // default blue

  return {
    title: (theme?.icon || '📡') + ' ' + insight.title,
    description: insight.body.length > 2000
      ? insight.body.slice(0, 1997) + '...'
      : insight.body,
    color: colorInt,
    footer: {
      text: (theme ? theme.name + ' · #' + theme.room_name : 'Research Intelligence Hub')
        + ' · ' + new Date(insight.created_at).toLocaleDateString(),
    },
    timestamp: insight.created_at,
  };
}

async function getNewsletter(newsletterId: string): Promise<any> {
  const { data, error } = await supabase
    .from('newsletters')
    .select('*')
    .eq('id', newsletterId)
    .single();

  if (error || !data) {
    throw new Error('Newsletter not found: ' + newsletterId);
  }
  return data;
}

function renderNewsletterMarkdown(newsletter: any): string {
  const sections = newsletter.sections || [];
  const sorted = [...sections].sort((a: any, b: any) => (a.order || 0) - (b.order || 0));

  let md = '# ' + newsletter.title + '\n\n';
  for (const section of sorted) {
    md = md + section.content + '\n\n---\n\n';
  }
  return md;
}

function renderNewsletterHtml(newsletter: any): string {
  const sections = newsletter.sections || [];
  const sorted = [...sections].sort((a: any, b: any) => (a.order || 0) - (b.order || 0));

  let body = '';
  for (const section of sorted) {
    // Basic markdown → HTML (headings, paragraphs, bold, links)
    let content = section.content || '';
    content = content.replace(/^## (.+)$/gm, '<h2 style="color:#1a1a1a;font-size:20px;margin:24px 0 8px">$1</h2>');
    content = content.replace(/^### (.+)$/gm, '<h3 style="color:#333;font-size:16px;margin:16px 0 8px">$1</h3>');
    content = content.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    content = content.replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" style="color:#2563eb">$1</a>');
    content = content.replace(/\n\n/g, '</p><p style="color:#444;line-height:1.6;margin:12px 0">');
    body = body + '<div style="margin-bottom:24px;padding-bottom:24px;border-bottom:1px solid #eee">'
      + '<p style="color:#444;line-height:1.6;margin:12px 0">' + content + '</p>'
      + '</div>';
  }

  return '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>'
    + '<body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#fff">'
    + '<h1 style="font-size:28px;color:#0a0a0a;margin-bottom:8px">' + newsletter.title + '</h1>'
    + '<hr style="border:none;border-top:2px solid #0a0a0a;margin:16px 0 24px">'
    + body
    + '<footer style="text-align:center;padding:24px 0;color:#999;font-size:12px">'
    + '<p>Research Intelligence Hub</p>'
    + '</footer>'
    + '</body></html>';
}

// ============================================
// 1. SEND — Distribute a newsletter across channels
// ============================================

export async function send(args: {
  newsletter_id: string;
  channels: string[];
  resend_api_key?: string;
  discord_webhook_url?: string;
  from_email?: string;
  from_name?: string;
  subject?: string;
  tag_filter?: string[];
}): Promise<{ results: SendResult[]; newsletter_id: string }> {
  const {
    newsletter_id,
    channels,
    resend_api_key,
    discord_webhook_url,
    from_email,
    from_name,
    subject,
    tag_filter,
  } = args;

  if (!newsletter_id) {
    throw new Error('newsletter_id is required');
  }
  if (!channels || !Array.isArray(channels) || channels.length === 0) {
    throw new Error('channels array is required: ["email", "web", "discord"]');
  }

  const newsletter = await getNewsletter(newsletter_id);

  if (newsletter.status !== 'approved' && newsletter.status !== 'sent') {
    throw new Error('Newsletter must be approved before sending. Current status: ' + newsletter.status);
  }

  // Mark as sending
  await supabase
    .from('newsletters')
    .update({ status: 'sending' })
    .eq('id', newsletter_id);

  const results: SendResult[] = [];

  // ── WEB — Publish via ul.markdown.publish ──
  if (channels.includes('web')) {
    try {
      const markdown = renderNewsletterMarkdown(newsletter);
      // Use ultralight.call or direct storage — agents call ul.markdown.publish via platform MCP
      // For now, store the rendered markdown and flag as published
      const slug = 'newsletter-' + newsletter_id.slice(0, 8);
      await ultralight.store('newsletter_web_' + newsletter_id, {
        slug: slug,
        title: newsletter.title,
        markdown: markdown,
        published_at: new Date().toISOString(),
      });

      // Update newsletter record
      await supabase
        .from('newsletters')
        .update({ slug: slug, published_url: 'pending-publish' })
        .eq('id', newsletter_id);

      results.push({
        channel: 'web',
        success: true,
        message: 'Markdown rendered and stored. Use ul.markdown.publish to create the live page.',
        details: { slug: slug },
      });
    } catch (err) {
      results.push({
        channel: 'web',
        success: false,
        message: 'Web publish failed: ' + (err instanceof Error ? err.message : String(err)),
      });
    }
  }

  // ── EMAIL — Send via Resend API ──
  if (channels.includes('email')) {
    const apiKey = resend_api_key || await getEnvVar('RESEND_API_KEY');
    if (!apiKey) {
      results.push({
        channel: 'email',
        success: false,
        message: 'No Resend API key. Pass resend_api_key or store it via: ultralight.store("env_RESEND_API_KEY", "re_xxx")',
      });
    } else {
      try {
        // Get subscribers
        let subscriberQuery = supabase
          .from('subscribers')
          .select('email, name')
          .eq('subscribed', true);

        if (tag_filter && tag_filter.length > 0) {
          subscriberQuery = subscriberQuery.overlaps('tags', tag_filter);
        }

        const { data: subscribers, error: subError } = await subscriberQuery;
        if (subError) {
          throw new Error('Failed to fetch subscribers: ' + subError.message);
        }

        if (!subscribers || subscribers.length === 0) {
          results.push({
            channel: 'email',
            success: false,
            message: 'No active subscribers found.',
          });
        } else {
          const html = renderNewsletterHtml(newsletter);
          const emailSubject = subject || newsletter.title;
          const senderEmail = from_email || 'newsletter@resend.dev';
          const senderName = from_name || 'Research Intelligence Hub';

          // Send via Resend batch API
          const emails = subscribers.map((sub: any) => ({
            from: senderName + ' <' + senderEmail + '>',
            to: [sub.email],
            subject: emailSubject,
            html: html,
          }));

          // Resend batch endpoint — max 100 per call
          const batchSize = 100;
          let totalSent = 0;

          for (let i = 0; i < emails.length; i = i + batchSize) {
            const batch = emails.slice(i, i + batchSize);

            const response = await fetch('https://api.resend.com/emails/batch', {
              method: 'POST',
              headers: {
                'Authorization': 'Bearer ' + apiKey,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(batch),
            });

            if (response.ok) {
              totalSent = totalSent + batch.length;
            } else {
              const errBody = await response.text();
              console.error('Resend batch send error:', errBody);
            }
          }

          // Update newsletter
          await supabase
            .from('newsletters')
            .update({
              email_sent_at: new Date().toISOString(),
              email_send_count: totalSent,
            })
            .eq('id', newsletter_id);

          results.push({
            channel: 'email',
            success: true,
            message: 'Sent to ' + totalSent + ' of ' + subscribers.length + ' subscribers.',
            details: { sent: totalSent, total_subscribers: subscribers.length },
          });
        }
      } catch (err) {
        results.push({
          channel: 'email',
          success: false,
          message: 'Email send failed: ' + (err instanceof Error ? err.message : String(err)),
        });
      }
    }
  }

  // ── DISCORD — Per-room routing via insight themes ──
  if (channels.includes('discord')) {
    const fallbackWebhook = discord_webhook_url || await getEnvVar('DISCORD_WEBHOOK_URL');

    try {
      // Load theme map for webhook resolution
      const themeMap = await loadThemeMap();

      // Get insights linked to this newsletter with their theme_ids
      const insightIds = (newsletter.sections || []).map((s: any) => s.insight_id).filter(Boolean);
      let insights: InsightForBroadcast[] = [];

      if (insightIds.length > 0) {
        const { data: insightRows } = await supabase
          .from('insights')
          .select('id, title, body, theme_id, themes, source_content_ids, created_at')
          .in('id', insightIds);
        insights = insightRows || [];
      }

      if (insights.length === 0) {
        // Fallback: post full newsletter to default webhook
        if (!fallbackWebhook) {
          results.push({
            channel: 'discord',
            success: false,
            message: 'No Discord webhook URL and no themed insights. Pass discord_webhook_url or store it via: ultralight.store("env_DISCORD_WEBHOOK_URL", "https://...")',
          });
        } else {
          const markdown = renderNewsletterMarkdown(newsletter);
          const maxLen = 1800;
          const truncated = markdown.length > maxLen
            ? markdown.slice(0, maxLen) + '\n\n*[Read the full newsletter online]*'
            : markdown;

          const response = await fetch(fallbackWebhook, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              content: truncated,
              username: 'Research Intelligence Hub',
            }),
          });

          if (!response.ok) {
            const errBody = await response.text();
            throw new Error('Discord fallback webhook returned ' + response.status + ': ' + errBody);
          }

          results.push({
            channel: 'discord',
            success: true,
            message: 'Posted newsletter to default Discord channel (no themed insights).',
          });
        }
      } else {
        // Route each insight to its theme's room
        let posted = 0;
        let skipped = 0;
        const roomsSent: string[] = [];

        for (const insight of insights) {
          const theme = insight.theme_id ? themeMap[insight.theme_id] : null;
          const webhookUrl = theme?.discord_webhook_url || fallbackWebhook;

          if (!webhookUrl) {
            skipped = skipped + 1;
            continue;
          }

          const embed = buildDiscordEmbed(insight, theme);

          const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              username: 'Research Intelligence Hub',
              embeds: [embed],
            }),
          });

          if (response.ok) {
            posted = posted + 1;
            const roomLabel = theme ? '#' + theme.room_name : 'default';
            if (roomsSent.indexOf(roomLabel) === -1) {
              roomsSent.push(roomLabel);
            }
          } else {
            console.error('Discord post failed for insight ' + insight.id + ':', await response.text());
            skipped = skipped + 1;
          }

          // Discord rate limit: wait 500ms between posts
          if (posted < insights.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
        }

        // Update newsletter
        await supabase
          .from('newsletters')
          .update({ discord_posted_at: new Date().toISOString() })
          .eq('id', newsletter_id);

        results.push({
          channel: 'discord',
          success: posted > 0,
          message: 'Routed ' + posted + ' insights to Discord rooms (' + roomsSent.join(', ') + ').' + (skipped > 0 ? ' Skipped ' + skipped + ' (no webhook).' : ''),
          details: { posted: posted, skipped: skipped, rooms: roomsSent },
        });
      }
    } catch (err) {
      results.push({
        channel: 'discord',
        success: false,
        message: 'Discord post failed: ' + (err instanceof Error ? err.message : String(err)),
      });
    }
  }

  // Update final status
  const allSucceeded = results.every((r) => r.success);
  const anySucceeded = results.some((r) => r.success);
  const finalStatus = allSucceeded ? 'sent' : anySucceeded ? 'sent' : 'failed';

  await supabase
    .from('newsletters')
    .update({ status: finalStatus })
    .eq('id', newsletter_id);

  return { results: results, newsletter_id: newsletter_id };
}

// ============================================
// 2. BROADCAST — Push insights directly to themed Discord rooms
// ============================================
// Bypasses the newsletter pipeline. Sends approved insights
// that haven't been broadcast yet to their theme's Discord room.

export async function broadcast(args: {
  insight_ids?: string[];
  theme_slug?: string;
  auto_select?: boolean;
  limit?: number;
  discord_webhook_url?: string;
}): Promise<{
  posted: number;
  skipped: number;
  rooms: string[];
  insight_ids: string[];
}> {
  const { insight_ids, theme_slug, auto_select, limit, discord_webhook_url } = args;
  const fallbackWebhook = discord_webhook_url || await getEnvVar('DISCORD_WEBHOOK_URL');

  // Load theme map
  const themeMap = await loadThemeMap();

  let insights: InsightForBroadcast[] = [];

  if (insight_ids && insight_ids.length > 0) {
    // Explicit list
    const { data, error } = await supabase
      .from('insights')
      .select('id, title, body, theme_id, themes, source_content_ids, created_at')
      .in('id', insight_ids);

    if (error) {
      throw new Error('Failed to fetch insights: ' + error.message);
    }
    insights = data || [];
  } else if (auto_select !== false) {
    // Auto-select: approved insights not yet broadcast
    let query = supabase
      .from('insights')
      .select('id, title, body, theme_id, themes, source_content_ids, created_at')
      .eq('approved', true)
      .order('created_at', { ascending: false })
      .limit(limit || 10);

    if (theme_slug) {
      // Find theme_id from slug
      const themeEntry = Object.values(themeMap).find((t) => t.slug === theme_slug);
      if (themeEntry) {
        query = query.eq('theme_id', themeEntry.id);
      }
    }

    const { data, error } = await query;
    if (error) {
      throw new Error('Failed to auto-select insights: ' + error.message);
    }
    insights = data || [];
  }

  if (insights.length === 0) {
    return { posted: 0, skipped: 0, rooms: [], insight_ids: [] };
  }

  let posted = 0;
  let skipped = 0;
  const roomsSent: string[] = [];
  const postedIds: string[] = [];

  for (const insight of insights) {
    const theme = insight.theme_id ? themeMap[insight.theme_id] : null;
    const webhookUrl = theme?.discord_webhook_url || fallbackWebhook;

    if (!webhookUrl) {
      skipped = skipped + 1;
      continue;
    }

    const embed = buildDiscordEmbed(insight, theme);

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'Research Intelligence Hub',
          embeds: [embed],
        }),
      });

      if (response.ok) {
        posted = posted + 1;
        postedIds.push(insight.id);
        const roomLabel = theme ? '#' + theme.room_name : 'default';
        if (roomsSent.indexOf(roomLabel) === -1) {
          roomsSent.push(roomLabel);
        }
      } else {
        console.error('Broadcast failed for ' + insight.id + ':', await response.text());
        skipped = skipped + 1;
      }

      // Rate limit
      await new Promise((resolve) => setTimeout(resolve, 500));
    } catch (err) {
      console.error('Broadcast error for ' + insight.id + ':', err);
      skipped = skipped + 1;
    }
  }

  return {
    posted: posted,
    skipped: skipped,
    rooms: roomsSent,
    insight_ids: postedIds,
  };
}

// ============================================
// 3. SUBSCRIBERS — Manage the email list
// ============================================

export async function subscribers(args: {
  action: string;
  email?: string;
  name?: string;
  tags?: string[];
  source?: string;
  subscriber_id?: string;
  limit?: number;
}): Promise<{ subscribers: SubscriberRow[]; total: number; action: string }> {
  const { action, email, name, tags, source, subscriber_id, limit } = args;

  if (!action) {
    throw new Error('action is required: "list", "add", "remove", "update", or "stats"');
  }

  // LIST — all active subscribers
  if (action === 'list') {
    const pageSize = limit || 50;
    const { data, error } = await supabase
      .from('subscribers')
      .select('*')
      .eq('subscribed', true)
      .order('subscribed_at', { ascending: false })
      .limit(pageSize);

    if (error) {
      throw new Error('Failed to fetch subscribers: ' + error.message);
    }

    return { subscribers: data || [], total: (data || []).length, action: 'list' };
  }

  // ADD — subscribe an email
  if (action === 'add') {
    if (!email) {
      throw new Error('email is required for action "add"');
    }

    // Check for existing
    const { data: existing } = await supabase
      .from('subscribers')
      .select('id, subscribed')
      .eq('email', email.toLowerCase().trim())
      .single();

    if (existing) {
      if (existing.subscribed) {
        // Already subscribed — return existing
        const { data: sub } = await supabase.from('subscribers').select('*').eq('id', existing.id).single();
        return { subscribers: sub ? [sub] : [], total: 1, action: 'already_subscribed' };
      } else {
        // Re-subscribe
        const now = new Date().toISOString();
        await supabase
          .from('subscribers')
          .update({
            subscribed: true,
            subscribed_at: now,
            unsubscribed_at: null,
            name: name || undefined,
            tags: tags || undefined,
          })
          .eq('id', existing.id);

        const { data: sub } = await supabase.from('subscribers').select('*').eq('id', existing.id).single();
        return { subscribers: sub ? [sub] : [], total: 1, action: 'resubscribed' };
      }
    }

    // New subscriber
    const subId = uuid.v4();
    const now = new Date().toISOString();
    const newSub = {
      id: subId,
      email: email.toLowerCase().trim(),
      name: name || null,
      subscribed: true,
      tags: tags || [],
      source: source || 'manual',
      subscribed_at: now,
      unsubscribed_at: null,
      created_at: now,
    };

    const { error: insertError } = await supabase.from('subscribers').insert(newSub);
    if (insertError) {
      throw new Error('Failed to add subscriber: ' + insertError.message);
    }

    return { subscribers: [newSub as any], total: 1, action: 'added' };
  }

  // REMOVE — unsubscribe
  if (action === 'remove') {
    if (!email && !subscriber_id) {
      throw new Error('email or subscriber_id is required for action "remove"');
    }

    let query = supabase.from('subscribers').update({
      subscribed: false,
      unsubscribed_at: new Date().toISOString(),
    });

    if (subscriber_id) {
      query = query.eq('id', subscriber_id);
    } else {
      query = query.eq('email', email!.toLowerCase().trim());
    }

    const { error } = await query;
    if (error) {
      throw new Error('Failed to unsubscribe: ' + error.message);
    }

    return { subscribers: [], total: 0, action: 'removed' };
  }

  // UPDATE — modify name/tags
  if (action === 'update') {
    if (!subscriber_id && !email) {
      throw new Error('subscriber_id or email is required for action "update"');
    }

    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name;
    if (tags !== undefined) updates.tags = tags;

    let query = supabase.from('subscribers').update(updates);
    if (subscriber_id) {
      query = query.eq('id', subscriber_id);
    } else {
      query = query.eq('email', email!.toLowerCase().trim());
    }

    const { error } = await query;
    if (error) {
      throw new Error('Failed to update subscriber: ' + error.message);
    }

    // Return updated
    let fetchQuery = supabase.from('subscribers').select('*');
    if (subscriber_id) {
      fetchQuery = fetchQuery.eq('id', subscriber_id);
    } else {
      fetchQuery = fetchQuery.eq('email', email!.toLowerCase().trim());
    }
    const { data } = await fetchQuery.single();

    return { subscribers: data ? [data] : [], total: 1, action: 'updated' };
  }

  throw new Error('Unknown action: ' + action + '. Use "list", "add", "remove", or "update".');
}

// ============================================
// 4. PREVIEW — Render a newsletter for review before sending
// ============================================

export async function preview(args: {
  newsletter_id: string;
  format?: string;
}): Promise<{ newsletter_id: string; title: string; format: string; content: string }> {
  const { newsletter_id, format } = args;

  if (!newsletter_id) {
    throw new Error('newsletter_id is required');
  }

  const newsletter = await getNewsletter(newsletter_id);
  const renderFormat = format || 'markdown';

  let content: string;
  if (renderFormat === 'html') {
    content = renderNewsletterHtml(newsletter);
  } else {
    content = renderNewsletterMarkdown(newsletter);
  }

  return {
    newsletter_id: newsletter_id,
    title: newsletter.title,
    format: renderFormat,
    content: content,
  };
}

// ============================================
// 5. STATUS — Sending + subscriber stats
// ============================================

export async function status(args?: Record<string, never>): Promise<{
  health: string;
  subscribers: {
    total_active: number;
    total_unsubscribed: number;
    by_source: Record<string, number>;
  };
  newsletters: {
    total_sent: number;
    total_emails_sent: number;
    last_sent_at: string | null;
  };
}> {
  let supabaseOk = false;

  try {
    await supabase.from('subscribers').select('id').limit(1);
    supabaseOk = true;
  } catch (e) {
    console.error('Health check failed:', e);
  }

  // Subscriber stats
  const [activeCount, unsubCount] = await Promise.all([
    supabase.from('subscribers').select('id', { count: 'exact', head: true }).eq('subscribed', true),
    supabase.from('subscribers').select('id', { count: 'exact', head: true }).eq('subscribed', false),
  ]);

  // Source breakdown
  const { data: sourceRows } = await supabase
    .from('subscribers')
    .select('source')
    .eq('subscribed', true);

  const bySource: Record<string, number> = {};
  if (sourceRows) {
    for (const row of sourceRows) {
      const s = row.source || 'unknown';
      bySource[s] = (bySource[s] || 0) + 1;
    }
  }

  // Newsletter send stats
  const { data: sentNewsletters } = await supabase
    .from('newsletters')
    .select('email_send_count, email_sent_at')
    .eq('status', 'sent')
    .order('email_sent_at', { ascending: false });

  let totalEmailsSent = 0;
  let lastSentAt: string | null = null;
  if (sentNewsletters && sentNewsletters.length > 0) {
    lastSentAt = sentNewsletters[0].email_sent_at;
    for (const nl of sentNewsletters) {
      totalEmailsSent = totalEmailsSent + (nl.email_send_count || 0);
    }
  }

  return {
    health: supabaseOk ? 'healthy' : 'degraded',
    subscribers: {
      total_active: activeCount.count || 0,
      total_unsubscribed: unsubCount.count || 0,
      by_source: bySource,
    },
    newsletters: {
      total_sent: (sentNewsletters || []).length,
      total_emails_sent: totalEmailsSent,
      last_sent_at: lastSentAt,
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
  let dashData: any = null;
  try {
    const [activeCount, sentCount] = await Promise.all([
      supabase.from('subscribers').select('id', { count: 'exact', head: true }).eq('subscribed', true),
      supabase.from('newsletters').select('id', { count: 'exact', head: true }).eq('status', 'sent'),
    ]);

    // Recent sends
    const { data: recentSends } = await supabase
      .from('newsletters')
      .select('id, title, status, email_send_count, email_sent_at, discord_posted_at')
      .order('created_at', { ascending: false })
      .limit(10);

    // Total emails
    const { data: allSent } = await supabase
      .from('newsletters')
      .select('email_send_count')
      .eq('status', 'sent');

    let totalEmails = 0;
    if (allSent) {
      for (const nl of allSent) {
        totalEmails = totalEmails + (nl.email_send_count || 0);
      }
    }

    dashData = {
      subscribers: activeCount.count || 0,
      sent: sentCount.count || 0,
      totalEmails: totalEmails,
      recentSends: recentSends || [],
    };
  } catch (e) {
    console.error('Dashboard data fetch failed:', e);
  }

  const d = dashData || { subscribers: 0, sent: 0, totalEmails: 0, recentSends: [] };

  const sendRows = d.recentSends
    .map((nl: any) => {
      const statusBadge = nl.status === 'sent' ? '<span class="badge green">Sent</span>'
        : nl.status === 'approved' ? '<span class="badge blue">Ready</span>'
        : nl.status === 'draft' ? '<span class="badge gray">Draft</span>'
        : '<span class="badge yellow">' + nl.status + '</span>';
      const channels: string[] = [];
      if (nl.email_send_count > 0) channels.push('Email (' + nl.email_send_count + ')');
      if (nl.discord_posted_at) channels.push('Discord');
      return '<tr><td>' + (nl.title || '-') + '</td><td>' + statusBadge + '</td><td>' + (channels.join(', ') || '-') + '</td><td>' + (nl.email_sent_at ? new Date(nl.email_sent_at).toLocaleDateString() : '-') + '</td></tr>';
    })
    .join('');

  const htmlContent = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>Sending — Research Intelligence Hub</title>'
    + '<style>'
    + '*{margin:0;padding:0;box-sizing:border-box}'
    + 'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0a0a0a;color:#e5e5e5;padding:24px}'
    + '.container{max-width:800px;margin:0 auto}'
    + 'h1{font-size:24px;font-weight:700;background:linear-gradient(90deg,#22c55e,#06b6d4);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:4px}'
    + '.subtitle{color:#888;font-size:14px;margin-bottom:32px}'
    + '.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:32px}'
    + '.card{background:#141414;border:1px solid #2a2a2a;border-radius:12px;padding:20px}'
    + '.card-value{font-size:28px;font-weight:700}'
    + '.card-label{font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-top:4px}'
    + '.card-value.green{color:#22c55e}.card-value.cyan{color:#06b6d4}.card-value.purple{color:#8b5cf6}'
    + '.section{margin-bottom:32px}'
    + '.section h2{font-size:16px;color:#ccc;margin-bottom:12px}'
    + 'table{width:100%;border-collapse:collapse}'
    + 'th,td{text-align:left;padding:10px 12px;border-bottom:1px solid #1e1e1e;font-size:13px}'
    + 'th{color:#888;font-weight:600;text-transform:uppercase;font-size:11px;letter-spacing:.5px}'
    + 'td{color:#ccc}'
    + '.badge{padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600}'
    + '.badge.green{background:#052e16;color:#22c55e}.badge.blue{background:#051e2e;color:#3b82f6}.badge.gray{background:#1e1e1e;color:#888}.badge.yellow{background:#2e2a05;color:#eab308}'
    + '</style></head><body>'
    + '<div class="container">'
    + '<h1>Sending</h1>'
    + '<p class="subtitle">Research Intelligence Hub — Distribution Layer</p>'
    + '<div class="grid">'
    + '<div class="card"><div class="card-value green">' + d.subscribers + '</div><div class="card-label">Active Subscribers</div></div>'
    + '<div class="card"><div class="card-value cyan">' + d.sent + '</div><div class="card-label">Newsletters Sent</div></div>'
    + '<div class="card"><div class="card-value purple">' + d.totalEmails + '</div><div class="card-label">Emails Delivered</div></div>'
    + '</div>'
    + '<div class="section"><h2>Recent Newsletters</h2>'
    + '<table><thead><tr><th>Title</th><th>Status</th><th>Channels</th><th>Sent</th></tr></thead>'
    + '<tbody>' + (sendRows || '<tr><td colspan="4" style="color:#666;text-align:center;padding:24px">No newsletters sent yet</td></tr>') + '</tbody></table>'
    + '</div>'
    + '</div></body></html>';

  return http.html(htmlContent);
}
