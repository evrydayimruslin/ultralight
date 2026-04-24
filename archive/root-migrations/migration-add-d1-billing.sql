-- D1 Billing Columns
-- Adds per-user D1 usage tracking for metering and billing.

ALTER TABLE users ADD COLUMN d1_rows_read_total BIGINT DEFAULT 0;
ALTER TABLE users ADD COLUMN d1_rows_written_total BIGINT DEFAULT 0;
ALTER TABLE users ADD COLUMN d1_storage_bytes BIGINT DEFAULT 0;
ALTER TABLE users ADD COLUMN d1_billing_last_synced_at TIMESTAMPTZ DEFAULT NOW();

-- RPC: Bulk sync D1 usage from Worker to Supabase for billing
CREATE OR REPLACE FUNCTION sync_d1_usage(
  p_user_id UUID,
  p_rows_read BIGINT,
  p_rows_written BIGINT,
  p_storage_bytes BIGINT
) RETURNS VOID AS $$
BEGIN
  UPDATE users SET
    d1_rows_read_total = d1_rows_read_total + p_rows_read,
    d1_rows_written_total = d1_rows_written_total + p_rows_written,
    d1_storage_bytes = GREATEST(d1_storage_bytes, p_storage_bytes),
    d1_billing_last_synced_at = NOW()
  WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql;

-- RPC: Check if a user is within D1 free tier
CREATE OR REPLACE FUNCTION check_d1_free_tier(
  p_user_id UUID
) RETURNS TABLE(
  within_free_tier BOOLEAN,
  rows_read_total BIGINT,
  rows_written_total BIGINT,
  storage_bytes BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    (u.d1_rows_read_total < 50000 AND u.d1_rows_written_total < 10000 AND u.d1_storage_bytes < 52428800) AS within_free_tier,
    u.d1_rows_read_total,
    u.d1_rows_written_total,
    u.d1_storage_bytes
  FROM users u
  WHERE u.id = p_user_id;
END;
$$ LANGUAGE plpgsql;
