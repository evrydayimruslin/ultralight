-- Migration: GPU Compute Runtime — Phase 4 (Marketplace)
-- Materialized view for GPU reliability stats, refreshed hourly.
-- Run after migration-gpu-phase3.sql has been applied.

-- GPU reliability materialized view (7-day rolling window)
CREATE MATERIALIZED VIEW IF NOT EXISTS gpu_reliability_7d AS
SELECT
  app_id,
  COUNT(*) as total_calls,
  COUNT(*) FILTER (WHERE success = true) as successful_calls,
  ROUND(
    COUNT(*) FILTER (WHERE success = true)::numeric
    / NULLIF(COUNT(*), 0),
    4
  ) as success_rate,
  AVG(gpu_duration_ms) FILTER (WHERE gpu_duration_ms IS NOT NULL) as avg_duration_ms,
  SUM(gpu_cost_cents) FILTER (WHERE gpu_cost_cents IS NOT NULL) as total_compute_cents
FROM mcp_call_logs
WHERE created_at > now() - interval '7 days'
  AND gpu_type IS NOT NULL
GROUP BY app_id;

-- Unique index required for CONCURRENTLY refresh
CREATE UNIQUE INDEX IF NOT EXISTS idx_gpu_reliability_app
  ON gpu_reliability_7d(app_id);

-- Function to refresh the view (called by hourly billing job)
CREATE OR REPLACE FUNCTION refresh_gpu_reliability()
RETURNS void AS $$
  REFRESH MATERIALIZED VIEW CONCURRENTLY gpu_reliability_7d;
$$ LANGUAGE SQL;
