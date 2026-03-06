-- Migration: Free Calls Usage Tracking
-- Adds atomic per-user call counter for "first N calls free" pricing.
-- Run after migration-pricing.sql.

-- 1. USAGE COUNTER TABLE
-- Tracks how many calls each user has made to each app/function.
-- counter_key is '__app__' for app-scope counting, or the function name for function-scope.
CREATE TABLE IF NOT EXISTS app_caller_usage (
  app_id UUID NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  counter_key TEXT NOT NULL,
  call_count INTEGER NOT NULL DEFAULT 0,
  first_call_at TIMESTAMPTZ DEFAULT NOW(),
  last_call_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (app_id, user_id, counter_key)
);

-- Index for owner dashboards: "show me usage across my app"
CREATE INDEX IF NOT EXISTS idx_caller_usage_app
  ON app_caller_usage(app_id, last_call_at DESC);

-- 2. ATOMIC INCREMENT-AND-RETURN RPC
-- Returns the NEW count after incrementing. Used to decide charge vs free.
-- Single atomic upsert — no TOCTOU race conditions.
CREATE OR REPLACE FUNCTION increment_caller_usage(
  p_app_id UUID,
  p_user_id UUID,
  p_counter_key TEXT
)
RETURNS INTEGER AS $$
  INSERT INTO app_caller_usage (app_id, user_id, counter_key, call_count, first_call_at, last_call_at)
  VALUES (p_app_id, p_user_id, p_counter_key, 1, NOW(), NOW())
  ON CONFLICT (app_id, user_id, counter_key)
  DO UPDATE SET
    call_count = app_caller_usage.call_count + 1,
    last_call_at = NOW()
  RETURNING call_count;
$$ LANGUAGE SQL;
