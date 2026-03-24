// Email-Ops — Ultralight MCP App
//
// Autonomous email agent: receives inbound email via Resend webhook,
// classifies intent, drafts responses in sender's language,
// queues everything for admin approval, sends via Resend on approve.
//
// Storage: Ultralight D1 (3 tables: email_log, approval_queue, conventions)
// AI: ultralight.ai() for classification + draft generation (prompt-cached)
// Network: Resend API for outbound email
// Widgets: widget_approval_queue for desktop Activity tab
// Permissions: ai:call, net:fetch

const ultralight = (globalThis as any).ultralight;

// ============================================
// INTERNAL HELPERS
// ============================================

function nowISO(): string {
  return new Date().toISOString();
}

function uid(): string {
  return ultralight.user.id;
}

function escapeHtml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function truncate(str: string, maxLen: number): string {
  if (!str || str.length <= maxLen) return str || '';
  return str.slice(0, maxLen) + '…';
}

function stripHtml(html: string): string {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .trim();
}

// ============================================
// 1. RECEIVE EMAIL — Resend Inbound Webhook Handler
// ============================================

export async function receive_email(args: {
  from?: string;
  to?: string;
  subject?: string;
  text?: string;
  html?: string;
} | any): Promise<unknown> {
  // Handle both direct calls and HTTP webhook requests
  let from: string;
  let to: string;
  let subject: string;
  let body: string;

  if (args.method && args.json) {
    // Called via HTTP webhook — args is an UltralightRequest
    const payload = await args.json();
    if (!payload) {
      return { statusCode: 400, body: { error: 'No payload' } };
    }
    from = payload.from || '';
    to = payload.to || '';
    subject = payload.subject || '';
    body = payload.text || stripHtml(payload.html || '');
  } else {
    // Called directly via MCP tool
    from = args.from || '';
    to = args.to || '';
    subject = args.subject || '';
    body = args.text || stripHtml(args.html || '');
  }

  if (!from || !subject) {
    return { error: 'from and subject are required' };
  }

  const now = nowISO();
  const emailId = crypto.randomUUID();

  // 1. Log inbound email
  await ultralight.db.run(
    'INSERT INTO email_log (id, user_id, direction, from_address, to_address, subject, body, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [emailId, uid(), 'inbound', from, to, subject, body, 'processing', now, now]
  );

  // 2. Load business conventions for AI context
  const allConventions = await ultralight.db.all(
    'SELECT key, value, category FROM conventions WHERE user_id = ?',
    [uid()]
  );
  const conventionsText = allConventions.length > 0
    ? allConventions.map((c: any) => (c.category ? '[' + c.category + '] ' : '') + c.key + ': ' + c.value).join('\n')
    : 'No business conventions configured yet.';

  try {
    // 3. AI Classification + Draft — single call for efficiency
    const aiResponse = await ultralight.ai({
      model: 'minimax/minimax-m2.7',
      messages: [
        {
          role: 'system',
          content: 'You are an email response agent for a business. Your job is to classify inbound emails and draft professional replies.\n\nBusiness conventions:\n' + conventionsText + '\n\nInstructions:\n1. Classify the email intent\n2. Detect the language of the email\n3. If it warrants a reply, draft a response IN THE SAME LANGUAGE as the sender\n4. Be warm, professional, and accurate based on the business conventions\n\nRespond with JSON only:\n{\n  "classification": "inquiry|booking_request|cancellation|complaint|feedback|spam|other",\n  "language": "detected language code (e.g. en, ja, fr, es, de, zh)",\n  "should_reply": true/false,\n  "reason": "brief explanation of classification",\n  "priority": "high|normal|low",\n  "draft_body": "the full draft reply text in the sender\'s language (null if should_reply is false)",\n  "knowledge_gaps": ["list of topics the customer asked about that are NOT covered in the business conventions above, or empty array if all topics are covered"]\n}',
          cache_control: { type: 'ephemeral' },
        },
        {
          role: 'user',
          content: 'From: ' + from + '\nSubject: ' + subject + '\n\n' + body,
        },
      ],
    });

    // Parse AI response
    let parsed: any;
    try {
      const content = aiResponse.content || '';
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, content];
      parsed = JSON.parse(jsonMatch[1] || content);
    } catch {
      parsed = { classification: 'other', language: 'en', should_reply: false, reason: 'Failed to parse AI response', priority: 'normal', draft_body: null };
    }

    // Update email log with classification
    await ultralight.db.run(
      'UPDATE email_log SET classification = ?, language = ?, status = ?, updated_at = ? WHERE id = ? AND user_id = ?',
      [parsed.classification, parsed.language, 'queued', now, emailId, uid()]
    );

    // 4. Queue for approval
    const approvalId = crypto.randomUUID();

    if (parsed.should_reply && parsed.draft_body) {
      await ultralight.db.run(
        'INSERT INTO approval_queue (id, user_id, type, status, priority, title, summary, payload, original_email_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [approvalId, uid(), 'email_reply', 'pending', parsed.priority || 'normal',
          'Reply to: ' + subject,
          'From ' + from + ' — ' + parsed.reason,
          JSON.stringify({ to: from, subject: 'Re: ' + subject, draft_body: parsed.draft_body, original_body: body, language: parsed.language, classification: parsed.classification, knowledge_gaps: parsed.knowledge_gaps || [] }),
          emailId, now, now]
      );
    } else {
      await ultralight.db.run(
        'INSERT INTO approval_queue (id, user_id, type, status, priority, title, summary, payload, original_email_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [approvalId, uid(), 'email_skip', 'pending', 'low',
          'Skip: ' + subject,
          parsed.reason || 'No reply needed',
          JSON.stringify({ from: from, subject: subject, reason: parsed.reason, original_body: body, language: parsed.language, classification: parsed.classification }),
          emailId, now, now]
      );
    }

    // Link approval to email log
    await ultralight.db.run(
      'UPDATE email_log SET approval_id = ?, updated_at = ? WHERE id = ? AND user_id = ?',
      [approvalId, now, emailId, uid()]
    );

    // Return success (for webhook response)
    if (args.method) {
      return { statusCode: 200, body: { received: true, email_id: emailId, approval_id: approvalId } };
    }
    return { success: true, email_id: emailId, classification: parsed.classification, language: parsed.language, action: parsed.should_reply ? 'reply_queued' : 'skip_queued', approval_id: approvalId };

  } catch (err) {
    await ultralight.db.run(
      'UPDATE email_log SET status = ?, error_message = ?, updated_at = ? WHERE id = ? AND user_id = ?',
      ['failed', err instanceof Error ? err.message : String(err), now, emailId, uid()]
    );

    if (args.method) {
      return { statusCode: 500, body: { error: err instanceof Error ? err.message : String(err) } };
    }
    return { error: err instanceof Error ? err.message : String(err), email_id: emailId };
  }
}

// ============================================
// 2. EMAIL SEND — Outbound via Resend API
// ============================================

export async function email_send(args: {
  to: string;
  subject: string;
  body: string;
  in_reply_to?: string;
}): Promise<unknown> {
  const { to, subject, body, in_reply_to } = args;

  if (!to || !subject || !body) throw new Error('to, subject, and body are required');

  const apiKey = ultralight.env.RESEND_API_KEY;
  const fromAddress = ultralight.env.BUSINESS_EMAIL || 'noreply@resend.dev';
  const businessName = ultralight.env.BUSINESS_NAME || 'Business';

  if (!apiKey) {
    throw new Error('RESEND_API_KEY not configured. Set it in the app environment variables.');
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: businessName + ' <' + fromAddress + '>',
      to: [to],
      subject: subject,
      html: body.replace(/\n/g, '<br>'),
    }),
  });

  const now = nowISO();
  const emailId = crypto.randomUUID();
  const resendData = response.ok ? await response.json() : null;

  if (response.ok) {
    await ultralight.db.run(
      'INSERT INTO email_log (id, user_id, direction, from_address, to_address, subject, body, resend_id, status, sent_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [emailId, uid(), 'outbound', fromAddress, to, subject, body, resendData?.id || null, 'sent', now, now, now]
    );
    return { success: true, email_id: emailId, to: to, subject: subject };
  } else {
    const errBody = await response.text();
    await ultralight.db.run(
      'INSERT INTO email_log (id, user_id, direction, from_address, to_address, subject, body, status, error_message, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [emailId, uid(), 'outbound', fromAddress, to, subject, body, 'failed', errBody, now, now]
    );
    throw new Error('Email send failed: ' + errBody);
  }
}

// ============================================
// 3. EMAIL LOG LIST
// ============================================

export async function email_log_list(args: {
  direction?: string;
  status?: string;
  limit?: number;
}): Promise<unknown> {
  const { direction, status, limit } = args;

  let sql = 'SELECT id, direction, from_address, to_address, subject, classification, language, status, sent_at, created_at FROM email_log WHERE user_id = ?';
  const params: any[] = [uid()];

  if (direction) {
    sql += ' AND direction = ?';
    params.push(direction);
  }
  if (status) {
    sql += ' AND status = ?';
    params.push(status);
  }

  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit || 50);

  const emails = await ultralight.db.all(sql, params);
  return { emails: emails, total: emails.length };
}

// ============================================
// 4. APPROVALS LIST
// ============================================

export async function approvals_list(args: {
  status?: string;
  type?: string;
  limit?: number;
}): Promise<unknown> {
  const targetStatus = args.status || 'pending';
  const { type, limit } = args;

  let sql = 'SELECT * FROM approval_queue WHERE user_id = ? AND status = ?';
  const params: any[] = [uid(), targetStatus];

  if (type) {
    sql += ' AND type = ?';
    params.push(type);
  }

  sql += ' ORDER BY CASE priority WHEN \'high\' THEN 1 WHEN \'normal\' THEN 2 WHEN \'low\' THEN 3 END, created_at ASC LIMIT ?';
  params.push(limit || 20);

  const approvals = await ultralight.db.all(sql, params);

  const parsed = approvals.map((a: any) => ({
    ...a,
    payload: JSON.parse(a.payload || '{}'),
  }));

  const pendingRow = await ultralight.db.first(
    'SELECT COUNT(*) as cnt FROM approval_queue WHERE user_id = ? AND status = ?',
    [uid(), 'pending']
  );

  return {
    approvals: parsed,
    total: parsed.length,
    pending_count: pendingRow ? pendingRow.cnt : 0,
  };
}

// ============================================
// 5. APPROVALS ACT — Approve, Reject, Revise
// ============================================

export async function approvals_act(args: {
  approval_id: string;
  action: string;
  revision?: string;
  admin_notes?: string;
}): Promise<unknown> {
  const { approval_id, action, revision, admin_notes } = args;

  if (!approval_id || !action) throw new Error('approval_id and action are required');
  if (!['approve', 'reject', 'revise', 'regenerate'].includes(action)) throw new Error('action must be "approve", "reject", "revise", or "regenerate"');

  const approval = await ultralight.db.first(
    'SELECT * FROM approval_queue WHERE id = ? AND user_id = ?',
    [approval_id, uid()]
  );
  if (!approval) throw new Error('Approval not found: ' + approval_id);
  if (approval.status !== 'pending') throw new Error('Approval already resolved: ' + approval.status);

  const payload = JSON.parse(approval.payload || '{}');
  const now = nowISO();
  let result: any = null;

  if (action === 'reject') {
    await ultralight.db.run(
      'UPDATE approval_queue SET status = ?, admin_notes = ?, resolved_at = ?, updated_at = ? WHERE id = ? AND user_id = ?',
      ['rejected', admin_notes || null, now, now, approval_id, uid()]
    );
    return { success: true, approval_id: approval_id, action: 'rejected' };
  }

  // Approve or revise
  if (approval.type === 'email_reply') {
    const emailBody = revision || payload.draft_body;
    try {
      result = await email_send({
        to: payload.to,
        subject: payload.subject,
        body: emailBody,
        in_reply_to: approval.original_email_id,
      });
    } catch (err) {
      result = { error: err instanceof Error ? err.message : String(err) };
    }
  }

  if (approval.type === 'email_skip' && action === 'revise' && revision) {
    // Admin overrides skip — create a new reply approval with the revision
    const newApprovalId = crypto.randomUUID();
    await ultralight.db.run(
      'INSERT INTO approval_queue (id, user_id, type, status, priority, title, summary, payload, original_email_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [newApprovalId, uid(), 'email_reply', 'pending', 'normal',
        'Override reply: ' + payload.subject,
        'Admin requested reply to previously skipped email',
        JSON.stringify({ to: payload.from, subject: 'Re: ' + payload.subject, draft_body: revision, original_body: payload.original_body, language: payload.language }),
        approval.original_email_id, now, now]
    );
    result = { new_approval_id: newApprovalId, message: 'Reply draft created for approval' };
  }

  // Regenerate — re-draft using AI with admin's prompt guidance
  if (action === 'regenerate' && approval.type === 'email_reply') {
    const prompt = revision || 'Rewrite the draft to be better';
    const allConventions = await ultralight.db.all(
      'SELECT key, value, category FROM conventions WHERE user_id = ?',
      [uid()]
    );
    const conventionsText = allConventions.map((c: any) => (c.category ? '[' + c.category + '] ' : '') + c.key + ': ' + c.value).join('\n');

    const aiResponse = await ultralight.ai({
      model: 'minimax/minimax-m2.7',
      messages: [
        {
          role: 'system',
          content: 'You are rewriting a draft email response. Follow the admin\'s instructions precisely.\n\nBusiness conventions:\n' + conventionsText + '\n\nOriginal inbound email:\n' + (payload.original_body || '') + '\n\nCurrent draft:\n' + payload.draft_body + '\n\nRespond with ONLY the rewritten email body, nothing else. Write in ' + (payload.language || 'en') + '.',
          cache_control: { type: 'ephemeral' },
        },
        {
          role: 'user',
          content: 'Rewrite instruction: ' + prompt,
        },
      ],
    });

    const newDraft = aiResponse.content || payload.draft_body;

    // Update the approval with the new draft (stays pending)
    const updatedPayload = { ...payload, draft_body: newDraft };
    await ultralight.db.run(
      'UPDATE approval_queue SET payload = ?, admin_notes = ?, updated_at = ? WHERE id = ? AND user_id = ?',
      [JSON.stringify(updatedPayload), 'Regenerated: ' + prompt, now, approval_id, uid()]
    );

    return { success: true, approval_id: approval_id, action: 'regenerated', draft_body: newDraft };
  }

  const finalStatus = action === 'revise' ? 'revised' : 'executed';
  await ultralight.db.run(
    'UPDATE approval_queue SET status = ?, admin_notes = ?, resolved_at = ?, updated_at = ? WHERE id = ? AND user_id = ?',
    [finalStatus, admin_notes || null, now, now, approval_id, uid()]
  );

  return { success: true, approval_id: approval_id, action: finalStatus, result: result };
}

// ============================================
// 6. CONVENTIONS (Business Knowledge)
// ============================================

export async function conventions_get(args: {
  key?: string;
  category?: string;
}): Promise<unknown> {
  const { key, category } = args;

  if (key) {
    const row = await ultralight.db.first(
      'SELECT * FROM conventions WHERE user_id = ? AND key = ?',
      [uid(), key]
    );
    return row || { message: 'Convention not found: ' + key };
  }

  let sql = 'SELECT * FROM conventions WHERE user_id = ?';
  const params: any[] = [uid()];

  if (category) {
    sql += ' AND category = ?';
    params.push(category);
  }

  sql += ' ORDER BY category, key';
  const conventions = await ultralight.db.all(sql, params);
  return { conventions: conventions, total: conventions.length };
}

export async function conventions_set(args: {
  key: string;
  value: string;
  category?: string;
}): Promise<unknown> {
  const { key, value, category } = args;

  if (!key || !value) throw new Error('key and value are required');

  const now = nowISO();
  const existing = await ultralight.db.first(
    'SELECT id FROM conventions WHERE user_id = ? AND key = ?',
    [uid(), key]
  );

  if (existing) {
    await ultralight.db.run(
      'UPDATE conventions SET value = ?, category = ?, updated_at = ? WHERE id = ? AND user_id = ?',
      [value, category || 'general', now, existing.id, uid()]
    );
    return { success: true, action: 'updated', key: key };
  } else {
    const id = crypto.randomUUID();
    await ultralight.db.run(
      'INSERT INTO conventions (id, user_id, key, value, category, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, uid(), key, value, category || 'general', now, now]
    );
    return { success: true, action: 'created', key: key, id: id };
  }
}

// ============================================
// 7. WIDGET — Approval Queue for Activity Tab
// ============================================

export async function widget_approval_queue(args: {}): Promise<unknown> {
  const pending = await ultralight.db.all(
    'SELECT a.*, e.from_address, e.subject as email_subject, e.body as original_body FROM approval_queue a LEFT JOIN email_log e ON a.original_email_id = e.id AND e.user_id = a.user_id WHERE a.user_id = ? AND a.status = ? ORDER BY CASE a.priority WHEN \'high\' THEN 1 WHEN \'normal\' THEN 2 WHEN \'low\' THEN 3 END, a.created_at ASC',
    [uid(), 'pending']
  );

  return {
    badge_count: pending.length,
    items: pending.map((item: any) => {
      const payload = JSON.parse(item.payload || '{}');
      const isReply = item.type === 'email_reply';
      const fromAddr = item.from_address || payload.from || 'unknown';
      const subj = item.email_subject || payload.subject || item.title || 'No subject';
      const originalBody = item.original_body || payload.original_body || '';
      const draftBody = payload.draft_body || '';
      const lang = payload.language || 'en';
      const classification = payload.classification || item.type;

      const priorityColor = item.priority === 'high' ? '#ef4444' : item.priority === 'low' ? '#9ca3af' : '#3b82f6';
      const priorityLabel = item.priority === 'high' ? 'HIGH' : item.priority === 'low' ? 'LOW' : '';

      const html = '<div style="font-family: -apple-system, system-ui, sans-serif; font-size: 13px; line-height: 1.5; color: #1a1a1a;">'
        + '<div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">'
        + '<strong style="color: #111;">' + escapeHtml(fromAddr) + '</strong>'
        + '<span style="font-size: 11px; color: #888; background: #f3f4f6; padding: 1px 6px; border-radius: 3px;">' + escapeHtml(lang) + '</span>'
        + '<span style="font-size: 11px; color: #888; background: #f3f4f6; padding: 1px 6px; border-radius: 3px;">' + escapeHtml(classification) + '</span>'
        + (priorityLabel ? '<span style="font-size: 10px; font-weight: 600; color: ' + priorityColor + ';">' + priorityLabel + '</span>' : '')
        + '</div>'
        + '<div style="font-size: 14px; font-weight: 500; margin-bottom: 10px;">' + escapeHtml(subj) + '</div>'
        + '<div style="border: 1px solid #e5e7eb; border-radius: 6px; padding: 10px; margin-bottom: 10px; background: #fafafa; max-height: 120px; overflow-y: auto;">'
        + '<div style="font-size: 11px; color: #888; margin-bottom: 4px;">Original message</div>'
        + '<div style="white-space: pre-wrap; color: #444; font-size: 13px;">' + escapeHtml(truncate(originalBody, 600)) + '</div>'
        + '</div>'
        + (isReply
          ? '<div style="border: 1px solid #bfdbfe; border-radius: 6px; padding: 10px; background: #eff6ff;">'
            + '<div style="font-size: 11px; color: #3b82f6; margin-bottom: 4px;">Draft response</div>'
            + '<div style="white-space: pre-wrap; color: #1e3a5f; font-size: 13px;">' + escapeHtml(draftBody) + '</div>'
            + '</div>'
          : '<div style="color: #888; font-size: 12px; font-style: italic;">AI determined no reply needed: ' + escapeHtml(payload.reason || '') + '</div>'
        )
        + '</div>';

      const actions: any[] = [];

      if (isReply) {
        actions.push(
          { label: 'Send', icon: 'check', style: 'primary', tool: 'approvals_act', args: { approval_id: item.id, action: 'approve' } },
          { label: 'Regenerate', icon: 'refresh', style: 'secondary', tool: 'approvals_act',
            prompt_input: { placeholder: 'e.g. "Make it shorter" or "Add a greeting in Japanese"' },
            args: { approval_id: item.id, action: 'regenerate', revision: '{{edited_value}}' }
          },
          { label: 'Edit & Send', icon: 'edit', style: 'secondary', tool: 'approvals_act',
            editable: { field: 'draft_body', initial_value: draftBody },
            args: { approval_id: item.id, action: 'revise', revision: '{{edited_value}}' }
          },
          { label: 'Reject', icon: 'x', style: 'danger', tool: 'approvals_act', args: { approval_id: item.id, action: 'reject' } },
        );
      } else {
        // email_skip — admin can override with a custom reply
        actions.push(
          { label: 'Write Reply', icon: 'edit', style: 'secondary', tool: 'approvals_act',
            editable: { field: 'draft_body', initial_value: '' },
            args: { approval_id: item.id, action: 'revise', revision: '{{edited_value}}' }
          },
          { label: 'Dismiss', icon: 'x', style: 'danger', tool: 'approvals_act', args: { approval_id: item.id, action: 'reject' } },
        );
      }

      return { id: item.id, html: html, actions: actions };
    }),
  };
}

// ============================================
// 8. WIDGET APP — Full HTML App (new system)
// ============================================

export async function widget_email_inbox_ui(args: {}): Promise<unknown> {
  const countResult = await ultralight.db.first(
    'SELECT COUNT(*) as cnt FROM approval_queue WHERE user_id = ? AND status = ?',
    [uid(), 'pending']
  );
  const badgeCount = countResult?.cnt || 0;

  return {
    meta: {
      title: 'Email Approvals',
      icon: '📧',
      badge_count: badgeCount,
    },
    app_html: EMAIL_INBOX_APP_HTML,
    version: '1.0',
  };
}

export async function widget_email_inbox_data(args: {}): Promise<unknown> {
  const pending = await ultralight.db.all(
    'SELECT a.*, e.from_address, e.subject as email_subject, e.body as original_body FROM approval_queue a LEFT JOIN email_log e ON a.original_email_id = e.id AND e.user_id = a.user_id WHERE a.user_id = ? AND a.status = ? ORDER BY CASE a.priority WHEN \'high\' THEN 1 WHEN \'normal\' THEN 2 WHEN \'low\' THEN 3 END, a.created_at ASC',
    [uid(), 'pending']
  );

  const conventions = await ultralight.db.all(
    'SELECT key, value, category FROM conventions WHERE user_id = ? ORDER BY category, key',
    [uid()]
  );

  const totalProcessed = await ultralight.db.first(
    'SELECT COUNT(*) as cnt FROM email_log WHERE user_id = ?',
    [uid()]
  );

  return {
    items: pending.map((item: any) => {
      const payload = JSON.parse(item.payload || '{}');
      return {
        id: item.id,
        type: item.type,
        priority: item.priority,
        from: item.from_address || payload.from || 'unknown',
        subject: item.email_subject || payload.subject || item.title || 'No subject',
        language: payload.language || 'en',
        classification: payload.classification || item.type,
        original_body: item.original_body || payload.original_body || '',
        draft_body: payload.draft_body || '',
        reason: payload.reason || '',
        knowledge_gaps: payload.knowledge_gaps || [],
        created_at: item.created_at,
      };
    }),
    conventions: conventions,
    stats: {
      total_processed: totalProcessed?.cnt || 0,
      total_pending: pending.length,
    },
  };
}

// ── Email Inbox Deck UI — complete HTML app ──

const EMAIL_INBOX_APP_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { height: 100%; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; font-size: 14px; line-height: 1.5; color: #1a1a1a; background: #f8f9fa; display: flex; flex-direction: column; overflow: hidden; }

  /* Header */
  .header { display: flex; align-items: center; justify-content: space-between; padding: 12px 20px; background: #fff; border-bottom: 1px solid #e5e7eb; flex-shrink: 0; }
  .header-left { display: flex; align-items: center; gap: 12px; }
  .header-nav { font-size: 13px; color: #6b7280; }
  .header-title { font-size: 15px; font-weight: 600; }
  .header-badge { font-size: 11px; font-weight: 600; background: #ef4444; color: #fff; padding: 1px 7px; border-radius: 10px; }

  /* Deck container */
  .deck { flex: 1; display: flex; flex-direction: column; align-items: center; padding: 20px; min-height: 0; overflow-y: auto; }

  /* Card */
  .card { width: 100%; max-width: 680px; background: #fff; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.08), 0 4px 12px rgba(0,0,0,0.04); overflow-y: auto; max-height: calc(100% - 60px); transition: transform 0.3s ease, opacity 0.3s ease; }
  .card.slide-left { transform: translateX(-110%); opacity: 0; }
  .card.slide-right { transform: translateX(110%); opacity: 0; }
  .card-inner { padding: 24px; }

  /* Card header */
  .card-from { font-weight: 600; font-size: 14px; color: #111; }
  .card-badges { display: flex; gap: 6px; margin-top: 4px; flex-wrap: wrap; }
  .badge { font-size: 11px; color: #6b7280; background: #f3f4f6; padding: 1px 8px; border-radius: 4px; }
  .badge-high { color: #ef4444; background: #fef2f2; }
  .card-subject { font-size: 16px; font-weight: 500; margin-top: 10px; color: #111; }

  /* Sections */
  .section { margin-top: 16px; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; }
  .section-label { font-size: 11px; font-weight: 500; color: #9ca3af; padding: 8px 14px 4px; text-transform: uppercase; letter-spacing: 0.5px; }
  .section-body { padding: 4px 14px 12px; white-space: pre-wrap; font-size: 13px; color: #374151; max-height: 140px; overflow-y: auto; }
  .section-draft { background: #eff6ff; border-color: #bfdbfe; }
  .section-draft .section-label { color: #3b82f6; }
  .section-draft .section-body { color: #1e3a5f; }

  /* Gap analysis */
  .gaps { margin-top: 12px; border: 1px solid #fde68a; border-radius: 8px; background: #fffbeb; padding: 10px 14px; }
  .gaps-title { font-size: 11px; font-weight: 600; color: #b45309; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; }
  .gap-item { display: flex; align-items: start; justify-content: space-between; gap: 8px; font-size: 12px; color: #92400e; padding: 3px 0; }
  .gap-add { font-size: 11px; color: #2563eb; cursor: pointer; white-space: nowrap; border: none; background: none; padding: 0; }
  .gap-add:hover { text-decoration: underline; }

  /* No reply section */
  .no-reply { margin-top: 12px; font-size: 13px; color: #6b7280; font-style: italic; padding: 10px 14px; background: #f9fafb; border-radius: 8px; border: 1px solid #e5e7eb; }

  /* Actions */
  .actions { display: flex; gap: 8px; margin-top: 20px; flex-wrap: wrap; }
  .btn { padding: 8px 16px; font-size: 13px; font-weight: 500; border-radius: 6px; border: 1px solid transparent; cursor: pointer; transition: all 0.15s; }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-send { background: #16a34a; color: #fff; border-color: #16a34a; }
  .btn-send:hover:not(:disabled) { background: #15803d; }
  .btn-regen { background: #2563eb; color: #fff; border-color: #2563eb; }
  .btn-regen:hover:not(:disabled) { background: #1d4ed8; }
  .btn-edit { background: #fff; color: #374151; border-color: #d1d5db; }
  .btn-edit:hover:not(:disabled) { background: #f3f4f6; }
  .btn-reject { background: #fff; color: #ef4444; border-color: #fca5a5; }
  .btn-reject:hover:not(:disabled) { background: #fef2f2; }

  /* Prompt/edit input */
  .input-section { margin-top: 12px; }
  .input-label { font-size: 11px; font-weight: 500; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
  .input-area { width: 100%; border: 1px solid #d1d5db; border-radius: 6px; padding: 8px 12px; font-size: 13px; font-family: inherit; resize: vertical; min-height: 48px; outline: none; }
  .input-area:focus { border-color: #3b82f6; box-shadow: 0 0 0 2px rgba(37,99,235,0.1); }
  .input-actions { display: flex; gap: 8px; margin-top: 8px; align-items: center; }
  .input-hint { font-size: 11px; color: #9ca3af; margin-left: auto; }

  /* Navigation dots */
  .nav-dots { display: flex; align-items: center; gap: 8px; margin-top: 16px; }
  .nav-arrow { width: 28px; height: 28px; border-radius: 50%; border: 1px solid #d1d5db; background: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 14px; color: #6b7280; transition: all 0.15s; }
  .nav-arrow:hover { background: #f3f4f6; border-color: #9ca3af; }
  .nav-arrow:disabled { opacity: 0.3; cursor: not-allowed; }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: #d1d5db; transition: background 0.2s; }
  .dot.active { background: #3b82f6; }

  /* Toast */
  .toast { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); padding: 8px 16px; border-radius: 6px; font-size: 13px; font-weight: 500; z-index: 100; animation: fadeInUp 0.2s ease; }
  .toast-success { background: #16a34a; color: #fff; }
  .toast-error { background: #ef4444; color: #fff; }
  @keyframes fadeInUp { from { opacity: 0; transform: translate(-50%, 10px); } to { opacity: 1; transform: translate(-50%, 0); } }

  /* Empty state */
  .empty { text-align: center; color: #9ca3af; padding: 60px 20px; }
  .empty-icon { font-size: 48px; margin-bottom: 12px; }
  .empty-text { font-size: 15px; }

  /* Loading */
  .loading { text-align: center; color: #9ca3af; padding: 60px 20px; }

  /* Shortcuts legend */
  .shortcuts { position: fixed; bottom: 12px; right: 16px; display: flex; gap: 10px; font-size: 11px; color: #9ca3af; }
  .shortcut-key { display: inline-block; background: #f3f4f6; border: 1px solid #e5e7eb; border-radius: 3px; padding: 0 4px; font-family: monospace; font-size: 10px; margin-right: 2px; }
</style>
</head>
<body>

<div class="header">
  <div class="header-left">
    <span class="header-title">Email Approvals</span>
    <span class="header-nav" id="counter"></span>
  </div>
  <span class="header-badge" id="badge"></span>
</div>

<div class="deck" id="deck">
  <div class="loading" id="loading">Loading emails...</div>
</div>

<div class="shortcuts" id="shortcuts" style="display:none;">
  <span><span class="shortcut-key">←→</span> navigate</span>
  <span><span class="shortcut-key">S</span> send</span>
  <span><span class="shortcut-key">R</span> regenerate</span>
  <span><span class="shortcut-key">E</span> edit</span>
  <span><span class="shortcut-key">X</span> reject</span>
</div>

<div id="toast-container"></div>

<script>
(function() {
  var items = [];
  var conventions = [];
  var currentIndex = 0;
  var busy = false;
  var inputMode = null; // null | 'regen' | 'edit'

  // ── Data loading ──
  async function loadData() {
    try {
      var data = await ulAction('widget_email_inbox_data', {});
      items = data.items || [];
      conventions = data.conventions || [];
      render();
    } catch(e) {
      document.getElementById('loading').textContent = 'Failed to load: ' + e.message;
    }
  }

  // ── Render ──
  function render() {
    var deck = document.getElementById('deck');
    var badge = document.getElementById('badge');
    var counter = document.getElementById('counter');
    var shortcuts = document.getElementById('shortcuts');

    badge.textContent = items.length + ' pending';
    badge.style.display = items.length > 0 ? '' : 'none';

    if (items.length === 0) {
      deck.innerHTML = '<div class="empty"><div class="empty-icon">✅</div><div class="empty-text">All caught up! No pending emails.</div></div>';
      counter.textContent = '';
      shortcuts.style.display = 'none';
      return;
    }

    if (currentIndex >= items.length) currentIndex = items.length - 1;
    if (currentIndex < 0) currentIndex = 0;

    counter.textContent = (currentIndex + 1) + ' of ' + items.length;
    shortcuts.style.display = '';

    var item = items[currentIndex];
    var isReply = item.type === 'email_reply';

    var html = '<div class="card" id="current-card"><div class="card-inner">';

    // From + badges
    html += '<div class="card-from">' + esc(item.from) + '</div>';
    html += '<div class="card-badges">';
    html += '<span class="badge">' + esc(item.language) + '</span>';
    html += '<span class="badge">' + esc(item.classification) + '</span>';
    if (item.priority === 'high') html += '<span class="badge badge-high">HIGH</span>';
    html += '</div>';

    // Subject
    html += '<div class="card-subject">' + esc(item.subject) + '</div>';

    // Original message
    html += '<div class="section"><div class="section-label">Original message</div>';
    html += '<div class="section-body">' + esc(item.original_body) + '</div></div>';

    // Draft response
    if (isReply && item.draft_body) {
      html += '<div class="section section-draft"><div class="section-label">Draft response</div>';
      html += '<div class="section-body">' + esc(item.draft_body) + '</div></div>';
    } else if (!isReply) {
      html += '<div class="no-reply">AI determined no reply needed: ' + esc(item.reason) + '</div>';
    }

    // Knowledge gaps
    if (item.knowledge_gaps && item.knowledge_gaps.length > 0) {
      html += '<div class="gaps"><div class="gaps-title">⚠ Knowledge Gaps</div>';
      item.knowledge_gaps.forEach(function(gap, i) {
        html += '<div class="gap-item"><span>• ' + esc(gap) + '</span>';
        html += '<button class="gap-add" onclick="addToConventions(' + i + ')">Add to KB</button></div>';
      });
      html += '</div>';
    }

    // Input section (regenerate/edit)
    if (inputMode === 'regen') {
      html += '<div class="input-section">';
      html += '<div class="input-label">Regeneration instructions</div>';
      html += '<textarea class="input-area" id="input-area" placeholder="e.g. Make it shorter, Add greeting in Japanese..."></textarea>';
      html += '<div class="input-actions">';
      html += '<button class="btn btn-regen" onclick="submitRegen()">Regenerate</button>';
      html += '<button class="btn btn-edit" onclick="cancelInput()">Cancel</button>';
      html += '<span class="input-hint">⌘+Enter to submit</span>';
      html += '</div></div>';
    } else if (inputMode === 'edit') {
      html += '<div class="input-section">';
      html += '<div class="input-label">Edit draft</div>';
      html += '<textarea class="input-area" id="input-area" style="min-height:120px;font-family:inherit;">' + esc(item.draft_body || '') + '</textarea>';
      html += '<div class="input-actions">';
      html += '<button class="btn btn-send" onclick="submitEdit()">Send Edited</button>';
      html += '<button class="btn btn-edit" onclick="cancelInput()">Cancel</button>';
      html += '</div></div>';
    }

    // Action buttons (only if not in input mode)
    if (!inputMode) {
      html += '<div class="actions">';
      if (isReply) {
        html += '<button class="btn btn-send" onclick="doSend()" ' + (busy ? 'disabled' : '') + '>Send</button>';
        html += '<button class="btn btn-regen" onclick="doRegen()" ' + (busy ? 'disabled' : '') + '>Regenerate</button>';
        html += '<button class="btn btn-edit" onclick="doEdit()" ' + (busy ? 'disabled' : '') + '>Edit & Send</button>';
      } else {
        html += '<button class="btn btn-edit" onclick="doEdit()" ' + (busy ? 'disabled' : '') + '>Write Reply</button>';
      }
      html += '<button class="btn btn-reject" onclick="doReject()" ' + (busy ? 'disabled' : '') + '>Reject</button>';
      html += '</div>';
    }

    html += '</div></div>';

    // Navigation dots
    if (items.length > 1) {
      html += '<div class="nav-dots">';
      html += '<button class="nav-arrow" onclick="goPrev()" ' + (currentIndex === 0 ? 'disabled' : '') + '>◀</button>';
      for (var i = 0; i < items.length; i++) {
        html += '<span class="dot' + (i === currentIndex ? ' active' : '') + '" onclick="goTo(' + i + ')"></span>';
      }
      html += '<button class="nav-arrow" onclick="goNext()" ' + (currentIndex === items.length - 1 ? 'disabled' : '') + '>▶</button>';
      html += '</div>';
    }

    deck.innerHTML = html;

    // Focus input if in input mode
    if (inputMode) {
      var el = document.getElementById('input-area');
      if (el) setTimeout(function() { el.focus(); }, 50);
    }
  }

  // ── Navigation ──
  window.goPrev = function() { if (currentIndex > 0) { currentIndex--; inputMode = null; render(); } };
  window.goNext = function() { if (currentIndex < items.length - 1) { currentIndex++; inputMode = null; render(); } };
  window.goTo = function(i) { currentIndex = i; inputMode = null; render(); };

  // ── Actions ──
  window.doSend = async function() {
    if (busy) return;
    busy = true;
    render();
    try {
      await ulAction('approvals_act', { approval_id: items[currentIndex].id, action: 'approve' });
      toast('Email sent!', 'success');
      await loadData();
    } catch(e) { toast('Send failed: ' + e.message, 'error'); }
    busy = false;
    render();
  };

  window.doReject = async function() {
    if (busy) return;
    busy = true;
    render();
    try {
      await ulAction('approvals_act', { approval_id: items[currentIndex].id, action: 'reject' });
      toast('Rejected', 'success');
      await loadData();
    } catch(e) { toast('Reject failed: ' + e.message, 'error'); }
    busy = false;
    render();
  };

  window.doRegen = function() { inputMode = 'regen'; render(); };
  window.doEdit = function() { inputMode = 'edit'; render(); };
  window.cancelInput = function() { inputMode = null; render(); };

  window.submitRegen = async function() {
    var el = document.getElementById('input-area');
    var prompt = el ? el.value.trim() : '';
    if (!prompt) return;
    busy = true;
    render();
    try {
      await ulAction('approvals_act', { approval_id: items[currentIndex].id, action: 'regenerate', revision: prompt });
      inputMode = null;
      toast('Draft regenerated', 'success');
      await loadData();
    } catch(e) { toast('Regeneration failed: ' + e.message, 'error'); }
    busy = false;
    render();
  };

  window.submitEdit = async function() {
    var el = document.getElementById('input-area');
    var text = el ? el.value.trim() : '';
    if (!text) return;
    busy = true;
    render();
    try {
      await ulAction('approvals_act', { approval_id: items[currentIndex].id, action: 'revise', revision: text });
      inputMode = null;
      toast('Sent with edits!', 'success');
      await loadData();
    } catch(e) { toast('Send failed: ' + e.message, 'error'); }
    busy = false;
    render();
  };

  window.addToConventions = async function(gapIndex) {
    var item = items[currentIndex];
    var gap = item.knowledge_gaps[gapIndex];
    if (!gap) return;
    var value = prompt('Value for "' + gap + '":');
    if (!value) return;
    try {
      await ulAction('conventions_set', { key: gap, value: value, category: 'auto-detected' });
      toast('Added to conventions!', 'success');
      item.knowledge_gaps.splice(gapIndex, 1);
      render();
    } catch(e) { toast('Failed: ' + e.message, 'error'); }
  };

  // ── Keyboard shortcuts ──
  document.addEventListener('keydown', function(e) {
    // Skip if typing in input
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') {
      if (e.key === 'Escape') { window.cancelInput(); e.preventDefault(); }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        if (inputMode === 'regen') window.submitRegen();
        else if (inputMode === 'edit') window.submitEdit();
      }
      return;
    }
    if (e.key === 'ArrowLeft') { window.goPrev(); e.preventDefault(); }
    if (e.key === 'ArrowRight') { window.goNext(); e.preventDefault(); }
    if (e.key === 's' || e.key === 'S') { window.doSend(); e.preventDefault(); }
    if (e.key === 'r' || e.key === 'R') { window.doRegen(); e.preventDefault(); }
    if (e.key === 'e' || e.key === 'E') { window.doEdit(); e.preventDefault(); }
    if (e.key === 'x' || e.key === 'X') { window.doReject(); e.preventDefault(); }
  });

  // ── Toast ──
  function toast(msg, type) {
    var el = document.createElement('div');
    el.className = 'toast toast-' + type;
    el.textContent = msg;
    document.getElementById('toast-container').appendChild(el);
    setTimeout(function() { el.remove(); }, 3000);
  }

  // ── Escape HTML ──
  function esc(s) {
    if (!s) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── Init ──
  loadData();
})();
</script>
</body>
</html>`;

