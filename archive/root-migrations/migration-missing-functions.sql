-- Run this in Supabase SQL Editor to apply all missing migrations.
-- This fixes: marketplace empty, storage tracking, data metering.

-- ============================================
-- 1. Missing column: featured_at (fixes empty marketplace)
-- ============================================
ALTER TABLE apps ADD COLUMN IF NOT EXISTS featured_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_apps_featured ON apps (featured_at DESC NULLS LAST) WHERE featured_at IS NOT NULL;

-- ============================================
-- 2. Missing column: version_metadata (upload storage tracking)
-- ============================================
ALTER TABLE apps ADD COLUMN IF NOT EXISTS version_metadata JSONB DEFAULT '[]';

-- ============================================
-- 3. Missing RPC: record_upload_storage (tracks app source code size)
-- ============================================
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
  UPDATE users
  SET storage_used_bytes = storage_used_bytes + p_size_bytes,
      updated_at = NOW()
  WHERE id = p_user_id;

  UPDATE apps
  SET storage_bytes = p_size_bytes,
      updated_at = NOW()
  WHERE id = p_app_id;

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
-- 4. Data storage metering columns + RPCs
-- ============================================
ALTER TABLE users ADD COLUMN IF NOT EXISTS data_storage_used_bytes BIGINT DEFAULT 0;

UPDATE users SET storage_limit_bytes = 104857600
WHERE storage_limit_bytes < 104857600;

ALTER TABLE users ALTER COLUMN storage_limit_bytes SET DEFAULT 104857600; -- 100MB

CREATE INDEX IF NOT EXISTS idx_users_data_storage_positive
  ON users(data_storage_used_bytes)
  WHERE data_storage_used_bytes > 0;

-- Atomic increment/decrement for data storage tracking
CREATE OR REPLACE FUNCTION adjust_data_storage(
  p_user_id UUID,
  p_delta_bytes BIGINT
)
RETURNS TABLE(
  new_bytes BIGINT,
  combined_bytes BIGINT,
  storage_limit BIGINT,
  over_limit BOOLEAN
) AS $$
  UPDATE users
  SET data_storage_used_bytes = GREATEST(0::BIGINT, data_storage_used_bytes + p_delta_bytes),
      updated_at = NOW()
  WHERE id = p_user_id
  RETURNING
    data_storage_used_bytes AS new_bytes,
    (storage_used_bytes + data_storage_used_bytes) AS combined_bytes,
    storage_limit_bytes AS storage_limit,
    ((storage_used_bytes + data_storage_used_bytes) > storage_limit_bytes) AS over_limit;
$$ LANGUAGE SQL;

-- Quota check RPC
CREATE OR REPLACE FUNCTION check_data_storage_quota(
  p_user_id UUID,
  p_additional_bytes BIGINT
)
RETURNS TABLE(
  allowed BOOLEAN,
  source_used_bytes BIGINT,
  data_used_bytes BIGINT,
  combined_used_bytes BIGINT,
  limit_bytes BIGINT,
  remaining_bytes BIGINT,
  has_hosting_balance BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    ((u.storage_used_bytes + u.data_storage_used_bytes + p_additional_bytes) <= u.storage_limit_bytes
     OR u.hosting_balance_cents > 0) AS allowed,
    u.storage_used_bytes AS source_used_bytes,
    u.data_storage_used_bytes AS data_used_bytes,
    (u.storage_used_bytes + u.data_storage_used_bytes) AS combined_used_bytes,
    u.storage_limit_bytes AS limit_bytes,
    GREATEST(0::BIGINT, u.storage_limit_bytes - u.storage_used_bytes - u.data_storage_used_bytes) AS remaining_bytes,
    (u.hosting_balance_cents > 0) AS has_hosting_balance
  FROM users u
  WHERE u.id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 5. Verify
-- ============================================
-- Should return the functions we just created
SELECT routine_name FROM information_schema.routines
WHERE routine_schema = 'public'
AND routine_name IN ('record_upload_storage', 'adjust_data_storage', 'check_data_storage_quota');
