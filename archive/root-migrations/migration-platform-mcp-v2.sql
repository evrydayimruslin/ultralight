-- Migration: Platform MCP v2 — ul.* Tools Support
-- Run AFTER: migration.sql, migration-mcp-skills.sql, migration-tier-v2.sql,
--            migration-permissions.sql, migration-supabase-servers.sql
--
-- Adds columns needed by the new ul.* tool namespace:
--   - download_access on apps (for ul.set.download)
--   - app_type on apps (for MCP-only enforcement)
--   - manifest on apps (for v2 manifests)
--   - icon_url, category, tags, declared_permissions on apps
--   - Ensures versions is a proper JSONB array
-- Also adds the update_app_embedding RPC used by the library service.

-- ============================================
-- 1. APP TABLE — NEW COLUMNS
-- ============================================

-- download_access: who can download source code (ul.set.download)
ALTER TABLE apps ADD COLUMN IF NOT EXISTS download_access TEXT DEFAULT 'owner'
  CHECK (download_access IN ('owner', 'public'));

-- app_type: 'mcp' or null (legacy)
ALTER TABLE apps ADD COLUMN IF NOT EXISTS app_type TEXT;

-- manifest: serialized AppManifest JSON
ALTER TABLE apps ADD COLUMN IF NOT EXISTS manifest JSONB;

-- icon_url: app icon
ALTER TABLE apps ADD COLUMN IF NOT EXISTS icon_url TEXT;

-- category: e.g. 'productivity', 'data', etc.
ALTER TABLE apps ADD COLUMN IF NOT EXISTS category TEXT;

-- tags: array of searchable tags
ALTER TABLE apps ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '[]';

-- declared_permissions: permissions the app requests
ALTER TABLE apps ADD COLUMN IF NOT EXISTS declared_permissions JSONB DEFAULT '[]';

-- env_vars: encrypted env vars for the app
ALTER TABLE apps ADD COLUMN IF NOT EXISTS env_vars JSONB DEFAULT '{}';

-- HTTP endpoint settings
ALTER TABLE apps ADD COLUMN IF NOT EXISTS http_enabled BOOLEAN DEFAULT false;
ALTER TABLE apps ADD COLUMN IF NOT EXISTS http_path TEXT;

-- deleted_at for soft delete
ALTER TABLE apps ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- last_build_at, last_build_error columns
ALTER TABLE apps ADD COLUMN IF NOT EXISTS last_build_at TIMESTAMPTZ;
ALTER TABLE apps ADD COLUMN IF NOT EXISTS last_build_error TEXT;

-- unique user counts
ALTER TABLE apps ADD COLUMN IF NOT EXISTS total_unique_users INTEGER DEFAULT 0;
ALTER TABLE apps ADD COLUMN IF NOT EXISTS runs_7d INTEGER DEFAULT 0;

-- ============================================
-- 2. APP TABLE — INDEXES
-- ============================================

-- Index for download_access queries
CREATE INDEX IF NOT EXISTS idx_apps_download_access
  ON apps(download_access)
  WHERE download_access = 'public';

-- Index for soft-deleted filtering
CREATE INDEX IF NOT EXISTS idx_apps_not_deleted
  ON apps(id)
  WHERE deleted_at IS NULL;

-- ============================================
-- 3. UPDATE_APP_EMBEDDING RPC
-- ============================================
-- Used by AppsService.updateEmbedding() as the primary path.
-- Falls back to direct PATCH if this RPC doesn't exist.

CREATE OR REPLACE FUNCTION update_app_embedding(
  p_app_id UUID,
  p_embedding vector(1536)
) RETURNS void AS $$
BEGIN
  UPDATE apps
  SET skills_embedding = p_embedding,
      updated_at = NOW()
  WHERE id = p_app_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 4. INCREMENT_APP_RUNS RPC
-- ============================================
-- Atomic run counter for apps.

CREATE OR REPLACE FUNCTION increment_app_runs(app_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE apps
  SET total_runs = COALESCE(total_runs, 0) + 1,
      runs_7d = COALESCE(runs_7d, 0) + 1,
      runs_30d = COALESCE(runs_30d, 0) + 1,
      updated_at = NOW()
  WHERE id = app_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 5. SEARCH_APPS — (defined in section 9 with like fields)
-- ============================================
-- Moved to section 9 to include likes, dislikes.

-- ============================================
-- 6. BYOK CONFIGS — Ensure multi-provider columns exist
-- ============================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS byok_configs JSONB DEFAULT '[]';
ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_credit_balance INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_credit_resets_at TIMESTAMPTZ;

-- ============================================
-- 7. MCP CALL LOGS — Index for owner-centric queries (ul.logs)
-- ============================================
-- ul.logs queries by app_id (owner viewing their app's logs).
-- The existing idx_mcp_logs_user_time indexes by caller user_id.
-- This adds an app_id index for efficient owner queries.

CREATE INDEX IF NOT EXISTS idx_mcp_logs_app_time
  ON mcp_call_logs(app_id, created_at DESC);

-- Composite index for app + function filtering
CREATE INDEX IF NOT EXISTS idx_mcp_logs_app_function
  ON mcp_call_logs(app_id, function_name);

-- Rich telemetry columns for tool-use training data
ALTER TABLE mcp_call_logs ADD COLUMN IF NOT EXISTS input_args JSONB;
ALTER TABLE mcp_call_logs ADD COLUMN IF NOT EXISTS output_result JSONB;
ALTER TABLE mcp_call_logs ADD COLUMN IF NOT EXISTS user_tier TEXT;
ALTER TABLE mcp_call_logs ADD COLUMN IF NOT EXISTS app_version TEXT;
ALTER TABLE mcp_call_logs ADD COLUMN IF NOT EXISTS ai_cost_cents FLOAT DEFAULT 0;
ALTER TABLE mcp_call_logs ADD COLUMN IF NOT EXISTS session_id TEXT;
ALTER TABLE mcp_call_logs ADD COLUMN IF NOT EXISTS sequence_number INTEGER;
ALTER TABLE mcp_call_logs ADD COLUMN IF NOT EXISTS user_query TEXT;

-- Session replay index
CREATE INDEX IF NOT EXISTS idx_mcp_logs_session
  ON mcp_call_logs(session_id, sequence_number)
  WHERE session_id IS NOT NULL;

-- Training data export index
CREATE INDEX IF NOT EXISTS idx_mcp_logs_rich
  ON mcp_call_logs(created_at DESC)
  WHERE input_args IS NOT NULL AND output_result IS NOT NULL;

-- ============================================
-- 8. APP LIKES — Binary like/dislike system (ul.like)
-- ============================================
-- Paid users only, one like per user per app, upsert-friendly.

CREATE TABLE IF NOT EXISTS app_likes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id UUID NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  positive BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(app_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_app_likes_app ON app_likes(app_id);
CREATE INDEX IF NOT EXISTS idx_app_likes_user ON app_likes(user_id);

-- Denormalized like/dislike counters on apps
ALTER TABLE apps ADD COLUMN IF NOT EXISTS likes INTEGER DEFAULT 0;
ALTER TABLE apps ADD COLUMN IF NOT EXISTS dislikes INTEGER DEFAULT 0;
ALTER TABLE apps ADD COLUMN IF NOT EXISTS weighted_likes INTEGER DEFAULT 0;
ALTER TABLE apps ADD COLUMN IF NOT EXISTS weighted_dislikes INTEGER DEFAULT 0;

-- Trigger function: recompute likes, dislikes, weighted_likes, weighted_dislikes
-- on every INSERT/UPDATE/DELETE in app_likes.
-- JOINs users to compute weighted counts (paid tiers only).
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

-- Attach trigger
DROP TRIGGER IF EXISTS trg_app_likes ON app_likes;
CREATE TRIGGER trg_app_likes
  AFTER INSERT OR UPDATE OR DELETE ON app_likes
  FOR EACH ROW EXECUTE FUNCTION update_app_like_counts();

-- ============================================
-- 9. SEARCH_APPS — Add like fields to return type
-- ============================================
-- Must DROP again because return type is changing.

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

-- RLS for app_likes
ALTER TABLE app_likes ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_likes_select ON app_likes
  FOR SELECT USING (true);  -- Anyone can read likes

CREATE POLICY app_likes_own ON app_likes
  FOR ALL USING (user_id = auth.uid());

-- ============================================
-- 10. PER-USER SECRETS — ul.connect / ul.connections
-- ============================================
-- App owners declare per-user env var schema via apps.env_schema.
-- End users store their encrypted secrets in user_app_secrets.

-- env_schema: declares which env vars are per-user (with description, required flag)
ALTER TABLE apps ADD COLUMN IF NOT EXISTS env_schema JSONB DEFAULT '{}';

-- user_app_secrets: encrypted per-user secrets for apps
CREATE TABLE IF NOT EXISTS user_app_secrets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  app_id UUID NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value_encrypted TEXT NOT NULL,  -- AES-256-GCM encrypted value
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, app_id, key)
);

CREATE INDEX IF NOT EXISTS idx_user_app_secrets_user_app
  ON user_app_secrets(user_id, app_id);

CREATE INDEX IF NOT EXISTS idx_user_app_secrets_app
  ON user_app_secrets(app_id);

-- RLS for user_app_secrets
ALTER TABLE user_app_secrets ENABLE ROW LEVEL SECURITY;

-- Users can only see/manage their own secrets
CREATE POLICY user_app_secrets_own ON user_app_secrets
  FOR ALL USING (user_id = auth.uid());

-- App owners can see which users have connected (but NOT the secret values)
-- This is handled at the application level via service role key

-- ============================================
-- NOTES
-- ============================================
-- After running this migration, the new ul.* Platform MCP tools
-- will have all required database columns and RPC functions.
--
-- Key changes:
-- - apps.download_access controls who can use ul.download
-- - apps.app_type tracks MCP vs legacy (null)
-- - search_apps() now returns slug + like data for discovery results
-- - update_app_embedding() provides atomic embedding updates
-- - mcp_call_logs has app_id index for ul.logs owner queries
-- - mcp_call_logs has rich telemetry: input_args, output_result, session_id, user_query
-- - app_likes table + trigger keeps likes/dislikes/weighted_likes/weighted_dislikes on apps in sync
-- - apps.env_schema declares per-user secret requirements
-- - user_app_secrets stores encrypted per-user secrets (ul.connect/ul.connections)
