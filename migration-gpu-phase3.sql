-- Migration: GPU Compute Runtime — Phase 3 (Execution + Billing)
-- Adds GPU metering columns to mcp_call_logs for call-level telemetry.
-- Run after migration-gpu-phase2.sql has been applied.

-- GPU metering columns on mcp_call_logs
ALTER TABLE mcp_call_logs ADD COLUMN IF NOT EXISTS gpu_type TEXT;
ALTER TABLE mcp_call_logs ADD COLUMN IF NOT EXISTS gpu_exit_code TEXT;
ALTER TABLE mcp_call_logs ADD COLUMN IF NOT EXISTS gpu_duration_ms DOUBLE PRECISION;
ALTER TABLE mcp_call_logs ADD COLUMN IF NOT EXISTS gpu_cost_cents DOUBLE PRECISION;
ALTER TABLE mcp_call_logs ADD COLUMN IF NOT EXISTS gpu_peak_vram_gb DOUBLE PRECISION;
ALTER TABLE mcp_call_logs ADD COLUMN IF NOT EXISTS gpu_developer_fee_cents DOUBLE PRECISION;
ALTER TABLE mcp_call_logs ADD COLUMN IF NOT EXISTS gpu_failure_policy TEXT;

-- Index for GPU call analysis (partial index — only rows with gpu_type set)
CREATE INDEX IF NOT EXISTS idx_mcp_call_logs_gpu_type
  ON mcp_call_logs(gpu_type)
  WHERE gpu_type IS NOT NULL;
