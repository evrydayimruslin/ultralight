-- Migration: Fusion Search
-- Run AFTER: migration-content-layer.sql, migration-content-likes.sql
-- Adds: vector index on content.embedding, GIN text index on embedding_text,
--        search_content_fusion() RPC combining semantic + keyword matching.
-- Purpose: Better search precision — exact keyword matches are found even when
--          embeddings give weak similarity. KV data with NULL embeddings is
--          immediately keyword-searchable before the background processor runs.

-- ============================================
-- 1. VECTOR INDEX ON CONTENT TABLE
-- ============================================
-- The content table had no vector index (only apps.skills_embedding had one).
-- This dramatically improves vector search performance.

CREATE INDEX IF NOT EXISTS idx_content_embedding_ivfflat
  ON content USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- ============================================
-- 2. GIN TEXT SEARCH INDEX
-- ============================================
-- For keyword matching on embedding_text column.

CREATE INDEX IF NOT EXISTS idx_content_embedding_text_gin
  ON content USING gin (to_tsvector('simple', COALESCE(embedding_text, '')));

-- ============================================
-- 3. FUSION SEARCH RPC
-- ============================================
-- Combines vector similarity with keyword matching.
-- Vector: 1 - (embedding <=> query_embedding) as semantic score
-- Keyword: fraction of query words found in embedding_text via ILIKE
-- Final: GREATEST(semantic, keyword * 0.85)
-- Keyword capped at 0.85 so semantic wins when both match equally.

DROP FUNCTION IF EXISTS search_content_fusion(vector, TEXT, UUID, TEXT[], TEXT, INTEGER);

CREATE OR REPLACE FUNCTION search_content_fusion(
  p_query_embedding vector(1536),
  p_query_text TEXT,
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
  keyword_score FLOAT,
  final_score FLOAT,
  tags TEXT[],
  published BOOLEAN,
  updated_at TIMESTAMPTZ,
  likes INTEGER,
  dislikes INTEGER,
  weighted_likes INTEGER,
  weighted_dislikes INTEGER
) AS $$
DECLARE
  v_words TEXT[];
  v_word_count INTEGER;
BEGIN
  -- Parse query into individual words (lowercase, trimmed, non-empty)
  v_words := array_remove(string_to_array(lower(trim(COALESCE(p_query_text, ''))), ' '), '');
  v_word_count := COALESCE(array_length(v_words, 1), 0);

  -- Handle empty query: return pure vector results
  IF v_word_count = 0 THEN
    v_word_count := 1;
  END IF;

  RETURN QUERY
  WITH accessible AS (
    -- Base: all accessible content (same visibility logic as search_content)
    SELECT DISTINCT ON (c.id) c.*
    FROM content c
    LEFT JOIN content_shares cs
      ON cs.content_id = c.id
      AND (cs.shared_with_user_id = p_user_id OR cs.shared_with_email = (
        SELECT email FROM users WHERE users.id = p_user_id LIMIT 1
      ))
      AND (cs.expires_at IS NULL OR cs.expires_at > NOW())
    WHERE
      (p_types IS NULL OR c.type = ANY(p_types))
      AND (
        c.visibility = 'public'
        OR c.owner_id = p_user_id
        OR cs.id IS NOT NULL
      )
      AND (p_visibility IS NULL OR c.visibility = p_visibility)
  ),
  vector_results AS (
    -- Vector similarity search (only rows with embeddings)
    SELECT
      a.id,
      1 - (a.embedding <=> p_query_embedding) AS v_similarity
    FROM accessible a
    WHERE a.embedding IS NOT NULL
    ORDER BY a.embedding <=> p_query_embedding
    LIMIT p_limit * 3
  ),
  keyword_results AS (
    -- Keyword matching: count how many query words appear in embedding_text
    SELECT
      a.id,
      CASE WHEN v_word_count > 0 THEN
        (
          SELECT COUNT(*)::FLOAT / v_word_count
          FROM unnest(v_words) AS w(word)
          WHERE lower(COALESCE(a.embedding_text, '')) LIKE '%' || w.word || '%'
        )
      ELSE 0.0
      END AS k_score
    FROM accessible a
    WHERE a.embedding_text IS NOT NULL
      AND v_word_count > 0
      AND lower(a.embedding_text) LIKE '%' || v_words[1] || '%'
    ORDER BY k_score DESC
    LIMIT p_limit * 3
  ),
  fused AS (
    -- Merge with GREATEST(semantic, keyword * 0.85) per row
    SELECT
      COALESCE(vr.id, kr.id) AS fused_id,
      COALESCE(vr.v_similarity, 0.0) AS sem_score,
      COALESCE(kr.k_score, 0.0) AS kw_score,
      GREATEST(
        COALESCE(vr.v_similarity, 0.0),
        COALESCE(kr.k_score, 0.0) * 0.85
      ) AS f_score
    FROM vector_results vr
    FULL OUTER JOIN keyword_results kr ON vr.id = kr.id
  )
  SELECT
    c.id,
    c.type,
    c.slug,
    c.title,
    c.description,
    c.owner_id,
    c.visibility,
    f.sem_score AS similarity,
    f.kw_score AS keyword_score,
    f.f_score AS final_score,
    c.tags,
    c.published,
    c.updated_at,
    COALESCE(c.likes, 0),
    COALESCE(c.dislikes, 0),
    COALESCE(c.weighted_likes, 0),
    COALESCE(c.weighted_dislikes, 0)
  FROM fused f
  JOIN content c ON c.id = f.fused_id
  ORDER BY f.f_score DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION search_content_fusion IS
  'Fusion search combining vector similarity and keyword matching. Returns GREATEST(semantic, keyword*0.85) per row. Content with NULL embedding is still keyword-searchable. Respects visibility and sharing.';
