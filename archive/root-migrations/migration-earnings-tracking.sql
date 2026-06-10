-- Migration: Earnings Tracking & Withdrawal Guardrails
-- STATUS: Pending — run on Supabase before deploying code
--
-- Adds:
--   1. total_earned_cents column on users (denormalized earnings accumulator)
--   2. Backfill from historical transfers
--   3. Updated transfer_balance() that atomically increments total_earned_cents
--   4. Updated accept_bid() that increments total_earned_cents on seller
--   5. Updated create_payout_record() with earnings-only withdrawal validation
--
-- Design: Only earnings (tool_call, page_view, marketplace_sale) are withdrawable.
-- Deposits credit hosting_balance_cents but NOT total_earned_cents.
-- Withdrawable = total_earned_cents - SUM(successful payouts).

-- ============================================
-- 1. ADD EARNINGS TRACKING COLUMN
-- ============================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS total_earned_cents FLOAT DEFAULT 0;

-- ============================================
-- 2. BACKFILL FROM HISTORICAL TRANSFERS
-- ============================================
-- Sum all earning-type transfers received by each user.

UPDATE users u SET total_earned_cents = COALESCE((
  SELECT SUM(t.amount_cents) FROM transfers t
  WHERE t.to_user_id = u.id
  AND t.reason IN ('tool_call', 'page_view', 'marketplace_sale')
), 0);

-- ============================================
-- 3. UPDATE transfer_balance() — TRACK EARNINGS
-- ============================================
-- Only change: credit CTE also increments total_earned_cents.
-- This covers tool_call and page_view earnings (the only callers of this RPC).

DROP FUNCTION IF EXISTS transfer_balance(UUID, UUID, FLOAT);

CREATE OR REPLACE FUNCTION transfer_balance(
  p_from_user UUID,
  p_to_user UUID,
  p_amount_cents FLOAT
)
RETURNS TABLE(from_new_balance FLOAT, to_new_balance FLOAT) AS $$
  WITH debit AS (
    UPDATE users
    SET hosting_balance_cents = hosting_balance_cents - p_amount_cents
    WHERE id = p_from_user
      AND hosting_balance_cents >= p_amount_cents
    RETURNING hosting_balance_cents
  ),
  credit AS (
    UPDATE users
    SET hosting_balance_cents = hosting_balance_cents + p_amount_cents,
        total_earned_cents = total_earned_cents + p_amount_cents
    WHERE id = p_to_user
      AND EXISTS (SELECT 1 FROM debit)
    RETURNING hosting_balance_cents
  )
  SELECT
    d.hosting_balance_cents AS from_new_balance,
    c.hosting_balance_cents AS to_new_balance
  FROM debit d, credit c;
$$ LANGUAGE SQL;

-- ============================================
-- 4. UPDATE accept_bid() — TRACK MARKETPLACE EARNINGS
-- ============================================
-- Only change: seller credit step also increments total_earned_cents.
-- Everything else in the function remains identical.

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

  -- 2. Credit seller 90% + track earnings
  UPDATE users
  SET hosting_balance_cents = hosting_balance_cents + v_payout,
      total_earned_cents = total_earned_cents + v_payout
  WHERE id = p_owner_id;

  -- 3. Transfer ownership — handle slug conflict
  SELECT EXISTS(
    SELECT 1 FROM apps
    WHERE owner_id = v_bid.bidder_id AND slug = v_app.slug AND id != v_app.id
  ) INTO v_slug_exists;

  IF v_slug_exists THEN
    v_new_slug := v_app.slug || '-acquired';
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
-- 5. UPDATE create_payout_record() — EARNINGS-ONLY VALIDATION
-- ============================================
-- Only change: validates that withdrawal amount <= withdrawable earnings.
-- Withdrawable = total_earned_cents - SUM(non-failed payouts).

CREATE OR REPLACE FUNCTION create_payout_record(
  p_user_id UUID,
  p_amount_cents FLOAT,
  p_stripe_fee_cents FLOAT,
  p_net_cents FLOAT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_payout_id UUID;
  v_available FLOAT;
  v_total_earned FLOAT;
  v_total_withdrawn FLOAT;
  v_withdrawable FLOAT;
BEGIN
  -- Lock the user row and check available balance (balance minus escrow)
  SELECT hosting_balance_cents - COALESCE(escrow_held_cents, 0),
         COALESCE(total_earned_cents, 0)
  INTO v_available, v_total_earned
  FROM users WHERE id = p_user_id FOR UPDATE;

  IF v_available IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  IF v_available < p_amount_cents THEN
    RAISE EXCEPTION 'Insufficient available balance. Available: % cents, requested: %', v_available, p_amount_cents;
  END IF;

  -- Check earnings-only withdrawal constraint
  SELECT COALESCE(SUM(amount_cents), 0) INTO v_total_withdrawn
  FROM payouts
  WHERE user_id = p_user_id AND status IN ('pending', 'processing', 'paid');

  v_withdrawable := v_total_earned - v_total_withdrawn;

  IF v_withdrawable < p_amount_cents THEN
    RAISE EXCEPTION 'Withdrawal exceeds earnings. Only earned funds can be withdrawn. Withdrawable: % cents, requested: %', v_withdrawable, p_amount_cents;
  END IF;

  -- Debit the balance
  UPDATE users
  SET hosting_balance_cents = hosting_balance_cents - p_amount_cents
  WHERE id = p_user_id;

  -- Insert payout record
  INSERT INTO payouts (user_id, amount_cents, stripe_fee_cents, net_cents, status)
  VALUES (p_user_id, p_amount_cents, p_stripe_fee_cents, p_net_cents, 'pending')
  RETURNING id INTO v_payout_id;

  -- Log the withdrawal transfer for audit trail
  INSERT INTO transfers (id, from_user_id, to_user_id, amount_cents, reason, created_at)
  VALUES (gen_random_uuid(), p_user_id, p_user_id, p_amount_cents, 'withdrawal', now());

  RETURN v_payout_id;
END;
$$;
