-- Migration: Discovery Layers — Desk, Library Saves, Blocks
-- Run AFTER: migration-platform-mcp-v2.sql
--
-- Adds tables for the three-layer discovery cascade:
--   Desk (recent usage) → Library (owned + liked apps) → App Store (global)
--
-- - user_app_library: apps saved to a user's library via like
-- - user_app_blocks: apps blocked from a user's future appstore results via dislike

-- ============================================
-- 1. USER_APP_LIBRARY — Liked/saved apps (like → library)
-- ============================================
-- When a user likes an app, it's saved here.
-- These appear alongside owned apps in ul.discover.library results.

CREATE TABLE IF NOT EXISTS user_app_library (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  app_id UUID NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'like',  -- how it got here: 'like', future: 'manual'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, app_id)
);

CREATE INDEX IF NOT EXISTS idx_user_app_library_user
  ON user_app_library(user_id);

CREATE INDEX IF NOT EXISTS idx_user_app_library_app
  ON user_app_library(app_id);

-- RLS
ALTER TABLE user_app_library ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_app_library_own ON user_app_library;
CREATE POLICY user_app_library_own ON user_app_library
  FOR ALL USING (user_id = auth.uid());

-- ============================================
-- 2. USER_APP_BLOCKS — Blocked apps (dislike → hidden)
-- ============================================
-- When a user dislikes an app, it's blocked here.
-- These are filtered out of ul.discover.appstore results for this user.

CREATE TABLE IF NOT EXISTS user_app_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  app_id UUID NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  reason TEXT NOT NULL DEFAULT 'dislike',  -- why blocked: 'dislike', future: 'manual'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, app_id)
);

CREATE INDEX IF NOT EXISTS idx_user_app_blocks_user
  ON user_app_blocks(user_id);

-- RLS
ALTER TABLE user_app_blocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_app_blocks_own ON user_app_blocks;
CREATE POLICY user_app_blocks_own ON user_app_blocks
  FOR ALL USING (user_id = auth.uid());

-- ============================================
-- NOTES
-- ============================================
-- The desk layer (ul.discover.desk) does NOT need a table.
-- It queries mcp_call_logs for the user's last 3 distinct apps used.
-- Existing idx_mcp_logs_user_time index covers this efficiently.
--
-- Discovery cascade taught to agents via Skills.md:
--   1. Desk   — last 3 apps used (from call logs)
--   2. Library — owned apps + liked apps (user_app_library)
--   3. App Store — all public apps, minus blocks (user_app_blocks)
