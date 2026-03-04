-- Stripe Connect Withdrawal System
-- Adds Express account support, payouts table, and atomic RPCs for withdrawals.

-- ============================================
-- 1. New columns on users table
-- ============================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_connect_account_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_connect_onboarded BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_connect_payouts_enabled BOOLEAN DEFAULT FALSE;

-- ============================================
-- 2. Payouts table
-- ============================================

CREATE TABLE IF NOT EXISTS payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  amount_cents FLOAT NOT NULL,            -- gross amount deducted from hosting_balance_cents
  stripe_fee_cents FLOAT NOT NULL,        -- estimated Stripe payout fee (0.25% + $0.25)
  net_cents FLOAT NOT NULL,               -- amount minus fee (estimated bank deposit)
  stripe_transfer_id TEXT,                -- Stripe Transfer ID (tr_xxx)
  stripe_payout_id TEXT,                  -- Stripe Payout ID (po_xxx)
  status TEXT DEFAULT 'pending',          -- pending, processing, paid, failed
  failure_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_payouts_user ON payouts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payouts_status ON payouts(status);
CREATE INDEX IF NOT EXISTS idx_payouts_stripe_transfer ON payouts(stripe_transfer_id);
CREATE INDEX IF NOT EXISTS idx_payouts_stripe_payout ON payouts(stripe_payout_id);

-- ============================================
-- 3. Atomic RPC: create_payout_record
-- Debits balance + creates payout record + logs transfer in one transaction.
-- Same pattern as escrow_bid — prevents race conditions.
-- ============================================

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
BEGIN
  -- Lock the user row and check available balance (balance minus escrow)
  SELECT hosting_balance_cents - COALESCE(escrow_held_cents, 0)
  INTO v_available
  FROM users WHERE id = p_user_id FOR UPDATE;

  IF v_available IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  IF v_available < p_amount_cents THEN
    RAISE EXCEPTION 'Insufficient available balance. Available: % cents, requested: %', v_available, p_amount_cents;
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

-- ============================================
-- 4. Atomic RPC: fail_payout_refund
-- Reverses a failed payout by restoring the balance.
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

  IF v_payout.status NOT IN ('pending', 'processing') THEN
    RAISE EXCEPTION 'Payout already finalized with status: %', v_payout.status;
  END IF;

  -- Refund the balance
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
