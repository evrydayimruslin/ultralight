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
          content: 'You are an email response agent for a business. Your job is to classify inbound emails and draft professional replies.\n\nBusiness conventions:\n' + conventionsText + '\n\nInstructions:\n1. Classify the email intent\n2. Detect the language of the email\n3. If it warrants a reply, draft a response IN THE SAME LANGUAGE as the sender\n4. Be warm, professional, and accurate based on the business conventions\n\nRespond with JSON only:\n{\n  "classification": "inquiry|booking_request|cancellation|complaint|feedback|spam|other",\n  "language": "detected language code (e.g. en, ja, fr, es, de, zh)",\n  "should_reply": true/false,\n  "reason": "brief explanation of classification",\n  "priority": "high|normal|low",\n  "draft_body": "the full draft reply text in the sender\'s language (null if should_reply is false)"\n}',
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
          JSON.stringify({ to: from, subject: 'Re: ' + subject, draft_body: parsed.draft_body, original_body: body, language: parsed.language, classification: parsed.classification }),
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
  if (!['approve', 'reject', 'revise'].includes(action)) throw new Error('action must be "approve", "reject", or "revise"');

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
