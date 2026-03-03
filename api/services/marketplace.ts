// Marketplace Service
// Handles bid/ask, escrow, ownership transfer, and provenance for app trading.
// All financial operations use atomic Supabase RPCs — no double-spend possible.

// @ts-ignore - Deno is available
const Deno = globalThis.Deno;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

// ============================================
// TYPES
// ============================================

export interface BidResult {
  bid_id: string;
  app_id: string;
  amount_cents: number;
  message: string;
}

export interface ListingResult {
  listing_id: string;
  app_id: string;
  ask_price_cents: number | null;
  floor_price_cents: number | null;
  instant_buy: boolean;
}

export interface SaleResult {
  sale_id: string;
  app_id: string;
  seller_id: string;
  buyer_id: string;
  sale_price_cents: number;
  platform_fee_cents: number;
  seller_payout_cents: number;
}

export interface ListingDetails {
  listing: {
    id: string;
    app_id: string;
    owner_id: string;
    ask_price_cents: number | null;
    floor_price_cents: number | null;
    instant_buy: boolean;
    status: string;
    listing_note: string | null;
    provenance: Array<{ owner_id: string; email: string; acquired_at: string; price_cents: number; method: string }>;
    created_at: string;
  } | null;
  bids: Array<{
    id: string;
    bidder_id: string;
    bidder_email?: string;
    amount_cents: number;
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
  } | null;
}

export interface OffersSummary {
  incoming: Array<{
    bid_id: string;
    app_id: string;
    app_name: string;
    bidder_email: string;
    amount_cents: number;
    message: string | null;
    created_at: string;
  }>;
  outgoing: Array<{
    bid_id: string;
    app_id: string;
    app_name: string;
    amount_cents: number;
    status: string;
    escrow_status: string;
    created_at: string;
  }>;
}

export interface SaleHistory {
  id: string;
  app_id: string;
  app_name?: string;
  seller_id: string;
  buyer_id: string;
  sale_price_cents: number;
  platform_fee_cents: number;
  seller_payout_cents: number;
  created_at: string;
}

// ============================================
// HELPERS
// ============================================

function dbHeaders() {
  return {
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
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
  amountCents: number,
  message?: string,
  expiresInHours?: number
): Promise<BidResult> {
  if (amountCents <= 0) throw createError('Bid amount must be positive', 400);

  // Check if listing is sold (prevent bidding on transferred apps)
  const soldCheck = await fetch(
    `${SUPABASE_URL}/rest/v1/app_listings?app_id=eq.${appId}&status=eq.sold&select=id`,
    { headers: dbHeaders() }
  );
  const soldRows = soldCheck.ok ? await soldCheck.json() : [];
  if (soldRows.length > 0) {
    throw createError('This app has already been sold', 400);
  }

  const expiresAt = expiresInHours
    ? new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString()
    : null;

  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/escrow_bid`, {
    method: 'POST',
    headers: rpcHeaders(),
    body: JSON.stringify({
      p_bidder_id: bidderId,
      p_app_id: appId,
      p_amount_cents: amountCents,
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

  const bidId = await res.json();

  console.log(`[MARKETPLACE] Bid placed: ${bidId} by ${bidderId} on ${appId} for ${amountCents}c`);

  return {
    bid_id: bidId,
    app_id: appId,
    amount_cents: amountCents,
    message: `Bid of $${(amountCents / 100).toFixed(2)} placed successfully. Funds are escrowed until accepted, rejected, or cancelled.`,
  };
}

/**
 * Set or update ask price for an app (owner only).
 * Pass priceCents = null to remove ask price (keep open to offers).
 */
export async function setAskPrice(
  ownerId: string,
  appId: string,
  priceCents: number | null,
  floorCents?: number | null,
  instantBuy?: boolean,
  note?: string
): Promise<ListingResult> {
  // Verify ownership
  const appRes = await fetch(
    `${SUPABASE_URL}/rest/v1/apps?id=eq.${appId}&select=owner_id`,
    { headers: dbHeaders() }
  );
  const apps = appRes.ok ? await appRes.json() : [];
  if (!apps[0] || apps[0].owner_id !== ownerId) {
    throw createError('Only the app owner can set ask price', 403);
  }

  // Upsert listing
  const listingData: Record<string, unknown> = {
    app_id: appId,
    owner_id: ownerId,
    ask_price_cents: priceCents,
    floor_price_cents: floorCents ?? null,
    instant_buy: instantBuy ?? false,
    listing_note: note ?? null,
    updated_at: new Date().toISOString(),
  };

  const upsertRes = await fetch(
    `${SUPABASE_URL}/rest/v1/app_listings`,
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

  const rows = await upsertRes.json();
  const listing = Array.isArray(rows) ? rows[0] : rows;

  console.log(`[MARKETPLACE] Ask price set: ${appId} = ${priceCents}c (instant_buy: ${instantBuy})`);

  return {
    listing_id: listing.id,
    app_id: appId,
    ask_price_cents: priceCents,
    floor_price_cents: floorCents ?? null,
    instant_buy: instantBuy ?? false,
  };
}

/**
 * Accept a bid (owner only). Triggers atomic ownership transfer.
 */
export async function acceptBid(ownerId: string, bidId: string): Promise<SaleResult> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/accept_bid`, {
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

  const result = await res.json();

  console.log(`[MARKETPLACE] Sale completed: ${result.sale_id} — ${result.seller_id} → ${result.buyer_id} for ${result.sale_price_cents}c`);

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
    sale_price_cents: result.sale_price_cents,
    platform_fee_cents: result.platform_fee_cents,
    seller_payout_cents: result.seller_payout_cents,
  };
}

/**
 * Reject a bid (owner only). Refunds buyer escrow.
 */
export async function rejectBid(ownerId: string, bidId: string): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/reject_bid`, {
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
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/cancel_bid`, {
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
    `${SUPABASE_URL}/rest/v1/app_listings?app_id=eq.${appId}&select=*`,
    { headers: dbHeaders() }
  );
  const listings = listingRes.ok ? await listingRes.json() : [];
  const listing = listings[0];

  if (!listing) throw createError('No listing found for this app', 404);
  if (!listing.instant_buy) throw createError('This listing does not allow instant buy', 400);
  if (!listing.ask_price_cents) throw createError('No ask price set', 400);

  // Place bid at ask price
  const bidResult = await placeBid(buyerId, appId, listing.ask_price_cents);

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
  let incomingUrl = `${SUPABASE_URL}/rest/v1/app_bids?status=eq.active&select=id,app_id,bidder_id,amount_cents,message,created_at,apps!inner(name,owner_id)&apps.owner_id=eq.${userId}&order=amount_cents.desc`;
  if (appId) incomingUrl += `&app_id=eq.${appId}`;

  // Outgoing: user's own bids
  let outgoingUrl = `${SUPABASE_URL}/rest/v1/app_bids?bidder_id=eq.${userId}&select=id,app_id,amount_cents,status,escrow_status,created_at,apps(name)&order=created_at.desc&limit=50`;

  const [incomingRes, outgoingRes] = await Promise.all([
    fetch(incomingUrl, { headers: dbHeaders() }),
    fetch(outgoingUrl, { headers: dbHeaders() }),
  ]);

  // Parse incoming — may fail if join syntax not supported, fall back to separate queries
  let incoming: OffersSummary['incoming'] = [];
  if (incomingRes.ok) {
    const inData = await incomingRes.json();
    incoming = (inData || []).map((b: Record<string, unknown>) => ({
      bid_id: b.id as string,
      app_id: b.app_id as string,
      app_name: (b.apps as Record<string, unknown>)?.name as string || 'Unknown',
      bidder_email: '',
      amount_cents: b.amount_cents as number,
      message: b.message as string | null,
      created_at: b.created_at as string,
    }));
  } else {
    // Fallback: get user's apps, then get bids on those apps
    const myAppsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/apps?owner_id=eq.${userId}&select=id,name`,
      { headers: dbHeaders() }
    );
    const myApps = myAppsRes.ok ? await myAppsRes.json() : [];
    if (myApps.length > 0) {
      const appIds = myApps.map((a: { id: string }) => a.id);
      const appNameMap: Record<string, string> = {};
      myApps.forEach((a: { id: string; name: string }) => { appNameMap[a.id] = a.name; });

      const bidsRes = await fetch(
        `${SUPABASE_URL}/rest/v1/app_bids?status=eq.active&app_id=in.(${appIds.join(',')})&select=id,app_id,bidder_id,amount_cents,message,created_at&order=amount_cents.desc`,
        { headers: dbHeaders() }
      );
      const bidsData = bidsRes.ok ? await bidsRes.json() : [];

      // Get bidder emails
      const bidderIds = [...new Set(bidsData.map((b: { bidder_id: string }) => b.bidder_id))];
      let emailMap: Record<string, string> = {};
      if (bidderIds.length > 0) {
        const emailRes = await fetch(
          `${SUPABASE_URL}/rest/v1/users?id=in.(${bidderIds.join(',')})&select=id,email`,
          { headers: dbHeaders() }
        );
        const emails = emailRes.ok ? await emailRes.json() : [];
        emails.forEach((u: { id: string; email: string }) => { emailMap[u.id] = u.email; });
      }

      incoming = bidsData.map((b: Record<string, unknown>) => ({
        bid_id: b.id as string,
        app_id: b.app_id as string,
        app_name: appNameMap[b.app_id as string] || 'Unknown',
        bidder_email: emailMap[b.bidder_id as string] || 'Unknown',
        amount_cents: b.amount_cents as number,
        message: b.message as string | null,
        created_at: b.created_at as string,
      }));
    }
  }

  // Parse outgoing
  let outgoing: OffersSummary['outgoing'] = [];
  if (outgoingRes.ok) {
    const outData = await outgoingRes.json();
    outgoing = (outData || []).map((b: Record<string, unknown>) => ({
      bid_id: b.id as string,
      app_id: b.app_id as string,
      app_name: (b.apps as Record<string, unknown>)?.name as string || 'Unknown',
      amount_cents: b.amount_cents as number,
      status: b.status as string,
      escrow_status: b.escrow_status as string,
      created_at: b.created_at as string,
    }));
  }

  return { incoming, outgoing };
}

/**
 * Get sale/provenance history for an app or user.
 */
export async function getHistory(appId?: string, userId?: string): Promise<SaleHistory[]> {
  let url = `${SUPABASE_URL}/rest/v1/app_sales?select=*&order=created_at.desc&limit=50`;
  if (appId) url += `&app_id=eq.${appId}`;
  if (userId) url += `&or=(seller_id.eq.${userId},buyer_id.eq.${userId})`;

  const res = await fetch(url, { headers: dbHeaders() });
  if (!res.ok) return [];

  return res.json();
}

/**
 * Get listing details + bids for an app.
 */
export async function getListing(appId: string): Promise<ListingDetails> {
  const [listingRes, bidsRes, appRes] = await Promise.all([
    fetch(
      `${SUPABASE_URL}/rest/v1/app_listings?app_id=eq.${appId}&select=*`,
      { headers: dbHeaders() }
    ),
    fetch(
      `${SUPABASE_URL}/rest/v1/app_bids?app_id=eq.${appId}&status=eq.active&select=id,bidder_id,amount_cents,message,status,created_at,expires_at&order=amount_cents.desc`,
      { headers: dbHeaders() }
    ),
    fetch(
      `${SUPABASE_URL}/rest/v1/apps?id=eq.${appId}&select=id,name,slug,owner_id,total_runs,runs_30d,description`,
      { headers: dbHeaders() }
    ),
  ]);

  const listings = listingRes.ok ? await listingRes.json() : [];
  const bids = bidsRes.ok ? await bidsRes.json() : [];
  const apps = appRes.ok ? await appRes.json() : [];

  // Get bidder emails for bid display
  const bidderIds = [...new Set(bids.map((b: { bidder_id: string }) => b.bidder_id))];
  let emailMap: Record<string, string> = {};
  if (bidderIds.length > 0) {
    const emailRes = await fetch(
      `${SUPABASE_URL}/rest/v1/users?id=in.(${(bidderIds as string[]).join(',')})&select=id,email`,
      { headers: dbHeaders() }
    );
    const emails = emailRes.ok ? await emailRes.json() : [];
    emails.forEach((u: { id: string; email: string }) => { emailMap[u.id] = u.email; });
  }

  const enrichedBids = bids.map((b: Record<string, unknown>) => ({
    ...b,
    bidder_email: emailMap[b.bidder_id as string] || undefined,
  }));

  return {
    listing: listings[0] || null,
    bids: enrichedBids,
    app: apps[0] || null,
  };
}

// ============================================
// HELPERS
// ============================================

function createError(message: string, status: number): Error {
  const err = new Error(message);
  (err as Error & { status: number }).status = status;
  return err;
}
