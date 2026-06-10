-- Migration: Shortcomings — Agent-reported platform gaps
--
-- Creates the shortcomings table for collecting distributed agent reports.
-- Each row is a fire-and-forget report from a per-user agent that encountered
-- a platform inadequacy — whether an explicit failure or implicit user friction.
--
-- Types:
--   capability_gap       — something that should exist but doesn't
--   tool_failure         — a tool call that failed unexpectedly
--   user_friction        — user expressed frustration or made corrections
--   schema_confusion     — tool schema was misleading or hard to use
--   protocol_limitation  — MCP protocol or platform architecture limitation
--   quality_issue        — tool worked but produced poor results

-- ============================================
-- 1. SHORTCOMINGS TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS shortcomings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  session_id TEXT,
  type TEXT NOT NULL,
  summary TEXT NOT NULL,
  context JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- 2. INDEXES
-- ============================================

-- By type: find all reports of a specific category
CREATE INDEX IF NOT EXISTS idx_shortcomings_type
  ON shortcomings(type, created_at DESC);

-- By user: see what a specific user's agent has reported
CREATE INDEX IF NOT EXISTS idx_shortcomings_user
  ON shortcomings(user_id, created_at DESC);

-- Recent: triage latest reports across all users
CREATE INDEX IF NOT EXISTS idx_shortcomings_recent
  ON shortcomings(created_at DESC);
