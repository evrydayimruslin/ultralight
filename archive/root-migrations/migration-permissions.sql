-- Migration: User App Permissions (Model B)
-- Per-user, per-app, per-function access control.
-- Private apps: only explicitly granted users can access specific functions.
-- Unlisted/Published apps: open to all authenticated users, no permission check.
-- Default: all functions denied for ungrated users on private apps.

-- ============================================
-- 1. DROP OLD TOKEN-BASED PERMISSIONS (if exists)
-- ============================================

DROP TABLE IF EXISTS token_function_permissions CASCADE;
DROP FUNCTION IF EXISTS get_allowed_functions(UUID, UUID);

-- ============================================
-- 2. CREATE user_app_permissions TABLE
-- ============================================

CREATE TABLE IF NOT EXISTS user_app_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id UUID NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  granted_to_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  granted_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  function_name TEXT NOT NULL,
  allowed BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(app_id, granted_to_user_id, function_name)
);

CREATE INDEX IF NOT EXISTS idx_user_app_perms_app_user
  ON user_app_permissions(app_id, granted_to_user_id);

CREATE INDEX IF NOT EXISTS idx_user_app_perms_app
  ON user_app_permissions(app_id);

CREATE INDEX IF NOT EXISTS idx_user_app_perms_granted_to
  ON user_app_permissions(granted_to_user_id);

-- ============================================
-- 3. HELPER: Get allowed functions for a user+app
-- ============================================

CREATE OR REPLACE FUNCTION get_user_allowed_functions(
  p_user_id UUID,
  p_app_id UUID
) RETURNS TABLE (function_name TEXT) AS $$
BEGIN
  RETURN QUERY
    SELECT uap.function_name
    FROM user_app_permissions uap
    WHERE uap.granted_to_user_id = p_user_id
      AND uap.app_id = p_app_id
      AND uap.allowed = true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 4. HELPER: Get all granted users for an app
-- ============================================

CREATE OR REPLACE FUNCTION get_app_granted_users(
  p_app_id UUID
) RETURNS TABLE (
  user_id UUID,
  email TEXT,
  display_name TEXT,
  function_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
    SELECT DISTINCT
      u.id AS user_id,
      u.email,
      u.display_name,
      COUNT(uap.function_name) AS function_count
    FROM user_app_permissions uap
    JOIN users u ON u.id = uap.granted_to_user_id
    WHERE uap.app_id = p_app_id
      AND uap.allowed = true
    GROUP BY u.id, u.email, u.display_name
    ORDER BY u.email;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
