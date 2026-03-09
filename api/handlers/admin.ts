// Admin Handler
// Protected endpoints for platform administration.
// Auth: Bearer token must match SUPABASE_SERVICE_ROLE_KEY (service-to-service).
//
// Endpoints:
//   POST  /api/admin/gaps               — Create a gap
//   PATCH /api/admin/gaps/:id           — Update a gap
//   POST  /api/admin/assess/:id         — Trigger/record assessment for a gap submission
//   POST  /api/admin/approve/:id        — Approve an assessment (writes points)
//   POST  /api/admin/reject/:id         — Reject an assessment
//   POST  /api/admin/balance/:userId    — Top up a user's hosting balance
//   POST  /api/admin/cleanup-provisionals — Delete expired provisional users
//   GET   /api/admin/analytics?days=30  — Distribution pipeline analytics dashboard

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

  // POST /api/admin/cleanup-provisionals — Delete expired provisional users
  if (path === '/api/admin/cleanup-provisionals' && method === 'POST') {
    return cleanupProvisionals();
  }

  // PATCH /api/admin/apps/:appId/category — Set app category
  const categoryMatch = path.match(/^\/api\/admin\/apps\/([0-9a-f-]+)\/category$/);
  if (categoryMatch && method === 'PATCH') {
    return setAppCategory(request, categoryMatch[1]);
  }

  // PATCH /api/admin/apps/:appId/featured — Toggle featured status
  const featuredMatch = path.match(/^\/api\/admin\/apps\/([0-9a-f-]+)\/featured$/);
  if (featuredMatch && method === 'PATCH') {
    return setAppFeatured(request, featuredMatch[1]);
  }

  // GET /api/admin/analytics — Distribution pipeline analytics dashboard
  if (path === '/api/admin/analytics' && method === 'GET') {
    const days = parseInt(url.searchParams.get('days') || '30', 10);
    return getAnalytics(days);
  }

  return error('Admin endpoint not found', 404);
}

async function cleanupProvisionals(): Promise<Response> {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = getEnv();

  try {
    // Get IDs of provisionals about to be deleted (for auth.users cleanup)
    const listRes = await fetch(
      `${SUPABASE_URL}/rest/v1/users?provisional=eq.true&last_active_at=lt.${new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()}&select=id`,
      { headers: dbHeaders(SUPABASE_SERVICE_ROLE_KEY) }
    );

    const toDelete = listRes.ok ? await listRes.json() : [];

    // Run the cleanup RPC (deletes from public.users, cascades to tokens)
    const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/cleanup_expired_provisionals`, {
      method: 'POST',
      headers: writeHeaders(SUPABASE_SERVICE_ROLE_KEY),
      body: '{}',
    });

    const deletedCount = rpcRes.ok ? await rpcRes.json() : 0;

    // Delete from auth.users (best-effort, non-blocking)
    let authDeleted = 0;
    for (const user of (toDelete || [])) {
      try {
        await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${user.id}`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            'apikey': SUPABASE_SERVICE_ROLE_KEY,
          },
        });
        authDeleted++;
      } catch {}
    }

    return json({
      deleted_users: deletedCount,
      auth_entries_cleaned: authDeleted,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[ADMIN] Cleanup provisionals failed:', err);
    return error('Cleanup failed', 500);
  }
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

// ============================================
// ANALYTICS DASHBOARD
// ============================================

async function getAnalytics(days: number): Promise<Response> {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = getEnv();

  // Clamp days to reasonable range
  const periodDays = Math.max(1, Math.min(days, 365));
  const since = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000).toISOString();

  try {
    // Try the RPC first (requires migration-analytics.sql to be run)
    const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_analytics_summary`, {
      method: 'POST',
      headers: writeHeaders(SUPABASE_SERVICE_ROLE_KEY),
      body: JSON.stringify({ p_days: periodDays }),
    });

    if (rpcRes.ok) {
      const rpcData = await rpcRes.json();
      return json({ success: true, analytics: rpcData });
    }

    // RPC not available (migration not run yet) — fall back to direct queries
    console.warn('[ADMIN] Analytics RPC not available, falling back to direct queries');

    // Run all analytics queries in parallel
    const [
      provisionalsRes,
      conversionsRes,
      templateFetchesRes,
      topAppsRes,
      topSearchesRes,
      unmetDemandRes,
      totalCallsRes,
      onboardingCallsRes,
    ] = await Promise.all([
      // Active provisional users
      fetch(
        `${SUPABASE_URL}/rest/v1/users?provisional=eq.true&select=id,provisional_created_at,last_active_at&provisional_created_at=gte.${since}`,
        { headers: dbHeaders(SUPABASE_SERVICE_ROLE_KEY) }
      ),
      // Conversion events
      fetch(
        `${SUPABASE_URL}/rest/v1/conversion_events?created_at=gte.${since}&select=*&order=created_at.desc&limit=100`,
        { headers: dbHeaders(SUPABASE_SERVICE_ROLE_KEY) }
      ),
      // Template fetches
      fetch(
        `${SUPABASE_URL}/rest/v1/onboarding_requests?created_at=gte.${since}&select=id,provisional_created,created_at&order=created_at.desc&limit=1000`,
        { headers: dbHeaders(SUPABASE_SERVICE_ROLE_KEY) }
      ),
      // Top apps by usage
      fetch(
        `${SUPABASE_URL}/rest/v1/mcp_call_logs?created_at=gte.${since}&app_id=not.is.null&select=app_id,app_name,success&order=created_at.desc&limit=10000`,
        { headers: dbHeaders(SUPABASE_SERVICE_ROLE_KEY) }
      ),
      // Top search queries
      fetch(
        `${SUPABASE_URL}/rest/v1/appstore_queries?created_at=gte.${since}&select=query,top_similarity,result_count&order=created_at.desc&limit=500`,
        { headers: dbHeaders(SUPABASE_SERVICE_ROLE_KEY) }
      ),
      // Unmet demand (low similarity searches)
      fetch(
        `${SUPABASE_URL}/rest/v1/appstore_queries?created_at=gte.${since}&or=(top_similarity.lt.0.5,result_count.eq.0)&select=query,top_similarity,result_count&order=created_at.desc&limit=200`,
        { headers: dbHeaders(SUPABASE_SERVICE_ROLE_KEY) }
      ),
      // Total call volume
      fetch(
        `${SUPABASE_URL}/rest/v1/mcp_call_logs?created_at=gte.${since}&select=user_id,success,source&order=created_at.desc&limit=50000`,
        { headers: dbHeaders(SUPABASE_SERVICE_ROLE_KEY) }
      ),
      // Onboarding template attributed calls
      fetch(
        `${SUPABASE_URL}/rest/v1/mcp_call_logs?created_at=gte.${since}&source=eq.onboarding_template&select=app_id,app_name,user_id,success&order=created_at.desc&limit=5000`,
        { headers: dbHeaders(SUPABASE_SERVICE_ROLE_KEY) }
      ),
    ]);

    // Parse all responses
    const provisionals = provisionalsRes.ok ? await provisionalsRes.json() : [];
    const conversions = conversionsRes.ok ? await conversionsRes.json() : [];
    const templateFetches = templateFetchesRes.ok ? await templateFetchesRes.json() : [];
    const appCalls = topAppsRes.ok ? await topAppsRes.json() : [];
    const searches = topSearchesRes.ok ? await topSearchesRes.json() : [];
    const unmetSearches = unmetDemandRes.ok ? await unmetDemandRes.json() : [];
    const allCalls = totalCallsRes.ok ? await totalCallsRes.json() : [];
    const onboardingCalls = onboardingCallsRes.ok ? await onboardingCallsRes.json() : [];

    // Aggregate top apps
    const appUsage: Record<string, { app_name: string; calls: number; unique_users: Set<string>; successful: number }> = {};
    for (const call of appCalls) {
      if (!call.app_id) continue;
      if (!appUsage[call.app_id]) {
        appUsage[call.app_id] = { app_name: call.app_name || 'unknown', calls: 0, unique_users: new Set(), successful: 0 };
      }
      appUsage[call.app_id].calls++;
      appUsage[call.app_id].unique_users.add(call.user_id);
      if (call.success) appUsage[call.app_id].successful++;
    }

    const topApps = Object.entries(appUsage)
      .map(([app_id, data]) => ({
        app_id,
        app_name: data.app_name,
        calls: data.calls,
        unique_users: data.unique_users.size,
        successful_calls: data.successful,
        success_rate: data.calls > 0 ? Math.round((data.successful / data.calls) * 100) : 0,
      }))
      .sort((a, b) => b.calls - a.calls)
      .slice(0, 20);

    // Aggregate top searches
    const searchCounts: Record<string, { count: number; totalSim: number; totalResults: number }> = {};
    for (const s of searches) {
      if (!searchCounts[s.query]) searchCounts[s.query] = { count: 0, totalSim: 0, totalResults: 0 };
      searchCounts[s.query].count++;
      searchCounts[s.query].totalSim += s.top_similarity || 0;
      searchCounts[s.query].totalResults += s.result_count || 0;
    }
    const topSearches = Object.entries(searchCounts)
      .map(([query, data]) => ({
        query,
        count: data.count,
        avg_similarity: Math.round((data.totalSim / data.count) * 1000) / 1000,
        avg_results: Math.round(data.totalResults / data.count),
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);

    // Aggregate unmet demand
    const unmetCounts: Record<string, { count: number; avgSim: number }> = {};
    for (const s of unmetSearches) {
      if (!unmetCounts[s.query]) unmetCounts[s.query] = { count: 0, avgSim: 0 };
      unmetCounts[s.query].count++;
      unmetCounts[s.query].avgSim += s.top_similarity || 0;
    }
    const unmetDemand = Object.entries(unmetCounts)
      .map(([query, data]) => ({
        query,
        count: data.count,
        avg_similarity: Math.round((data.avgSim / data.count) * 1000) / 1000,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15);

    // Conversion stats
    const conversionsByMethod: Record<string, number> = {};
    let totalTimeToConvert = 0;
    let timeToConvertCount = 0;
    let totalCallsBeforeConvert = 0;
    for (const c of conversions) {
      conversionsByMethod[c.merge_method] = (conversionsByMethod[c.merge_method] || 0) + 1;
      if (c.time_to_convert_minutes != null) {
        totalTimeToConvert += c.time_to_convert_minutes;
        timeToConvertCount++;
      }
      totalCallsBeforeConvert += c.calls_as_provisional || 0;
    }

    // First app distribution from conversions
    const firstAppCounts: Record<string, { name: string; count: number }> = {};
    for (const c of conversions) {
      if (c.first_app_id) {
        if (!firstAppCounts[c.first_app_id]) firstAppCounts[c.first_app_id] = { name: c.first_app_name || 'unknown', count: 0 };
        firstAppCounts[c.first_app_id].count++;
      }
    }
    const firstAppDistribution = Object.entries(firstAppCounts)
      .map(([app_id, data]) => ({ app_id, app_name: data.name, count: data.count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Template fetch → provisional creation rate
    const templateTotal = templateFetches.length;
    const templateToProvisional = templateFetches.filter((f: { provisional_created: boolean }) => f.provisional_created).length;

    // Onboarding template attribution
    const onboardingAppUsage: Record<string, { app_name: string; calls: number; unique_users: Set<string> }> = {};
    for (const call of onboardingCalls) {
      if (!call.app_id) continue;
      if (!onboardingAppUsage[call.app_id]) {
        onboardingAppUsage[call.app_id] = { app_name: call.app_name || 'unknown', calls: 0, unique_users: new Set() };
      }
      onboardingAppUsage[call.app_id].calls++;
      onboardingAppUsage[call.app_id].unique_users.add(call.user_id);
    }
    const onboardingTemplateApps = Object.entries(onboardingAppUsage)
      .map(([app_id, data]) => ({
        app_id,
        app_name: data.app_name,
        calls: data.calls,
        unique_provisional_users: data.unique_users.size,
      }))
      .sort((a, b) => b.calls - a.calls);

    // Overall stats
    const totalCallCount = allCalls.length;
    const uniqueUsers = new Set(allCalls.map((c: { user_id: string }) => c.user_id)).size;
    const failedCalls = allCalls.filter((c: { success: boolean }) => !c.success).length;

    const analytics = {
      period_days: periodDays,
      generated_at: new Date().toISOString(),

      // Onboarding funnel
      template_fetches: templateTotal,
      template_to_provisional_rate: templateTotal > 0 ? Math.round((templateToProvisional / templateTotal) * 1000) / 10 : 0,

      // Provisionals
      provisionals_created: provisionals.length,
      provisionals_active: provisionals.filter((p: { last_active_at: string }) =>
        p.last_active_at && (Date.now() - new Date(p.last_active_at).getTime()) < 24 * 60 * 60 * 1000
      ).length,

      // Conversions
      conversions_total: conversions.length,
      conversions_by_method: conversionsByMethod,
      avg_time_to_convert_minutes: timeToConvertCount > 0 ? Math.round(totalTimeToConvert / timeToConvertCount) : 0,
      avg_calls_before_convert: conversions.length > 0 ? Math.round(totalCallsBeforeConvert / conversions.length) : 0,
      conversion_rate: provisionals.length > 0
        ? Math.round((conversions.length / (provisionals.length + conversions.length)) * 1000) / 10
        : 0,

      // First app attribution
      first_app_distribution: firstAppDistribution,

      // Onboarding template attribution
      onboarding_template_app_usage: onboardingTemplateApps,

      // App usage
      top_apps: topApps,

      // Discovery demand
      top_searches: topSearches,
      unmet_demand: unmetDemand,

      // Overall platform
      total_calls: totalCallCount,
      unique_users: uniqueUsers,
      error_rate_percent: totalCallCount > 0 ? Math.round((failedCalls / totalCallCount) * 1000) / 10 : 0,
    };

    return json({ success: true, analytics });
  } catch (err) {
    console.error('[ADMIN] Analytics failed:', err);
    return error('Analytics query failed', 500);
  }
}

// ============================================
// APP CURATION
// ============================================

async function setAppCategory(request: Request, appId: string): Promise<Response> {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = getEnv();
  try {
    const body = await request.json() as { category: string | null };
    const category = body.category ?? null;

    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/apps?id=eq.${appId}`,
      {
        method: 'PATCH',
        headers: writeHeaders(SUPABASE_SERVICE_ROLE_KEY),
        body: JSON.stringify({ category }),
      }
    );
    if (!res.ok) {
      const text = await res.text();
      return error(`Failed to update category: ${text}`, 500);
    }
    const updated = await res.json();
    return json({ success: true, app_id: appId, category, app: updated[0] || null });
  } catch (err) {
    console.error('[ADMIN] setAppCategory failed:', err);
    return error('Failed to set category', 500);
  }
}

async function setAppFeatured(request: Request, appId: string): Promise<Response> {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = getEnv();
  try {
    const body = await request.json() as { featured: boolean };
    const featured_at = body.featured ? new Date().toISOString() : null;

    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/apps?id=eq.${appId}`,
      {
        method: 'PATCH',
        headers: writeHeaders(SUPABASE_SERVICE_ROLE_KEY),
        body: JSON.stringify({ featured_at }),
      }
    );
    if (!res.ok) {
      const text = await res.text();
      return error(`Failed to update featured status: ${text}`, 500);
    }
    const updated = await res.json();
    return json({ success: true, app_id: appId, featured: !!featured_at, featured_at, app: updated[0] || null });
  } catch (err) {
    console.error('[ADMIN] setAppFeatured failed:', err);
    return error('Failed to set featured status', 500);
  }
}
