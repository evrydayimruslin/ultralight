-- Migration: Pre-Auth Provisional Users
-- Enables unauthenticated visitors to get working tokens immediately,
-- with seamless merge into real accounts on sign-in.

-- 1A. Add provisional columns to users table
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS provisional BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS provisional_created_ip TEXT,
  ADD COLUMN IF NOT EXISTS provisional_created_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ DEFAULT NOW();

-- Partial indexes: only index provisional users (small subset)
CREATE INDEX IF NOT EXISTS idx_users_provisional ON users(provisional) WHERE provisional = TRUE;
CREATE INDEX IF NOT EXISTS idx_users_last_active ON users(last_active_at) WHERE provisional = TRUE;

-- 1B. IP rate-limit: count provisional users created from an IP in a time window
CREATE OR REPLACE FUNCTION count_provisional_by_ip(p_ip TEXT, p_window_hours INT DEFAULT 24)
RETURNS INT
LANGUAGE plpgsql AS $$
DECLARE cnt INT;
BEGIN
  SELECT COUNT(*)::INT INTO cnt
  FROM users
  WHERE provisional = TRUE
    AND provisional_created_ip = p_ip
    AND provisional_created_at >= NOW() - make_interval(hours => p_window_hours);
  RETURN cnt;
END;
$$;

-- 1C. Merge: atomically transfer all assets from provisional to real user
CREATE OR REPLACE FUNCTION merge_provisional_user(p_provisional_id UUID, p_real_id UUID)
RETURNS JSONB
LANGUAGE plpgsql AS $$
DECLARE
  apps_moved INT;
  tokens_moved INT;
  storage_transferred BIGINT;
BEGIN
  -- Verify source is actually provisional
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_provisional_id AND provisional = TRUE) THEN
    RETURN jsonb_build_object('error', 'Source user is not provisional');
  END IF;

  -- Verify target is a real (non-provisional) user
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_real_id AND provisional = FALSE) THEN
    RETURN jsonb_build_object('error', 'Target user is not a real account');
  END IF;

  -- Transfer apps
  UPDATE apps SET owner_id = p_real_id, updated_at = NOW()
  WHERE owner_id = p_provisional_id;
  GET DIAGNOSTICS apps_moved = ROW_COUNT;

  -- Transfer API tokens (re-assign to real user)
  UPDATE user_api_tokens SET user_id = p_real_id
  WHERE user_id = p_provisional_id;
  GET DIAGNOSTICS tokens_moved = ROW_COUNT;

  -- Transfer storage accounting
  SELECT COALESCE(storage_used_bytes, 0) INTO storage_transferred
  FROM users WHERE id = p_provisional_id;

  UPDATE users
  SET storage_used_bytes = COALESCE(storage_used_bytes, 0) + storage_transferred
  WHERE id = p_real_id;

  -- Delete provisional user record
  DELETE FROM users WHERE id = p_provisional_id;

  RETURN jsonb_build_object(
    'apps_moved', apps_moved,
    'tokens_moved', tokens_moved,
    'storage_transferred_bytes', storage_transferred
  );
END;
$$;

-- 1D. Cleanup: delete provisional users with no activity in 30+ days
CREATE OR REPLACE FUNCTION cleanup_expired_provisionals()
RETURNS INT
LANGUAGE plpgsql AS $$
DECLARE deleted_count INT;
BEGIN
  DELETE FROM users
  WHERE provisional = TRUE
    AND last_active_at < NOW() - INTERVAL '30 days';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;
