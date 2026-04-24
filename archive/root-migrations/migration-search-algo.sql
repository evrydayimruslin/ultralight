-- Migration: Search Algorithm Overhaul
-- Run AFTER: migration-platform-mcp-v2.sql, migration-discovery-layers.sql
--
-- Adds:
--   - weighted_likes / weighted_dislikes on apps (paid-tier only counts for ranking)
--   - Updated trigger to compute weighted counts by joining users.tier
--   - Updated search_apps RPC to return weighted columns
--   - appstore_queries table for demand logging + impression tracking
--   - source column on mcp_call_logs for attribution

-- ============================================
-- 1. WEIGHTED LIKE COLUMNS ON APPS
-- ============================================
-- likes/dislikes = total counts (all tiers)
-- weighted_likes/weighted_dislikes = paid tier only (used in search ranking)

ALTER TABLE apps ADD COLUMN IF NOT EXISTS weighted_likes INTEGER DEFAULT 0;
ALTER TABLE apps ADD COLUMN IF NOT EXISTS weighted_dislikes INTEGER DEFAULT 0;

-- ============================================
-- 2. UPDATED TRIGGER FUNCTION
-- ============================================
-- Replaces the existing update_app_like_counts() in-place.
-- The trigger (trg_app_likes) stays attached — no need to recreate it.
-- Now JOINs users table to compute weighted counts (tier != 'free').

CREATE OR REPLACE FUNCTION update_app_like_counts() RETURNS trigger AS $$
DECLARE
  target_app_id UUID;
  like_count INTEGER;
  dislike_count INTEGER;
  w_like_count INTEGER;
  w_dislike_count INTEGER;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_app_id := OLD.app_id;
  ELSE
    target_app_id := NEW.app_id;
  END IF;

  -- If UPDATE changed app_id, also recompute old app
  IF TG_OP = 'UPDATE' AND OLD.app_id IS DISTINCT FROM NEW.app_id THEN
    SELECT
      COUNT(*) FILTER (WHERE al.positive),
      COUNT(*) FILTER (WHERE NOT al.positive),
      COUNT(*) FILTER (WHERE al.positive AND u.tier != 'free'),
      COUNT(*) FILTER (WHERE NOT al.positive AND u.tier != 'free')
    INTO like_count, dislike_count, w_like_count, w_dislike_count
    FROM app_likes al
    JOIN users u ON u.id = al.user_id
    WHERE al.app_id = OLD.app_id;

    UPDATE apps SET
      likes = like_count,
      dislikes = dislike_count,
      weighted_likes = w_like_count,
      weighted_dislikes = w_dislike_count,
      updated_at = NOW()
    WHERE id = OLD.app_id;
  END IF;

  -- Recompute for the target app
  SELECT
    COUNT(*) FILTER (WHERE al.positive),
    COUNT(*) FILTER (WHERE NOT al.positive),
    COUNT(*) FILTER (WHERE al.positive AND u.tier != 'free'),
    COUNT(*) FILTER (WHERE NOT al.positive AND u.tier != 'free')
  INTO like_count, dislike_count, w_like_count, w_dislike_count
  FROM app_likes al
  JOIN users u ON u.id = al.user_id
  WHERE al.app_id = target_app_id;

  UPDATE apps SET
    likes = like_count,
    dislikes = dislike_count,
    weighted_likes = w_like_count,
    weighted_dislikes = w_dislike_count,
    updated_at = NOW()
  WHERE id = target_app_id;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 3. UPDATED search_apps RPC
-- ============================================
-- Must DROP because return type changes (adding weighted columns).

DROP FUNCTION IF EXISTS search_apps(vector, uuid, integer, integer);

CREATE OR REPLACE FUNCTION search_apps(
  p_query_embedding vector(1536),
  p_user_id UUID,
  p_limit INTEGER DEFAULT 20,
  p_offset INTEGER DEFAULT 0
) RETURNS TABLE (
  id UUID,
  name TEXT,
  slug TEXT,
  description TEXT,
  owner_id UUID,
  visibility TEXT,
  similarity FLOAT,
  skills_parsed JSONB,
  likes INTEGER,
  dislikes INTEGER,
  weighted_likes INTEGER,
  weighted_dislikes INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    a.id,
    a.name,
    a.slug,
    a.description,
    a.owner_id,
    a.visibility,
    1 - (a.skills_embedding <=> p_query_embedding) as similarity,
    a.skills_parsed,
    COALESCE(a.likes, 0),
    COALESCE(a.dislikes, 0),
    COALESCE(a.weighted_likes, 0),
    COALESCE(a.weighted_dislikes, 0)
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
-- 4. APPSTORE QUERIES TABLE (demand logging)
-- ============================================
-- Logs every appstore search: query text, scores, result positions.
-- Anonymous (no user_id). Enables unmet demand analysis and
-- impression/conversion tracking via offline correlation.

CREATE TABLE IF NOT EXISTS appstore_queries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  query TEXT NOT NULL,
  top_similarity FLOAT,
  top_final_score FLOAT,
  result_count INTEGER,
  results JSONB,  -- [{app_id, position, final_score, similarity}]
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_appstore_queries_time
  ON appstore_queries(created_at DESC);

-- ============================================
-- 5. SOURCE COLUMN ON MCP_CALL_LOGS
-- ============================================
-- Tracks where an app execution originated:
-- 'direct', 'appstore', 'library', 'desk'

ALTER TABLE mcp_call_logs ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'direct';

-- ============================================
-- 6. BACKFILL WEIGHTED COUNTS
-- ============================================
-- One-time computation for existing like data.

UPDATE apps SET
  weighted_likes = COALESCE((
    SELECT COUNT(*) FROM app_likes al
    JOIN users u ON u.id = al.user_id
    WHERE al.app_id = apps.id AND al.positive AND u.tier != 'free'
  ), 0),
  weighted_dislikes = COALESCE((
    SELECT COUNT(*) FROM app_likes al
    JOIN users u ON u.id = al.user_id
    WHERE al.app_id = apps.id AND NOT al.positive AND u.tier != 'free'
  ), 0)
WHERE id IN (SELECT DISTINCT app_id FROM app_likes);

-- ============================================
-- NOTES
-- ============================================
-- Ranking formula (applied in TypeScript, not SQL):
--   final_score = (similarity * 0.7) + (native_boost * 0.15) + (like_signal * 0.15)
--
-- native_boost:
--   1.0 = no per_user env_schema keys (fully native)
--   0.3 = per_user keys exist, all optional
--   0.0 = required per_user keys, user NOT connected
--   0.8 = required per_user keys, user HAS connected
--
-- like_signal:
--   weighted_likes / (weighted_likes + weighted_dislikes + 1)
--   Free-tier likes have zero weight in ranking (but still count in total likes/dislikes)
--
-- Luck shuffle:
--   Top 5 results get a random bonus: Math.random() * (top_score - this_score) * 0.5
--   Re-sorted by final_score + luck_bonus
--   Rotates position #1 among closely-scored apps
