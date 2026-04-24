-- Migration: Per-Function Pricing & Balance Transfer
-- STATUS: Pending — run on Supabase before deploying code
--
-- Adds:
--   1. pricing_config JSONB on apps (per-function pricing)
--   2. price_cents INTEGER on content (per-page pricing)
--   3. Atomic transfer_balance() Postgres function (internal ledger transfers)
--   4. transfers log table for audit trail

-- ============================================
-- 1. APP PRICING CONFIG
-- ============================================
-- Structure: { "default_price_cents": 0, "functions": { "fnName": 5, "fnName2": 10 } }
-- default_price_cents applies to any function not listed explicitly.
-- 0 = free. null = free (backward compat).

ALTER TABLE apps ADD COLUMN IF NOT EXISTS pricing_config JSONB;

-- ============================================
-- 2. PAGE PRICING
-- ============================================
-- Simple integer: cents per page view. 0 or null = free.

ALTER TABLE content ADD COLUMN IF NOT EXISTS price_cents INTEGER DEFAULT 0;

-- ============================================
-- 3. ATOMIC BALANCE TRANSFER FUNCTION
-- ============================================
-- Moves cents from one user to another in a single atomic transaction.
-- Returns NULL (empty result set) if the sender has insufficient balance.
-- This prevents negative balances and ensures both sides update together.

CREATE OR REPLACE FUNCTION transfer_balance(
  p_from_user UUID,
  p_to_user UUID,
  p_amount_cents INTEGER
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
    SET hosting_balance_cents = hosting_balance_cents + p_amount_cents
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
-- 4. TRANSFERS LOG TABLE
-- ============================================
-- Audit trail for all internal balance transfers.

CREATE TABLE IF NOT EXISTS transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user_id UUID NOT NULL REFERENCES users(id),
  to_user_id UUID NOT NULL REFERENCES users(id),
  amount_cents INTEGER NOT NULL,
  reason TEXT NOT NULL,              -- 'tool_call', 'page_view', 'manual'
  app_id UUID REFERENCES apps(id),
  function_name TEXT,                -- which function was called (for tool_call)
  content_id UUID,                   -- which page was viewed (for page_view)
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transfers_from_user ON transfers(from_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transfers_to_user ON transfers(to_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transfers_app ON transfers(app_id, created_at DESC);

-- ============================================
-- 5. CALL LOG: ADD CHARGE TRACKING COLUMN
-- ============================================

ALTER TABLE mcp_call_logs ADD COLUMN IF NOT EXISTS call_charge_cents FLOAT;
