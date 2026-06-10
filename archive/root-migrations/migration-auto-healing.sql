-- Migration: Auto-Healing Infrastructure
-- STATUS: Pending — run on Supabase after code deploy
--
-- Adds:
--   1. app_health_events table — tracks detected failures & healing attempts
--   2. Columns on apps table for health tracking

-- ============================================
-- 1. HEALTH EVENT LOG
-- ============================================
-- Records every detected failure spike and healing attempt.
-- Status flow: detected → diagnosing → patched → testing → deployed | failed | rolled_back

CREATE TABLE IF NOT EXISTS app_health_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id UUID NOT NULL REFERENCES apps(id),
  function_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'detected',  -- detected, diagnosing, patched, testing, deployed, failed, rolled_back
  error_rate FLOAT NOT NULL,                -- error rate that triggered healing (0.0-1.0)
  total_calls INTEGER NOT NULL,             -- total calls in detection window
  failed_calls INTEGER NOT NULL,            -- failed calls in detection window
  common_error TEXT,                        -- most frequent error message
  error_sample JSONB,                       -- sample of recent errors { message, args, timestamp }[]
  patch_description TEXT,                   -- what the AI changed
  patch_version TEXT,                       -- version deployed with the fix
  previous_version TEXT,                    -- version before the fix (for rollback)
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_health_events_app ON app_health_events(app_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_health_events_status ON app_health_events(status) WHERE status NOT IN ('deployed', 'failed', 'rolled_back');

-- ============================================
-- 2. APP HEALTH COLUMNS
-- ============================================
-- Quick lookup for UI: is this app healthy? When was it last healed?

ALTER TABLE apps ADD COLUMN IF NOT EXISTS health_status TEXT DEFAULT 'healthy';
ALTER TABLE apps ADD COLUMN IF NOT EXISTS last_healed_at TIMESTAMPTZ;
ALTER TABLE apps ADD COLUMN IF NOT EXISTS auto_heal_enabled BOOLEAN DEFAULT TRUE;
