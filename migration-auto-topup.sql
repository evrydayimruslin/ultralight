-- Migration: Auto Top-Up & Atomic Balance Operations
-- STATUS: Pending — run on Supabase after code deploy
--
-- Adds:
--   1. Stripe customer ID for saved payment methods
--   2. Auto top-up configuration columns
--   3. Ensure hosting_balance_cents is FLOAT (supports fractional cent billing)
--   4. Atomic credit_hosting_balance() Postgres function
--   5. Atomic debit_hosting_balance() Postgres function (fixes billing loop race)

-- ============================================
-- 1. STRIPE CUSTOMER & AUTO TOP-UP COLUMNS
-- ============================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS auto_topup_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS auto_topup_threshold_cents INTEGER DEFAULT 100;
ALTER TABLE users ADD COLUMN IF NOT EXISTS auto_topup_amount_cents INTEGER DEFAULT 1000;
ALTER TABLE users ADD COLUMN IF NOT EXISTS auto_topup_last_failed_at TIMESTAMPTZ;

-- Index for billing loop: quickly find users with auto top-up enabled
CREATE INDEX IF NOT EXISTS idx_users_auto_topup
  ON users(id)
  WHERE auto_topup_enabled = true;

-- ============================================
-- 2. ENSURE hosting_balance_cents IS FLOAT
-- ============================================
-- Billing charges fractional cents ($0.025/MB/hr = 0.025 cents for 1MB for 1hr).
-- If an earlier migration created this as INTEGER, ALTER it to FLOAT.
-- Safe: all existing integer values are valid floats.

ALTER TABLE users ALTER COLUMN hosting_balance_cents TYPE FLOAT USING hosting_balance_cents::FLOAT;

-- ============================================
-- 3. ATOMIC BALANCE CREDIT FUNCTION
-- ============================================
-- Replaces the read-modify-write pattern in creditHostingBalance()
-- with a single atomic UPDATE. Returns old and new balance.

CREATE OR REPLACE FUNCTION credit_hosting_balance(p_user_id UUID, p_amount_cents INTEGER)
RETURNS TABLE(old_balance FLOAT, new_balance FLOAT) AS $$
  WITH old AS (
    SELECT hosting_balance_cents FROM users WHERE id = p_user_id
  )
  UPDATE users
  SET hosting_balance_cents = hosting_balance_cents + p_amount_cents
  WHERE id = p_user_id
  RETURNING
    (SELECT hosting_balance_cents FROM old) AS old_balance,
    hosting_balance_cents AS new_balance;
$$ LANGUAGE SQL;

-- ============================================
-- 4. ATOMIC BALANCE DEBIT FUNCTION
-- ============================================
-- Used by the billing loop to atomically deduct hosting charges.
-- Prevents race condition where a concurrent webhook credit gets overwritten.
-- Clamps balance at 0 (never goes negative). Returns old and new balance
-- plus a boolean indicating if the balance hit zero (for suspension logic).

CREATE OR REPLACE FUNCTION debit_hosting_balance(
  p_user_id UUID,
  p_amount FLOAT,
  p_update_billed_at BOOLEAN DEFAULT TRUE
)
RETURNS TABLE(old_balance FLOAT, new_balance FLOAT, was_depleted BOOLEAN) AS $$
  WITH old AS (
    SELECT hosting_balance_cents FROM users WHERE id = p_user_id
  )
  UPDATE users
  SET
    hosting_balance_cents = GREATEST(hosting_balance_cents - p_amount, 0),
    hosting_last_billed_at = CASE WHEN p_update_billed_at THEN NOW() ELSE hosting_last_billed_at END
  WHERE id = p_user_id
  RETURNING
    (SELECT hosting_balance_cents FROM old) AS old_balance,
    hosting_balance_cents AS new_balance,
    (hosting_balance_cents <= 0) AS was_depleted;
$$ LANGUAGE SQL;
