-- PR15: Light cloud economy config surface.
-- Adds configurable Cloudflare cost policy, publishing gates, and funding minimums.

ALTER TABLE public.platform_billing_config
  ADD COLUMN IF NOT EXISTS card_minimum_cents integer NOT NULL DEFAULT 2500,
  ADD COLUMN IF NOT EXISTS wire_minimum_cents integer NOT NULL DEFAULT 2500,
  ADD COLUMN IF NOT EXISTS cloud_unit_light_per_1k double precision NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS worker_ms_per_cloud_unit integer NOT NULL DEFAULT 250,
  ADD COLUMN IF NOT EXISTS d1_read_rows_per_cloud_unit integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS d1_write_rows_per_cloud_unit integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS r2_ops_per_cloud_unit integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS kv_ops_per_cloud_unit integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS widget_pulls_per_cloud_unit integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS storage_free_bytes bigint NOT NULL DEFAULT 104857600,
  ADD COLUMN IF NOT EXISTS storage_light_per_gb_month double precision NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS publish_deposit_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS published_hosting_meter_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.platform_billing_config
  ALTER COLUMN platform_fee_rate SET DEFAULT 0.15;

UPDATE public.platform_billing_config
SET
  platform_fee_rate = 0.15,
  card_minimum_cents = 2500,
  wire_minimum_cents = 2500,
  cloud_unit_light_per_1k = 1,
  worker_ms_per_cloud_unit = 250,
  d1_read_rows_per_cloud_unit = 100,
  d1_write_rows_per_cloud_unit = 1,
  r2_ops_per_cloud_unit = 1,
  kv_ops_per_cloud_unit = 1,
  widget_pulls_per_cloud_unit = 1,
  storage_free_bytes = 104857600,
  storage_light_per_gb_month = 100,
  publish_deposit_enabled = false,
  published_hosting_meter_enabled = false
WHERE id = 'singleton'
  AND platform_fee_rate = 0.10;

ALTER TABLE public.platform_billing_config
  DROP CONSTRAINT IF EXISTS platform_billing_config_cloud_policy_valid;
ALTER TABLE public.platform_billing_config
  ADD CONSTRAINT platform_billing_config_cloud_policy_valid CHECK (
    card_minimum_cents > 0
    AND wire_minimum_cents > 0
    AND cloud_unit_light_per_1k > 0
    AND worker_ms_per_cloud_unit > 0
    AND d1_read_rows_per_cloud_unit > 0
    AND d1_write_rows_per_cloud_unit > 0
    AND r2_ops_per_cloud_unit > 0
    AND kv_ops_per_cloud_unit > 0
    AND widget_pulls_per_cloud_unit > 0
    AND storage_free_bytes > 0
    AND storage_light_per_gb_month > 0
  );
