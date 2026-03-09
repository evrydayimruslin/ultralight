-- migration-data-storage.sql
-- User Data Storage Metering & Billing
--
-- Adds tracking for user-generated data stored via ultralight.store() / batchStore().
-- Combined with existing storage_used_bytes (app source code) to form a unified
-- 100MB free tier budget. Overage billed at $0.0005/MB/hr from hosting_balance_cents.

-- 1. Track user-generated data bytes (separate from app source code)
ALTER TABLE users ADD COLUMN IF NOT EXISTS data_storage_used_bytes BIGINT DEFAULT 0;

-- 2. Update combined storage limit to 100MB for all users
--    (existing users may have 25MB, 500MB, or 100MB depending on which migrations ran)
UPDATE users SET storage_limit_bytes = 104857600
WHERE storage_limit_bytes < 104857600;

ALTER TABLE users ALTER COLUMN storage_limit_bytes SET DEFAULT 104857600; -- 100MB

-- 3. Partial index for billing queries — only index users with data storage > 0
CREATE INDEX IF NOT EXISTS idx_users_data_storage_positive
  ON users(data_storage_used_bytes)
  WHERE data_storage_used_bytes > 0;

-- 4. Atomic increment/decrement for data storage tracking
--    Called after every store() and remove() operation.
--    Uses GREATEST(0, ...) to prevent negative values from race conditions.
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

-- 5. Quota check RPC (read-only, no mutations)
--    Returns whether the user is allowed to store additional bytes.
--    Allowed if: under 100MB combined, OR has hosting balance to cover overage.
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
    -- Allowed if under limit OR user has hosting balance to cover overage
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
