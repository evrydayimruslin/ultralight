-- Migration: Storage Tracking & Tier Enforcement
-- Phase 1 of tiered infrastructure
--
-- Adds:
-- 1. version_metadata JSONB column on apps table
-- 2. check_storage_quota() RPC - pre-upload validation
-- 3. record_upload_storage() RPC - post-upload bookkeeping
-- 4. reclaim_app_storage() RPC - reclaim space on delete
-- 5. reclaim_version_storage() RPC - reclaim space for single version
-- 6. Updates default storage_limit_bytes for new free users (100MB)

-- ============================================
-- 1. Add version_metadata column to apps
-- ============================================
-- Stores per-version size tracking alongside existing `versions` text[] column.
-- Format: [{"version": "1.0.0", "size_bytes": 45230, "created_at": "2025-01-15T..."}, ...]
ALTER TABLE apps ADD COLUMN IF NOT EXISTS version_metadata JSONB DEFAULT '[]';

-- ============================================
-- 2. Update default storage limit for new free users
-- ============================================
-- Spec: Free = 100MB, Pro = 10GB
-- Existing users will be updated separately (see backfill section below)
ALTER TABLE users ALTER COLUMN storage_limit_bytes SET DEFAULT 104857600; -- 100MB

-- ============================================
-- 3. check_storage_quota() - Pre-upload validation
-- ============================================
-- Returns whether an upload of p_upload_size bytes is allowed,
-- plus current usage details for error messages.
CREATE OR REPLACE FUNCTION check_storage_quota(
  p_user_id UUID,
  p_upload_size BIGINT
) RETURNS TABLE (
  allowed BOOLEAN,
  used_bytes BIGINT,
  limit_bytes BIGINT,
  remaining_bytes BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    (u.storage_used_bytes + p_upload_size <= u.storage_limit_bytes) AS allowed,
    u.storage_used_bytes AS used_bytes,
    u.storage_limit_bytes AS limit_bytes,
    GREATEST(0::BIGINT, u.storage_limit_bytes - u.storage_used_bytes) AS remaining_bytes
  FROM users u
  WHERE u.id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 4. record_upload_storage() - Post-upload bookkeeping
-- ============================================
-- Called after a successful upload. Updates:
-- - users.storage_used_bytes (increment)
-- - apps.storage_bytes (set to this version's size)
-- - apps.version_metadata (append new version entry)
CREATE OR REPLACE FUNCTION record_upload_storage(
  p_user_id UUID,
  p_app_id UUID,
  p_version TEXT,
  p_size_bytes BIGINT
) RETURNS void AS $$
DECLARE
  v_existing_metadata JSONB;
  v_new_entry JSONB;
BEGIN
  -- Update user's total storage used
  UPDATE users
  SET storage_used_bytes = storage_used_bytes + p_size_bytes,
      updated_at = NOW()
  WHERE id = p_user_id;

  -- Update app's current version size
  UPDATE apps
  SET storage_bytes = p_size_bytes,
      updated_at = NOW()
  WHERE id = p_app_id;

  -- Append version metadata entry
  v_new_entry := jsonb_build_object(
    'version', p_version,
    'size_bytes', p_size_bytes,
    'created_at', NOW()
  );

  SELECT COALESCE(version_metadata, '[]'::JSONB)
  INTO v_existing_metadata
  FROM apps
  WHERE id = p_app_id;

  UPDATE apps
  SET version_metadata = v_existing_metadata || jsonb_build_array(v_new_entry)
  WHERE id = p_app_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 5. reclaim_app_storage() - Reclaim all storage for an app
-- ============================================
-- Called when an app is soft-deleted. Reclaims ALL version storage
-- from the user's quota. Returns bytes reclaimed.
CREATE OR REPLACE FUNCTION reclaim_app_storage(
  p_user_id UUID,
  p_app_id UUID
) RETURNS BIGINT AS $$
DECLARE
  v_total_bytes BIGINT;
BEGIN
  -- Calculate total storage across all versions from metadata
  SELECT COALESCE(
    (SELECT SUM((elem->>'size_bytes')::BIGINT)
     FROM jsonb_array_elements(version_metadata) AS elem),
    -- Fallback to storage_bytes if no version_metadata (pre-migration apps)
    COALESCE(storage_bytes, 0)
  ) INTO v_total_bytes
  FROM apps WHERE id = p_app_id;

  -- Subtract from user's total (floor at 0)
  UPDATE users
  SET storage_used_bytes = GREATEST(0::BIGINT, storage_used_bytes - COALESCE(v_total_bytes, 0)),
      updated_at = NOW()
  WHERE id = p_user_id;

  RETURN COALESCE(v_total_bytes, 0);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 6. reclaim_version_storage() - Reclaim storage for a single version
-- ============================================
-- Called when a user deletes a specific old version. Removes the version
-- from metadata and reclaims its storage from the user quota.
CREATE OR REPLACE FUNCTION reclaim_version_storage(
  p_user_id UUID,
  p_app_id UUID,
  p_version TEXT
) RETURNS BIGINT AS $$
DECLARE
  v_version_bytes BIGINT;
  v_current_metadata JSONB;
  v_filtered_metadata JSONB;
BEGIN
  -- Get current metadata
  SELECT COALESCE(version_metadata, '[]'::JSONB)
  INTO v_current_metadata
  FROM apps WHERE id = p_app_id;

  -- Find size of the version being deleted
  SELECT (elem->>'size_bytes')::BIGINT
  INTO v_version_bytes
  FROM jsonb_array_elements(v_current_metadata) AS elem
  WHERE elem->>'version' = p_version;

  IF v_version_bytes IS NULL THEN
    RETURN 0;
  END IF;

  -- Remove the version entry from metadata
  SELECT COALESCE(jsonb_agg(elem), '[]'::JSONB)
  INTO v_filtered_metadata
  FROM jsonb_array_elements(v_current_metadata) AS elem
  WHERE elem->>'version' != p_version;

  -- Update the app's version_metadata
  UPDATE apps
  SET version_metadata = v_filtered_metadata,
      -- Also remove from versions string array
      versions = array_remove(versions, p_version),
      updated_at = NOW()
  WHERE id = p_app_id;

  -- Subtract from user's total (floor at 0)
  UPDATE users
  SET storage_used_bytes = GREATEST(0::BIGINT, storage_used_bytes - v_version_bytes),
      updated_at = NOW()
  WHERE id = p_user_id;

  RETURN v_version_bytes;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 7. Backfill: Update existing users' storage limits
-- ============================================
-- Free users: 100MB (was 500MB)
-- Pro users: 10GB
-- Run this AFTER the backfill script populates storage_used_bytes
UPDATE users SET storage_limit_bytes = 104857600 WHERE tier = 'free';
UPDATE users SET storage_limit_bytes = 10737418240 WHERE tier = 'pro';
