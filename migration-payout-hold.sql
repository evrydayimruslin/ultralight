-- Migration: 14-Day Payout Hold + 5% Platform Withdrawal Fee
-- STATUS: Pending — run on Supabase before deploying code
--
-- Adds:
--   1. release_at column on payouts (14-day hold timer)
--   2. platform_fee_cents column on payouts (5% platform withdrawal fee)
--   3. Updated create_payout_record() with hold period + platform fee deduction
--   4. Updated fail_payout_refund() to also refund platform fee
--   5. New release_held_payouts() RPC for the payout processor
--
-- Design: Withdrawals are debited immediately but held for 14 days before
-- executing Stripe Transfer + Payout. The 5% platform fee is deducted from
-- the withdrawal amount, so the developer receives 95% minus Stripe fees.
--
-- Flow:
--   Day 0:  Developer requests withdrawal of $100
--           → Balance debited $100 immediately
--           → Payout record created with status='held', release_at=now()+14d
--           → platform_fee_cents = $5.00 (5% of $100)
--           → amount after platform fee = $95.00
--           → Stripe fees estimated on $95.00
--
--   Day 14: Payout processor picks up mature records
--           → Stripe Transfer $95.00 to connected account
--           → Stripe Payout $95.00 to bank (minus Stripe's own fee)

-- ============================================
-- 1. ADD HOLD COLUMNS TO PAYOUTS TABLE
-- ============================================

ALTER TABLE payouts ADD COLUMN IF NOT EXISTS release_at TIMESTAMPTZ;
ALTER TABLE payouts ADD COLUMN IF NOT EXISTS platform_fee_cents FLOAT DEFAULT 0;

-- Index for the payout processor to find mature held payouts efficiently
CREATE INDEX IF NOT EXISTS idx_payouts_release ON payouts(release_at)
  WHERE status = 'held';

-- ============================================
-- 2. UPDATE create_payout_record() — ADD HOLD + PLATFORM FEE
-- ============================================
-- Changes:
--   - Accepts p_platform_fee_cents parameter
--   - Sets status to 'held' instead of 'pending'
--   - Sets release_at to now() + 14 days
--   - Stores platform_fee_cents for audit trail
--   - Retains all existing validations (balance, earnings)

DROP FUNCTION IF EXISTS create_payout_record(UUID, FLOAT, FLOAT, FLOAT);

CREATE OR REPLACE FUNCTION create_payout_record(
  p_user_id UUID,
  p_amount_cents FLOAT,
  p_stripe_fee_cents FLOAT,
  p_net_cents FLOAT,
  p_platform_fee_cents FLOAT DEFAULT 0
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
  WHERE user_id = p_user_id AND status IN ('held', 'pending', 'processing', 'paid');

  v_withdrawable := v_total_earned - v_total_withdrawn;

  IF v_withdrawable < p_amount_cents THEN
    RAISE EXCEPTION 'Withdrawal exceeds earnings. Only earned funds can be withdrawn. Withdrawable: % cents, requested: %', v_withdrawable, p_amount_cents;
  END IF;

  -- Debit the balance (full gross amount including platform fee)
  UPDATE users
  SET hosting_balance_cents = hosting_balance_cents - p_amount_cents
  WHERE id = p_user_id;

  -- Insert payout record with 14-day hold
  INSERT INTO payouts (
    user_id, amount_cents, stripe_fee_cents, net_cents,
    platform_fee_cents, status, release_at
  )
  VALUES (
    p_user_id, p_amount_cents, p_stripe_fee_cents, p_net_cents,
    p_platform_fee_cents, 'held', now() + interval '14 days'
  )
  RETURNING id INTO v_payout_id;

  -- Log the withdrawal transfer for audit trail
  INSERT INTO transfers (id, from_user_id, to_user_id, amount_cents, reason, created_at)
  VALUES (gen_random_uuid(), p_user_id, p_user_id, p_amount_cents, 'withdrawal', now());

  RETURN v_payout_id;
END;
$$;

-- ============================================
-- 3. UPDATE fail_payout_refund() — HANDLE 'held' STATUS
-- ============================================
-- Changes:
--   - Accepts 'held' as a valid status for refund (not just pending/processing)

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

  -- Refund the full balance (including platform fee — developer gets everything back)
  UPDATE users
  SET hosting_balance_cents = hosting_balance_cents + v_payout.amount_cents
  WHERE id = v_payout.user_id;

  -- Mark payout as failed
  UPDATE payouts
  SET status = 'failed',
      failure_reason = p_failure_reason,
      completed_at = now()
  WHERE id = p_payout_id;

  -- Log refund transfer for audit trail
  INSERT INTO transfers (id, from_user_id, to_user_id, amount_cents, reason, created_at)
  VALUES (gen_random_uuid(), v_payout.user_id, v_payout.user_id, v_payout.amount_cents, 'withdrawal_refund', now());
END;
$$;

-- ============================================
-- 4. NEW RPC: release_held_payouts()
-- ============================================
-- Called by the payout processor hourly.
-- Returns all payouts with status='held' whose release_at has passed.
-- Does NOT execute Stripe — just returns the batch for the processor to handle.

CREATE OR REPLACE FUNCTION get_releasable_payouts()
RETURNS TABLE(
  id UUID,
  user_id UUID,
  amount_cents FLOAT,
  stripe_fee_cents FLOAT,
  net_cents FLOAT,
  platform_fee_cents FLOAT,
  created_at TIMESTAMPTZ,
  release_at TIMESTAMPTZ
)
LANGUAGE SQL
SECURITY DEFINER
AS $$
  SELECT id, user_id, amount_cents, stripe_fee_cents, net_cents,
         COALESCE(platform_fee_cents, 0) as platform_fee_cents,
         created_at, release_at
  FROM payouts
  WHERE status = 'held'
    AND release_at <= now()
  ORDER BY release_at ASC
  LIMIT 50;
$$;

-- ============================================
-- 5. MARK PAYOUT AS RELEASING (transition held → pending)
-- ============================================
-- Called per-payout by the processor before executing Stripe transfer.
-- Prevents double-processing by atomically checking and updating status.

CREATE OR REPLACE FUNCTION mark_payout_releasing(p_payout_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_updated INT;
BEGIN
  UPDATE payouts
  SET status = 'pending'
  WHERE id = p_payout_id
    AND status = 'held';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;
