-- Migration: Argument-Value Whitelisting for Permissions
-- Adds allowed_args JSONB column to user_app_permissions.
-- Format: { "param_name": ["val1", "val2"], "another_param": ["x"] }
-- null = no restriction (any value allowed for that parameter).
-- Enforced at MCP call time alongside IP/time/budget/expiry constraints.

ALTER TABLE user_app_permissions
  ADD COLUMN IF NOT EXISTS allowed_args JSONB DEFAULT NULL;

-- Also add to pending_permissions so invites carry arg constraints
ALTER TABLE pending_permissions
  ADD COLUMN IF NOT EXISTS allowed_args JSONB DEFAULT NULL;

COMMENT ON COLUMN user_app_permissions.allowed_args IS
  'Per-parameter value whitelist. Keys = param names, values = arrays of allowed values. null = unrestricted.';

COMMENT ON COLUMN pending_permissions.allowed_args IS
  'Per-parameter value whitelist carried from invite. Applied when user signs up.';
