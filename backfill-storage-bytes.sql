-- Backfill storage_bytes for 8 marketplace apps
-- Run this in Supabase SQL Editor
--
-- Also ensures the record_upload_storage RPC exists so future uploads
-- properly track storage.

-- ============================================
-- 1. Ensure missing columns exist
-- ============================================
ALTER TABLE apps ADD COLUMN IF NOT EXISTS version_metadata JSONB DEFAULT '[]';
-- featured_at is required by the marketplace query but was missing
ALTER TABLE apps ADD COLUMN IF NOT EXISTS featured_at TIMESTAMPTZ;

-- ============================================
-- 2. Create/replace record_upload_storage RPC
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
-- 3. Backfill storage_bytes for the 8 marketplace apps
-- ============================================
-- Sizes calculated from local source bundles (index.ts + manifest.json)
UPDATE apps SET storage_bytes = 9289  WHERE id = 'd2109945-e720-4e0c-9f6f-5bff5c2a6358'; -- Smart Budget
UPDATE apps SET storage_bytes = 11135 WHERE id = '8c3ccff5-8cb8-456d-9099-0b2528640d6b'; -- Goal Tracker
UPDATE apps SET storage_bytes = 8976  WHERE id = 'a87ac9bf-fe40-4667-97be-581c441c9ce0'; -- Home Inventory
UPDATE apps SET storage_bytes = 11087 WHERE id = '242ea64e-89f2-4339-93b0-66b3281f6d87'; -- Fitness Tracker
UPDATE apps SET storage_bytes = 11760 WHERE id = 'b43e8c92-511c-45a0-b5cd-ef7d22dad559'; -- Recipe Box
UPDATE apps SET storage_bytes = 11967 WHERE id = '736e468f-dcd7-4d9d-a95c-567d2f0f4b72'; -- Study Coach
UPDATE apps SET storage_bytes = 12218 WHERE id = '2972d642-8e70-409b-ae86-0c2504f53261'; -- Story Builder
UPDATE apps SET storage_bytes = 11675 WHERE id = '86670430-1281-478c-8ed5-9b30ecf5391d'; -- Reading List

-- ============================================
-- 4. Update the owner's storage_used_bytes
-- ============================================
-- Sum all their apps' storage_bytes into users.storage_used_bytes
UPDATE users
SET storage_used_bytes = (
  SELECT COALESCE(SUM(storage_bytes), 0)
  FROM apps
  WHERE owner_id = users.id
    AND deleted_at IS NULL
)
WHERE id = (
  SELECT owner_id FROM apps WHERE id = 'd2109945-e720-4e0c-9f6f-5bff5c2a6358'
);

-- Verify
SELECT id, name, storage_bytes FROM apps
WHERE id IN (
  'd2109945-e720-4e0c-9f6f-5bff5c2a6358',
  '8c3ccff5-8cb8-456d-9099-0b2528640d6b',
  'a87ac9bf-fe40-4667-97be-581c441c9ce0',
  '242ea64e-89f2-4339-93b0-66b3281f6d87',
  'b43e8c92-511c-45a0-b5cd-ef7d22dad559',
  '736e468f-dcd7-4d9d-a95c-567d2f0f4b72',
  '2972d642-8e70-409b-ae86-0c2504f53261',
  '86670430-1281-478c-8ed5-9b30ecf5391d'
)
ORDER BY name;
