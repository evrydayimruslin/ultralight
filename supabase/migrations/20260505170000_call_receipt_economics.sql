ALTER TABLE public.mcp_call_logs
  ADD COLUMN IF NOT EXISTS app_price_light double precision,
  ADD COLUMN IF NOT EXISTS app_charge_light double precision,
  ADD COLUMN IF NOT EXISTS infra_charge_light double precision,
  ADD COLUMN IF NOT EXISTS platform_fee_light double precision,
  ADD COLUMN IF NOT EXISTS developer_net_light double precision,
  ADD COLUMN IF NOT EXISTS free_call boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS free_call_count integer,
  ADD COLUMN IF NOT EXISTS free_call_limit integer;

UPDATE public.mcp_call_logs
SET
  app_price_light = COALESCE(app_price_light, call_charge_light),
  app_charge_light = COALESCE(app_charge_light, call_charge_light),
  infra_charge_light = COALESCE(infra_charge_light, cloud_charge_light),
  developer_net_light = COALESCE(developer_net_light, call_charge_light),
  free_call = COALESCE(free_call, false),
  free_call_limit = COALESCE(free_call_limit, 0)
WHERE
  app_price_light IS NULL
  OR app_charge_light IS NULL
  OR infra_charge_light IS NULL
  OR developer_net_light IS NULL
  OR free_call_limit IS NULL;

ALTER TABLE public.mcp_call_logs
  DROP CONSTRAINT IF EXISTS mcp_call_logs_receipt_economics_nonnegative;

ALTER TABLE public.mcp_call_logs
  ADD CONSTRAINT mcp_call_logs_receipt_economics_nonnegative CHECK (
    COALESCE(app_price_light, 0) >= 0
    AND COALESCE(app_charge_light, 0) >= 0
    AND COALESCE(infra_charge_light, 0) >= 0
    AND COALESCE(platform_fee_light, 0) >= 0
    AND COALESCE(developer_net_light, 0) >= 0
    AND COALESCE(free_call_count, 0) >= 0
    AND COALESCE(free_call_limit, 0) >= 0
  );

CREATE INDEX IF NOT EXISTS idx_mcp_call_logs_receipt_economics_time
  ON public.mcp_call_logs(created_at DESC)
  WHERE app_price_light IS NOT NULL OR cloud_charge_light IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mcp_call_logs_platform_fee_time
  ON public.mcp_call_logs(created_at DESC)
  WHERE platform_fee_light IS NOT NULL AND platform_fee_light > 0;
