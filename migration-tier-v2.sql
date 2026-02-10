-- Migration: Tier System v2
-- Expands from 2 tiers (free/pro) to 5 tiers (free/fun/pro/scale/enterprise)
-- Adds weekly call tracking, MCP call logs, and platform-level Supabase config
-- Archives ui/hybrid apps (MCP-only going forward)

-- ============================================
-- 1. EXPAND TIER CHECK CONSTRAINT
-- ============================================

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_tier_check;
ALTER TABLE users ADD CONSTRAINT users_tier_check
  CHECK (tier IN ('free', 'fun', 'pro', 'scale', 'enterprise'));

-- ============================================
-- 2. WEEKLY CALL TRACKING
-- ============================================

CREATE TABLE IF NOT EXISTS weekly_call_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_start TIMESTAMPTZ NOT NULL,  -- Monday 00:00 UTC
  call_count BIGINT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_weekly_calls_user_week
  ON weekly_call_usage(user_id, week_start);

-- Atomic increment function for weekly call tracking
CREATE OR REPLACE FUNCTION increment_weekly_calls(
  p_user_id UUID,
  p_week_start TIMESTAMPTZ
) RETURNS TABLE (current_count BIGINT) AS $$
BEGIN
  INSERT INTO weekly_call_usage (user_id, week_start, call_count)
  VALUES (p_user_id, p_week_start, 1)
  ON CONFLICT (user_id, week_start)
  DO UPDATE SET
    call_count = weekly_call_usage.call_count + 1,
    updated_at = NOW();

  RETURN QUERY
    SELECT wcu.call_count
    FROM weekly_call_usage wcu
    WHERE wcu.user_id = p_user_id AND wcu.week_start = p_week_start;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get weekly usage for a user
CREATE OR REPLACE FUNCTION get_weekly_usage(
  p_user_id UUID,
  p_week_start TIMESTAMPTZ
) RETURNS TABLE (call_count BIGINT) AS $$
BEGIN
  RETURN QUERY
    SELECT COALESCE(wcu.call_count, 0)
    FROM weekly_call_usage wcu
    WHERE wcu.user_id = p_user_id AND wcu.week_start = p_week_start;

  -- If no rows returned, return 0
  IF NOT FOUND THEN
    RETURN QUERY SELECT 0::BIGINT;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 3. MCP CALL LOG TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS mcp_call_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  app_id UUID REFERENCES apps(id) ON DELETE SET NULL,
  app_name TEXT,
  function_name TEXT NOT NULL,
  method TEXT NOT NULL,  -- 'tools/call', 'tools/list', etc.
  success BOOLEAN,
  duration_ms INTEGER,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mcp_logs_user_time
  ON mcp_call_logs(user_id, created_at DESC);

-- ============================================
-- 4. PLATFORM-LEVEL SUPABASE CONFIG ON USERS
-- ============================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS supabase_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS supabase_anon_key_encrypted TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS supabase_service_key_encrypted TEXT;

-- ============================================
-- 5. ARCHIVE UI/HYBRID APPS (MCP-ONLY GOING FORWARD)
-- ============================================

UPDATE apps
SET deleted_at = NOW()
WHERE app_type IN ('ui', 'hybrid')
  AND deleted_at IS NULL;

-- ============================================
-- 6. CLEANUP: DROP DEPRECATED STORAGE RPC FUNCTIONS
-- ============================================

DROP FUNCTION IF EXISTS check_storage_quota(UUID, BIGINT);
DROP FUNCTION IF EXISTS record_upload_storage(UUID, UUID, TEXT, BIGINT);
DROP FUNCTION IF EXISTS reclaim_app_storage(UUID, UUID);
DROP FUNCTION IF EXISTS reclaim_version_storage(UUID, UUID, TEXT);
