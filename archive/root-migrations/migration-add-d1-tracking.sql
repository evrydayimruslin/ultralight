-- D1 Database Tracking
-- Adds columns to apps table for tracking per-app D1 database provisioning.

ALTER TABLE apps ADD COLUMN d1_database_id TEXT DEFAULT NULL;
ALTER TABLE apps ADD COLUMN d1_status TEXT DEFAULT NULL
  CHECK (d1_status IN ('pending', 'provisioning', 'ready', 'error'));
ALTER TABLE apps ADD COLUMN d1_provisioned_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE apps ADD COLUMN d1_last_migration_version INTEGER DEFAULT 0;

COMMENT ON COLUMN apps.d1_database_id IS 'Cloudflare D1 database UUID, null until first ultralight.db call';
COMMENT ON COLUMN apps.d1_status IS 'Provisioning state: pending->provisioning->ready or error';
COMMENT ON COLUMN apps.d1_last_migration_version IS 'Highest migration version applied to this apps D1';
