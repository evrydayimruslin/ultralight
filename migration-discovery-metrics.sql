-- Migration: Discovery Metrics
-- Run AFTER: migration-search-algo.sql, migration-content-layer.sql
-- Adds: discovery metric columns on apps, app_impressions table,
--        quality score computation RPC, impressions rollup RPC.
-- Purpose: Foundation for TikTok-style discovery ranking (freshness,
--          quality signals, cold-start impression budgets).

-- ============================================
-- 1. NEW COLUMNS ON APPS TABLE
-- ============================================

-- When the app was first made public (for freshness scoring)
ALTER TABLE apps ADD COLUMN IF NOT EXISTS first_published_at TIMESTAMPTZ;

-- Composite quality score (0.0-1.0) computed from success rate, likes, usage
ALTER TABLE apps ADD COLUMN IF NOT EXISTS quality_score FLOAT DEFAULT 0;

-- Discovery impression counts (rolled up from app_impressions table)
ALTER TABLE apps ADD COLUMN IF NOT EXISTS impressions_total INTEGER DEFAULT 0;
ALTER TABLE apps ADD COLUMN IF NOT EXISTS impressions_7d INTEGER DEFAULT 0;

-- Call outcome counts for 30d window (rolled up from mcp_call_logs)
ALTER TABLE apps ADD COLUMN IF NOT EXISTS calls_success_30d INTEGER DEFAULT 0;
ALTER TABLE apps ADD COLUMN IF NOT EXISTS calls_error_30d INTEGER DEFAULT 0;

-- Index for quality-based sorting in homepage/featured mode
CREATE INDEX IF NOT EXISTS idx_apps_quality_score ON apps(quality_score DESC)
  WHERE visibility = 'public' AND deleted_at IS NULL;

-- Index for freshness-based queries
CREATE INDEX IF NOT EXISTS idx_apps_first_published ON apps(first_published_at DESC)
  WHERE visibility = 'public' AND deleted_at IS NULL AND first_published_at IS NOT NULL;

-- ============================================
-- 2. BACKFILL first_published_at
-- ============================================
-- For existing public apps, set first_published_at to created_at.
-- Future publishes will set this in the handler code.

UPDATE apps
SET first_published_at = created_at
WHERE visibility = 'public'
  AND deleted_at IS NULL
  AND first_published_at IS NULL;

-- ============================================
-- 3. APP_IMPRESSIONS TABLE
-- ============================================
-- Tracks each time an app or page appears in a discovery result.
-- Bulk-inserted from appstore queries (platform-mcp.ts) and
-- web marketplace (discover.ts). One row per result item per query.

CREATE TABLE IF NOT EXISTS app_impressions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id UUID REFERENCES apps(id) ON DELETE CASCADE,
  content_id UUID,                          -- for page impressions (references content.id)
  query_id UUID,                            -- correlates to appstore_queries.id
  source TEXT NOT NULL DEFAULT 'appstore',   -- 'appstore' (MCP) | 'marketplace' (web UI)
  position INTEGER,                          -- rank position in results (1-based)
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- For rolling up per-app impression counts
CREATE INDEX IF NOT EXISTS idx_app_impressions_app_time
  ON app_impressions(app_id, created_at DESC)
  WHERE app_id IS NOT NULL;

-- For rolling up per-content impression counts
CREATE INDEX IF NOT EXISTS idx_app_impressions_content_time
  ON app_impressions(content_id, created_at DESC)
  WHERE content_id IS NOT NULL;

-- For time-based cleanup and windowed queries
CREATE INDEX IF NOT EXISTS idx_app_impressions_time
  ON app_impressions(created_at DESC);

-- ============================================
-- 4. IMPRESSIONS ROLLUP RPC
-- ============================================
-- Updates impressions_total and impressions_7d on the apps table.
-- Intended to be called periodically (e.g., every 5 min via pg_cron
-- or via an admin endpoint).

CREATE OR REPLACE FUNCTION rollup_impressions()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_7d_ago TIMESTAMPTZ := now() - INTERVAL '7 days';
BEGIN
  -- Reset all to 0 first (handles apps whose impressions were deleted)
  UPDATE apps
  SET impressions_total = 0, impressions_7d = 0
  WHERE (impressions_total > 0 OR impressions_7d > 0);

  -- Aggregate from app_impressions and update
  UPDATE apps a
  SET
    impressions_total = sub.total,
    impressions_7d = sub.recent
  FROM (
    SELECT
      app_id,
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE created_at >= v_7d_ago) AS recent
    FROM app_impressions
    WHERE app_id IS NOT NULL
    GROUP BY app_id
  ) sub
  WHERE a.id = sub.app_id;
END;
$$;

-- ============================================
-- 5. CALL METRICS ROLLUP RPC
-- ============================================
-- Updates calls_success_30d and calls_error_30d on the apps table.
-- Separate from quality score so it can run independently.

CREATE OR REPLACE FUNCTION rollup_call_metrics()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_30d_ago TIMESTAMPTZ := now() - INTERVAL '30 days';
BEGIN
  -- Reset all to 0 first
  UPDATE apps
  SET calls_success_30d = 0, calls_error_30d = 0
  WHERE (calls_success_30d > 0 OR calls_error_30d > 0);

  -- Aggregate from mcp_call_logs
  UPDATE apps a
  SET
    calls_success_30d = COALESCE(sub.successes, 0),
    calls_error_30d = COALESCE(sub.errors, 0)
  FROM (
    SELECT
      app_id,
      COUNT(*) FILTER (WHERE success = TRUE) AS successes,
      COUNT(*) FILTER (WHERE success = FALSE) AS errors
    FROM mcp_call_logs
    WHERE created_at >= v_30d_ago AND app_id IS NOT NULL
    GROUP BY app_id
  ) sub
  WHERE a.id = sub.app_id;
END;
$$;

-- ============================================
-- 6. QUALITY SCORE COMPUTATION RPC
-- ============================================
-- Computes quality_score (0.0-1.0) from:
--   40% success rate (Wilson lower bound)
--   30% like ratio (weighted likes vs dislikes)
--   20% usage volume (log-scaled 30d calls)
--   10% discovery traction (log-scaled 7d impressions)
--
-- Call AFTER rollup_call_metrics() and rollup_impressions().

CREATE OR REPLACE FUNCTION compute_quality_scores()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE apps
  SET quality_score = ROUND((
    -- 40%: Success rate (with Wilson-like smoothing)
    CASE
      WHEN (calls_success_30d + calls_error_30d) >= 5
      THEN 0.4 * (calls_success_30d::FLOAT / (calls_success_30d + calls_error_30d))
      WHEN (calls_success_30d + calls_error_30d) > 0
      THEN 0.4 * ((calls_success_30d::FLOAT + 1) / (calls_success_30d + calls_error_30d + 2))  -- Laplace smoothing for small samples
      ELSE 0.4 * 0.5  -- neutral prior when no data
    END
    -- 30%: Like ratio
    + 0.3 * (COALESCE(weighted_likes, 0)::FLOAT / (COALESCE(weighted_likes, 0) + COALESCE(weighted_dislikes, 0) + 1))
    -- 20%: Usage volume (log-scaled, capped at 1.0)
    + 0.2 * LEAST(LN(COALESCE(calls_success_30d, 0) + 1) / 7.0, 1.0)  -- ~1100 calls/30d = 1.0
    -- 10%: Discovery traction (log-scaled, capped at 1.0)
    + 0.1 * LEAST(LN(COALESCE(impressions_7d, 0) + 1) / 5.0, 1.0)  -- ~150 impressions/7d = 1.0
  )::NUMERIC, 4)
  WHERE visibility = 'public' AND deleted_at IS NULL;
END;
$$;

-- ============================================
-- 7. COMBINED ROLLUP (convenience wrapper)
-- ============================================
-- Runs all three rollups in sequence. Call this from pg_cron:
--   SELECT cron.schedule('rollup-discovery-metrics', '*/5 * * * *', 'SELECT rollup_discovery_metrics()');

CREATE OR REPLACE FUNCTION rollup_discovery_metrics()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM rollup_impressions();
  PERFORM rollup_call_metrics();
  PERFORM compute_quality_scores();
END;
$$;

-- ============================================
-- 8. IMPRESSIONS CLEANUP (optional)
-- ============================================
-- Delete impressions older than 90 days to prevent unbounded growth.
-- Schedule via pg_cron: daily at 3am.
--   SELECT cron.schedule('cleanup-old-impressions', '0 3 * * *', $$DELETE FROM app_impressions WHERE created_at < now() - INTERVAL '90 days'$$);
