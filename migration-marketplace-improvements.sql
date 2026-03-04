-- Marketplace Improvements Migration
-- STATUS: Pending — run on Supabase
--
-- 1. accept_bid: after sale, reset listing to 'active' (not 'sold') so new owner
--    can immediately receive bids. Also resets ask_price_cents = NULL.
-- 2. escrow_bid: remove the sold-status check (dead code since listings are never 'sold').
-- 3. Add show_metrics column to app_listings for optional metrics exposure.
-- 4. Fix any existing 'sold' listings.

-- ============================================
-- 1. RECREATE accept_bid() — status = 'active' + reset ask_price
-- ============================================
-- After a sale completes, the listing stays active under the new owner.
-- This enables continuous bid flow and price discovery.

DROP FUNCTION IF EXISTS accept_bid(UUID, UUID);

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

  -- 8. Update listing: active status (not 'sold'), new owner, reset ask price
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
      status = 'active',
      ask_price_cents = NULL,
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
-- 2. RECREATE escrow_bid() — remove sold-status check
-- ============================================
-- The sold-status check is now dead code since accept_bid sets 'active'.
-- Clean removal for clarity.

DROP FUNCTION IF EXISTS escrow_bid(UUID, UUID, INT, TEXT, TIMESTAMPTZ);

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
-- 3. ADD show_metrics COLUMN TO app_listings
-- ============================================
-- Owners can toggle this to expose usage metrics (call volume, revenue)
-- on their marketplace listing page for bidder information symmetry.

ALTER TABLE app_listings ADD COLUMN IF NOT EXISTS show_metrics BOOLEAN DEFAULT FALSE;

-- ============================================
-- 4. FIX EXISTING 'sold' LISTINGS
-- ============================================
-- Any listings stuck in 'sold' status from previous sales should be 'active'.

UPDATE app_listings SET status = 'active' WHERE status = 'sold';
