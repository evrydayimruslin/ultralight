ALTER TABLE public.mcp_call_logs
  ADD COLUMN IF NOT EXISTS billing_config_version integer;

WITH receipt_versions AS (
  SELECT
    receipt_id::uuid AS receipt_uuid,
    max(billing_config_version) AS billing_config_version
  FROM public.cloud_usage_events
  WHERE receipt_id IS NOT NULL
    AND billing_config_version IS NOT NULL
    AND receipt_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  GROUP BY receipt_id
  HAVING count(DISTINCT billing_config_version) = 1
)
UPDATE public.mcp_call_logs AS logs
SET billing_config_version = receipt_versions.billing_config_version
FROM receipt_versions
WHERE logs.id = receipt_versions.receipt_uuid
  AND logs.billing_config_version IS NULL;

CREATE INDEX IF NOT EXISTS idx_mcp_call_logs_billing_config_version_time
  ON public.mcp_call_logs(billing_config_version, created_at DESC)
  WHERE billing_config_version IS NOT NULL;
