-- Migration: MCP + Skills Documentation System
-- Run this in Supabase SQL Editor after the base migration
-- Go to: https://your-project.supabase.co/project/_/sql

-- ============================================
-- PHASE 1: Core Documentation Fields
-- ============================================

-- Add skills_parsed column for structured skill data (JSON)
ALTER TABLE apps
  ADD COLUMN IF NOT EXISTS skills_parsed JSONB;

-- Add documentation generation metadata
ALTER TABLE apps
  ADD COLUMN IF NOT EXISTS docs_generated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS generation_in_progress BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS generation_config JSONB DEFAULT '{"ai_enhance": false}'::jsonb;

-- ============================================
-- PHASE 4: Discovery + Embeddings
-- (Run after implementing embedding service)
-- ============================================

-- Enable pgvector extension for semantic search
CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding column for semantic search
ALTER TABLE apps
  ADD COLUMN IF NOT EXISTS skills_embedding vector(1536);

-- Create vector similarity index
-- Using ivfflat for good balance of speed and accuracy
CREATE INDEX IF NOT EXISTS apps_skills_embedding_idx
  ON apps USING ivfflat (skills_embedding vector_cosine_ops)
  WITH (lists = 100);

-- ============================================
-- PHASE 5: Draft/Publish System
-- ============================================

-- Add draft version fields
ALTER TABLE apps
  ADD COLUMN IF NOT EXISTS draft_storage_key TEXT,
  ADD COLUMN IF NOT EXISTS draft_version TEXT,
  ADD COLUMN IF NOT EXISTS draft_uploaded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS draft_exports TEXT[];

-- ============================================
-- RATE LIMITING (for MCP endpoints)
-- ============================================

-- Rate limits table
CREATE TABLE IF NOT EXISTS rate_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  endpoint TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  request_count INTEGER DEFAULT 1,
  UNIQUE(user_id, endpoint, window_start)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS rate_limits_lookup_idx
  ON rate_limits(user_id, endpoint, window_start);

-- Rate limit check function (atomic increment + check)
CREATE OR REPLACE FUNCTION check_rate_limit(
  p_user_id UUID,
  p_endpoint TEXT,
  p_limit INTEGER DEFAULT 100,
  p_window_minutes INTEGER DEFAULT 1
) RETURNS BOOLEAN AS $$
DECLARE
  v_window_start TIMESTAMPTZ;
  v_count INTEGER;
BEGIN
  -- Truncate to minute boundary for windowing
  v_window_start := date_trunc('minute', NOW());

  -- Upsert rate limit entry and get count
  INSERT INTO rate_limits (user_id, endpoint, window_start, request_count)
  VALUES (p_user_id, p_endpoint, v_window_start, 1)
  ON CONFLICT (user_id, endpoint, window_start)
  DO UPDATE SET request_count = rate_limits.request_count + 1
  RETURNING request_count INTO v_count;

  -- Return true if under limit
  RETURN v_count <= p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Cleanup old rate limit entries (run periodically via cron)
CREATE OR REPLACE FUNCTION cleanup_rate_limits() RETURNS void AS $$
BEGIN
  DELETE FROM rate_limits WHERE window_start < NOW() - INTERVAL '1 hour';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- DISCOVERY SEARCH FUNCTION
-- ============================================

-- Semantic search function for discovering apps
-- Returns apps matching a query embedding, respecting visibility
CREATE OR REPLACE FUNCTION search_apps(
  p_query_embedding vector(1536),
  p_user_id UUID,
  p_limit INTEGER DEFAULT 20,
  p_offset INTEGER DEFAULT 0
) RETURNS TABLE (
  id UUID,
  name TEXT,
  description TEXT,
  owner_id UUID,
  visibility TEXT,
  similarity FLOAT,
  skills_parsed JSONB
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    a.id,
    a.name,
    a.description,
    a.owner_id,
    a.visibility,
    1 - (a.skills_embedding <=> p_query_embedding) as similarity,
    a.skills_parsed
  FROM apps a
  WHERE
    a.deleted_at IS NULL
    AND a.skills_embedding IS NOT NULL
    AND (
      a.visibility = 'public'
      OR a.owner_id = p_user_id
    )
  ORDER BY similarity DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- ADDITIONAL INDEXES
-- ============================================

-- Index for finding apps by visibility (for discovery)
CREATE INDEX IF NOT EXISTS idx_apps_visibility_not_deleted
  ON apps(visibility)
  WHERE deleted_at IS NULL;

-- Index for draft detection
CREATE INDEX IF NOT EXISTS idx_apps_has_draft
  ON apps(id)
  WHERE draft_storage_key IS NOT NULL;

-- ============================================
-- RLS POLICIES FOR NEW TABLE
-- ============================================

-- Enable RLS on rate_limits
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;

-- Users can only see their own rate limit entries (if needed for debugging)
CREATE POLICY rate_limits_own ON rate_limits
  FOR SELECT
  USING (user_id = auth.uid());

-- ============================================
-- NOTES
-- ============================================
--
-- After running this migration:
-- 1. The apps table will have new columns for skills documentation
-- 2. pgvector will be enabled for semantic search
-- 3. Rate limiting will be available via check_rate_limit() function
-- 4. Discovery search will be available via search_apps() function
--
-- To test pgvector is working:
-- SELECT '[1,2,3]'::vector(3);
--
-- To test rate limiting:
-- SELECT check_rate_limit('user-uuid-here', 'mcp', 100, 1);
