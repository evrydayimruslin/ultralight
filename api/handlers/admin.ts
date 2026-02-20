// Admin Handler
// Protected endpoints for platform administration.
// Auth: Bearer token must match SUPABASE_SERVICE_ROLE_KEY (service-to-service).
//
// Endpoints:
//   POST /api/admin/gaps           — Create a gap
//   PATCH /api/admin/gaps/:id      — Update a gap
//   POST /api/admin/assess/:id     — Trigger/record assessment for a gap submission
//   POST /api/admin/approve/:id    — Approve an assessment (writes points)
//   POST /api/admin/reject/:id     — Reject an assessment
//   POST /api/admin/balance/:userId — Top up a user's hosting balance

import { json, error } from './app.ts';
import { unsuspendContent } from '../services/hosting-billing.ts';

// @ts-ignore
const Deno = globalThis.Deno;

function getEnv() {
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  return { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY };
}

function dbHeaders(key: string) {
  return {
    'apikey': key,
    'Authorization': `Bearer ${key}`,
  };
}

function writeHeaders(key: string) {
  return {
    ...dbHeaders(key),
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
  };
}

function authenticateAdmin(request: Request): boolean {
  const { SUPABASE_SERVICE_ROLE_KEY } = getEnv();
  const authHeader = request.headers.get('Authorization');
  const token = authHeader?.replace('Bearer ', '');
  return !!token && token === SUPABASE_SERVICE_ROLE_KEY;
}

export async function handleAdmin(request: Request): Promise<Response> {
  if (!authenticateAdmin(request)) {
    return error('Unauthorized: invalid service secret', 401);
  }

  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // POST /api/admin/gaps — Create a gap
  if (path === '/api/admin/gaps' && method === 'POST') {
    return createGap(request);
  }

  // PATCH /api/admin/gaps/:id — Update a gap
  const gapMatch = path.match(/^\/api\/admin\/gaps\/([0-9a-f-]+)$/);
  if (gapMatch && method === 'PATCH') {
    return updateGap(request, gapMatch[1]);
  }

  // POST /api/admin/assess/:id — Record assessment for a gap_assessment
  const assessMatch = path.match(/^\/api\/admin\/assess\/([0-9a-f-]+)$/);
  if (assessMatch && method === 'POST') {
    return recordAssessment(request, assessMatch[1]);
  }

  // POST /api/admin/approve/:id — Approve assessment, grant points
  const approveMatch = path.match(/^\/api\/admin\/approve\/([0-9a-f-]+)$/);
  if (approveMatch && method === 'POST') {
    return approveAssessment(request, approveMatch[1]);
  }

  // POST /api/admin/reject/:id — Reject assessment
  const rejectMatch = path.match(/^\/api\/admin\/reject\/([0-9a-f-]+)$/);
  if (rejectMatch && method === 'POST') {
    return rejectAssessment(rejectMatch[1]);
  }

  // POST /api/admin/balance/:userId — Top up hosting balance
  const balanceMatch = path.match(/^\/api\/admin\/balance\/([0-9a-f-]+)$/);
  if (balanceMatch && method === 'POST') {
    return topUpBalance(request, balanceMatch[1]);
  }

  return error('Admin endpoint not found', 404);
}

// ============================================
// CREATE GAP
// ============================================

async function createGap(request: Request): Promise<Response> {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = getEnv();

  let body: {
    title: string;
    description: string;
    severity?: string;
    points_value?: number;
    season?: number;
    source_shortcoming_ids?: string[];
    source_query_ids?: string[];
  };
  try {
    body = await request.json();
  } catch {
    return error('Invalid JSON body', 400);
  }

  if (!body.title || !body.description) {
    return error('title and description are required', 400);
  }

  const severity = body.severity || 'medium';
  if (!['low', 'medium', 'high', 'critical'].includes(severity)) {
    return error('severity must be low, medium, high, or critical', 400);
  }

  const payload = {
    title: body.title,
    description: body.description,
    severity,
    points_value: body.points_value ?? 100,
    season: body.season ?? 1,
    status: 'open',
    source_shortcoming_ids: body.source_shortcoming_ids || [],
    source_query_ids: body.source_query_ids || [],
  };

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/gaps`,
    {
      method: 'POST',
      headers: writeHeaders(SUPABASE_SERVICE_ROLE_KEY),
      body: JSON.stringify(payload),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    return error(`Failed to create gap: ${err}`, 500);
  }

  const rows = await res.json();
  const created = Array.isArray(rows) ? rows[0] : rows;
  return json({ success: true, gap: created }, 201);
}

// ============================================
// UPDATE GAP
// ============================================

async function updateGap(request: Request, gapId: string): Promise<Response> {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = getEnv();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return error('Invalid JSON body', 400);
  }

  // Whitelist allowed fields
  const allowed = ['title', 'description', 'severity', 'points_value', 'season', 'status',
    'source_shortcoming_ids', 'source_query_ids', 'fulfilled_by_app_id', 'fulfilled_by_user_id'];
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const key of allowed) {
    if (key in body) update[key] = body[key];
  }

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/gaps?id=eq.${gapId}`,
    {
      method: 'PATCH',
      headers: writeHeaders(SUPABASE_SERVICE_ROLE_KEY),
      body: JSON.stringify(update),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    return error(`Failed to update gap: ${err}`, 500);
  }

  const rows = await res.json();
  return json({ success: true, gap: Array.isArray(rows) ? rows[0] : rows });
}

// ============================================
// RECORD ASSESSMENT
// ============================================

async function recordAssessment(request: Request, assessmentId: string): Promise<Response> {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = getEnv();

  let body: {
    agent_score?: number;
    agent_notes?: string;
    proposed_points?: number;
  };
  try {
    body = await request.json();
  } catch {
    return error('Invalid JSON body', 400);
  }

  const update: Record<string, unknown> = {};
  if (body.agent_score !== undefined) update.agent_score = body.agent_score;
  if (body.agent_notes !== undefined) update.agent_notes = body.agent_notes;
  if (body.proposed_points !== undefined) update.proposed_points = body.proposed_points;

  if (Object.keys(update).length === 0) {
    return error('At least one of agent_score, agent_notes, proposed_points required', 400);
  }

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/gap_assessments?id=eq.${assessmentId}`,
    {
      method: 'PATCH',
      headers: writeHeaders(SUPABASE_SERVICE_ROLE_KEY),
      body: JSON.stringify(update),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    return error(`Failed to update assessment: ${err}`, 500);
  }

  const rows = await res.json();
  return json({ success: true, assessment: Array.isArray(rows) ? rows[0] : rows });
}

// ============================================
// APPROVE ASSESSMENT
// ============================================

async function approveAssessment(request: Request, assessmentId: string): Promise<Response> {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = getEnv();
  const headers = writeHeaders(SUPABASE_SERVICE_ROLE_KEY);

  let body: { awarded_points?: number; reviewed_by?: string };
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  // 1. Fetch the assessment
  const assessRes = await fetch(
    `${SUPABASE_URL}/rest/v1/gap_assessments?id=eq.${assessmentId}&select=*&limit=1`,
    { headers: dbHeaders(SUPABASE_SERVICE_ROLE_KEY) }
  );
  if (!assessRes.ok) return error('Failed to fetch assessment', 500);
  const assessments = await assessRes.json() as Array<{
    id: string; gap_id: string; app_id: string; user_id: string;
    proposed_points: number | null; status: string;
  }>;
  if (assessments.length === 0) return error('Assessment not found', 404);
  const assessment = assessments[0];

  if (assessment.status === 'approved') {
    return error('Assessment already approved', 409);
  }

  const awardedPoints = body.awarded_points ?? assessment.proposed_points ?? 100;
  const reviewedBy = body.reviewed_by || 'admin';

  // 2. Update assessment to approved
  const updateRes = await fetch(
    `${SUPABASE_URL}/rest/v1/gap_assessments?id=eq.${assessmentId}`,
    {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        status: 'approved',
        awarded_points: awardedPoints,
        reviewed_by: reviewedBy,
        reviewed_at: new Date().toISOString(),
      }),
    }
  );
  if (!updateRes.ok) return error('Failed to approve assessment', 500);

  // 3. Write points to ledger
  const pointsRes = await fetch(
    `${SUPABASE_URL}/rest/v1/points_ledger`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        user_id: assessment.user_id,
        amount: awardedPoints,
        reason: `Gap fulfilled: ${assessment.gap_id}`,
        gap_assessment_id: assessmentId,
        season: 1, // TODO: read from active season
      }),
    }
  );
  if (!pointsRes.ok) {
    console.error('[ADMIN] Failed to write points ledger:', await pointsRes.text());
  }

  // 4. Update gap status to fulfilled
  await fetch(
    `${SUPABASE_URL}/rest/v1/gaps?id=eq.${assessment.gap_id}`,
    {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        status: 'fulfilled',
        fulfilled_by_app_id: assessment.app_id,
        fulfilled_by_user_id: assessment.user_id,
        updated_at: new Date().toISOString(),
      }),
    }
  ).catch(() => {});

  return json({
    success: true,
    awarded_points: awardedPoints,
    user_id: assessment.user_id,
    gap_id: assessment.gap_id,
  });
}

// ============================================
// REJECT ASSESSMENT
// ============================================

async function rejectAssessment(assessmentId: string): Promise<Response> {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = getEnv();

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/gap_assessments?id=eq.${assessmentId}`,
    {
      method: 'PATCH',
      headers: writeHeaders(SUPABASE_SERVICE_ROLE_KEY),
      body: JSON.stringify({
        status: 'rejected',
        reviewed_at: new Date().toISOString(),
      }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    return error(`Failed to reject assessment: ${err}`, 500);
  }

  return json({ success: true, assessment_id: assessmentId, status: 'rejected' });
}

// ============================================
// TOP UP HOSTING BALANCE (ADMIN)
// ============================================

async function topUpBalance(request: Request, userId: string): Promise<Response> {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = getEnv();

  let body: { amount_cents: number };
  try {
    body = await request.json();
  } catch {
    return error('Invalid JSON body', 400);
  }

  if (!body.amount_cents || typeof body.amount_cents !== 'number' || body.amount_cents <= 0) {
    return error('amount_cents must be a positive number', 400);
  }

  // Get current balance
  const getRes = await fetch(
    `${SUPABASE_URL}/rest/v1/users?id=eq.${userId}&select=hosting_balance_cents`,
    { headers: dbHeaders(SUPABASE_SERVICE_ROLE_KEY) }
  );
  if (!getRes.ok) return error('Failed to read user', 500);
  const rows = await getRes.json() as Array<{ hosting_balance_cents: number }>;
  if (rows.length === 0) return error('User not found', 404);

  const currentBalance = rows[0].hosting_balance_cents ?? 0;
  const newBalance = currentBalance + body.amount_cents;

  // Update balance
  const updateRes = await fetch(
    `${SUPABASE_URL}/rest/v1/users?id=eq.${userId}`,
    {
      method: 'PATCH',
      headers: writeHeaders(SUPABASE_SERVICE_ROLE_KEY),
      body: JSON.stringify({ hosting_balance_cents: newBalance }),
    }
  );
  if (!updateRes.ok) return error('Failed to update balance', 500);

  // If was at zero, unsuspend content
  let unsuspended = { apps: 0, pages: 0 };
  if (currentBalance <= 0) {
    unsuspended = await unsuspendContent(userId);
  }

  return json({
    success: true,
    user_id: userId,
    previous_balance_cents: currentBalance,
    added_cents: body.amount_cents,
    new_balance_cents: newBalance,
    unsuspended_apps: unsuspended.apps,
    unsuspended_pages: unsuspended.pages,
  });
}
