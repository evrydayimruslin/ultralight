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
-- 5. SEARCH_APPS — (defined in section 9 with review fields)
-- ============================================
-- Moved to section 9 to include review_positive, review_total, review_score.

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
-- 8. APP REVIEWS — Binary review system (ul.review)
-- ============================================
-- Paid users only, one review per user per app, upsert-friendly.

CREATE TABLE IF NOT EXISTS app_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id UUID NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  positive BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(app_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_app_reviews_app ON app_reviews(app_id);
CREATE INDEX IF NOT EXISTS idx_app_reviews_user ON app_reviews(user_id);

-- Denormalized review counters on apps
ALTER TABLE apps ADD COLUMN IF NOT EXISTS review_positive INTEGER DEFAULT 0;
ALTER TABLE apps ADD COLUMN IF NOT EXISTS review_total INTEGER DEFAULT 0;
ALTER TABLE apps ADD COLUMN IF NOT EXISTS review_score INTEGER DEFAULT 0;

-- Trigger function: recompute review_positive, review_total, review_score
-- on every INSERT/UPDATE/DELETE in app_reviews.
-- review_score = positive_count - negative_count (positive minus negative).
CREATE OR REPLACE FUNCTION update_app_review_counts() RETURNS trigger AS $$
DECLARE
  target_app_id UUID;
  pos_count INTEGER;
  tot_count INTEGER;
BEGIN
  -- Determine which app_id to recompute for
  IF TG_OP = 'DELETE' THEN
    target_app_id := OLD.app_id;
  ELSE
    target_app_id := NEW.app_id;
  END IF;

  -- If UPDATE changed app_id (unlikely but safe), also recompute old app
  IF TG_OP = 'UPDATE' AND OLD.app_id IS DISTINCT FROM NEW.app_id THEN
    SELECT COUNT(*) FILTER (WHERE positive), COUNT(*)
      INTO pos_count, tot_count
      FROM app_reviews WHERE app_id = OLD.app_id;
    UPDATE apps SET
      review_positive = pos_count,
      review_total = tot_count,
      review_score = pos_count - (tot_count - pos_count),
      updated_at = NOW()
    WHERE id = OLD.app_id;
  END IF;

  -- Recompute for the target app
  SELECT COUNT(*) FILTER (WHERE positive), COUNT(*)
    INTO pos_count, tot_count
    FROM app_reviews WHERE app_id = target_app_id;

  UPDATE apps SET
    review_positive = pos_count,
    review_total = tot_count,
    review_score = pos_count - (tot_count - pos_count),
    updated_at = NOW()
  WHERE id = target_app_id;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Attach trigger
DROP TRIGGER IF EXISTS trg_app_reviews ON app_reviews;
CREATE TRIGGER trg_app_reviews
  AFTER INSERT OR UPDATE OR DELETE ON app_reviews
  FOR EACH ROW EXECUTE FUNCTION update_app_review_counts();

-- ============================================
-- 9. SEARCH_APPS — Add review fields to return type
-- ============================================
-- Must DROP again because return type is changing (adding review columns).

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
  review_positive INTEGER,
  review_total INTEGER,
  review_score INTEGER
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
    COALESCE(a.review_positive, 0),
    COALESCE(a.review_total, 0),
    COALESCE(a.review_score, 0)
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

-- RLS for app_reviews
ALTER TABLE app_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_reviews_select ON app_reviews
  FOR SELECT USING (true);  -- Anyone can read reviews

CREATE POLICY app_reviews_own ON app_reviews
  FOR ALL USING (user_id = auth.uid());

-- ============================================
-- NOTES
-- ============================================
-- After running this migration, the new ul.* Platform MCP tools
-- will have all required database columns and RPC functions.
--
-- Key changes:
-- - apps.download_access controls who can use ul.download
-- - apps.app_type tracks MCP vs legacy (null)
-- - search_apps() now returns slug + review data for discovery results
-- - update_app_embedding() provides atomic embedding updates
-- - mcp_call_logs has app_id index for ul.logs owner queries
-- - app_reviews table + trigger keeps review_positive/total/score on apps in sync
-- - review_score = positive_count - negative_count (Rotten Tomatoes style)
