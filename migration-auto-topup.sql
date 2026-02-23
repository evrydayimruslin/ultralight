-- Migration: Auto Top-Up & Atomic Balance Credit
-- STATUS: Pending — run on Supabase after code deploy
--
-- Adds:
--   1. Stripe customer ID for saved payment methods
--   2. Auto top-up configuration columns
--   3. Postgres function for atomic balance credit (fixes race condition)

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
-- 2. ATOMIC BALANCE CREDIT FUNCTION
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
