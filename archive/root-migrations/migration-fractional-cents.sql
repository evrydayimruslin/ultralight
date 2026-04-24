-- Migration: Fractional Cent Support for Per-Call Pricing
-- STATUS: Pending — run on Supabase
--
-- Fixes the type mismatch where pricing_config stores fractional cents (e.g. 0.5)
-- but transfer_balance() and transfers table only accept INTEGER.
-- hosting_balance_cents is already FLOAT (migrated in migration-auto-topup.sql).
--
-- This enables developers to set per-function prices like $0.005 (0.5 cents).
-- Marketplace bid/ask/sale columns remain INT — ownership trades in whole cents.

-- ============================================
-- 1. ALTER transfers.amount_cents TO FLOAT
-- ============================================
-- Safe: all existing integer values are valid floats.

ALTER TABLE transfers ALTER COLUMN amount_cents TYPE FLOAT USING amount_cents::FLOAT;

-- ============================================
-- 2. REPLACE transfer_balance() WITH FLOAT PARAMETER
-- ============================================
-- The only change is p_amount_cents INTEGER → FLOAT.
-- This allows fractional cent transfers for per-call billing ($0.005/call = 0.5 cents).

-- First drop the old INTEGER-parameter version
DROP FUNCTION IF EXISTS transfer_balance(UUID, UUID, INTEGER);

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
-- 3. REPLACE credit_hosting_balance() WITH FLOAT PARAMETER
-- ============================================
-- Used by Stripe webhook and manual credits. Accepting FLOAT ensures
-- consistency across the entire balance pipeline.

DROP FUNCTION IF EXISTS credit_hosting_balance(UUID, INTEGER);

CREATE OR REPLACE FUNCTION credit_hosting_balance(p_user_id UUID, p_amount_cents FLOAT)
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
-- NOTE: debit_hosting_balance() already uses FLOAT parameter.
-- NOTE: Marketplace escrow RPCs (escrow_bid, accept_bid, etc.) remain INT.
--       Ownership trades in whole cents — fractional cents are for per-call billing only.
-- ============================================
