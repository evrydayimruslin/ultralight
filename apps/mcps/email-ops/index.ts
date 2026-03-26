// Email-Ops — Ultralight MCP App (v2: Conversations + Versions)
//
// Version-controlled email thread system. Every action (draft, edit, regenerate,
// send, followup) creates a version. Full audit trail with diffs computed on read.
//
// Tables: conversations, versions, conventions (+ legacy email_log, approval_queue)
// AI: ultralight.ai() with google/gemini-3-flash-preview
// Network: Resend API for outbound
// Widgets: widget_email_inbox_ui (full deck app), widget_email_inbox_data
// Permissions: ai:call, net:fetch

const ultralight = (globalThis as any).ultralight;
const AI_MODEL = 'google/gemini-3-flash-preview';

// ── Helpers ──

function now(): string { return new Date().toISOString(); }
function uid(): string { return ultralight.user.id; }
function uname(): string { return ultralight.user.name || ultralight.user.email || 'admin'; }
function esc(s: string): string {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function stripHtml(html: string): string {
  if (!html) return '';
  return html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").trim();
}

async function getConventionsText(): Promise<string> {
  const rows = await ultralight.db.all('SELECT key, value, category FROM conventions WHERE user_id = ?', [uid()]);
  return rows.length > 0
    ? rows.map((c: any) => (c.category ? '[' + c.category + '] ' : '') + c.key + ': ' + c.value).join('\n')
    : 'No business conventions configured yet.';
}

async function nextVersionNum(conversationId: string): Promise<number> {
  const row = await ultralight.db.first('SELECT MAX(version_num) as mx FROM versions WHERE conversation_id = ? AND user_id = ?', [conversationId, uid()]);
  return (row?.mx || 0) + 1;
}

async function sendViaResend(to: string, subject: string, body: string, inReplyTo?: string): Promise<{ success: boolean; resendId?: string; error?: string }> {
  const apiKey = ultralight.env.RESEND_API_KEY;
  const fromAddr = ultralight.env.BUSINESS_EMAIL || 'noreply@resend.dev';
  const bizName = ultralight.env.BUSINESS_NAME || 'Business';
  if (!apiKey) return { success: false, error: 'RESEND_API_KEY not configured' };

  const payload: any = { from: bizName + ' <' + fromAddr + '>', to: [to], subject, html: body.replace(/\n/g, '<br>') };
  if (inReplyTo) { payload.headers = { 'In-Reply-To': inReplyTo, 'References': inReplyTo }; }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });

  if (res.ok) {
    const data = await res.json();
    return { success: true, resendId: data?.id };
  }
  return { success: false, error: await res.text() };
}

// ============================================
// 1. RECEIVE EMAIL — Webhook + Direct
// ============================================

export async function receive_email(args: any): Promise<unknown> {
  let from: string, to: string, subject: string, body: string, messageId: string | undefined;

  if (args.method && args.json) {
    const p = await args.json();
    if (!p) return { statusCode: 400, body: { error: 'No payload' } };
    from = p.from || ''; to = p.to || ''; subject = p.subject || '';
    body = p.text || stripHtml(p.html || ''); messageId = p.message_id;
  } else {
    from = args.from || ''; to = args.to || ''; subject = args.subject || '';
    body = args.text || stripHtml(args.html || ''); messageId = args.message_id;
  }

  if (!from || !subject) return { error: 'from and subject are required' };

  // Check for reply threading — match by In-Reply-To or same guest+subject
  const inReplyTo = args.in_reply_to || args.headers?.['in-reply-to'];
  let existingConvo: any = null;

  if (inReplyTo) {
    // Try to match by message_id stored on a sent version
    existingConvo = await ultralight.db.first(
      'SELECT c.* FROM conversations c JOIN versions v ON v.conversation_id = c.id WHERE v.resend_id = ? AND c.user_id = ?',
      [inReplyTo, uid()]
    );
  }
  if (!existingConvo) {
    // Try matching by guest email + similar subject (strip Re:/Fwd: prefixes)
    const cleanSubject = subject.replace(/^(Re|Fwd|Fw):\s*/gi, '').trim();
    existingConvo = await ultralight.db.first(
      'SELECT * FROM conversations WHERE user_id = ? AND guest_email = ? AND subject LIKE ? AND status != ? ORDER BY updated_at DESC LIMIT 1',
      [uid(), from, '%' + cleanSubject + '%', 'discarded']
    );
  }

  const ts = now();
  const conventionsText = await getConventionsText();

  if (existingConvo) {
    // ── Followup in existing thread ──
    const vNum = await nextVersionNum(existingConvo.id);
    const vId = crypto.randomUUID();
    await ultralight.db.run(
      'INSERT INTO versions (id, conversation_id, user_id, version_num, type, body, actor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [vId, existingConvo.id, uid(), vNum, 'inbound', body, from, ts]
    );

    // Get full thread for context
    const allVersions = await ultralight.db.all(
      'SELECT type, body, actor FROM versions WHERE conversation_id = ? AND user_id = ? ORDER BY version_num',
      [existingConvo.id, uid()]
    );
    const threadContext = allVersions.map((v: any) => (v.type === 'inbound' ? 'Guest: ' : 'You: ') + v.body).join('\n---\n');

    // AI draft followup
    const aiResp = await ultralight.ai({
      model: AI_MODEL,
      messages: [
        { role: 'system', content: 'You are an email response agent. Draft a followup reply to an ongoing conversation.\n\nBusiness conventions:\n' + conventionsText + '\n\nFull thread so far:\n' + threadContext + '\n\nRespond with JSON:\n{"draft_body": "your reply", "knowledge_gaps": ["topics not in conventions"]}', cache_control: { type: 'ephemeral' } },
        { role: 'user', content: 'Latest message from guest:\n' + body },
      ],
    });

    let parsed: any;
    try { const m = (aiResp.content || '').match(/```(?:json)?\s*([\s\S]*?)```/) || [null, aiResp.content]; parsed = JSON.parse(m[1] || aiResp.content); } catch { parsed = { draft_body: 'Thank you for your message. I will get back to you shortly.', knowledge_gaps: [] }; }

    const draftVId = crypto.randomUUID();
    await ultralight.db.run(
      'INSERT INTO versions (id, conversation_id, user_id, version_num, type, body, actor, model, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [draftVId, existingConvo.id, uid(), vNum + 1, 'auto_draft', parsed.draft_body, 'ai', AI_MODEL, JSON.stringify({ knowledge_gaps: parsed.knowledge_gaps || [] }), ts]
    );

    await ultralight.db.run('UPDATE conversations SET status = ?, updated_at = ? WHERE id = ? AND user_id = ?', ['active', ts, existingConvo.id, uid()]);

    if (args.method) return { statusCode: 200, body: { received: true, conversation_id: existingConvo.id, thread: true } };
    return { success: true, conversation_id: existingConvo.id, thread: true, classification: existingConvo.classification, language: existingConvo.language };
  }

  // ── New conversation ──
  const convoId = crypto.randomUUID();

  // AI classify + draft
  const aiResp = await ultralight.ai({
    model: AI_MODEL,
    messages: [
      { role: 'system', content: 'You are an email response agent for a business. Classify inbound emails and draft professional replies.\n\nBusiness conventions:\n' + conventionsText + '\n\nInstructions:\n1. Classify intent\n2. Detect language\n3. Draft reply IN THE SAME LANGUAGE as sender\n4. Be warm, professional, accurate\n\nRespond with JSON only:\n{"classification":"inquiry|booking_request|cancellation|complaint|feedback|spam|other","language":"en|ja|etc","should_reply":true/false,"priority":"high|normal|low","draft_body":"full reply text or null","knowledge_gaps":["topics not covered in conventions"]}', cache_control: { type: 'ephemeral' } },
      { role: 'user', content: 'From: ' + from + '\nSubject: ' + subject + '\n\n' + body },
    ],
  });

  let parsed: any;
  try { const m = (aiResp.content || '').match(/```(?:json)?\s*([\s\S]*?)```/) || [null, aiResp.content]; parsed = JSON.parse(m[1] || aiResp.content); } catch { parsed = { classification: 'other', language: 'en', should_reply: false, priority: 'normal', draft_body: null, knowledge_gaps: [] }; }

  // Create conversation
  await ultralight.db.run(
    'INSERT INTO conversations (id, user_id, guest_email, guest_name, subject, language, classification, status, message_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [convoId, uid(), from, from.split('@')[0], subject, parsed.language, parsed.classification, 'active', messageId || null, ts, ts]
  );

  // Version 1: inbound
  await ultralight.db.run(
    'INSERT INTO versions (id, conversation_id, user_id, version_num, type, body, actor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [crypto.randomUUID(), convoId, uid(), 1, 'inbound', body, from, ts]
  );

  // Version 2: auto_draft (if should_reply)
  if (parsed.should_reply && parsed.draft_body) {
    await ultralight.db.run(
      'INSERT INTO versions (id, conversation_id, user_id, version_num, type, body, actor, model, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [crypto.randomUUID(), convoId, uid(), 2, 'auto_draft', parsed.draft_body, 'ai', AI_MODEL, JSON.stringify({ knowledge_gaps: parsed.knowledge_gaps || [], priority: parsed.priority }), ts]
    );
  }

  if (args.method) return { statusCode: 200, body: { received: true, conversation_id: convoId } };
  return { success: true, conversation_id: convoId, classification: parsed.classification, language: parsed.language, action: parsed.should_reply ? 'draft_queued' : 'no_reply' };
}

// ============================================
// 2. EMAIL SEND — Outbound via Resend
// ============================================

export async function email_send(args: { to: string; subject: string; body: string; in_reply_to?: string }): Promise<unknown> {
  const { to, subject, body, in_reply_to } = args;
  if (!to || !subject || !body) throw new Error('to, subject, and body are required');
  const result = await sendViaResend(to, subject, body, in_reply_to);
  if (!result.success) throw new Error('Email send failed: ' + result.error);
  return { success: true, to, subject, resend_id: result.resendId };
}

// ============================================
// 3. CONVERSATION ACTIONS — Send, Discard, Edit, Regenerate, Restore, Followup
// ============================================

export async function conversation_act(args: {
  conversation_id: string;
  action: string;
  body?: string;
  prompt?: string;
}): Promise<unknown> {
  const { conversation_id, action, body: inputBody, prompt } = args;
  if (!conversation_id || !action) throw new Error('conversation_id and action are required');

  const convo = await ultralight.db.first('SELECT * FROM conversations WHERE id = ? AND user_id = ?', [conversation_id, uid()]);
  if (!convo) throw new Error('Conversation not found');

  const ts = now();
  const actor = uname();

  // Get latest draft version
  const latestDraft = await ultralight.db.first(
    'SELECT * FROM versions WHERE conversation_id = ? AND user_id = ? AND type IN (?, ?, ?, ?) ORDER BY version_num DESC LIMIT 1',
    [conversation_id, uid(), 'auto_draft', 'regeneration', 'manual_edit', 'followup_draft']
  );

  if (action === 'send') {
    const bodyToSend = inputBody || latestDraft?.body;
    if (!bodyToSend) throw new Error('No draft to send');

    const vNum = await nextVersionNum(conversation_id);
    const isSentBefore = !!(await ultralight.db.first("SELECT id FROM versions WHERE conversation_id = ? AND user_id = ? AND type IN ('sent', 'followup_sent')", [conversation_id, uid()]));
    const vType = isSentBefore ? 'followup_sent' : 'sent';

    // Send via Resend
    const result = await sendViaResend(convo.guest_email, (isSentBefore ? 'Re: ' : 'Re: ') + convo.subject, bodyToSend, convo.message_id);
    if (!result.success) throw new Error('Send failed: ' + result.error);

    await ultralight.db.run(
      'INSERT INTO versions (id, conversation_id, user_id, version_num, type, body, actor, resend_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [crypto.randomUUID(), conversation_id, uid(), vNum, vType, bodyToSend, actor, result.resendId || null, ts]
    );
    await ultralight.db.run('UPDATE conversations SET status = ?, updated_at = ? WHERE id = ? AND user_id = ?', ['resolved', ts, conversation_id, uid()]);

    return { success: true, action: 'sent', conversation_id };
  }

  if (action === 'discard') {
    await ultralight.db.run('UPDATE conversations SET status = ?, updated_at = ? WHERE id = ? AND user_id = ?', ['discarded', ts, conversation_id, uid()]);
    const vNum = await nextVersionNum(conversation_id);
    await ultralight.db.run(
      'INSERT INTO versions (id, conversation_id, user_id, version_num, type, body, actor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [crypto.randomUUID(), conversation_id, uid(), vNum, 'discarded', latestDraft?.body || '', actor, ts]
    );
    return { success: true, action: 'discarded', conversation_id };
  }

  if (action === 'restore') {
    if (convo.status !== 'discarded') throw new Error('Only discarded conversations can be restored');
    await ultralight.db.run('UPDATE conversations SET status = ?, updated_at = ? WHERE id = ? AND user_id = ?', ['active', ts, conversation_id, uid()]);
    return { success: true, action: 'restored', conversation_id };
  }

  if (action === 'save_edit') {
    if (!inputBody) throw new Error('body is required for save_edit');
    const vNum = await nextVersionNum(conversation_id);
    await ultralight.db.run(
      'INSERT INTO versions (id, conversation_id, user_id, version_num, type, body, actor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [crypto.randomUUID(), conversation_id, uid(), vNum, 'manual_edit', inputBody, actor, ts]
    );
    return { success: true, action: 'saved', conversation_id, version_num: vNum };
  }

  if (action === 'regenerate') {
    const regenPrompt = prompt || 'Rewrite the draft to be better';
    const conventionsText = await getConventionsText();

    // Get full thread for context
    const allVersions = await ultralight.db.all(
      'SELECT type, body, actor FROM versions WHERE conversation_id = ? AND user_id = ? ORDER BY version_num',
      [conversation_id, uid()]
    );
    const inboundBodies = allVersions.filter((v: any) => v.type === 'inbound').map((v: any) => v.body).join('\n---\n');
    const currentDraft = latestDraft?.body || '';

    const aiResp = await ultralight.ai({
      model: AI_MODEL,
      messages: [
        { role: 'system', content: 'You are rewriting a draft email response. Follow the admin\'s instructions.\n\nBusiness conventions:\n' + conventionsText + '\n\nInbound email(s):\n' + inboundBodies + '\n\nCurrent draft:\n' + currentDraft + '\n\nRespond with JSON:\n{"draft_body": "rewritten email", "knowledge_gaps": ["topics not covered"]}', cache_control: { type: 'ephemeral' } },
        { role: 'user', content: 'Instruction: ' + regenPrompt },
      ],
    });

    let parsed: any;
    try { const m = (aiResp.content || '').match(/```(?:json)?\s*([\s\S]*?)```/) || [null, aiResp.content]; parsed = JSON.parse(m[1] || aiResp.content); } catch { parsed = { draft_body: aiResp.content || currentDraft, knowledge_gaps: [] }; }

    const vNum = await nextVersionNum(conversation_id);
    await ultralight.db.run(
      'INSERT INTO versions (id, conversation_id, user_id, version_num, type, body, actor, actor_prompt, model, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [crypto.randomUUID(), conversation_id, uid(), vNum, 'regeneration', parsed.draft_body, 'ai', regenPrompt, AI_MODEL, JSON.stringify({ knowledge_gaps: parsed.knowledge_gaps || [] }), ts]
    );

    return { success: true, action: 'regenerated', conversation_id, version_num: vNum, draft_body: parsed.draft_body, knowledge_gaps: parsed.knowledge_gaps || [] };
  }

  if (action === 'followup_draft') {
    // Admin initiates a followup on a resolved conversation
    if (prompt) {
      // AI-generated followup
      const conventionsText = await getConventionsText();
      const allVersions = await ultralight.db.all('SELECT type, body FROM versions WHERE conversation_id = ? AND user_id = ? ORDER BY version_num', [conversation_id, uid()]);
      const threadContext = allVersions.map((v: any) => (v.type === 'inbound' ? 'Guest: ' : 'You: ') + v.body).join('\n---\n');

      const aiResp = await ultralight.ai({
        model: AI_MODEL,
        messages: [
          { role: 'system', content: 'Draft a followup email in an ongoing conversation.\n\nBusiness conventions:\n' + conventionsText + '\n\nThread:\n' + threadContext + '\n\nRespond with ONLY the email body text.', cache_control: { type: 'ephemeral' } },
          { role: 'user', content: 'Followup instruction: ' + prompt },
        ],
      });

      const vNum = await nextVersionNum(conversation_id);
      await ultralight.db.run(
        'INSERT INTO versions (id, conversation_id, user_id, version_num, type, body, actor, actor_prompt, model, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [crypto.randomUUID(), conversation_id, uid(), vNum, 'followup_draft', aiResp.content || '', 'ai', prompt, AI_MODEL, ts]
      );
      await ultralight.db.run('UPDATE conversations SET status = ?, updated_at = ? WHERE id = ? AND user_id = ?', ['active', ts, conversation_id, uid()]);
      return { success: true, action: 'followup_drafted', conversation_id, draft_body: aiResp.content };
    } else if (inputBody) {
      // Manual followup draft
      const vNum = await nextVersionNum(conversation_id);
      await ultralight.db.run(
        'INSERT INTO versions (id, conversation_id, user_id, version_num, type, body, actor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [crypto.randomUUID(), conversation_id, uid(), vNum, 'followup_draft', inputBody, actor, ts]
      );
      await ultralight.db.run('UPDATE conversations SET status = ?, updated_at = ? WHERE id = ? AND user_id = ?', ['active', ts, conversation_id, uid()]);
      return { success: true, action: 'followup_drafted', conversation_id };
    }
    throw new Error('prompt or body required for followup_draft');
  }

  throw new Error('Unknown action: ' + action);
}

// ============================================
// 4. CONVERSATION HISTORY
// ============================================

export async function conversation_history(args: { conversation_id: string }): Promise<unknown> {
  const { conversation_id } = args;
  if (!conversation_id) throw new Error('conversation_id is required');

  const convo = await ultralight.db.first('SELECT * FROM conversations WHERE id = ? AND user_id = ?', [conversation_id, uid()]);
  if (!convo) throw new Error('Conversation not found');

  const versions = await ultralight.db.all(
    'SELECT * FROM versions WHERE conversation_id = ? AND user_id = ? ORDER BY version_num ASC',
    [conversation_id, uid()]
  );

  return {
    conversation: convo,
    versions: versions.map((v: any) => ({
      ...v,
      metadata: v.metadata ? JSON.parse(v.metadata) : null,
    })),
  };
}

// ============================================
// 5. CONVERSATIONS LIST
// ============================================

export async function conversations_list(args: {
  status?: string;
  limit?: number;
  search?: string;
}): Promise<unknown> {
  const { status, limit, search } = args;

  let sql = 'SELECT c.*, (SELECT COUNT(*) FROM versions v WHERE v.conversation_id = c.id AND v.user_id = c.user_id) as version_count FROM conversations c WHERE c.user_id = ?';
  const params: any[] = [uid()];

  if (status) { sql += ' AND c.status = ?'; params.push(status); }
  if (search) { sql += ' AND (c.guest_email LIKE ? OR c.subject LIKE ?)'; params.push('%' + search + '%', '%' + search + '%'); }

  sql += ' ORDER BY c.updated_at DESC LIMIT ?';
  params.push(limit || 50);

  const convos = await ultralight.db.all(sql, params);

  // Get latest version for each conversation
  const result = [];
  for (const c of convos) {
    const latest = await ultralight.db.first(
      'SELECT type, body, actor, created_at FROM versions WHERE conversation_id = ? AND user_id = ? ORDER BY version_num DESC LIMIT 1',
      [c.id, uid()]
    );
    result.push({ ...c, latest_version: latest });
  }

  return { conversations: result, total: result.length };
}

// ============================================
// 6. CONVENTIONS (unchanged)
// ============================================

export async function conventions_get(args: { key?: string; category?: string }): Promise<unknown> {
  const { key, category } = args;
  if (key) {
    const row = await ultralight.db.first('SELECT * FROM conventions WHERE user_id = ? AND key = ?', [uid(), key]);
    return row || { message: 'Convention not found: ' + key };
  }
  let sql = 'SELECT * FROM conventions WHERE user_id = ?';
  const params: any[] = [uid()];
  if (category) { sql += ' AND category = ?'; params.push(category); }
  sql += ' ORDER BY category, key';
  return { conventions: await ultralight.db.all(sql, params) };
}

export async function conventions_set(args: { key: string; value: string; category?: string }): Promise<unknown> {
  const { key, value, category } = args;
  if (!key || !value) throw new Error('key and value are required');
  const ts = now();
  const existing = await ultralight.db.first('SELECT id FROM conventions WHERE user_id = ? AND key = ?', [uid(), key]);
  if (existing) {
    await ultralight.db.run('UPDATE conventions SET value = ?, category = ?, updated_at = ? WHERE id = ? AND user_id = ?', [value, category || 'general', ts, existing.id, uid()]);
    return { success: true, action: 'updated', key };
  }
  const id = crypto.randomUUID();
  await ultralight.db.run('INSERT INTO conventions (id, user_id, key, value, category, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [id, uid(), key, value, category || 'general', ts, ts]);
  return { success: true, action: 'created', key, id };
}

// ============================================
// 7. LEGACY BRIDGE — approvals_list + approvals_act
//    Maps old API to new conversation model for backward compat
// ============================================

export async function approvals_list(args: { status?: string; limit?: number }): Promise<unknown> {
  const convos = await ultralight.db.all(
    'SELECT * FROM conversations WHERE user_id = ? AND status = ? ORDER BY updated_at DESC LIMIT ?',
    [uid(), 'active', args.limit || 20]
  );

  const approvals = [];
  for (const c of convos) {
    const latestDraft = await ultralight.db.first(
      "SELECT * FROM versions WHERE conversation_id = ? AND user_id = ? AND type IN ('auto_draft','regeneration','manual_edit','followup_draft') ORDER BY version_num DESC LIMIT 1",
      [c.id, uid()]
    );
    const inbound = await ultralight.db.first(
      "SELECT body FROM versions WHERE conversation_id = ? AND user_id = ? AND type = 'inbound' ORDER BY version_num DESC LIMIT 1",
      [c.id, uid()]
    );

    if (latestDraft) {
      const meta = latestDraft.metadata ? JSON.parse(latestDraft.metadata) : {};
      approvals.push({
        id: c.id,
        type: 'email_reply',
        status: 'pending',
        priority: meta.priority || 'normal',
        title: 'Reply to: ' + c.subject,
        summary: 'From ' + c.guest_email,
        payload: JSON.stringify({
          to: c.guest_email, subject: 'Re: ' + c.subject, draft_body: latestDraft.body,
          original_body: inbound?.body || '', language: c.language, classification: c.classification,
          knowledge_gaps: meta.knowledge_gaps || [],
        }),
        created_at: c.created_at,
        from_address: c.guest_email,
        email_subject: c.subject,
        original_body: inbound?.body || '',
      });
    }
  }

  return { approvals, total: approvals.length, pending_count: approvals.length };
}

export async function approvals_act(args: { approval_id: string; action: string; revision?: string; admin_notes?: string }): Promise<unknown> {
  // Map old approval_id (which is now conversation_id) to new actions
  const { approval_id: convoId, action, revision } = args;
  if (!convoId || !action) throw new Error('approval_id and action are required');

  if (action === 'approve') return conversation_act({ conversation_id: convoId, action: 'send' });
  if (action === 'reject') return conversation_act({ conversation_id: convoId, action: 'discard' });
  if (action === 'save_draft') return conversation_act({ conversation_id: convoId, action: 'save_edit', body: revision });
  if (action === 'revise' && revision) return conversation_act({ conversation_id: convoId, action: 'save_edit', body: revision });
  if (action === 'regenerate') return conversation_act({ conversation_id: convoId, action: 'regenerate', prompt: revision || 'Rewrite the draft' });

  throw new Error('Unknown action: ' + action);
}

// ============================================
// 8. WIDGET APP — Full HTML Deck (Email Inbox)
// ============================================

export async function widget_email_inbox_ui(args: {}): Promise<unknown> {
  const countResult = await ultralight.db.first("SELECT COUNT(*) as cnt FROM conversations WHERE user_id = ? AND status = 'active'", [uid()]);
  return { meta: { title: 'Email Approvals', icon: '📧', badge_count: countResult?.cnt || 0 }, app_html: DECK_UI_HTML, version: '4.0' };
}

export async function widget_email_inbox_data(args: { view?: string }): Promise<unknown> {
  const view = args.view || 'active';

  // Active conversations with their full version history
  const convos = await ultralight.db.all(
    'SELECT * FROM conversations WHERE user_id = ? AND status = ? ORDER BY updated_at DESC LIMIT 50',
    [uid(), view === 'archive' ? 'resolved' : view === 'discarded' ? 'discarded' : 'active']
  );

  const items = [];
  for (const c of convos) {
    const versions = await ultralight.db.all(
      'SELECT id, version_num, type, body, actor, actor_prompt, model, metadata, resend_id, created_at FROM versions WHERE conversation_id = ? AND user_id = ? ORDER BY version_num ASC',
      [c.id, uid()]
    );

    const parsedVersions = versions.map((v: any) => ({
      ...v,
      metadata: v.metadata ? JSON.parse(v.metadata) : null,
    }));

    // Latest draft for the card
    const latestDraft = [...parsedVersions].reverse().find((v: any) => ['auto_draft', 'regeneration', 'manual_edit', 'followup_draft'].includes(v.type));
    // All inbound messages
    const inboundMessages = parsedVersions.filter((v: any) => v.type === 'inbound');
    // Knowledge gaps from latest draft metadata
    const gaps = latestDraft?.metadata?.knowledge_gaps || [];

    items.push({
      id: c.id,
      guest_email: c.guest_email,
      subject: c.subject,
      language: c.language,
      classification: c.classification,
      status: c.status,
      created_at: c.created_at,
      updated_at: c.updated_at,
      version_count: versions.length,
      latest_draft: latestDraft?.body || null,
      knowledge_gaps: gaps,
      inbound_messages: inboundMessages,
      versions: parsedVersions,
    });
  }

  // Counts per status
  const activeCnt = await ultralight.db.first("SELECT COUNT(*) as cnt FROM conversations WHERE user_id = ? AND status = 'active'", [uid()]);
  const resolvedCnt = await ultralight.db.first("SELECT COUNT(*) as cnt FROM conversations WHERE user_id = ? AND status = 'resolved'", [uid()]);
  const discardedCnt = await ultralight.db.first("SELECT COUNT(*) as cnt FROM conversations WHERE user_id = ? AND status = 'discarded'", [uid()]);

  return {
    items,
    counts: { active: activeCnt?.cnt || 0, resolved: resolvedCnt?.cnt || 0, discarded: discardedCnt?.cnt || 0 },
  };
}

// Legacy widget (backward compat for old homescreen tiles)
export async function widget_approval_queue(args: {}): Promise<unknown> {
  const data = await widget_email_inbox_data({});
  return { badge_count: (data as any).counts?.active || 0, items: [] };
}

// ============================================
// 10. EMAIL FAQs WIDGET — Knowledge Base Editor
// ============================================

export async function widget_email_faqs_ui(args: {}): Promise<unknown> {
  const conventions = await ultralight.db.all('SELECT * FROM conventions WHERE user_id = ? ORDER BY category, key', [uid()]);
  return { meta: { title: 'Email FAQs', icon: '📋', badge_count: conventions.length }, app_html: FAQS_UI_HTML, version: '1.0' };
}

export async function widget_email_faqs_data(args: {}): Promise<unknown> {
  const conventions = await ultralight.db.all("SELECT * FROM conventions WHERE user_id = ? AND category != '_deleted' ORDER BY category, key", [uid()]);

  // Aggregate knowledge gaps from recent versions
  const recentGaps = await ultralight.db.all(
    "SELECT metadata FROM versions WHERE user_id = ? AND metadata IS NOT NULL AND type IN ('auto_draft', 'regeneration') ORDER BY created_at DESC LIMIT 100",
    [uid()]
  );

  const gapCounts: Record<string, number> = {};
  for (const row of recentGaps) {
    try {
      const meta = JSON.parse(row.metadata);
      for (const gap of (meta.knowledge_gaps || [])) {
        const normalized = gap.toLowerCase().trim();
        gapCounts[normalized] = (gapCounts[normalized] || 0) + 1;
      }
    } catch {}
  }

  // Sort gaps by frequency
  const gaps = Object.entries(gapCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([gap, count]) => ({ gap, count }));

  // Group conventions by category
  const categories: Record<string, any[]> = {};
  for (const c of conventions) {
    const cat = c.category || 'general';
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(c);
  }

  return { categories, gaps, total: conventions.length };
}

// ============================================
// 11. DECK UI HTML — Full Email Inbox App with Threads + Archive
// ============================================

const DECK_UI_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { height: 100%; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; font-size: 14px; line-height: 1.5; color: #1a1a1a; background: #f8f9fa; display: flex; flex-direction: column; overflow: hidden; }

  .header { display: flex; align-items: center; justify-content: space-between; padding: 12px 20px; background: #fff; border-bottom: 1px solid #e5e7eb; flex-shrink: 0; }
  .header-left { display: flex; align-items: center; gap: 12px; }
  .header-title { font-size: 15px; font-weight: 600; }
  .header-right { display: flex; align-items: center; gap: 10px; }

  .tabs { display: flex; gap: 2px; background: #f3f4f6; border-radius: 6px; padding: 2px; }
  .tab { padding: 4px 12px; font-size: 12px; font-weight: 500; border-radius: 4px; cursor: pointer; color: #6b7280; border: none; background: none; }
  .tab.active { background: #fff; color: #111; box-shadow: 0 1px 2px rgba(0,0,0,0.06); }
  .tab .cnt { font-size: 10px; background: #e5e7eb; color: #6b7280; padding: 0 5px; border-radius: 8px; margin-left: 3px; }
  .tab.active .cnt { background: #3b82f6; color: #fff; }

  .filter-select { font-size: 12px; padding: 3px 8px; border: 1px solid #d1d5db; border-radius: 5px; background: #fff; color: #374151; cursor: pointer; }

  .deck { flex: 1; display: flex; flex-direction: column; align-items: center; padding: 20px; min-height: 0; overflow-y: auto; }
  .card { width: 100%; max-width: 700px; background: #fff; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.08), 0 4px 12px rgba(0,0,0,0.04); }
  .card-inner { padding: 24px; }
  .card-header { display: flex; justify-content: space-between; align-items: start; }
  .card-from { font-weight: 600; font-size: 14px; }
  .card-badges { display: flex; gap: 6px; margin-top: 4px; }
  .badge { font-size: 11px; color: #6b7280; background: #f3f4f6; padding: 1px 8px; border-radius: 4px; }
  .card-subject { font-size: 16px; font-weight: 500; margin-top: 10px; }

  .nav-dots { display: flex; align-items: center; gap: 6px; }
  .nav-arrow { width: 28px; height: 28px; border-radius: 50%; border: 1px solid #d1d5db; background: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 14px; color: #6b7280; }
  .nav-arrow:hover { background: #f3f4f6; }
  .nav-arrow:disabled { opacity: 0.3; cursor: not-allowed; }

  .thread { margin-top: 16px; }
  .thread-toggle { font-size: 12px; color: #3b82f6; cursor: pointer; border: none; background: none; padding: 4px 0; font-weight: 500; }
  .thread-toggle:hover { text-decoration: underline; }
  .thread-msg { border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px 14px; margin-top: 8px; }
  .thread-msg.guest { background: #fafafa; }
  .thread-msg.you { background: #f0fdf4; border-color: #bbf7d0; }
  .thread-msg-header { font-size: 11px; color: #9ca3af; margin-bottom: 4px; display: flex; justify-content: space-between; }
  .thread-msg-body { font-size: 13px; white-space: pre-wrap; color: #374151; }

  .section { margin-top: 16px; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; }
  .section-label { font-size: 11px; font-weight: 500; color: #9ca3af; padding: 8px 14px 4px; text-transform: uppercase; letter-spacing: 0.5px; }
  .section-body { padding: 4px 14px 12px; white-space: pre-wrap; font-size: 13px; color: #374151; }
  .section-draft { background: #eff6ff; border-color: #bfdbfe; }
  .section-draft .section-label { color: #3b82f6; }
  .section-draft .section-body { color: #1e3a5f; }

  .input-area { width: 100%; border: 1px solid #93c5fd; border-radius: 6px; padding: 8px 12px; font-size: 13px; font-family: inherit; outline: none; background: #fff; color: #1e3a5f; overflow: hidden; }
  .input-area:focus { border-color: #3b82f6; box-shadow: 0 0 0 2px rgba(37,99,235,0.1); }

  .gaps { margin-top: 12px; border: 1px solid #fde68a; border-radius: 8px; background: #fffbeb; padding: 10px 14px; }
  .gaps-title { font-size: 11px; font-weight: 600; color: #b45309; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; }
  .gap-item { font-size: 12px; color: #92400e; padding: 3px 0; }

  .actions { display: flex; gap: 8px; margin-top: 20px; flex-wrap: wrap; }
  .btn { padding: 8px 16px; font-size: 13px; font-weight: 500; border-radius: 6px; border: 1px solid transparent; cursor: pointer; transition: all 0.15s; }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-send { background: #16a34a; color: #fff; }
  .btn-send:hover:not(:disabled) { background: #15803d; }
  .btn-secondary { background: #fff; color: #374151; border-color: #d1d5db; }
  .btn-secondary:hover:not(:disabled) { background: #f3f4f6; }
  .btn-discard { background: #fff; color: #ef4444; border-color: #fca5a5; }
  .btn-discard:hover:not(:disabled) { background: #fef2f2; }
  .btn-restore { background: #fff; color: #16a34a; border-color: #86efac; }
  .btn-restore:hover:not(:disabled) { background: #f0fdf4; }
  .btn-followup { background: #2563eb; color: #fff; }
  .btn-followup:hover:not(:disabled) { background: #1d4ed8; }

  .prompt-section { margin-top: 12px; }
  .prompt-label { font-size: 11px; font-weight: 500; color: #6b7280; text-transform: uppercase; margin-bottom: 4px; }
  .prompt-actions { display: flex; gap: 8px; margin-top: 8px; align-items: center; }

  .history { margin-top: 16px; }
  .history-toggle { font-size: 12px; color: #6b7280; cursor: pointer; border: none; background: none; font-weight: 500; }
  .history-toggle:hover { color: #3b82f6; }
  .history-item { display: flex; gap: 8px; padding: 6px 0; border-bottom: 1px solid #f3f4f6; font-size: 12px; }
  .history-num { color: #9ca3af; min-width: 24px; }
  .history-type { font-weight: 500; min-width: 100px; }
  .history-actor { color: #6b7280; }
  .history-time { color: #9ca3af; margin-left: auto; white-space: nowrap; }

  .empty { text-align: center; color: #9ca3af; padding: 60px 20px; }
  .empty-icon { font-size: 48px; margin-bottom: 12px; }

  .toast { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); padding: 8px 16px; border-radius: 6px; font-size: 13px; font-weight: 500; z-index: 100; animation: fadeUp 0.2s; }
  .toast-ok { background: #16a34a; color: #fff; }
  .toast-err { background: #ef4444; color: #fff; }
  @keyframes fadeUp { from { opacity: 0; transform: translate(-50%, 10px); } to { opacity: 1; transform: translate(-50%, 0); } }
</style>
</head>
<body>
<div class="header">
  <div class="header-left">
    <span class="header-title">Email Approvals</span>
    <span id="nav-info" style="font-size:13px;color:#6b7280;"></span>
  </div>
  <div class="header-right">
    <div class="tabs">
      <button class="tab active" data-view="active">Active <span class="cnt" id="cnt-active">0</span></button>
      <button class="tab" data-view="archive">Sent <span class="cnt" id="cnt-resolved">0</span></button>
      <button class="tab" data-view="discarded">Discarded <span class="cnt" id="cnt-discarded">0</span></button>
    </div>
    <select class="filter-select" id="lang-filter"><option value="">All</option></select>
    <div class="nav-dots" id="nav-dots"></div>
  </div>
</div>
<div class="deck" id="deck"></div>
<div id="toast-container"></div>

<script>
var items = [], filteredItems = [], currentIdx = 0, currentView = 'active', inputMode = null, loading = true;

function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ulAction is provided by the bridge SDK injected by the desktop container.
// If running standalone (no bridge), provide a fallback that warns.
if (!window.ulAction) {
  window.ulAction = function(fn, args) {
    console.warn('[DeckUI] No bridge SDK — ulAction(' + fn + ') not available');
    return Promise.reject(new Error('No bridge SDK'));
  };
}

function toast(msg, ok) {
  var el = document.createElement('div');
  el.className = 'toast ' + (ok ? 'toast-ok' : 'toast-err');
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(function() { el.remove(); }, 3000);
}

function timeAgo(iso) {
  if (!iso) return '';
  var d = new Date(iso), n = Date.now(), s = Math.floor((n - d.getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s/60) + 'm ago';
  if (s < 86400) return Math.floor(s/3600) + 'h ago';
  return Math.floor(s/86400) + 'd ago';
}

function typeLabel(t) {
  var map = { inbound: 'Guest email', auto_draft: 'AI draft', regeneration: 'Regenerated', manual_edit: 'Edited', sent: 'Sent', followup_draft: 'Followup draft', followup_sent: 'Followup sent', discarded: 'Discarded' };
  return map[t] || t;
}

async function loadData() {
  try {
    var result = await ulAction('widget_email_inbox_data', { view: currentView === 'archive' ? 'archive' : currentView === 'discarded' ? 'discarded' : 'active' });
    items = result.items || [];
    document.getElementById('cnt-active').textContent = result.counts.active;
    document.getElementById('cnt-resolved').textContent = result.counts.resolved;
    document.getElementById('cnt-discarded').textContent = result.counts.discarded;
    applyFilter();
    loading = false;
    render();
  } catch(e) {
    loading = false;
    document.getElementById('deck').innerHTML = '<div class="empty"><div class="empty-icon">⚠️</div><div>Failed to load: ' + e.message + '</div></div>';
  }
}

function applyFilter() {
  var lang = document.getElementById('lang-filter').value;
  filteredItems = lang ? items.filter(function(i) { return i.language === lang; }) : items;
  if (currentIdx >= filteredItems.length) currentIdx = Math.max(0, filteredItems.length - 1);
  updateLangOptions();
}

function updateLangOptions() {
  var sel = document.getElementById('lang-filter');
  var val = sel.value;
  var langs = {};
  items.forEach(function(i) { if (i.language) langs[i.language] = (langs[i.language]||0)+1; });
  var html = '<option value="">All (' + items.length + ')</option>';
  Object.keys(langs).sort().forEach(function(l) { html += '<option value="' + l + '"' + (l===val?' selected':'') + '>' + l + ' (' + langs[l] + ')</option>'; });
  sel.innerHTML = html;
}

function render() {
  if (loading) { document.getElementById('deck').innerHTML = '<div class="empty">Loading...</div>'; return; }
  if (filteredItems.length === 0) {
    document.getElementById('deck').innerHTML = '<div class="empty"><div class="empty-icon">✅</div><div>' + (currentView === 'active' ? 'All caught up! No pending emails.' : currentView === 'archive' ? 'No sent emails yet.' : 'No discarded emails.') + '</div></div>';
    document.getElementById('nav-dots').innerHTML = '';
    document.getElementById('nav-info').textContent = '';
    return;
  }

  var item = filteredItems[currentIdx];
  var versions = item.versions || [];
  var inbounds = versions.filter(function(v) { return v.type === 'inbound'; });
  var latestDraft = null;
  for (var i = versions.length - 1; i >= 0; i--) {
    if (['auto_draft','regeneration','manual_edit','followup_draft'].indexOf(versions[i].type) >= 0) { latestDraft = versions[i]; break; }
  }
  var sentVersions = versions.filter(function(v) { return v.type === 'sent' || v.type === 'followup_sent'; });
  var gaps = latestDraft && latestDraft.metadata ? (latestDraft.metadata.knowledge_gaps || []) : [];

  var html = '<div class="card"><div class="card-inner">';

  // Header with nav
  html += '<div class="card-header"><div>';
  html += '<div class="card-from">' + esc(item.guest_email) + '</div>';
  html += '<div class="card-badges"><span class="badge">' + esc(item.language || 'en') + '</span><span class="badge">' + esc(item.classification || '') + '</span></div>';
  html += '</div><div class="nav-dots">';
  html += '<button class="nav-arrow" onclick="navigate(-1)" ' + (currentIdx === 0 ? 'disabled' : '') + '>◀</button>';
  html += '<button class="nav-arrow" onclick="navigate(1)" ' + (currentIdx >= filteredItems.length - 1 ? 'disabled' : '') + '>▶</button>';
  html += '</div></div>';
  html += '<div class="card-subject">' + esc(item.subject) + '</div>';

  // Thread view
  if (inbounds.length > 1 || sentVersions.length > 0) {
    var threadMsgs = versions.filter(function(v) { return v.type === 'inbound' || v.type === 'sent' || v.type === 'followup_sent'; });
    html += '<div class="thread"><button class="thread-toggle" onclick="toggleThread()">▶ Thread (' + threadMsgs.length + ' messages)</button>';
    html += '<div id="thread-messages" style="display:none;">';
    threadMsgs.forEach(function(v) {
      var isGuest = v.type === 'inbound';
      html += '<div class="thread-msg ' + (isGuest ? 'guest' : 'you') + '">';
      html += '<div class="thread-msg-header"><span>' + (isGuest ? 'Guest' : 'You (' + esc(v.actor) + ')') + '</span><span>' + timeAgo(v.created_at) + '</span></div>';
      html += '<div class="thread-msg-body">' + esc(v.body) + '</div></div>';
    });
    html += '</div></div>';
  }

  // Latest inbound (always shown)
  var latestInbound = inbounds[inbounds.length - 1];
  if (latestInbound) {
    html += '<div class="section"><div class="section-label">Original message</div><div class="section-body">' + esc(latestInbound.body) + '</div></div>';
  }

  // Draft section (for active view)
  if (currentView === 'active' && latestDraft) {
    html += '<div class="section section-draft"><div class="section-label">Draft response</div><div class="section-body" id="draft-display">';
    if (inputMode === 'edit') {
      html += '<textarea class="input-area" id="edit-area">' + esc(latestDraft.body) + '</textarea>';
    } else {
      html += esc(latestDraft.body);
    }
    html += '</div></div>';
  }

  // Sent version (for archive view)
  if (currentView === 'archive' && sentVersions.length > 0) {
    var lastSent = sentVersions[sentVersions.length - 1];
    html += '<div class="section" style="background:#f0fdf4;border-color:#bbf7d0;"><div class="section-label" style="color:#16a34a;">Sent response</div><div class="section-body">' + esc(lastSent.body) + '</div></div>';
  }

  // Knowledge gaps (read-only — admin manages FAQs in the separate FAQs widget)
  if (gaps.length > 0) {
    html += '<div class="gaps"><div class="gaps-title">⚠ Knowledge gaps</div>';
    gaps.forEach(function(g) {
      html += '<div class="gap-item"><span>• ' + esc(g) + '</span></div>';
    });
    html += '</div>';
  }

  // Prompt input (for regeneration)
  if (inputMode === 'regen') {
    html += '<div class="prompt-section"><div class="prompt-label">Regeneration instructions</div>';
    html += '<textarea class="input-area" id="prompt-area" placeholder="e.g. Make it shorter, add parking info..." style="min-height:48px;border-color:#d1d5db;background:#fff;color:#374151;"></textarea>';
    html += '<div class="prompt-actions"><button class="btn btn-send" onclick="doRegenerate()">Regenerate</button><button class="btn btn-secondary" onclick="cancelInput()">Cancel</button></div></div>';
  }

  // Followup input
  if (inputMode === 'followup') {
    html += '<div class="prompt-section"><div class="prompt-label">Follow up</div>';
    html += '<textarea class="input-area" id="followup-area" placeholder="Write your followup or describe what to say..." style="min-height:80px;border-color:#d1d5db;background:#fff;color:#374151;"></textarea>';
    html += '<div class="prompt-actions"><button class="btn btn-followup" onclick="doFollowup()">Send Followup</button><button class="btn btn-secondary" onclick="doFollowupDraft()">Generate Draft</button><button class="btn btn-secondary" onclick="cancelInput()">Cancel</button></div></div>';
  }

  // Actions
  if (!inputMode || inputMode === 'edit') {
    html += '<div class="actions">';
    if (currentView === 'active') {
      if (inputMode === 'edit') {
        html += '<button class="btn btn-send" onclick="doSaveEdit()">Save</button>';
        html += '<button class="btn btn-secondary" onclick="cancelInput()">Cancel</button>';
      } else {
        html += '<button class="btn btn-discard" onclick="doAction(&quot;discard&quot;)">Discard</button>';
        html += '<button class="btn btn-secondary" onclick="startEdit()">Edit</button>';
        html += '<button class="btn btn-secondary" onclick="startRegen()">Regenerate</button>';
        html += '<button class="btn btn-send" onclick="doAction(&quot;send&quot;)">Send</button>';
      }
    } else if (currentView === 'archive') {
      html += '<button class="btn btn-followup" onclick="startFollowup()">Follow Up</button>';
    } else if (currentView === 'discarded') {
      html += '<button class="btn btn-restore" onclick="doAction(&quot;restore&quot;)">Restore</button>';
    }
    html += '</div>';
  }

  // Version history
  if (versions.length > 2) {
    html += '<div class="history"><button class="history-toggle" onclick="toggleHistory()">▶ Version history (' + versions.length + ')</button>';
    html += '<div id="history-list" style="display:none;">';
    versions.forEach(function(v) {
      html += '<div class="history-item"><span class="history-num">v' + v.version_num + '</span>';
      html += '<span class="history-type">' + typeLabel(v.type) + '</span>';
      html += '<span class="history-actor">' + esc(v.actor || '') + (v.actor_prompt ? ' — "' + esc(v.actor_prompt.substring(0,40)) + '"' : '') + '</span>';
      html += '<span class="history-time">' + timeAgo(v.created_at) + '</span></div>';
    });
    html += '</div></div>';
  }

  html += '</div></div>';
  document.getElementById('deck').innerHTML = html;
  document.getElementById('nav-info').textContent = (currentIdx + 1) + ' of ' + filteredItems.length;

  // Auto-size edit textarea
  if (inputMode === 'edit') {
    var el = document.getElementById('edit-area');
    if (el) { setTimeout(function() { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; el.focus(); }, 50); }
  }
  if (inputMode === 'regen') { var el = document.getElementById('prompt-area'); if (el) setTimeout(function() { el.focus(); }, 50); }
  if (inputMode === 'followup') { var el = document.getElementById('followup-area'); if (el) setTimeout(function() { el.focus(); }, 50); }
}

function navigate(dir) { currentIdx = Math.max(0, Math.min(filteredItems.length - 1, currentIdx + dir)); inputMode = null; render(); }
function toggleThread() { var el = document.getElementById('thread-messages'); if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none'; }
function toggleHistory() { var el = document.getElementById('history-list'); if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none'; }

function startEdit() { inputMode = 'edit'; render(); }
function startRegen() { inputMode = 'regen'; render(); }
function startFollowup() { inputMode = 'followup'; render(); }
function cancelInput() { inputMode = null; render(); }

async function doAction(action) {
  var item = filteredItems[currentIdx];
  if (!item) return;
  try {
    await ulAction('conversation_act', { conversation_id: item.id, action: action });
    toast(action === 'send' ? 'Email sent!' : action === 'discard' ? 'Discarded' : action === 'restore' ? 'Restored' : 'Done', true);
    inputMode = null;
    await loadData();
  } catch(e) { toast('Failed: ' + e.message, false); }
}

async function doSaveEdit() {
  var item = filteredItems[currentIdx];
  var el = document.getElementById('edit-area');
  if (!item || !el) return;
  try {
    await ulAction('conversation_act', { conversation_id: item.id, action: 'save_edit', body: el.value });
    toast('Draft saved', true);
    inputMode = null;
    await loadData();
  } catch(e) { toast('Failed: ' + e.message, false); }
}

async function doRegenerate() {
  var item = filteredItems[currentIdx];
  var el = document.getElementById('prompt-area');
  if (!item || !el || !el.value.trim()) return;
  try {
    await ulAction('conversation_act', { conversation_id: item.id, action: 'regenerate', prompt: el.value });
    toast('Regenerated', true);
    inputMode = null;
    await loadData();
  } catch(e) { toast('Failed: ' + e.message, false); }
}

async function doFollowup() {
  var item = filteredItems[currentIdx];
  var el = document.getElementById('followup-area');
  if (!item || !el || !el.value.trim()) return;
  try {
    // Direct send as followup
    await ulAction('conversation_act', { conversation_id: item.id, action: 'followup_draft', body: el.value });
    await ulAction('conversation_act', { conversation_id: item.id, action: 'send' });
    toast('Followup sent', true);
    inputMode = null;
    await loadData();
  } catch(e) { toast('Failed: ' + e.message, false); }
}

async function doFollowupDraft() {
  var item = filteredItems[currentIdx];
  var el = document.getElementById('followup-area');
  if (!item || !el || !el.value.trim()) return;
  try {
    await ulAction('conversation_act', { conversation_id: item.id, action: 'followup_draft', prompt: el.value });
    toast('Draft generated', true);
    inputMode = null;
    currentView = 'active';
    document.querySelectorAll('.tab').forEach(function(t) { t.classList.toggle('active', t.dataset.view === 'active'); });
    await loadData();
  } catch(e) { toast('Failed: ' + e.message, false); }
}


// Tab switching
document.querySelectorAll('.tab').forEach(function(tab) {
  tab.addEventListener('click', function() {
    currentView = this.dataset.view;
    currentIdx = 0;
    inputMode = null;
    document.querySelectorAll('.tab').forEach(function(t) { t.classList.remove('active'); });
    this.classList.add('active');
    loadData();
  });
});

// Language filter
document.getElementById('lang-filter').addEventListener('change', function() { currentIdx = 0; applyFilter(); render(); });

// Keyboard shortcuts
document.addEventListener('keydown', function(e) {
  if (e.target.tagName === 'TEXTAREA') return;
  if (e.key === 'ArrowLeft') navigate(-1);
  if (e.key === 'ArrowRight') navigate(1);
});

// Initial load
loadData();
</script>
</body>
</html>`;

// ============================================
// 12. FAQs UI HTML — Knowledge Base Editor
// ============================================

const FAQS_UI_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { height: 100%; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; font-size: 14px; line-height: 1.5; color: #1a1a1a; background: #f8f9fa; display: flex; flex-direction: column; overflow-y: auto; }

  .header { display: flex; align-items: center; justify-content: space-between; padding: 12px 20px; background: #fff; border-bottom: 1px solid #e5e7eb; flex-shrink: 0; position: sticky; top: 0; z-index: 10; }
  .header-title { font-size: 15px; font-weight: 600; }
  .header-right { display: flex; align-items: center; gap: 8px; }
  .header-count { font-size: 12px; color: #6b7280; }

  .content { padding: 20px; max-width: 800px; margin: 0 auto; width: 100%; }

  .gaps-section { margin-bottom: 24px; border: 1px solid #fde68a; border-radius: 10px; background: #fffbeb; padding: 16px; }
  .gaps-header { font-size: 13px; font-weight: 600; color: #b45309; margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
  .gap-row { display: flex; align-items: center; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #fef3c7; }
  .gap-row:last-child { border-bottom: none; }
  .gap-text { font-size: 13px; color: #92400e; }
  .gap-count { font-size: 11px; color: #b45309; background: #fef3c7; padding: 1px 8px; border-radius: 10px; }

  .category { margin-bottom: 24px; }
  .category-header { font-size: 12px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; padding-bottom: 8px; border-bottom: 1px solid #e5e7eb; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center; }
  .category-count { font-size: 11px; font-weight: 400; color: #9ca3af; }

  .entry { border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 14px; margin-bottom: 8px; background: #fff; transition: box-shadow 0.15s; }
  .entry:hover { box-shadow: 0 1px 4px rgba(0,0,0,0.06); }
  .entry-key { font-size: 12px; font-weight: 600; color: #374151; margin-bottom: 4px; display: flex; justify-content: space-between; align-items: center; }
  .entry-value { font-size: 13px; color: #4b5563; white-space: pre-wrap; }
  .entry-actions { display: flex; gap: 6px; }

  .btn-sm { padding: 2px 8px; font-size: 11px; border-radius: 4px; border: 1px solid #d1d5db; background: #fff; color: #374151; cursor: pointer; }
  .btn-sm:hover { background: #f3f4f6; }
  .btn-sm-danger { color: #ef4444; border-color: #fca5a5; }
  .btn-sm-danger:hover { background: #fef2f2; }

  .edit-area { width: 100%; border: 1px solid #93c5fd; border-radius: 6px; padding: 8px 10px; font-size: 13px; font-family: inherit; outline: none; resize: vertical; min-height: 60px; }
  .edit-area:focus { border-color: #3b82f6; box-shadow: 0 0 0 2px rgba(37,99,235,0.1); }
  .edit-actions { display: flex; gap: 6px; margin-top: 6px; }

  .add-form { border: 1px dashed #d1d5db; border-radius: 8px; padding: 14px; margin-bottom: 8px; background: #fafafa; }
  .add-row { display: flex; gap: 8px; margin-bottom: 6px; }
  .add-input { flex: 1; padding: 6px 10px; font-size: 13px; border: 1px solid #d1d5db; border-radius: 6px; outline: none; font-family: inherit; }
  .add-input:focus { border-color: #3b82f6; }
  .add-select { padding: 6px 10px; font-size: 13px; border: 1px solid #d1d5db; border-radius: 6px; background: #fff; }

  .btn { padding: 6px 14px; font-size: 13px; font-weight: 500; border-radius: 6px; border: none; cursor: pointer; }
  .btn-primary { background: #2563eb; color: #fff; }
  .btn-primary:hover { background: #1d4ed8; }
  .btn-secondary { background: #fff; color: #374151; border: 1px solid #d1d5db; }
  .btn-secondary:hover { background: #f3f4f6; }

  .toast { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); padding: 8px 16px; border-radius: 6px; font-size: 13px; font-weight: 500; z-index: 100; animation: fadeUp 0.2s; }
  .toast-ok { background: #16a34a; color: #fff; }
  .toast-err { background: #ef4444; color: #fff; }
  @keyframes fadeUp { from { opacity:0; transform:translate(-50%,10px); } to { opacity:1; transform:translate(-50%,0); } }

  .empty { text-align: center; color: #9ca3af; padding: 40px; }
</style>
</head>
<body>
<div class="header">
  <div><span class="header-title">Email FAQs</span></div>
  <div class="header-right">
    <span class="header-count" id="total-count"></span>
    <button class="btn btn-primary" onclick="showAddForm()">+ Add Entry</button>
  </div>
</div>
<div class="content" id="content">
  <div class="empty">Loading...</div>
</div>
<div id="toast-container"></div>

<script>
var data = null, editingId = null, showAdd = false;

function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ulAction fallback
if (!window.ulAction) {
  window.ulAction = function() { return Promise.reject(new Error('No bridge')); };
}

function toast(msg, ok) {
  var el = document.createElement('div');
  el.className = 'toast ' + (ok ? 'toast-ok' : 'toast-err');
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(function() { el.remove(); }, 3000);
}

async function loadData() {
  try {
    data = await ulAction('widget_email_faqs_data', {});
    render();
  } catch(e) {
    document.getElementById('content').innerHTML = '<div class="empty">Failed to load: ' + esc(e.message) + '</div>';
  }
}

function render() {
  if (!data) return;
  var html = '';
  var categories = data.categories || {};
  var gaps = data.gaps || [];
  var total = data.total || 0;

  document.getElementById('total-count').textContent = total + ' entries';

  // Knowledge gaps from recent emails
  if (gaps.length > 0) {
    html += '<div class="gaps-section"><div class="gaps-header">Suggested topics from recent emails</div>';
    gaps.forEach(function(g) {
      html += '<div class="gap-row"><span class="gap-text">' + esc(g.gap) + '</span><span class="gap-count">' + g.count + 'x mentioned</span></div>';
    });
    html += '</div>';
  }

  // Add form
  if (showAdd) {
    html += '<div class="add-form">';
    html += '<div class="add-row"><input class="add-input" id="add-key" placeholder="Key (e.g. parking_fees)"><select class="add-select" id="add-category">';
    var cats = Object.keys(categories).sort();
    if (cats.length === 0) cats = ['general'];
    cats.forEach(function(c) { html += '<option value="' + esc(c) + '">' + esc(c) + '</option>'; });
    html += '<option value="_new">+ New category</option></select></div>';
    html += '<textarea class="edit-area" id="add-value" placeholder="FAQ content..."></textarea>';
    html += '<div class="edit-actions"><button class="btn btn-primary" onclick="doAdd()">Save</button><button class="btn btn-secondary" onclick="hideAddForm()">Cancel</button></div>';
    html += '</div>';
  }

  // Categories
  var catKeys = Object.keys(categories).sort();
  if (catKeys.length === 0 && gaps.length === 0) {
    html += '<div class="empty">No FAQ entries yet. Click "+ Add Entry" to start building your knowledge base.</div>';
  }

  catKeys.forEach(function(cat) {
    var entries = categories[cat];
    html += '<div class="category"><div class="category-header"><span>' + esc(cat) + '</span><span class="category-count">' + entries.length + ' entries</span></div>';
    entries.forEach(function(entry) {
      if (editingId === entry.id) {
        html += '<div class="entry"><div class="entry-key">' + esc(entry.key) + '</div>';
        html += '<textarea class="edit-area" id="edit-value">' + esc(entry.value) + '</textarea>';
        html += '<div class="edit-actions"><button class="btn btn-primary" onclick="doSave(&quot;' + esc(entry.id) + '&quot;, &quot;' + esc(entry.key) + '&quot;, &quot;' + esc(cat) + '&quot;)">Save</button>';
        html += '<button class="btn btn-secondary" onclick="cancelEdit()">Cancel</button></div></div>';
      } else {
        html += '<div class="entry"><div class="entry-key"><span>' + esc(entry.key) + '</span>';
        html += '<div class="entry-actions"><button class="btn-sm" onclick="startEdit(&quot;' + esc(entry.id) + '&quot;)">Edit</button>';
        html += '<button class="btn-sm btn-sm-danger" onclick="doDelete(&quot;' + esc(entry.key) + '&quot;)">Delete</button></div></div>';
        html += '<div class="entry-value">' + esc(entry.value) + '</div></div>';
      }
    });
    html += '</div>';
  });

  document.getElementById('content').innerHTML = html;

  // Focus edit area if editing
  if (editingId) {
    var el = document.getElementById('edit-value');
    if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; el.focus(); }
  }
  if (showAdd) {
    var el = document.getElementById('add-key');
    if (el) el.focus();
  }
}

function startEdit(id) { editingId = id; render(); }
function cancelEdit() { editingId = null; render(); }
function showAddForm() { showAdd = true; render(); }
function hideAddForm() { showAdd = false; render(); }

async function doSave(id, key, category) {
  var el = document.getElementById('edit-value');
  if (!el) return;
  try {
    await ulAction('conventions_set', { key: key, value: el.value, category: category });
    toast('Saved', true);
    editingId = null;
    await loadData();
  } catch(e) { toast('Failed: ' + e.message, false); }
}

async function doAdd() {
  var key = document.getElementById('add-key').value.trim();
  var value = document.getElementById('add-value').value.trim();
  var catSelect = document.getElementById('add-category');
  var category = catSelect.value;
  if (category === '_new') {
    category = prompt('New category name:');
    if (!category) return;
  }
  if (!key || !value) { toast('Key and value are required', false); return; }
  try {
    await ulAction('conventions_set', { key: key, value: value, category: category });
    toast('Added: ' + key, true);
    showAdd = false;
    await loadData();
  } catch(e) { toast('Failed: ' + e.message, false); }
}

async function doDelete(key) {
  if (!confirm('Delete "' + key + '"?')) return;
  try {
    // Delete by setting empty — conventions_set doesn't have a delete, so we'll need to use db directly
    // For now, just remove from UI by marking with a special value
    await ulAction('conventions_set', { key: key, value: '[DELETED]', category: '_deleted' });
    toast('Deleted: ' + key, true);
    await loadData();
  } catch(e) { toast('Failed: ' + e.message, false); }
}

loadData();
</script>
</body>
</html>`;
