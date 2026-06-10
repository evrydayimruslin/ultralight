-- Migration: Enhanced MCP Call Logs
--
-- Adds columns to mcp_call_logs for rich tool-use telemetry:
--   - input_args: the arguments passed to the tool call
--   - output_result: the return value (truncated to ~10KB at application layer)
--   - user_tier: caller's tier at the time of the call
--   - app_version: which version of the app was running
--   - ai_cost_cents: AI credit spend during execution
--   - session_id: correlates sequential calls from the same MCP session
--   - sequence_number: position within a session's call chain
--   - user_query: the end-user's original prompt (optional, agent-passed)

-- ============================================
-- 1. NEW COLUMNS ON MCP_CALL_LOGS
-- ============================================

ALTER TABLE mcp_call_logs ADD COLUMN IF NOT EXISTS input_args JSONB;
ALTER TABLE mcp_call_logs ADD COLUMN IF NOT EXISTS output_result JSONB;
ALTER TABLE mcp_call_logs ADD COLUMN IF NOT EXISTS user_tier TEXT;
ALTER TABLE mcp_call_logs ADD COLUMN IF NOT EXISTS app_version TEXT;
ALTER TABLE mcp_call_logs ADD COLUMN IF NOT EXISTS ai_cost_cents FLOAT DEFAULT 0;
ALTER TABLE mcp_call_logs ADD COLUMN IF NOT EXISTS session_id TEXT;
ALTER TABLE mcp_call_logs ADD COLUMN IF NOT EXISTS sequence_number INTEGER;
ALTER TABLE mcp_call_logs ADD COLUMN IF NOT EXISTS user_query TEXT;

-- ============================================
-- 2. INDEXES FOR SESSION-BASED QUERIES
-- ============================================

-- Session replay: get all calls in a session in order
CREATE INDEX IF NOT EXISTS idx_mcp_logs_session
  ON mcp_call_logs(session_id, sequence_number)
  WHERE session_id IS NOT NULL;

-- Training data export: find calls with full I/O pairs
CREATE INDEX IF NOT EXISTS idx_mcp_logs_rich
  ON mcp_call_logs(created_at DESC)
  WHERE input_args IS NOT NULL AND output_result IS NOT NULL;
