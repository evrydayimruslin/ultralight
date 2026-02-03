-- Phase 1 Migration: Environment Variables & HTTP Endpoints
-- Run this in Supabase SQL Editor

-- ============================================
-- 1. ADD ENV VARS COLUMN TO APPS TABLE
-- ============================================

-- Add env_vars column for encrypted environment variables
-- Format: { "KEY_NAME": "encrypted_value", ... }
ALTER TABLE apps ADD COLUMN IF NOT EXISTS env_vars JSONB DEFAULT '{}'::jsonb;

-- Add rate limiting columns for HTTP endpoints
ALTER TABLE apps ADD COLUMN IF NOT EXISTS http_rate_limit INTEGER DEFAULT 1000; -- requests per minute
ALTER TABLE apps ADD COLUMN IF NOT EXISTS http_enabled BOOLEAN DEFAULT true;

-- ============================================
-- 2. ENV VARS LIMITS TABLE (for validation)
-- ============================================

-- Store env var limits in a config table
CREATE TABLE IF NOT EXISTS app_config (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default limits
INSERT INTO app_config (key, value) VALUES
    ('env_vars_limits', '{
        "max_vars_per_app": 50,
        "max_key_length": 64,
        "max_value_length": 4096,
        "reserved_prefixes": ["ULTRALIGHT"]
    }'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ============================================
-- 3. HTTP REQUEST LOGGING (for rate limiting)
-- ============================================

-- Table to track HTTP requests for rate limiting
CREATE TABLE IF NOT EXISTS http_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id UUID REFERENCES apps(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL,
    method TEXT NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    status_code INTEGER,
    duration_ms INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for rate limiting queries
CREATE INDEX IF NOT EXISTS idx_http_requests_app_created
ON http_requests(app_id, created_at DESC);

-- Partitioning hint: In production, consider partitioning by created_at
-- for efficient cleanup of old records

-- ============================================
-- 4. RATE LIMITING FUNCTION
-- ============================================

-- Function to check HTTP rate limit for an app
CREATE OR REPLACE FUNCTION check_http_rate_limit(
    p_app_id UUID,
    p_window_minutes INTEGER DEFAULT 1
)
RETURNS TABLE (
    allowed BOOLEAN,
    current_count INTEGER,
    limit_count INTEGER,
    reset_at TIMESTAMPTZ
) AS $$
DECLARE
    v_limit INTEGER;
    v_count INTEGER;
    v_window_start TIMESTAMPTZ;
BEGIN
    -- Get app's rate limit
    SELECT COALESCE(http_rate_limit, 1000) INTO v_limit
    FROM apps WHERE id = p_app_id;

    -- Calculate window start
    v_window_start := NOW() - (p_window_minutes || ' minutes')::INTERVAL;

    -- Count requests in window
    SELECT COUNT(*) INTO v_count
    FROM http_requests
    WHERE app_id = p_app_id AND created_at >= v_window_start;

    RETURN QUERY SELECT
        v_count < v_limit AS allowed,
        v_count AS current_count,
        v_limit AS limit_count,
        v_window_start + (p_window_minutes || ' minutes')::INTERVAL AS reset_at;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 5. CLEANUP OLD HTTP REQUESTS (scheduled job)
-- ============================================

-- Function to clean up old HTTP request logs (keep last 24 hours)
CREATE OR REPLACE FUNCTION cleanup_http_requests()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM http_requests
    WHERE created_at < NOW() - INTERVAL '24 hours';

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 6. RLS POLICIES
-- ============================================

-- Enable RLS on http_requests
ALTER TABLE http_requests ENABLE ROW LEVEL SECURITY;

-- Policy: App owners can view their app's HTTP requests
CREATE POLICY "App owners can view http requests"
ON http_requests FOR SELECT
USING (
    app_id IN (
        SELECT id FROM apps WHERE owner_id = auth.uid()
    )
);

-- Service role can insert (for API server)
CREATE POLICY "Service role can insert http requests"
ON http_requests FOR INSERT
WITH CHECK (true);

-- ============================================
-- 7. INDEXES FOR PERFORMANCE
-- ============================================

-- Index for env_vars queries (if needed for searching)
CREATE INDEX IF NOT EXISTS idx_apps_env_vars
ON apps USING gin(env_vars);

COMMENT ON COLUMN apps.env_vars IS 'Encrypted environment variables for the app. Keys starting with ULTRALIGHT are reserved.';
COMMENT ON COLUMN apps.http_rate_limit IS 'Maximum HTTP requests per minute for this app (default 1000)';
COMMENT ON COLUMN apps.http_enabled IS 'Whether HTTP endpoints are enabled for this app';
