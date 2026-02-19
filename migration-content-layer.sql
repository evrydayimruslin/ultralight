-- Migration: Unified Content Layer
-- Adds content index table, content sharing, memory key sharing,
-- and search_content() RPC for unified vector search across
-- pages, memory.md, and library.md alongside apps.
--
-- Run AFTER: migration-search-algo.sql (for pgvector + search_apps)

-- ============================================
-- 1. CONTENT INDEX TABLE
-- ============================================
-- Indexes all non-app content. Actual content lives in R2.
-- This table stores metadata, embeddings, and access control.

CREATE TABLE IF NOT EXISTS content (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Identity
  type TEXT NOT NULL,               -- 'page' | 'memory_md' | 'library_md'
  slug TEXT NOT NULL,               -- page slug, or '_memory' / '_library' sentinel
  title TEXT,
  description TEXT,                 -- short summary for search results

  -- Visibility & Access
  visibility TEXT NOT NULL DEFAULT 'private',  -- 'public' | 'private' | 'shared'
  access_token TEXT,                -- random UUID for shared link access (?token=...)

  -- Search (same pgvector as apps.skills_embedding)
  embedding vector(1536),
  embedding_text TEXT,              -- the text that was embedded (for debugging)

  -- Metadata
  size INTEGER,
  tags TEXT[],                      -- optional tags for filtering/discovery
  published BOOLEAN DEFAULT false,  -- if true AND public, discoverable in appstore

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(owner_id, type, slug)
);

CREATE INDEX IF NOT EXISTS idx_content_owner ON content(owner_id);
CREATE INDEX IF NOT EXISTS idx_content_type_vis ON content(type, visibility);
CREATE INDEX IF NOT EXISTS idx_content_published ON content(published) WHERE published = true;

-- ============================================
-- 2. CONTENT SHARING
-- ============================================
-- Per-email sharing for whole content items (pages, memory.md, library.md).
-- Similar to user_app_permissions but for content, not functions.

CREATE TABLE IF NOT EXISTS content_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id UUID NOT NULL REFERENCES content(id) ON DELETE CASCADE,
  shared_with_email TEXT NOT NULL,
  shared_with_user_id UUID REFERENCES users(id),  -- null if user hasn't signed up yet
  access_level TEXT NOT NULL DEFAULT 'read',       -- 'read' | 'readwrite'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,                          -- optional auto-expiry
  UNIQUE(content_id, shared_with_email)
);

CREATE INDEX IF NOT EXISTS idx_content_shares_user ON content_shares(shared_with_user_id);
CREATE INDEX IF NOT EXISTS idx_content_shares_email ON content_shares(shared_with_email);

-- ============================================
-- 3. MEMORY KEY SHARING (pattern-based)
-- ============================================
-- For sharing specific KV memory keys by pattern (e.g. "project_*").
-- Separate from content_shares because KV keys use pattern matching,
-- not FK references.

CREATE TABLE IF NOT EXISTS memory_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope TEXT NOT NULL DEFAULT 'user',
  key_pattern TEXT NOT NULL,            -- exact key or prefix pattern (e.g. "project_*")
  shared_with_email TEXT NOT NULL,
  shared_with_user_id UUID REFERENCES users(id),
  access_level TEXT NOT NULL DEFAULT 'read',  -- 'read' | 'write' | 'readwrite'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  UNIQUE(owner_user_id, scope, key_pattern, shared_with_email)
);

CREATE INDEX IF NOT EXISTS idx_memory_shares_owner ON memory_shares(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_memory_shares_email ON memory_shares(shared_with_email);

-- ============================================
-- 4. UNIFIED SEARCH RPC
-- ============================================
-- Vector search over the content table. Respects visibility + sharing.
-- Composable with existing search_apps() for unified discovery.

CREATE OR REPLACE FUNCTION search_content(
  p_query_embedding vector(1536),
  p_user_id UUID,
  p_types TEXT[] DEFAULT NULL,       -- filter: ['page', 'memory_md'] or NULL for all
  p_visibility TEXT DEFAULT NULL,    -- filter: 'public' or NULL for all accessible
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
  updated_at TIMESTAMPTZ
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
    c.updated_at
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
      c.visibility = 'public'                              -- public to all
      OR c.owner_id = p_user_id                           -- own content
      OR cs.id IS NOT NULL                                 -- shared with me
    )
    AND (p_visibility IS NULL OR c.visibility = p_visibility)
  ORDER BY similarity DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION search_content IS
  'Vector search over content table (pages, memory, library). Respects visibility and sharing. Composable with search_apps() for unified discovery.';
