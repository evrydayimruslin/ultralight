-- Migration: Billing V2 — Cost Telemetry & Pay-As-You-Go
--
-- No tiers. Everyone gets 25MB storage, 50K calls/week.
-- Publishing requires a $5 deposit, then pay-as-you-go at $0.025/MB/hr.
-- No free hosting rate — every published MB costs from the first byte.
--
-- This migration:
--   1. Adds cost telemetry columns to mcp_call_logs
--   2. Normalizes all users to the same 25MB storage limit
--   3. Ensures hosting balance infrastructure exists
--
-- STATUS: Already run on Supabase. No further DB changes needed.

-- ============================================
-- 1. COST TELEMETRY ON MCP_CALL_LOGS
-- ============================================

-- Byte size of the response payload (for bandwidth cost estimation)
ALTER TABLE mcp_call_logs ADD COLUMN IF NOT EXISTS response_size_bytes INTEGER;

-- Estimated execution cost in cents (WfP: $0.30/M requests + $0.02/M CPU-ms)
ALTER TABLE mcp_call_logs ADD COLUMN IF NOT EXISTS execution_cost_estimate_cents FLOAT;

-- Index for cost analysis queries
CREATE INDEX IF NOT EXISTS idx_mcp_logs_cost
  ON mcp_call_logs(user_id, created_at DESC)
  WHERE execution_cost_estimate_cents IS NOT NULL;

-- ============================================
-- 2. NORMALIZE STORAGE LIMITS (25MB for everyone)
-- ============================================

-- All users get 25MB — no tier differentiation
UPDATE users
SET storage_limit_bytes = 26214400
WHERE storage_limit_bytes != 26214400;

-- ============================================
-- 3. ENSURE HOSTING BALANCE INFRASTRUCTURE
-- ============================================

-- These should already exist from migration-gaps-points-billing.sql,
-- but ensure they're present with correct defaults.
ALTER TABLE users ADD COLUMN IF NOT EXISTS hosting_balance_cents FLOAT DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS hosting_last_billed_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE apps ADD COLUMN IF NOT EXISTS hosting_suspended BOOLEAN DEFAULT FALSE;
ALTER TABLE content ADD COLUMN IF NOT EXISTS hosting_suspended BOOLEAN DEFAULT FALSE;

-- Index for billing queries (users with positive balance)
CREATE INDEX IF NOT EXISTS idx_users_hosting_balance
  ON users(hosting_balance_cents)
  WHERE hosting_balance_cents > 0;

-- Index for finding suspended apps
CREATE INDEX IF NOT EXISTS idx_apps_hosting_suspended
  ON apps(owner_id)
  WHERE hosting_suspended = true AND deleted_at IS NULL;
