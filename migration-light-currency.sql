-- Migration: Light Virtual Currency
-- STATUS: Pending — run on Supabase before deploying code
--
-- Converts the entire billing system from USD cents to Light (✦).
-- Exchange rates:
--   Web purchase:     720 Light per $1 USD
--   Desktop purchase: 800 Light per $1 USD
--   Publisher payout: $1 USD per 800 Light
-- Platform fee: 10% on every transfer (replaces withdrawal-only fee)
-- Hosting rate: ✦18/MB/hr (was $0.025/MB/hr)
-- Light is divisible to 8 decimal places.
--
-- Migration converts existing balances at 800:1 (cents → Light = cents * 8).

-- ============================================
-- 1. USER BALANCE COLUMNS
-- ============================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS balance_light FLOAT DEFAULT 0;
UPDATE users SET balance_light = COALESCE(hosting_balance_cents, 0) * 8;

ALTER TABLE users ADD COLUMN IF NOT EXISTS escrow_light FLOAT DEFAULT 0;
UPDATE users SET escrow_light = COALESCE(escrow_held_cents, 0) * 8;

ALTER TABLE users ADD COLUMN IF NOT EXISTS total_earned_light FLOAT DEFAULT 0;
UPDATE users SET total_earned_light = COALESCE(total_earned_cents, 0) * 8;

ALTER TABLE users ADD COLUMN IF NOT EXISTS auto_topup_threshold_light INTEGER DEFAULT 800;
ALTER TABLE users ADD COLUMN IF NOT EXISTS auto_topup_amount_light INTEGER DEFAULT 8000;

-- ============================================
-- 2. BILLING_TRANSACTIONS COLUMNS
-- ============================================

ALTER TABLE billing_transactions ADD COLUMN IF NOT EXISTS amount_light FLOAT;
UPDATE billing_transactions SET amount_light = COALESCE(amount_cents, 0) * 8;

ALTER TABLE billing_transactions ADD COLUMN IF NOT EXISTS balance_after_light FLOAT;
UPDATE billing_transactions SET balance_after_light = COALESCE(balance_after, 0) * 8;

-- ============================================
-- 3. TRANSFERS COLUMNS
-- ============================================

ALTER TABLE transfers ADD COLUMN IF NOT EXISTS amount_light FLOAT;
UPDATE transfers SET amount_light = COALESCE(amount_cents, 0) * 8;

-- ============================================
-- 4. PAYOUTS COLUMNS
-- ============================================

ALTER TABLE payouts ADD COLUMN IF NOT EXISTS amount_light FLOAT;
UPDATE payouts SET amount_light = COALESCE(amount_cents, 0) * 8;

ALTER TABLE payouts ADD COLUMN IF NOT EXISTS platform_fee_light FLOAT DEFAULT 0;
UPDATE payouts SET platform_fee_light = COALESCE(platform_fee_cents, 0) * 8;

-- ============================================
-- 5. CONTENT COLUMNS
-- ============================================

ALTER TABLE content ADD COLUMN IF NOT EXISTS price_light FLOAT DEFAULT 0;
UPDATE content SET price_light = COALESCE(price_cents, 0) * 8;

-- ============================================
-- 6. MCP CALL LOGS COLUMNS
-- ============================================

ALTER TABLE mcp_call_logs ADD COLUMN IF NOT EXISTS call_charge_light FLOAT;
UPDATE mcp_call_logs SET call_charge_light = COALESCE(call_charge_cents, 0) * 8;

-- ============================================
-- 7. APP BIDS COLUMNS
-- ============================================

ALTER TABLE app_bids ADD COLUMN IF NOT EXISTS amount_light FLOAT;
UPDATE app_bids SET amount_light = COALESCE(amount_cents, 0) * 8;

-- ============================================
-- 8. APP SALES COLUMNS
-- ============================================

ALTER TABLE app_sales ADD COLUMN IF NOT EXISTS sale_price_light FLOAT;
UPDATE app_sales SET sale_price_light = COALESCE(sale_price_cents, 0) * 8;

ALTER TABLE app_sales ADD COLUMN IF NOT EXISTS platform_fee_light FLOAT;
UPDATE app_sales SET platform_fee_light = COALESCE(platform_fee_cents, 0) * 8;

ALTER TABLE app_sales ADD COLUMN IF NOT EXISTS seller_payout_light FLOAT;
UPDATE app_sales SET seller_payout_light = COALESCE(seller_payout_cents, 0) * 8;

-- ============================================
-- 9. REWRITE transfer_balance() — 10% PLATFORM FEE
-- ============================================
-- Sender pays listed price. Recipient gets 90%. 10% burned (platform revenue).
-- Returns from_new_balance, to_new_balance, and platform_fee for audit logging.

DROP FUNCTION IF EXISTS transfer_balance(UUID, UUID, FLOAT);
DROP FUNCTION IF EXISTS transfer_balance(UUID, UUID, INTEGER);

CREATE OR REPLACE FUNCTION transfer_balance(
  p_from_user UUID,
  p_to_user UUID,
  p_amount_light FLOAT
)
RETURNS TABLE(from_new_balance FLOAT, to_new_balance FLOAT, platform_fee FLOAT) AS $$
  WITH
  fee AS (SELECT p_amount_light * 0.10 AS val),
  net AS (SELECT p_amount_light - (SELECT val FROM fee) AS val),
  debit AS (
    UPDATE users
    SET balance_light = balance_light - p_amount_light
    WHERE id = p_from_user
      AND balance_light >= p_amount_light
    RETURNING balance_light
  ),
  credit AS (
    UPDATE users
    SET balance_light = balance_light + (SELECT val FROM net),
        total_earned_light = total_earned_light + (SELECT val FROM net)
    WHERE id = p_to_user
      AND EXISTS (SELECT 1 FROM debit)
    RETURNING balance_light
  )
  SELECT
    d.balance_light AS from_new_balance,
    c.balance_light AS to_new_balance,
    (SELECT val FROM fee) AS platform_fee
  FROM debit d, credit c;
$$ LANGUAGE SQL;

-- ============================================
-- 10. REWRITE credit_hosting_balance() → credit_balance()
-- ============================================

DROP FUNCTION IF EXISTS credit_hosting_balance(UUID, INTEGER);
DROP FUNCTION IF EXISTS credit_hosting_balance(UUID, FLOAT);

CREATE OR REPLACE FUNCTION credit_balance(p_user_id UUID, p_amount_light FLOAT)
RETURNS TABLE(old_balance FLOAT, new_balance FLOAT) AS $$
  WITH old AS (
    SELECT balance_light FROM users WHERE id = p_user_id
  )
  UPDATE users
  SET balance_light = balance_light + p_amount_light
  WHERE id = p_user_id
  RETURNING
    (SELECT balance_light FROM old) AS old_balance,
    balance_light AS new_balance;
$$ LANGUAGE SQL;

-- ============================================
-- 11. REWRITE debit_hosting_balance() → debit_balance()
-- ============================================

DROP FUNCTION IF EXISTS debit_hosting_balance(UUID, FLOAT, BOOLEAN);

CREATE OR REPLACE FUNCTION debit_balance(
  p_user_id UUID,
  p_amount FLOAT,
  p_update_billed_at BOOLEAN DEFAULT TRUE
)
RETURNS TABLE(old_balance FLOAT, new_balance FLOAT, was_depleted BOOLEAN) AS $$
  WITH old AS (
    SELECT balance_light FROM users WHERE id = p_user_id
  )
  UPDATE users
  SET
    balance_light = GREATEST(balance_light - p_amount, 0),
    hosting_last_billed_at = CASE WHEN p_update_billed_at THEN NOW() ELSE hosting_last_billed_at END
  WHERE id = p_user_id
  RETURNING
    (SELECT balance_light FROM old) AS old_balance,
    balance_light AS new_balance,
    (balance_light <= 0) AS was_depleted;
$$ LANGUAGE SQL;

-- ============================================
-- 12. REWRITE accept_bid() — USE LIGHT COLUMNS
-- ============================================

CREATE OR REPLACE FUNCTION accept_bid(p_owner_id UUID, p_bid_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_bid RECORD;
  v_app RECORD;
  v_seller_email TEXT;
  v_fee FLOAT;
  v_payout FLOAT;
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
  v_fee := v_bid.amount_light * 0.10;
  v_payout := v_bid.amount_light - v_fee;

  -- 1. Release buyer escrow
  UPDATE users
  SET escrow_light = escrow_light - v_bid.amount_light
  WHERE id = v_bid.bidder_id;

  -- 2. Credit seller 90% + track earnings
  UPDATE users
  SET balance_light = balance_light + v_payout,
      total_earned_light = total_earned_light + v_payout
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
    SET balance_light = balance_light + v_other_bid.amount_light,
        escrow_light = escrow_light - v_other_bid.amount_light
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
    'price_light', v_bid.amount_light,
    'method', 'marketplace_sale'
  );

  UPDATE app_listings
  SET owner_id = v_bid.bidder_id,
      status = 'sold',
      provenance = v_provenance,
      updated_at = now()
  WHERE app_id = v_app.id;

  -- 9. Insert sale record
  INSERT INTO app_sales (app_id, seller_id, buyer_id, sale_price_light, platform_fee_light, seller_payout_light, bid_id)
  VALUES (v_app.id, p_owner_id, v_bid.bidder_id, v_bid.amount_light, v_fee, v_payout, p_bid_id)
  RETURNING id INTO v_sale_id;

  -- 10. Log transfer
  INSERT INTO transfers (from_user_id, to_user_id, amount_light, reason, app_id)
  VALUES (v_bid.bidder_id, p_owner_id, v_payout, 'marketplace_sale', v_app.id);

  RETURN jsonb_build_object(
    'sale_id', v_sale_id,
    'app_id', v_app.id,
    'seller_id', p_owner_id,
    'buyer_id', v_bid.bidder_id,
    'sale_price_light', v_bid.amount_light,
    'platform_fee_light', v_fee,
    'seller_payout_light', v_payout
  );
END;
$$;

-- ============================================
-- 13. REWRITE create_payout_record() — NO WITHDRAWAL FEE
-- ============================================
-- The 10% platform fee is now on every transfer, not on withdrawal.
-- Withdrawal is a straight conversion: amount_light / 800 = USD.

DROP FUNCTION IF EXISTS create_payout_record(UUID, FLOAT, FLOAT, FLOAT, FLOAT);
DROP FUNCTION IF EXISTS create_payout_record(UUID, FLOAT, FLOAT, FLOAT);

CREATE OR REPLACE FUNCTION create_payout_record(
  p_user_id UUID,
  p_amount_light FLOAT,
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
  SELECT balance_light - COALESCE(escrow_light, 0),
         COALESCE(total_earned_light, 0)
  INTO v_available, v_total_earned
  FROM users WHERE id = p_user_id FOR UPDATE;

  IF v_available IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  IF v_available < p_amount_light THEN
    RAISE EXCEPTION 'Insufficient available balance. Available: % Light, requested: %', v_available, p_amount_light;
  END IF;

  -- Check earnings-only withdrawal constraint
  SELECT COALESCE(SUM(amount_light), 0) INTO v_total_withdrawn
  FROM payouts
  WHERE user_id = p_user_id AND status IN ('held', 'pending', 'processing', 'paid');

  v_withdrawable := v_total_earned - v_total_withdrawn;

  IF v_withdrawable < p_amount_light THEN
    RAISE EXCEPTION 'Withdrawal exceeds earnings. Only earned funds can be withdrawn. Withdrawable: % Light, requested: %', v_withdrawable, p_amount_light;
  END IF;

  -- Debit the balance (no platform fee on withdrawal — fee is per-transaction)
  UPDATE users
  SET balance_light = balance_light - p_amount_light
  WHERE id = p_user_id;

  -- Insert payout record with 14-day hold
  INSERT INTO payouts (
    user_id, amount_light, stripe_fee_cents, net_cents,
    platform_fee_light, status, release_at
  )
  VALUES (
    p_user_id, p_amount_light, p_stripe_fee_cents, p_net_cents,
    0, 'held', now() + interval '14 days'
  )
  RETURNING id INTO v_payout_id;

  -- Log the withdrawal transfer for audit trail
  INSERT INTO transfers (id, from_user_id, to_user_id, amount_light, reason, created_at)
  VALUES (gen_random_uuid(), p_user_id, p_user_id, p_amount_light, 'withdrawal', now());

  RETURN v_payout_id;
END;
$$;

-- ============================================
-- 14. REWRITE fail_payout_refund() — USE LIGHT
-- ============================================

CREATE OR REPLACE FUNCTION fail_payout_refund(
  p_payout_id UUID,
  p_failure_reason TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_payout RECORD;
BEGIN
  -- Lock the payout row
  SELECT * INTO v_payout FROM payouts WHERE id = p_payout_id FOR UPDATE;

  IF v_payout IS NULL THEN
    RAISE EXCEPTION 'Payout not found';
  END IF;

  IF v_payout.status NOT IN ('held', 'pending', 'processing') THEN
    RAISE EXCEPTION 'Payout already finalized with status: %', v_payout.status;
  END IF;

  -- Refund the full balance
  UPDATE users
  SET balance_light = balance_light + v_payout.amount_light
  WHERE id = v_payout.user_id;

  -- Mark payout as failed
  UPDATE payouts
  SET status = 'failed',
      failure_reason = p_failure_reason,
      completed_at = now()
  WHERE id = p_payout_id;

  -- Log refund transfer for audit trail
  INSERT INTO transfers (id, from_user_id, to_user_id, amount_light, reason, created_at)
  VALUES (gen_random_uuid(), v_payout.user_id, v_payout.user_id, v_payout.amount_light, 'withdrawal_refund', now());
END;
$$;

-- ============================================
-- 15. REWRITE get_releasable_payouts() — USE LIGHT
-- ============================================

DROP FUNCTION IF EXISTS get_releasable_payouts();

CREATE OR REPLACE FUNCTION get_releasable_payouts()
RETURNS TABLE(
  id UUID,
  user_id UUID,
  amount_light FLOAT,
  stripe_fee_cents FLOAT,
  net_cents FLOAT,
  platform_fee_light FLOAT,
  created_at TIMESTAMPTZ,
  release_at TIMESTAMPTZ
)
LANGUAGE SQL
SECURITY DEFINER
AS $$
  SELECT id, user_id, amount_light, stripe_fee_cents, net_cents,
         COALESCE(platform_fee_light, 0) as platform_fee_light,
         created_at, release_at
  FROM payouts
  WHERE status = 'held'
    AND release_at <= now()
  ORDER BY release_at ASC
  LIMIT 50;
$$;

-- mark_payout_releasing stays the same (status transition only)
