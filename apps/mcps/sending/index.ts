// Sending MCP — Distribution Layer
//
// Handles the final mile of the pipeline:
// publishes newsletters as web pages, sends emails via Resend,
// posts to Discord via webhook, and manages the subscriber list.
//
// Storage: Ultralight D1
// Network: Resend API (email), Discord webhooks
// Permissions: net:fetch (Resend API, Discord webhook)

const ultralight = (globalThis as any).ultralight;

// ============================================
// TYPES
// ============================================

interface SendResult {
  channel: string;
  success: boolean;
  message: string;
  details?: Record<string, unknown>;
}

// ============================================
// INTERNAL HELPERS
// ============================================

async function getEnvVar(key: string): Promise<string | null> {
  const row = await ultralight.db.first(
    'SELECT value FROM env_vars WHERE key = ? AND user_id = ?',
    [key, ultralight.user.id]
  );
  return row ? row.value : null;
}

async function getNewsletter(newsletterId: string): Promise<any> {
  const row = await ultralight.db.first(
    'SELECT * FROM newsletters WHERE id = ? AND user_id = ?',
    [newsletterId, ultralight.user.id]
  );

  if (!row) {
    throw new Error('Newsletter not found: ' + newsletterId);
  }
  return { ...row, sections: JSON.parse(row.sections || '[]') };
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
  const now = new Date().toISOString();
  await ultralight.db.run(
    'UPDATE newsletters SET status = ?, updated_at = ? WHERE id = ? AND user_id = ?',
    ['sending', now, newsletter_id, ultralight.user.id]
  );

  const results: SendResult[] = [];

  // ── WEB — Publish via markdown store ──
  if (channels.includes('web')) {
    try {
      const markdown = renderNewsletterMarkdown(newsletter);
      const slug = 'newsletter-' + newsletter_id.slice(0, 8);

      await ultralight.db.run(
        'UPDATE newsletters SET slug = ?, published_url = ?, updated_at = ? WHERE id = ? AND user_id = ?',
        [slug, 'pending-publish', now, newsletter_id, ultralight.user.id]
      );

      results.push({
        channel: 'web',
        success: true,
        message: 'Markdown rendered. Use ul.markdown.publish to create the live page.',
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
        message: 'No Resend API key. Pass resend_api_key or store it in env_vars.',
      });
    } else {
      try {
        // Get subscribers
        let subQuery = 'SELECT email, name FROM subscribers WHERE subscribed = 1 AND user_id = ?';
        const subParams: any[] = [ultralight.user.id];

        const subscriberRows = await ultralight.db.all(subQuery, subParams);

        // Filter by tags if needed
        let filteredSubscribers = subscriberRows;
        if (tag_filter && tag_filter.length > 0) {
          filteredSubscribers = subscriberRows.filter((sub: any) => {
            const subTags = JSON.parse(sub.tags || '[]');
            return tag_filter.some((t: string) => subTags.includes(t));
          });
        }

        if (filteredSubscribers.length === 0) {
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

          const emails = filteredSubscribers.map((sub: any) => ({
            from: senderName + ' <' + senderEmail + '>',
            to: [sub.email],
            subject: emailSubject,
            html: html,
          }));

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

          await ultralight.db.run(
            'UPDATE newsletters SET email_sent_at = ?, email_send_count = ?, updated_at = ? WHERE id = ? AND user_id = ?',
            [now, totalSent, now, newsletter_id, ultralight.user.id]
          );

          results.push({
            channel: 'email',
            success: true,
            message: 'Sent to ' + totalSent + ' of ' + filteredSubscribers.length + ' subscribers.',
            details: { sent: totalSent, total_subscribers: filteredSubscribers.length },
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

  // ── DISCORD — Post to webhook ──
  if (channels.includes('discord')) {
    const webhookUrl = discord_webhook_url || await getEnvVar('DISCORD_WEBHOOK_URL');

    if (!webhookUrl) {
      results.push({
        channel: 'discord',
        success: false,
        message: 'No Discord webhook URL. Pass discord_webhook_url or store it in env_vars.',
      });
    } else {
      try {
        const markdown = renderNewsletterMarkdown(newsletter);
        const maxLen = 1800;
        const truncated = markdown.length > maxLen
          ? markdown.slice(0, maxLen) + '\n\n*[Read the full newsletter online]*'
          : markdown;

        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: truncated,
            username: 'Research Intelligence Hub',
          }),
        });

        if (!response.ok) {
          const errBody = await response.text();
          throw new Error('Discord webhook returned ' + response.status + ': ' + errBody);
        }

        await ultralight.db.run(
          'UPDATE newsletters SET discord_posted_at = ?, updated_at = ? WHERE id = ? AND user_id = ?',
          [now, now, newsletter_id, ultralight.user.id]
        );

        results.push({
          channel: 'discord',
          success: true,
          message: 'Posted newsletter to Discord.',
        });
      } catch (err) {
        results.push({
          channel: 'discord',
          success: false,
          message: 'Discord post failed: ' + (err instanceof Error ? err.message : String(err)),
        });
      }
    }
  }

  // Update final status
  const allSucceeded = results.every((r) => r.success);
  const anySucceeded = results.some((r) => r.success);
  const finalStatus = allSucceeded ? 'sent' : anySucceeded ? 'sent' : 'failed';

  await ultralight.db.run(
    'UPDATE newsletters SET status = ?, updated_at = ? WHERE id = ? AND user_id = ?',
    [finalStatus, now, newsletter_id, ultralight.user.id]
  );

  return { results: results, newsletter_id: newsletter_id };
}

// ============================================
// 2. BROADCAST — Push content directly to Discord
// ============================================

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
  const { discord_webhook_url } = args;
  const webhookUrl = discord_webhook_url || await getEnvVar('DISCORD_WEBHOOK_URL');

  if (!webhookUrl) {
    return { posted: 0, skipped: 0, rooms: [], insight_ids: [] };
  }

  // In D1 mode, broadcast is simplified since we don't have Supabase insights table
  // This would need to be adapted based on the actual insight storage
  return {
    posted: 0,
    skipped: 0,
    rooms: [],
    insight_ids: [],
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
}): Promise<{ subscribers: any[]; total: number; action: string }> {
  const { action, email, name, tags, source, subscriber_id, limit } = args;

  if (!action) {
    throw new Error('action is required: "list", "add", "remove", "update", or "stats"');
  }

  // LIST — all active subscribers
  if (action === 'list') {
    const pageSize = limit || 50;
    const rows = await ultralight.db.all(
      'SELECT * FROM subscribers WHERE subscribed = 1 AND user_id = ? ORDER BY subscribed_at DESC LIMIT ?',
      [ultralight.user.id, pageSize]
    );

    const parsed = rows.map((r: any) => ({ ...r, tags: JSON.parse(r.tags || '[]'), subscribed: !!r.subscribed }));
    return { subscribers: parsed, total: parsed.length, action: 'list' };
  }

  // ADD — subscribe an email
  if (action === 'add') {
    if (!email) {
      throw new Error('email is required for action "add"');
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Check for existing
    const existing = await ultralight.db.first(
      'SELECT id, subscribed FROM subscribers WHERE email = ? AND user_id = ?',
      [normalizedEmail, ultralight.user.id]
    );

    if (existing) {
      if (existing.subscribed) {
        const sub = await ultralight.db.first(
          'SELECT * FROM subscribers WHERE id = ? AND user_id = ?',
          [existing.id, ultralight.user.id]
        );
        const parsed = sub ? { ...sub, tags: JSON.parse(sub.tags || '[]'), subscribed: !!sub.subscribed } : null;
        return { subscribers: parsed ? [parsed] : [], total: 1, action: 'already_subscribed' };
      } else {
        // Re-subscribe
        const now = new Date().toISOString();
        await ultralight.db.run(
          'UPDATE subscribers SET subscribed = 1, subscribed_at = ?, unsubscribed_at = NULL, name = COALESCE(?, name), tags = COALESCE(?, tags), updated_at = ? WHERE id = ? AND user_id = ?',
          [now, name || null, tags ? JSON.stringify(tags) : null, now, existing.id, ultralight.user.id]
        );

        const sub = await ultralight.db.first(
          'SELECT * FROM subscribers WHERE id = ? AND user_id = ?',
          [existing.id, ultralight.user.id]
        );
        const parsed = sub ? { ...sub, tags: JSON.parse(sub.tags || '[]'), subscribed: !!sub.subscribed } : null;
        return { subscribers: parsed ? [parsed] : [], total: 1, action: 'resubscribed' };
      }
    }

    // New subscriber
    const subId = crypto.randomUUID();
    const now = new Date().toISOString();

    await ultralight.db.run(
      'INSERT INTO subscribers (id, user_id, email, name, subscribed, tags, source, subscribed_at, unsubscribed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [subId, ultralight.user.id, normalizedEmail, name || null, 1, JSON.stringify(tags || []), source || 'manual', now, null, now, now]
    );

    const newSub = {
      id: subId,
      user_id: ultralight.user.id,
      email: normalizedEmail,
      name: name || null,
      subscribed: true,
      tags: tags || [],
      source: source || 'manual',
      subscribed_at: now,
      unsubscribed_at: null,
      created_at: now,
      updated_at: now,
    };

    return { subscribers: [newSub], total: 1, action: 'added' };
  }

  // REMOVE — unsubscribe
  if (action === 'remove') {
    if (!email && !subscriber_id) {
      throw new Error('email or subscriber_id is required for action "remove"');
    }

    const now = new Date().toISOString();

    if (subscriber_id) {
      await ultralight.db.run(
        'UPDATE subscribers SET subscribed = 0, unsubscribed_at = ?, updated_at = ? WHERE id = ? AND user_id = ?',
        [now, now, subscriber_id, ultralight.user.id]
      );
    } else {
      await ultralight.db.run(
        'UPDATE subscribers SET subscribed = 0, unsubscribed_at = ?, updated_at = ? WHERE email = ? AND user_id = ?',
        [now, now, email!.toLowerCase().trim(), ultralight.user.id]
      );
    }

    return { subscribers: [], total: 0, action: 'removed' };
  }

  // UPDATE — modify name/tags
  if (action === 'update') {
    if (!subscriber_id && !email) {
      throw new Error('subscriber_id or email is required for action "update"');
    }

    const now = new Date().toISOString();
    const setClauses: string[] = ['updated_at = ?'];
    const params: any[] = [now];

    if (name !== undefined) {
      setClauses.push('name = ?');
      params.push(name);
    }
    if (tags !== undefined) {
      setClauses.push('tags = ?');
      params.push(JSON.stringify(tags));
    }

    if (subscriber_id) {
      params.push(subscriber_id, ultralight.user.id);
      await ultralight.db.run(
        'UPDATE subscribers SET ' + setClauses.join(', ') + ' WHERE id = ? AND user_id = ?',
        params
      );
    } else {
      params.push(email!.toLowerCase().trim(), ultralight.user.id);
      await ultralight.db.run(
        'UPDATE subscribers SET ' + setClauses.join(', ') + ' WHERE email = ? AND user_id = ?',
        params
      );
    }

    // Return updated
    let sub;
    if (subscriber_id) {
      sub = await ultralight.db.first(
        'SELECT * FROM subscribers WHERE id = ? AND user_id = ?',
        [subscriber_id, ultralight.user.id]
      );
    } else {
      sub = await ultralight.db.first(
        'SELECT * FROM subscribers WHERE email = ? AND user_id = ?',
        [email!.toLowerCase().trim(), ultralight.user.id]
      );
    }

    const parsed = sub ? { ...sub, tags: JSON.parse(sub.tags || '[]'), subscribed: !!sub.subscribed } : null;
    return { subscribers: parsed ? [parsed] : [], total: 1, action: 'updated' };
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
  const activeRow = await ultralight.db.first(
    'SELECT COUNT(*) as cnt FROM subscribers WHERE subscribed = 1 AND user_id = ?',
    [ultralight.user.id]
  );
  const unsubRow = await ultralight.db.first(
    'SELECT COUNT(*) as cnt FROM subscribers WHERE subscribed = 0 AND user_id = ?',
    [ultralight.user.id]
  );

  // Source breakdown
  const sourceRows = await ultralight.db.all(
    'SELECT source, COUNT(*) as cnt FROM subscribers WHERE subscribed = 1 AND user_id = ? GROUP BY source',
    [ultralight.user.id]
  );

  const bySource: Record<string, number> = {};
  for (const row of sourceRows) {
    bySource[row.source || 'unknown'] = row.cnt;
  }

  // Newsletter send stats
  const sentNewsletters = await ultralight.db.all(
    'SELECT email_send_count, email_sent_at FROM newsletters WHERE status = ? AND user_id = ? ORDER BY email_sent_at DESC',
    ['sent', ultralight.user.id]
  );

  let totalEmailsSent = 0;
  let lastSentAt: string | null = null;
  if (sentNewsletters.length > 0) {
    lastSentAt = sentNewsletters[0].email_sent_at;
    for (const nl of sentNewsletters) {
      totalEmailsSent = totalEmailsSent + (nl.email_send_count || 0);
    }
  }

  return {
    health: 'healthy',
    subscribers: {
      total_active: activeRow ? activeRow.cnt : 0,
      total_unsubscribed: unsubRow ? unsubRow.cnt : 0,
      by_source: bySource,
    },
    newsletters: {
      total_sent: sentNewsletters.length,
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
    const activeRow = await ultralight.db.first(
      'SELECT COUNT(*) as cnt FROM subscribers WHERE subscribed = 1 AND user_id = ?',
      [ultralight.user.id]
    );
    const sentRow = await ultralight.db.first(
      'SELECT COUNT(*) as cnt FROM newsletters WHERE status = ? AND user_id = ?',
      ['sent', ultralight.user.id]
    );

    // Recent sends
    const recentSends = await ultralight.db.all(
      'SELECT id, title, status, email_send_count, email_sent_at, discord_posted_at FROM newsletters WHERE user_id = ? ORDER BY created_at DESC LIMIT 10',
      [ultralight.user.id]
    );

    // Total emails
    const allSent = await ultralight.db.all(
      'SELECT email_send_count FROM newsletters WHERE status = ? AND user_id = ?',
      ['sent', ultralight.user.id]
    );

    let totalEmails = 0;
    for (const nl of allSent) {
      totalEmails = totalEmails + (nl.email_send_count || 0);
    }

    dashData = {
      subscribers: activeRow ? activeRow.cnt : 0,
      sent: sentRow ? sentRow.cnt : 0,
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
