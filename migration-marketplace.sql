-- Migration: App Marketplace — Bid/Ask Ownership Transfer
-- Adds escrow, listings, bids, sales tables and atomic RPCs.
-- Run after migration-pricing.sql (depends on transfers table, transfer_balance RPC).

-- ============================================
-- 1. ESCROW COLUMN ON USERS
-- ============================================
-- Tracks funds locked in active bids. Available balance = hosting_balance_cents - escrow_held_cents.

ALTER TABLE users ADD COLUMN IF NOT EXISTS escrow_held_cents FLOAT DEFAULT 0;

-- ============================================
-- 2. APP LISTINGS TABLE
-- ============================================
-- Lazy-created on first bid or when owner sets an ask price.
-- Every published app can have at most one listing.

CREATE TABLE IF NOT EXISTS app_listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id UUID NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES users(id),
  ask_price_cents INT,                    -- NULL = open to offers only
  floor_price_cents INT,                  -- Minimum bid to accept (NULL = any)
  instant_buy BOOLEAN DEFAULT FALSE,      -- Accept ask_price immediately?
  status TEXT DEFAULT 'active',           -- 'active', 'sold', 'delisted'
  listing_note TEXT,                      -- Seller's optional pitch
  provenance JSONB DEFAULT '[]',          -- [{owner_id, email, acquired_at, price_cents, method}]
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(app_id)
);

CREATE INDEX IF NOT EXISTS idx_listings_status ON app_listings(status, ask_price_cents);
CREATE INDEX IF NOT EXISTS idx_listings_owner ON app_listings(owner_id);

-- ============================================
-- 3. APP BIDS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS app_bids (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id UUID NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  bidder_id UUID NOT NULL REFERENCES users(id),
  amount_cents INT NOT NULL CHECK (amount_cents > 0),
  escrow_status TEXT DEFAULT 'held',      -- 'held', 'released', 'refunded'
  status TEXT DEFAULT 'active',           -- 'active', 'accepted', 'rejected', 'expired', 'cancelled'
  message TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

-- One active bid per user per app
CREATE UNIQUE INDEX IF NOT EXISTS idx_bids_one_active
  ON app_bids(app_id, bidder_id) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_bids_app ON app_bids(app_id, status, amount_cents DESC);
CREATE INDEX IF NOT EXISTS idx_bids_bidder ON app_bids(bidder_id, status);

-- ============================================
-- 4. APP SALES TABLE (immutable audit trail)
-- ============================================

CREATE TABLE IF NOT EXISTS app_sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id UUID NOT NULL REFERENCES apps(id),
  seller_id UUID NOT NULL REFERENCES users(id),
  buyer_id UUID NOT NULL REFERENCES users(id),
  sale_price_cents INT NOT NULL,
  platform_fee_cents INT NOT NULL,        -- 10% of sale_price
  seller_payout_cents INT NOT NULL,       -- 90% of sale_price
  bid_id UUID REFERENCES app_bids(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sales_app ON app_sales(app_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_time ON app_sales(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_seller ON app_sales(seller_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_buyer ON app_sales(buyer_id, created_at DESC);

-- ============================================
-- 5. RPC: escrow_bid
-- ============================================
-- Atomically: check balance → deduct → escrow → insert bid → lazy-create listing.
-- Returns the new bid ID, or raises exception if insufficient funds.

CREATE OR REPLACE FUNCTION escrow_bid(
  p_bidder_id UUID,
  p_app_id UUID,
  p_amount_cents INT,
  p_message TEXT DEFAULT NULL,
  p_expires_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_bid_id UUID;
  v_app_owner UUID;
  v_available FLOAT;
  v_new_slug TEXT;
BEGIN
  -- Get app owner
  SELECT owner_id INTO v_app_owner FROM apps WHERE id = p_app_id;
  IF v_app_owner IS NULL THEN
    RAISE EXCEPTION 'App not found';
  END IF;

  -- Can't bid on own app
  IF v_app_owner = p_bidder_id THEN
    RAISE EXCEPTION 'Cannot bid on your own app';
  END IF;

  -- Check available balance (balance minus already escrowed funds)
  SELECT hosting_balance_cents - escrow_held_cents INTO v_available
  FROM users WHERE id = p_bidder_id FOR UPDATE;

  IF v_available IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  IF v_available < p_amount_cents THEN
    RAISE EXCEPTION 'Insufficient balance. Available: % cents', v_available;
  END IF;

  -- Check if listing is sold
  PERFORM 1 FROM app_listings
  WHERE app_id = p_app_id AND status = 'sold';
  IF FOUND THEN
    RAISE EXCEPTION 'This app has already been sold';
  END IF;

  -- Check floor price if listing exists
  PERFORM 1 FROM app_listings
  WHERE app_id = p_app_id AND floor_price_cents IS NOT NULL AND p_amount_cents < floor_price_cents;
  IF FOUND THEN
    RAISE EXCEPTION 'Bid below floor price';
  END IF;

  -- Deduct balance and increase escrow
  UPDATE users
  SET hosting_balance_cents = hosting_balance_cents - p_amount_cents,
      escrow_held_cents = escrow_held_cents + p_amount_cents
  WHERE id = p_bidder_id;

  -- Insert the bid
  INSERT INTO app_bids (app_id, bidder_id, amount_cents, message, expires_at)
  VALUES (p_app_id, p_bidder_id, p_amount_cents, p_message, p_expires_at)
  RETURNING id INTO v_bid_id;

  -- Lazy-create listing if it doesn't exist
  INSERT INTO app_listings (app_id, owner_id)
  VALUES (p_app_id, v_app_owner)
  ON CONFLICT (app_id) DO NOTHING;

  RETURN v_bid_id;
END;
$$;

-- ============================================
-- 6. RPC: accept_bid
-- ============================================
-- Atomically: release escrow → pay seller 90% → transfer ownership →
-- clear perms/secrets → reject other bids → record sale → update provenance.

CREATE OR REPLACE FUNCTION accept_bid(p_owner_id UUID, p_bid_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_bid RECORD;
  v_app RECORD;
  v_seller_email TEXT;
  v_fee INT;
  v_payout INT;
  v_sale_id UUID;
  v_slug_exists BOOLEAN;
  v_new_slug TEXT;
  v_other_bid RECORD;
  v_provenance JSONB;
BEGIN
  -- Lock and fetch the bid
  SELECT * INTO v_bid FROM app_bids WHERE id = p_bid_id AND status = 'active' FOR UPDATE;
  IF v_bid IS NULL THEN
    RAISE EXCEPTION 'Bid not found or not active';
  END IF;

  -- Fetch the app
  SELECT * INTO v_app FROM apps WHERE id = v_bid.app_id FOR UPDATE;
  IF v_app IS NULL THEN
    RAISE EXCEPTION 'App not found';
  END IF;

  -- Verify caller is the owner
  IF v_app.owner_id != p_owner_id THEN
    RAISE EXCEPTION 'Only the app owner can accept bids';
  END IF;

  -- Get seller email for provenance
  SELECT email INTO v_seller_email FROM users WHERE id = p_owner_id;

  -- Calculate fee (10%) and payout (90%)
  v_fee := CEIL(v_bid.amount_cents * 0.10);
  v_payout := v_bid.amount_cents - v_fee;

  -- 1. Release buyer escrow
  UPDATE users
  SET escrow_held_cents = escrow_held_cents - v_bid.amount_cents
  WHERE id = v_bid.bidder_id;

  -- 2. Credit seller 90%
  UPDATE users
  SET hosting_balance_cents = hosting_balance_cents + v_payout
  WHERE id = p_owner_id;

  -- 3. Transfer ownership — handle slug conflict
  SELECT EXISTS(
    SELECT 1 FROM apps
    WHERE owner_id = v_bid.bidder_id AND slug = v_app.slug AND id != v_app.id
  ) INTO v_slug_exists;

  IF v_slug_exists THEN
    v_new_slug := v_app.slug || '-acquired';
    -- If even -acquired conflicts, append a number
    WHILE EXISTS(SELECT 1 FROM apps WHERE owner_id = v_bid.bidder_id AND slug = v_new_slug AND id != v_app.id) LOOP
      v_new_slug := v_new_slug || '-' || substr(gen_random_uuid()::text, 1, 4);
    END LOOP;
    UPDATE apps SET owner_id = v_bid.bidder_id, slug = v_new_slug, updated_at = now() WHERE id = v_app.id;
  ELSE
    UPDATE apps SET owner_id = v_bid.bidder_id, updated_at = now() WHERE id = v_app.id;
  END IF;

  -- 4. Clear permissions (seller's grants shouldn't carry over)
  DELETE FROM user_app_permissions WHERE app_id = v_app.id;

  -- 5. Clear secrets (seller's env vars shouldn't transfer)
  DELETE FROM user_app_secrets WHERE app_id = v_app.id;

  -- 6. Update the accepted bid
  UPDATE app_bids
  SET status = 'accepted', escrow_status = 'released', resolved_at = now()
  WHERE id = p_bid_id;

  -- 7. Reject + refund all other active bids on this app
  FOR v_other_bid IN
    SELECT * FROM app_bids
    WHERE app_id = v_app.id AND status = 'active' AND id != p_bid_id
    FOR UPDATE
  LOOP
    -- Refund escrow
    UPDATE users
    SET hosting_balance_cents = hosting_balance_cents + v_other_bid.amount_cents,
        escrow_held_cents = escrow_held_cents - v_other_bid.amount_cents
    WHERE id = v_other_bid.bidder_id;

    UPDATE app_bids
    SET status = 'rejected', escrow_status = 'refunded', resolved_at = now()
    WHERE id = v_other_bid.id;
  END LOOP;

  -- 8. Update listing provenance and owner
  SELECT COALESCE(provenance, '[]'::JSONB) INTO v_provenance
  FROM app_listings WHERE app_id = v_app.id;

  v_provenance := v_provenance || jsonb_build_object(
    'owner_id', p_owner_id,
    'email', v_seller_email,
    'acquired_at', now(),
    'price_cents', v_bid.amount_cents,
    'method', 'marketplace_sale'
  );

  UPDATE app_listings
  SET owner_id = v_bid.bidder_id,
      status = 'sold',
      provenance = v_provenance,
      updated_at = now()
  WHERE app_id = v_app.id;

  -- 9. Insert sale record
  INSERT INTO app_sales (app_id, seller_id, buyer_id, sale_price_cents, platform_fee_cents, seller_payout_cents, bid_id)
  VALUES (v_app.id, p_owner_id, v_bid.bidder_id, v_bid.amount_cents, v_fee, v_payout, p_bid_id)
  RETURNING id INTO v_sale_id;

  -- 10. Log transfer
  INSERT INTO transfers (from_user_id, to_user_id, amount_cents, reason, app_id)
  VALUES (v_bid.bidder_id, p_owner_id, v_payout, 'marketplace_sale', v_app.id);

  RETURN jsonb_build_object(
    'sale_id', v_sale_id,
    'app_id', v_app.id,
    'seller_id', p_owner_id,
    'buyer_id', v_bid.bidder_id,
    'sale_price_cents', v_bid.amount_cents,
    'platform_fee_cents', v_fee,
    'seller_payout_cents', v_payout
  );
END;
$$;

-- ============================================
-- 7. RPC: cancel_bid
-- ============================================
-- Refund escrow, mark bid cancelled.

CREATE OR REPLACE FUNCTION cancel_bid(p_bidder_id UUID, p_bid_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_bid RECORD;
BEGIN
  SELECT * INTO v_bid FROM app_bids WHERE id = p_bid_id AND status = 'active' FOR UPDATE;
  IF v_bid IS NULL THEN
    RAISE EXCEPTION 'Bid not found or not active';
  END IF;

  IF v_bid.bidder_id != p_bidder_id THEN
    RAISE EXCEPTION 'Only the bidder can cancel their own bid';
  END IF;

  -- Refund escrow
  UPDATE users
  SET hosting_balance_cents = hosting_balance_cents + v_bid.amount_cents,
      escrow_held_cents = escrow_held_cents - v_bid.amount_cents
  WHERE id = p_bidder_id;

  -- Mark cancelled
  UPDATE app_bids
  SET status = 'cancelled', escrow_status = 'refunded', resolved_at = now()
  WHERE id = p_bid_id;
END;
$$;

-- ============================================
-- 8. RPC: reject_bid
-- ============================================
-- Owner rejects a bid — refunds buyer escrow.

CREATE OR REPLACE FUNCTION reject_bid(p_owner_id UUID, p_bid_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_bid RECORD;
  v_app_owner UUID;
BEGIN
  SELECT * INTO v_bid FROM app_bids WHERE id = p_bid_id AND status = 'active' FOR UPDATE;
  IF v_bid IS NULL THEN
    RAISE EXCEPTION 'Bid not found or not active';
  END IF;

  -- Verify owner
  SELECT owner_id INTO v_app_owner FROM apps WHERE id = v_bid.app_id;
  IF v_app_owner != p_owner_id THEN
    RAISE EXCEPTION 'Only the app owner can reject bids';
  END IF;

  -- Refund escrow to bidder
  UPDATE users
  SET hosting_balance_cents = hosting_balance_cents + v_bid.amount_cents,
      escrow_held_cents = escrow_held_cents - v_bid.amount_cents
  WHERE id = v_bid.bidder_id;

  -- Mark rejected
  UPDATE app_bids
  SET status = 'rejected', escrow_status = 'refunded', resolved_at = now()
  WHERE id = p_bid_id;
END;
$$;

-- ============================================
-- 9. RPC: expire_old_bids
-- ============================================
-- Cleanup: expire bids past their expires_at, refund escrow.

CREATE OR REPLACE FUNCTION expire_old_bids()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_expired RECORD;
  v_count INT := 0;
BEGIN
  FOR v_expired IN
    SELECT * FROM app_bids
    WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at < now()
    FOR UPDATE
  LOOP
    -- Refund escrow
    UPDATE users
    SET hosting_balance_cents = hosting_balance_cents + v_expired.amount_cents,
        escrow_held_cents = escrow_held_cents - v_expired.amount_cents
    WHERE id = v_expired.bidder_id;

    UPDATE app_bids
    SET status = 'expired', escrow_status = 'refunded', resolved_at = now()
    WHERE id = v_expired.id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;
