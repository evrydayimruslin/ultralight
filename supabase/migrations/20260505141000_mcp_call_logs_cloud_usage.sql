ALTER TABLE public.mcp_call_logs
  ADD COLUMN IF NOT EXISTS cloud_usage_hold_id uuid,
  ADD COLUMN IF NOT EXISTS cloud_usage_event_id uuid,
  ADD COLUMN IF NOT EXISTS cloud_units double precision,
  ADD COLUMN IF NOT EXISTS cloud_charge_light double precision,
  ADD COLUMN IF NOT EXISTS cloud_payer_user_id uuid,
  ADD COLUMN IF NOT EXISTS cloud_owner_sponsored boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_mcp_call_logs_cloud_usage_event
  ON public.mcp_call_logs(cloud_usage_event_id)
  WHERE cloud_usage_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mcp_call_logs_cloud_payer_time
  ON public.mcp_call_logs(cloud_payer_user_id, created_at DESC)
  WHERE cloud_payer_user_id IS NOT NULL;
