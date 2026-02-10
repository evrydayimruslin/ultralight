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
-- 5. SEARCH_APPS — Updated for slug return
-- ============================================
-- Must DROP first because return type is changing (adding slug column).

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
  skills_parsed JSONB
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

-- ============================================
-- NOTES
-- ============================================
-- After running this migration, the new ul.* Platform MCP tools
-- will have all required database columns and RPC functions.
--
-- Key changes:
-- - apps.download_access controls who can use ul.download
-- - apps.app_type tracks MCP vs legacy (null)
-- - search_apps() now returns slug for display in discover results
-- - update_app_embedding() provides atomic embedding updates
-- - mcp_call_logs has app_id index for ul.logs owner queries
