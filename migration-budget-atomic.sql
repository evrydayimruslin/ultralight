-- Atomic budget increment function
-- Prevents race conditions when multiple concurrent requests increment budget_used
-- Used by mcp.ts permission checks

CREATE OR REPLACE FUNCTION increment_budget_used(
  p_user_id UUID,
  p_app_id TEXT,
  p_function_name TEXT
) RETURNS void AS $$
BEGIN
  UPDATE user_app_permissions
  SET budget_used = COALESCE(budget_used, 0) + 1,
      updated_at = NOW()
  WHERE granted_to_user_id = p_user_id
    AND app_id = p_app_id
    AND function_name = p_function_name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add missing indexes for performance
CREATE INDEX IF NOT EXISTS idx_executions_app_id ON executions(app_id);
CREATE INDEX IF NOT EXISTS idx_executions_user_id ON executions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_app_permissions_lookup
  ON user_app_permissions(granted_to_user_id, app_id, function_name);
