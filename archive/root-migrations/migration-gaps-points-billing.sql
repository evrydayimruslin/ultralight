-- Migration: Gaps, Points, Seasons & Hosting Billing
--
-- Creates the infrastructure for:
--   1. Team-curated platform gaps (from shortcomings/queries)
--   2. Gap submissions via ul.upload(gap_id)
--   3. Assessment pipeline (agent scores, team approves)
--   4. Season-scoped points ledger
--   5. Hosting balance & suspension for published content

-- ============================================
-- 1. GAPS TABLE
-- ============================================
-- Team-curated from shortcomings and appstore_queries.
-- Each gap represents a known platform need with a point bounty.

CREATE TABLE IF NOT EXISTS gaps (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  severity TEXT DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  points_value INTEGER NOT NULL DEFAULT 100,
  season INTEGER NOT NULL DEFAULT 1,
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'claimed', 'fulfilled', 'closed')),
  source_shortcoming_ids UUID[] DEFAULT '{}',
  source_query_ids UUID[] DEFAULT '{}',
  fulfilled_by_app_id UUID,
  fulfilled_by_user_id UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gaps_status
  ON gaps(status, season, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_gaps_season
  ON gaps(season, points_value DESC);

-- ============================================
-- 2. GAP_ID ON APPS
-- ============================================
-- Links an uploaded app to the gap it claims to fulfill.

ALTER TABLE apps ADD COLUMN IF NOT EXISTS gap_id UUID REFERENCES gaps(id);

CREATE INDEX IF NOT EXISTS idx_apps_gap
  ON apps(gap_id) WHERE gap_id IS NOT NULL;

-- ============================================
-- 3. GAP ASSESSMENTS
-- ============================================
-- Assessment agent proposes score + points, team approves/rejects.

CREATE TABLE IF NOT EXISTS gap_assessments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  gap_id UUID NOT NULL REFERENCES gaps(id),
  app_id UUID NOT NULL REFERENCES apps(id),
  user_id UUID NOT NULL,
  agent_score INTEGER,              -- 0-100 rubric score from assessment agent
  agent_notes TEXT,                 -- prose breakdown from assessment agent
  proposed_points INTEGER,          -- agent's recommended point grant
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'adjusted')),
  awarded_points INTEGER,           -- final points after team review
  reviewed_by TEXT,                 -- team member who reviewed
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_assessments_status
  ON gap_assessments(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_assessments_gap
  ON gap_assessments(gap_id);

-- ============================================
-- 4. POINTS LEDGER
-- ============================================
-- Immutable log of all point transactions. Positive = earned, negative = spent/decayed.

CREATE TABLE IF NOT EXISTS points_ledger (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL,
  gap_assessment_id UUID REFERENCES gap_assessments(id),
  season INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_points_user
  ON points_ledger(user_id, season, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_points_season
  ON points_ledger(season, created_at DESC);

-- ============================================
-- 5. SEASONS TABLE
-- ============================================
-- Season configuration for points programs.

CREATE TABLE IF NOT EXISTS seasons (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ,
  total_points_pool INTEGER,
  multiplier_config JSONB DEFAULT '{}',
  active BOOLEAN DEFAULT FALSE
);

-- ============================================
-- 6. HOSTING BALANCE ON USERS
-- ============================================
-- Balance drains based on published content storage.
-- $0.025/MB/hour for published apps and markdown pages.

ALTER TABLE users ADD COLUMN IF NOT EXISTS hosting_balance_cents INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS hosting_last_billed_at TIMESTAMPTZ DEFAULT now();

-- ============================================
-- 7. HOSTING SUSPENSION FLAGS
-- ============================================
-- When balance hits zero, published content goes offline.

ALTER TABLE apps ADD COLUMN IF NOT EXISTS hosting_suspended BOOLEAN DEFAULT FALSE;
ALTER TABLE content ADD COLUMN IF NOT EXISTS hosting_suspended BOOLEAN DEFAULT FALSE;
