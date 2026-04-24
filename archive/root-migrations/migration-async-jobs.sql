-- Async Jobs: transparent async promotion for long-running sandbox executions
-- Jobs are created in 'running' state (execution is already in-flight when promoted)

CREATE TABLE IF NOT EXISTS async_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id UUID NOT NULL,
  user_id UUID NOT NULL,
  owner_id UUID NOT NULL,
  function_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',  -- running | completed | failed
  result JSONB,
  result_r2_key TEXT,                       -- R2 key if result > 1MB
  error JSONB,
  logs JSONB DEFAULT '[]',
  duration_ms INTEGER,
  ai_cost_light NUMERIC DEFAULT 0,
  execution_id TEXT NOT NULL,
  server_instance TEXT,                     -- hostname for crash detection
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ DEFAULT now() + interval '1 hour',
  meta JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_async_jobs_status ON async_jobs(status) WHERE status = 'running';
CREATE INDEX IF NOT EXISTS idx_async_jobs_user ON async_jobs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_async_jobs_expires ON async_jobs(expires_at) WHERE status = 'running';
