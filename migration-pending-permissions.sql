-- Migration: Pending Permissions (Invite Flow)
-- Stores permission grants for users who haven't signed up yet.
-- When a user signs up, pending rows are resolved to user_app_permissions.

CREATE TABLE IF NOT EXISTS pending_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id UUID NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  invited_email TEXT NOT NULL,
  granted_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  function_name TEXT NOT NULL,
  allowed BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(app_id, invited_email, function_name)
);

CREATE INDEX IF NOT EXISTS idx_pending_perms_email
  ON pending_permissions(invited_email);

CREATE INDEX IF NOT EXISTS idx_pending_perms_app
  ON pending_permissions(app_id);
