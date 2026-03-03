-- Migration: Analytics Pipeline
-- Adds conversion event tracking, onboarding request logging, and analytics views.
-- Run after migration-provisional.sql

-- ============================================
-- 1. CONVERSION EVENTS TABLE
-- Logs every provisional → authenticated merge so we can compute conversion rates.
-- The provisional user record is deleted on merge, so this preserves the history.
-- ============================================

CREATE TABLE IF NOT EXISTS conversion_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provisional_user_id UUID NOT NULL,         -- The provisional user that was merged (now deleted)
  real_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  merge_method TEXT NOT NULL DEFAULT 'unknown', -- 'oauth_callback', 'mcp_auth_link', 'api_merge'
  provisional_created_at TIMESTAMPTZ,        -- When the provisional was created
  provisional_ip TEXT,                        -- IP that created the provisional
  calls_as_provisional INT DEFAULT 0,         -- Total MCP calls made while provisional
  apps_used_as_provisional INT DEFAULT 0,     -- Distinct apps used while provisional
  first_app_id UUID,                          -- First app the provisional user called
  first_app_name TEXT,                        -- First app name (denormalized for easy querying)
  apps_moved INT DEFAULT 0,                   -- Apps transferred in merge
  tokens_moved INT DEFAULT 0,                 -- Tokens transferred in merge
  storage_transferred_bytes BIGINT DEFAULT 0, -- Storage bytes transferred
  time_to_convert_minutes INT,                -- Minutes from provisional creation to merge
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for analytics queries
CREATE INDEX IF NOT EXISTS idx_conversion_events_time ON conversion_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversion_events_real_user ON conversion_events(real_user_id);
CREATE INDEX IF NOT EXISTS idx_conversion_events_method ON conversion_events(merge_method, created_at DESC);

-- ============================================
-- 2. ONBOARDING REQUESTS TABLE
-- Tracks every fetch of the onboarding instructions template.
-- Lightweight logging — no PII beyond IP (for rate correlation).
-- ============================================

CREATE TABLE IF NOT EXISTS onboarding_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_ip TEXT,
  user_agent TEXT,
  referrer TEXT,
  provisional_created BOOLEAN DEFAULT FALSE,  -- Did this session also create a provisional user?
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Time-based queries for funnel analysis
CREATE INDEX IF NOT EXISTS idx_onboarding_requests_time ON onboarding_requests(created_at DESC);
-- Correlate template fetches with provisional creations by IP
CREATE INDEX IF NOT EXISTS idx_onboarding_requests_ip ON onboarding_requests(client_ip, created_at DESC);

-- ============================================
-- 3. UPDATE mcp_call_logs SOURCE ENUM
-- Add 'onboarding_template' as a valid source for attribution.
-- (Postgres TEXT columns don't need ALTER for new values, but document it.)
-- ============================================

-- The source column is TEXT, not ENUM, so no schema change needed.
-- We'll just start writing 'onboarding_template' as a source value for
-- provisional users' calls to apps listed in the onboarding template.

-- ============================================
-- 4. ANALYTICS HELPER: RPC to get conversion funnel stats
-- Returns key metrics in one call for the admin dashboard.
-- ============================================

CREATE OR REPLACE FUNCTION get_analytics_summary(p_days INT DEFAULT 30)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result JSONB;
  v_since TIMESTAMPTZ := now() - (p_days || ' days')::INTERVAL;
BEGIN
  SELECT jsonb_build_object(
    -- Provisionals
    'provisionals_created', (
      SELECT COUNT(*) FROM users
      WHERE provisional = TRUE AND provisional_created_at >= v_since
    ),
    'provisionals_active', (
      SELECT COUNT(*) FROM users
      WHERE provisional = TRUE
    ),
    -- Conversions
    'conversions_total', (
      SELECT COUNT(*) FROM conversion_events
      WHERE created_at >= v_since
    ),
    'conversions_by_method', (
      SELECT COALESCE(jsonb_object_agg(merge_method, cnt), '{}'::JSONB)
      FROM (
        SELECT merge_method, COUNT(*) as cnt
        FROM conversion_events
        WHERE created_at >= v_since
        GROUP BY merge_method
      ) sub
    ),
    'avg_time_to_convert_minutes', (
      SELECT COALESCE(AVG(time_to_convert_minutes), 0)::INT
      FROM conversion_events
      WHERE created_at >= v_since AND time_to_convert_minutes IS NOT NULL
    ),
    'avg_calls_before_convert', (
      SELECT COALESCE(AVG(calls_as_provisional), 0)::INT
      FROM conversion_events
      WHERE created_at >= v_since
    ),
    -- Onboarding funnel
    'template_fetches', (
      SELECT COUNT(*) FROM onboarding_requests
      WHERE created_at >= v_since
    ),
    'template_to_provisional_rate', (
      SELECT CASE
        WHEN COUNT(*) = 0 THEN 0
        ELSE ROUND(COUNT(*) FILTER (WHERE provisional_created = TRUE)::NUMERIC / COUNT(*)::NUMERIC * 100, 1)
      END
      FROM onboarding_requests
      WHERE created_at >= v_since
    ),
    -- App usage
    'top_apps', (
      SELECT COALESCE(jsonb_agg(row_to_json(sub)), '[]'::JSONB)
      FROM (
        SELECT app_name, app_id,
               COUNT(*) as calls,
               COUNT(DISTINCT user_id) as unique_users,
               COUNT(*) FILTER (WHERE success = TRUE) as successful_calls,
               ROUND(AVG(duration_ms)::NUMERIC, 0) as avg_duration_ms
        FROM mcp_call_logs
        WHERE created_at >= v_since AND app_id IS NOT NULL
        GROUP BY app_name, app_id
        ORDER BY calls DESC
        LIMIT 20
      ) sub
    ),
    -- Discovery demand
    'top_searches', (
      SELECT COALESCE(jsonb_agg(row_to_json(sub)), '[]'::JSONB)
      FROM (
        SELECT query, COUNT(*) as count,
               ROUND(AVG(top_similarity)::NUMERIC, 3) as avg_similarity,
               ROUND(AVG(result_count)::NUMERIC, 0) as avg_results
        FROM appstore_queries
        WHERE created_at >= v_since
        GROUP BY query
        ORDER BY count DESC
        LIMIT 20
      ) sub
    ),
    'unmet_demand', (
      SELECT COALESCE(jsonb_agg(row_to_json(sub)), '[]'::JSONB)
      FROM (
        SELECT query, COUNT(*) as count,
               ROUND(AVG(top_similarity)::NUMERIC, 3) as avg_similarity
        FROM appstore_queries
        WHERE created_at >= v_since
          AND (top_similarity < 0.5 OR result_count = 0)
        GROUP BY query
        ORDER BY count DESC
        LIMIT 15
      ) sub
    ),
    -- Error rates
    'error_rate_percent', (
      SELECT CASE
        WHEN COUNT(*) = 0 THEN 0
        ELSE ROUND(COUNT(*) FILTER (WHERE success = FALSE)::NUMERIC / COUNT(*)::NUMERIC * 100, 1)
      END
      FROM mcp_call_logs
      WHERE created_at >= v_since
    ),
    'total_calls', (
      SELECT COUNT(*) FROM mcp_call_logs
      WHERE created_at >= v_since
    ),
    'unique_users', (
      SELECT COUNT(DISTINCT user_id) FROM mcp_call_logs
      WHERE created_at >= v_since
    ),
    -- First app attribution (what apps do provisional users try first?)
    'first_app_distribution', (
      SELECT COALESCE(jsonb_agg(row_to_json(sub)), '[]'::JSONB)
      FROM (
        SELECT first_app_name, first_app_id, COUNT(*) as count
        FROM conversion_events
        WHERE created_at >= v_since AND first_app_id IS NOT NULL
        GROUP BY first_app_name, first_app_id
        ORDER BY count DESC
        LIMIT 10
      ) sub
    ),
    -- Period info
    'period_days', p_days,
    'generated_at', now()
  ) INTO result;

  RETURN result;
END;
$$;
