// Marketplace Service
// Handles bid/ask, escrow, ownership transfer, and provenance for app trading.
// All financial operations use atomic Supabase RPCs — no double-spend possible.
// All amounts are in Light (✦).

import { getEnv } from '../lib/env.ts';
import { formatLight } from '../../shared/types/index.ts';
import { buildAppTrustCard } from './trust.ts';


// ============================================
// TYPES
// ============================================

export interface BidResult {
  bid_id: string;
  app_id: string;
  amount_light: number;
  message: string;
}

export interface ListingResult {
  listing_id: string;
  app_id: string;
  ask_price_light: number | null;
  floor_price_light: number | null;
  instant_buy: boolean;
}

export interface SaleResult {
  sale_id: string;
  app_id: string;
  seller_id: string;
  buyer_id: string;
  sale_price_light: number;
  platform_fee_light: number;
  seller_payout_light: number;
}

export interface ListingDetails {
  listing: {
    id: string;
    app_id: string;
    owner_id: string;
    ask_price_light: number | null;
    floor_price_light: number | null;
    instant_buy: boolean;
    status: string;
    listing_note: string | null;
    provenance: Array<{ owner_id: string; email: string; acquired_at: string; price_light: number; method: string; d1_database_id?: string }>;
    created_at: string;
  } | null;
  bids: Array<{
    id: string;
    bidder_id: string;
    bidder_email?: string;
    amount_light: number;
    message: string | null;
    status: string;
    created_at: string;
    expires_at: string | null;
  }>;
  app: {
    id: string;
    name: string;
    slug: string;
    owner_id: string;
    total_runs: number;
    runs_30d: number;
    description: string | null;
    trust_card?: unknown;
  } | null;
}

export interface OffersSummary {
  incoming: Array<{
    bid_id: string;
    app_id: string;
    app_name: string;
    bidder_email: string;
    amount_light: number;
    message: string | null;
    created_at: string;
  }>;
  outgoing: Array<{
    bid_id: string;
    app_id: string;
    app_name: string;
    amount_light: number;
    status: string;
    escrow_status: string;
    created_at: string;
  }>;
}

export interface AppMetrics {
  total_calls: number;
  calls_30d: number;
  unique_callers_30d: number;
  revenue_30d_light: number;
  success_rate_30d: number;  // 0.0 to 1.0
}

export interface SaleHistory {
  id: string;
  app_id: string;
  app_name?: string;
  seller_id: string;
  buyer_id: string;
  sale_price_light: number;
  platform_fee_light: number;
  seller_payout_light: number;
  created_at: string;
}

interface AppEligibilityRow {
  owner_id?: string;
  had_external_db: boolean | null;
}

interface ListingRow {
  id: string;
  owner_id: string;
  ask_price_light: number | null;
  floor_price_light: number | null;
  instant_buy: boolean;
  status?: string;
  listing_note?: string | null;
  provenance?: ListingDetails['listing'] extends { provenance: infer P } ? P : never;
  created_at?: string;
}

interface SaleRpcResult {
  sale_id: string;
  app_id: string;
  seller_id: string;
  buyer_id: string;
  sale_price_light: number;
  platform_fee_light: number;
  seller_payout_light: number;
}

interface JoinedBidRow {
  id: string;
  app_id: string;
  bidder_id: string;
  amount_light: number;
  message: string | null;
  status?: string;
  escrow_status?: string;
  created_at: string;
  expires_at?: string | null;
  apps?: unknown;
}

interface OwnedAppRow {
  id: string;
  name: string;
}

interface EmailRow {
  id: string;
  email: string;
}

interface ListingAppRow {
  id: string;
  name: string;
  slug: string;
  owner_id: string;
  total_runs: number;
  runs_30d: number;
  description: string | null;
  visibility?: 'private' | 'unlisted' | 'public';
  current_version?: string | null;
  version_metadata?: unknown;
  download_access?: 'owner' | 'public' | null;
  runtime?: string | null;
  manifest?: unknown;
  env_schema?: Record<string, unknown> | null;
}

function buildListingTrustCard(app: ListingAppRow): unknown {
  return buildAppTrustCard({
    current_version: app.current_version || '',
    runtime: app.runtime || 'deno',
    manifest: typeof app.manifest === 'string'
      ? app.manifest
      : app.manifest ? JSON.stringify(app.manifest) : null,
    version_metadata: Array.isArray(app.version_metadata)
      ? app.version_metadata as never
      : [],
    visibility: app.visibility || 'public',
    download_access: app.download_access || 'owner',
    env_schema: app.env_schema || {},
  } as never);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function extractJoinedName(value: unknown): string | undefined {
  if (isRecord(value) && typeof value.name === 'string') {
    return value.name;
  }
  if (Array.isArray(value)) {
    const first = value[0];
    if (isRecord(first) && typeof first.name === 'string') {
      return first.name;
    }
  }
  return undefined;
}

// ============================================
// HELPERS
// ============================================

function dbHeaders() {
  return {
    'apikey': getEnv('SUPABASE_SERVICE_ROLE_KEY'),
    'Authorization': `Bearer ${getEnv('SUPABASE_SERVICE_ROLE_KEY')}`,
  };
}

function writeHeaders() {
  return {
    ...dbHeaders(),
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
  };
}

function rpcHeaders() {
  return {
    ...dbHeaders(),
    'Content-Type': 'application/json',
  };
}

// ============================================
// PUBLIC API
// ============================================

/**
 * Place a bid on an app. Escrows funds atomically.
 */
export async function placeBid(
  bidderId: string,
  appId: string,
  amountLight: number,
  message?: string,
  expiresInHours?: number
): Promise<BidResult> {
  if (amountLight <= 0) throw createError('Bid amount must be positive', 400);

  // Apps that have ever used an external database are permanently ineligible
  const appCheck = await fetch(
    `${getEnv('SUPABASE_URL')}/rest/v1/apps?id=eq.${appId}&select=had_external_db`,
    { headers: dbHeaders() }
  );
  const appRows = appCheck.ok ? await appCheck.json() as AppEligibilityRow[] : [];
  if (appRows[0]?.had_external_db) {
    throw createError('This app is permanently ineligible for trading because it has used an external database.', 400);
  }

  const expiresAt = expiresInHours
    ? new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString()
    : null;

  const res = await fetch(`${getEnv('SUPABASE_URL')}/rest/v1/rpc/escrow_bid`, {
    method: 'POST',
    headers: rpcHeaders(),
    body: JSON.stringify({
      p_bidder_id: bidderId,
      p_app_id: appId,
      p_amount_light: amountLight,
      p_message: message || null,
      p_expires_at: expiresAt,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error('[MARKETPLACE] escrow_bid RPC failed:', errText);
    if (errText.includes('Insufficient balance')) throw createError('Insufficient balance', 402);
    if (errText.includes('Cannot bid on your own')) throw createError('Cannot bid on your own app', 400);
    if (errText.includes('App not found')) throw createError('App not found', 404);
    if (errText.includes('below floor price')) throw createError('Bid below floor price', 400);
    // Unique constraint violation = already has active bid
    if (errText.includes('idx_bids_one_active') || errText.includes('duplicate') || errText.includes('23505')) {
      throw createError('You already have an active bid on this app. Cancel it first.', 409);
    }
    throw createError('Failed to place bid', 500);
  }

  const bidId = await res.json() as string;

  console.log(`[MARKETPLACE] Bid placed: ${bidId} by ${bidderId} on ${appId} for ${formatLight(amountLight)}`);

  return {
    bid_id: bidId,
    app_id: appId,
    amount_light: amountLight,
    message: `Bid of ${formatLight(amountLight)} placed successfully. Funds are escrowed until accepted, rejected, or cancelled.`,
  };
}

/**
 * Set or update ask price for an app (owner only).
 * Pass priceLight = null to remove ask price (keep open to offers).
 */
export async function setAskPrice(
  ownerId: string,
  appId: string,
  priceLight: number | null,
  floorLight?: number | null,
  instantBuy?: boolean,
  note?: string
): Promise<ListingResult> {
  // Verify ownership + storage eligibility
  const appRes = await fetch(
    `${getEnv('SUPABASE_URL')}/rest/v1/apps?id=eq.${appId}&select=owner_id,had_external_db`,
    { headers: dbHeaders() }
  );
  const apps = appRes.ok ? await appRes.json() as AppEligibilityRow[] : [];
  if (!apps[0] || apps[0].owner_id !== ownerId) {
    throw createError('Only the app owner can set ask price', 403);
  }
  if (apps[0].had_external_db) {
    throw createError('This app is permanently ineligible for trading because it has used an external database.', 400);
  }

  // Upsert listing
  const listingData: Record<string, unknown> = {
    app_id: appId,
    owner_id: ownerId,
    ask_price_light: priceLight,
    floor_price_light: floorLight ?? null,
    instant_buy: instantBuy ?? false,
    listing_note: note ?? null,
    updated_at: new Date().toISOString(),
  };

  const upsertRes = await fetch(
    `${getEnv('SUPABASE_URL')}/rest/v1/app_listings`,
    {
      method: 'POST',
      headers: {
        ...writeHeaders(),
        'Prefer': 'return=representation,resolution=merge-duplicates',
      },
      body: JSON.stringify(listingData),
    }
  );

  if (!upsertRes.ok) {
    const errText = await upsertRes.text();
    console.error('[MARKETPLACE] Listing upsert failed:', errText);
    throw createError('Failed to update listing', 500);
  }

  const rows = await upsertRes.json() as ListingRow[] | ListingRow;
  const listing = Array.isArray(rows) ? rows[0] : rows;

  console.log(`[MARKETPLACE] Ask price set: ${appId} = ${priceLight !== null ? formatLight(priceLight) : 'open'} (instant_buy: ${instantBuy})`);

  return {
    listing_id: listing.id,
    app_id: appId,
    ask_price_light: priceLight,
    floor_price_light: floorLight ?? null,
    instant_buy: instantBuy ?? false,
  };
}

/**
 * Accept a bid (owner only). Triggers atomic ownership transfer.
 */
export async function acceptBid(ownerId: string, bidId: string): Promise<SaleResult> {
  const res = await fetch(`${getEnv('SUPABASE_URL')}/rest/v1/rpc/accept_bid`, {
    method: 'POST',
    headers: rpcHeaders(),
    body: JSON.stringify({
      p_owner_id: ownerId,
      p_bid_id: bidId,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error('[MARKETPLACE] accept_bid RPC failed:', errText);
    if (errText.includes('not active')) throw createError('Bid not found or already resolved', 404);
    if (errText.includes('Only the app owner')) throw createError('Only the app owner can accept bids', 403);
    throw createError('Failed to accept bid', 500);
  }

  const result = await res.json() as SaleRpcResult;

  console.log(`[MARKETPLACE] Sale completed: ${result.sale_id} — ${result.seller_id} → ${result.buyer_id} for ${formatLight(result.sale_price_light)}`);

  // Record source fingerprint for seller-relist detection (fire-and-forget)
  import('./originality.ts').then(({ recordSaleFingerprint }) => {
    recordSaleFingerprint(result.sale_id, result.app_id, result.seller_id, result.buyer_id)
      .catch(err => console.error('[MARKETPLACE] Failed to record sale fingerprint:', err));
  }).catch(err => console.error('[MARKETPLACE] Failed to import originality service:', err));

  return {
    sale_id: result.sale_id,
    app_id: result.app_id,
    seller_id: result.seller_id,
    buyer_id: result.buyer_id,
    sale_price_light: result.sale_price_light,
    platform_fee_light: result.platform_fee_light,
    seller_payout_light: result.seller_payout_light,
  };
}

/**
 * Reject a bid (owner only). Refunds buyer escrow.
 */
export async function rejectBid(ownerId: string, bidId: string): Promise<void> {
  const res = await fetch(`${getEnv('SUPABASE_URL')}/rest/v1/rpc/reject_bid`, {
    method: 'POST',
    headers: rpcHeaders(),
    body: JSON.stringify({
      p_owner_id: ownerId,
      p_bid_id: bidId,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error('[MARKETPLACE] reject_bid RPC failed:', errText);
    if (errText.includes('not active')) throw createError('Bid not found or already resolved', 404);
    if (errText.includes('Only the app owner')) throw createError('Only the app owner can reject bids', 403);
    throw createError('Failed to reject bid', 500);
  }

  console.log(`[MARKETPLACE] Bid rejected: ${bidId} by owner ${ownerId}`);
}

/**
 * Cancel own bid. Refunds escrow.
 */
export async function cancelBid(bidderId: string, bidId: string): Promise<void> {
  const res = await fetch(`${getEnv('SUPABASE_URL')}/rest/v1/rpc/cancel_bid`, {
    method: 'POST',
    headers: rpcHeaders(),
    body: JSON.stringify({
      p_bidder_id: bidderId,
      p_bid_id: bidId,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error('[MARKETPLACE] cancel_bid RPC failed:', errText);
    if (errText.includes('not active')) throw createError('Bid not found or already resolved', 404);
    if (errText.includes('Only the bidder')) throw createError('Only the bidder can cancel their bid', 403);
    throw createError('Failed to cancel bid', 500);
  }

  console.log(`[MARKETPLACE] Bid cancelled: ${bidId} by bidder ${bidderId}`);
}

/**
 * Buy now — for listings with instant_buy enabled.
 * Creates a bid at the ask price and immediately accepts it.
 */
export async function buyNow(buyerId: string, appId: string): Promise<SaleResult> {
  // Get listing
  const listingRes = await fetch(
    `${getEnv('SUPABASE_URL')}/rest/v1/app_listings?app_id=eq.${appId}&select=*`,
    { headers: dbHeaders() }
  );
  const listings = listingRes.ok ? await listingRes.json() as ListingRow[] : [];
  const listing = listings[0];

  if (!listing) throw createError('No listing found for this app', 404);
  if (!listing.instant_buy) throw createError('This listing does not allow instant buy', 400);
  if (!listing.ask_price_light) throw createError('No ask price set', 400);

  // Place bid at ask price
  const bidResult = await placeBid(buyerId, appId, listing.ask_price_light);

  // Immediately accept (as the owner) — if this fails, auto-cancel to refund escrow
  try {
    return await acceptBid(listing.owner_id, bidResult.bid_id);
  } catch (err) {
    // Accept failed — clean up by cancelling the bid to refund escrow
    console.error('[MARKETPLACE] buyNow accept failed, auto-cancelling bid:', err);
    try {
      await cancelBid(buyerId, bidResult.bid_id);
    } catch (cancelErr) {
      console.error('[MARKETPLACE] CRITICAL: buyNow cleanup cancel also failed:', cancelErr);
    }
    throw createError('Purchase failed. Your funds have been refunded.', 500);
  }
}

/**
 * Get offers — incoming bids (as seller) and outgoing bids (as buyer).
 */
export async function getOffers(userId: string, appId?: string): Promise<OffersSummary> {
  // Incoming: bids on user's apps
  let incomingUrl = `${getEnv('SUPABASE_URL')}/rest/v1/app_bids?status=eq.active&select=id,app_id,bidder_id,amount_light,message,created_at,apps!inner(name,owner_id)&apps.owner_id=eq.${userId}&order=amount_light.desc`;
  if (appId) incomingUrl += `&app_id=eq.${appId}`;

  // Outgoing: user's own bids
  let outgoingUrl = `${getEnv('SUPABASE_URL')}/rest/v1/app_bids?bidder_id=eq.${userId}&select=id,app_id,amount_light,status,escrow_status,created_at,apps(name)&order=created_at.desc&limit=50`;

  const [incomingRes, outgoingRes] = await Promise.all([
    fetch(incomingUrl, { headers: dbHeaders() }),
    fetch(outgoingUrl, { headers: dbHeaders() }),
  ]);

  // Parse incoming — may fail if join syntax not supported, fall back to separate queries
  let incoming: OffersSummary['incoming'] = [];
  if (incomingRes.ok) {
    const inData = await incomingRes.json() as JoinedBidRow[];
    incoming = inData.map((b) => ({
      bid_id: b.id,
      app_id: b.app_id,
      app_name: extractJoinedName(b.apps) || 'Unknown',
      bidder_email: '',
      amount_light: b.amount_light,
      message: b.message,
      created_at: b.created_at,
    }));
  } else {
    // Fallback: get user's apps, then get bids on those apps
    const myAppsRes = await fetch(
      `${getEnv('SUPABASE_URL')}/rest/v1/apps?owner_id=eq.${userId}&select=id,name`,
      { headers: dbHeaders() }
    );
    const myApps = myAppsRes.ok ? await myAppsRes.json() as OwnedAppRow[] : [];
    if (myApps.length > 0) {
      const appIds = myApps.map((a) => a.id);
      const appNameMap: Record<string, string> = {};
      myApps.forEach((a) => { appNameMap[a.id] = a.name; });

      const bidsRes = await fetch(
        `${getEnv('SUPABASE_URL')}/rest/v1/app_bids?status=eq.active&app_id=in.(${appIds.join(',')})&select=id,app_id,bidder_id,amount_light,message,created_at&order=amount_light.desc`,
        { headers: dbHeaders() }
      );
      const bidsData = bidsRes.ok ? await bidsRes.json() as JoinedBidRow[] : [];

      // Get bidder emails
      const bidderIds = [...new Set(bidsData.map((b) => b.bidder_id))];
      let emailMap: Record<string, string> = {};
      if (bidderIds.length > 0) {
        const emailRes = await fetch(
          `${getEnv('SUPABASE_URL')}/rest/v1/users?id=in.(${bidderIds.join(',')})&select=id,email`,
          { headers: dbHeaders() }
        );
        const emails = emailRes.ok ? await emailRes.json() as EmailRow[] : [];
        emails.forEach((u) => { emailMap[u.id] = u.email; });
      }

      incoming = bidsData.map((b) => ({
        bid_id: b.id,
        app_id: b.app_id,
        app_name: appNameMap[b.app_id] || 'Unknown',
        bidder_email: emailMap[b.bidder_id] || 'Unknown',
        amount_light: b.amount_light,
        message: b.message,
        created_at: b.created_at,
      }));
    }
  }

  // Parse outgoing
  let outgoing: OffersSummary['outgoing'] = [];
  if (outgoingRes.ok) {
    const outData = await outgoingRes.json() as JoinedBidRow[];
    outgoing = outData.map((b) => ({
      bid_id: b.id,
      app_id: b.app_id,
      app_name: extractJoinedName(b.apps) || 'Unknown',
      amount_light: b.amount_light,
      status: b.status || 'unknown',
      escrow_status: b.escrow_status || 'unknown',
      created_at: b.created_at,
    }));
  }

  return { incoming, outgoing };
}

/**
 * Get sale/provenance history for an app or user.
 */
export async function getHistory(appId?: string, userId?: string): Promise<SaleHistory[]> {
  let url = `${getEnv('SUPABASE_URL')}/rest/v1/app_sales?select=*&order=created_at.desc&limit=50`;
  if (appId) url += `&app_id=eq.${appId}`;
  if (userId) url += `&or=(seller_id.eq.${userId},buyer_id.eq.${userId})`;

  const res = await fetch(url, { headers: dbHeaders() });
  if (!res.ok) return [];

  return await res.json() as SaleHistory[];
}

/**
 * Get listing details + bids for an app.
 */
export async function getListing(appId: string): Promise<ListingDetails> {
  const [listingRes, bidsRes, appRes] = await Promise.all([
    fetch(
      `${getEnv('SUPABASE_URL')}/rest/v1/app_listings?app_id=eq.${appId}&select=*`,
      { headers: dbHeaders() }
    ),
    fetch(
      `${getEnv('SUPABASE_URL')}/rest/v1/app_bids?app_id=eq.${appId}&status=eq.active&select=id,bidder_id,amount_light,message,status,created_at,expires_at&order=amount_light.desc`,
      { headers: dbHeaders() }
    ),
    fetch(
      `${getEnv('SUPABASE_URL')}/rest/v1/apps?id=eq.${appId}&select=id,name,slug,owner_id,total_runs,runs_30d,description,visibility,current_version,version_metadata,download_access,runtime,manifest,env_schema`,
      { headers: dbHeaders() }
    ),
  ]);

  const listings = listingRes.ok ? await listingRes.json() as ListingDetails['listing'][] : [];
  const bids = bidsRes.ok ? await bidsRes.json() as JoinedBidRow[] : [];
  const apps = appRes.ok ? await appRes.json() as ListingAppRow[] : [];

  // Get bidder emails for bid display
  const bidderIds = [...new Set(bids.map((b) => b.bidder_id))];
  let emailMap: Record<string, string> = {};
  if (bidderIds.length > 0) {
    const emailRes = await fetch(
      `${getEnv('SUPABASE_URL')}/rest/v1/users?id=in.(${(bidderIds as string[]).join(',')})&select=id,email`,
      { headers: dbHeaders() }
    );
    const emails = emailRes.ok ? await emailRes.json() as EmailRow[] : [];
    emails.forEach((u) => { emailMap[u.id] = u.email; });
  }

  const enrichedBids: ListingDetails['bids'] = bids.map((b) => ({
    id: b.id,
    bidder_id: b.bidder_id,
    bidder_email: emailMap[b.bidder_id] || undefined,
    amount_light: b.amount_light,
    message: b.message,
    status: b.status || 'unknown',
    created_at: b.created_at,
    expires_at: b.expires_at || null,
  }));

  return {
    listing: listings[0] || null,
    bids: enrichedBids,
    app: apps[0]
      ? {
        ...apps[0],
        trust_card: buildListingTrustCard(apps[0]),
      }
      : null,
  };
}

/**
 * Get aggregate usage metrics for an app from mcp_call_logs.
 * Used for optional metrics exposure on marketplace listings.
 */
export async function getAppMetrics(appId: string): Promise<AppMetrics> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // Parallel queries: total calls, 30d calls with revenue, 30d unique callers
  const [totalRes, recentRes, callersRes] = await Promise.all([
    // Total lifetime calls
    fetch(
      `${getEnv('SUPABASE_URL')}/rest/v1/mcp_call_logs?app_id=eq.${appId}&select=id`,
      { headers: { ...dbHeaders(), 'Prefer': 'count=exact', 'Range-Unit': 'items', 'Range': '0-0' } }
    ),
    // 30d calls + sum revenue + success flag
    fetch(
      `${getEnv('SUPABASE_URL')}/rest/v1/mcp_call_logs?app_id=eq.${appId}&created_at=gte.${thirtyDaysAgo}&select=call_charge_light,success`,
      { headers: dbHeaders() }
    ),
    // 30d unique callers
    fetch(
      `${getEnv('SUPABASE_URL')}/rest/v1/mcp_call_logs?app_id=eq.${appId}&created_at=gte.${thirtyDaysAgo}&select=user_id`,
      { headers: dbHeaders() }
    ),
  ]);

  // Parse total from content-range header (format: "0-0/1234")
  const contentRange = totalRes.headers.get('content-range') || '';
  const totalMatch = contentRange.match(/\/(\d+)/);
  const totalCalls = totalMatch ? parseInt(totalMatch[1], 10) : 0;

  // Parse 30d calls + revenue + success rate
  const recentRows = recentRes.ok ? await recentRes.json() as Array<{ call_charge_light: number | null; success: boolean | null }> : [];
  const calls30d = recentRows.length;
  const revenue30dLight = recentRows.reduce((sum, r) => sum + (r.call_charge_light || 0), 0);
  const successCount = recentRows.filter(r => r.success !== false).length;
  const successRate30d = calls30d > 0 ? Math.round((successCount / calls30d) * 10000) / 10000 : 1.0;

  // Parse unique callers
  const callerRows = callersRes.ok ? await callersRes.json() as Array<{ user_id: string }> : [];
  const uniqueCallers30d = new Set(callerRows.map(r => r.user_id)).size;

  return {
    total_calls: totalCalls,
    calls_30d: calls30d,
    unique_callers_30d: uniqueCallers30d,
    revenue_30d_light: Math.round(revenue30dLight * 100) / 100,
    success_rate_30d: successRate30d,
  };
}

/**
 * Mark an app as permanently ineligible for trading.
 * Called when a Supabase connection is made. Sets had_external_db = true,
 * cancels all active bids (refunding escrow), and removes any listing.
 */
export async function flagExternalDb(appId: string): Promise<void> {
  // 1. Set the permanent flag
  const flagRes = await fetch(
    `${getEnv('SUPABASE_URL')}/rest/v1/apps?id=eq.${appId}`,
    {
      method: 'PATCH',
      headers: writeHeaders(),
      body: JSON.stringify({ had_external_db: true }),
    }
  );
  if (!flagRes.ok) {
    console.error('[MARKETPLACE] Failed to set had_external_db:', await flagRes.text());
  }

  // 2. Cancel all active bids on this app (refunds escrow via RPC)
  const bidsRes = await fetch(
    `${getEnv('SUPABASE_URL')}/rest/v1/app_bids?app_id=eq.${appId}&status=eq.active&select=id,bidder_id`,
    { headers: dbHeaders() }
  );
  if (bidsRes.ok) {
    const bids = await bidsRes.json() as Array<{ id: string; bidder_id: string }>;
    for (const bid of bids) {
      try {
        await fetch(`${getEnv('SUPABASE_URL')}/rest/v1/rpc/cancel_bid`, {
          method: 'POST',
          headers: rpcHeaders(),
          body: JSON.stringify({ p_bidder_id: bid.bidder_id, p_bid_id: bid.id }),
        });
        console.log(`[MARKETPLACE] Auto-cancelled bid ${bid.id} due to external DB flag on app ${appId}`);
      } catch (err) {
        console.error(`[MARKETPLACE] Failed to cancel bid ${bid.id}:`, err);
      }
    }
  }

  // 3. Delist the app (remove listing)
  await fetch(
    `${getEnv('SUPABASE_URL')}/rest/v1/app_listings?app_id=eq.${appId}`,
    {
      method: 'DELETE',
      headers: dbHeaders(),
    }
  );

  console.log(`[MARKETPLACE] App ${appId} permanently flagged had_external_db — bids cancelled, listing removed`);
}

// ============================================
// HELPERS
// ============================================

function createError(message: string, status: number): Error {
  const err = new Error(message);
  (err as Error & { status: number }).status = status;
  return err;
}
