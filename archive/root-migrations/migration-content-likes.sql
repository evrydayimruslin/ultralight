-- Content Likes Migration — Page rating/library/block parity with apps
-- STATUS: Pending — run on Supabase
--
-- Mirrors the app like system (app_likes, user_app_library, user_app_blocks)
-- for the content table (pages, memory_md, library_md).

-- ============================================
-- 1. DENORMALIZED COUNTERS ON CONTENT TABLE
-- ============================================

ALTER TABLE content ADD COLUMN IF NOT EXISTS likes INTEGER DEFAULT 0;
ALTER TABLE content ADD COLUMN IF NOT EXISTS dislikes INTEGER DEFAULT 0;
ALTER TABLE content ADD COLUMN IF NOT EXISTS weighted_likes INTEGER DEFAULT 0;
ALTER TABLE content ADD COLUMN IF NOT EXISTS weighted_dislikes INTEGER DEFAULT 0;

-- ============================================
-- 2. CONTENT_LIKES TABLE (mirrors app_likes)
-- ============================================

CREATE TABLE IF NOT EXISTS content_likes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id UUID NOT NULL REFERENCES content(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  positive BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(content_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_content_likes_content ON content_likes(content_id);
CREATE INDEX IF NOT EXISTS idx_content_likes_user ON content_likes(user_id);

-- ============================================
-- 3. USER_CONTENT_LIBRARY (mirrors user_app_library)
-- ============================================
-- Liked pages saved to user's library for discovery.

CREATE TABLE IF NOT EXISTS user_content_library (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content_id UUID NOT NULL REFERENCES content(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'like',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, content_id)
);

CREATE INDEX IF NOT EXISTS idx_user_content_library_user ON user_content_library(user_id);
CREATE INDEX IF NOT EXISTS idx_user_content_library_content ON user_content_library(content_id);

-- ============================================
-- 4. USER_CONTENT_BLOCKS (mirrors user_app_blocks)
-- ============================================
-- Disliked pages hidden from appstore discovery.

CREATE TABLE IF NOT EXISTS user_content_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content_id UUID NOT NULL REFERENCES content(id) ON DELETE CASCADE,
  reason TEXT NOT NULL DEFAULT 'dislike',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, content_id)
);

CREATE INDEX IF NOT EXISTS idx_user_content_blocks_user ON user_content_blocks(user_id);

-- ============================================
-- 5. TRIGGER: AUTO-UPDATE CONTENT LIKE COUNTERS
-- ============================================
-- Mirrors update_app_like_counts() from migration-platform-mcp-v2.sql.
-- Weighted counts only include non-free tier users.

CREATE OR REPLACE FUNCTION update_content_like_counts() RETURNS trigger AS $$
DECLARE
  target_content_id UUID;
  like_count INTEGER;
  dislike_count INTEGER;
  w_like_count INTEGER;
  w_dislike_count INTEGER;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_content_id := OLD.content_id;
  ELSE
    target_content_id := NEW.content_id;
  END IF;

  -- If UPDATE changed content_id, also recompute old content
  IF TG_OP = 'UPDATE' AND OLD.content_id IS DISTINCT FROM NEW.content_id THEN
    SELECT
      COUNT(*) FILTER (WHERE cl.positive),
      COUNT(*) FILTER (WHERE NOT cl.positive),
      COUNT(*) FILTER (WHERE cl.positive AND u.tier != 'free'),
      COUNT(*) FILTER (WHERE NOT cl.positive AND u.tier != 'free')
    INTO like_count, dislike_count, w_like_count, w_dislike_count
    FROM content_likes cl
    JOIN users u ON u.id = cl.user_id
    WHERE cl.content_id = OLD.content_id;

    UPDATE content SET
      likes = like_count,
      dislikes = dislike_count,
      weighted_likes = w_like_count,
      weighted_dislikes = w_dislike_count,
      updated_at = NOW()
    WHERE id = OLD.content_id;
  END IF;

  -- Recompute for the target content
  SELECT
    COUNT(*) FILTER (WHERE cl.positive),
    COUNT(*) FILTER (WHERE NOT cl.positive),
    COUNT(*) FILTER (WHERE cl.positive AND u.tier != 'free'),
    COUNT(*) FILTER (WHERE NOT cl.positive AND u.tier != 'free')
  INTO like_count, dislike_count, w_like_count, w_dislike_count
  FROM content_likes cl
  JOIN users u ON u.id = cl.user_id
  WHERE cl.content_id = target_content_id;

  UPDATE content SET
    likes = like_count,
    dislikes = dislike_count,
    weighted_likes = w_like_count,
    weighted_dislikes = w_dislike_count,
    updated_at = NOW()
  WHERE id = target_content_id;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_content_likes ON content_likes;
CREATE TRIGGER trg_content_likes
  AFTER INSERT OR UPDATE OR DELETE ON content_likes
  FOR EACH ROW EXECUTE FUNCTION update_content_like_counts();

-- ============================================
-- 6. UPDATE search_content() RPC — ADD LIKE COUNTERS
-- ============================================
-- Adds likes, dislikes, weighted_likes, weighted_dislikes to return type.
-- Same query logic, just selects the new columns.

DROP FUNCTION IF EXISTS search_content(vector, UUID, TEXT[], TEXT, INTEGER);

CREATE OR REPLACE FUNCTION search_content(
  p_query_embedding vector(1536),
  p_user_id UUID,
  p_types TEXT[] DEFAULT NULL,
  p_visibility TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 20
) RETURNS TABLE (
  id UUID,
  type TEXT,
  slug TEXT,
  title TEXT,
  description TEXT,
  owner_id UUID,
  visibility TEXT,
  similarity FLOAT,
  tags TEXT[],
  published BOOLEAN,
  updated_at TIMESTAMPTZ,
  likes INTEGER,
  dislikes INTEGER,
  weighted_likes INTEGER,
  weighted_dislikes INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    c.type,
    c.slug,
    c.title,
    c.description,
    c.owner_id,
    c.visibility,
    1 - (c.embedding <=> p_query_embedding) as similarity,
    c.tags,
    c.published,
    c.updated_at,
    COALESCE(c.likes, 0),
    COALESCE(c.dislikes, 0),
    COALESCE(c.weighted_likes, 0),
    COALESCE(c.weighted_dislikes, 0)
  FROM content c
  LEFT JOIN content_shares cs
    ON cs.content_id = c.id
    AND (cs.shared_with_user_id = p_user_id OR cs.shared_with_email = (
      SELECT email FROM users WHERE id = p_user_id LIMIT 1
    ))
    AND (cs.expires_at IS NULL OR cs.expires_at > NOW())
  WHERE
    c.embedding IS NOT NULL
    AND (p_types IS NULL OR c.type = ANY(p_types))
    AND (
      c.visibility = 'public'
      OR c.owner_id = p_user_id
      OR cs.id IS NOT NULL
    )
    AND (p_visibility IS NULL OR c.visibility = p_visibility)
  ORDER BY similarity DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION search_content IS
  'Vector search over content table (pages, memory, library). Respects visibility and sharing. Returns like counters for scoring.';
