-- NS-4: configurable publisher minimum balance before non-private publish/live activation.

ALTER TABLE public.platform_billing_config
  ADD COLUMN IF NOT EXISTS publisher_min_publish_balance_light double precision NOT NULL DEFAULT 1000;

ALTER TABLE public.platform_billing_config
  ALTER COLUMN publisher_min_publish_balance_light SET DEFAULT 1000;

UPDATE public.platform_billing_config
SET publisher_min_publish_balance_light = 1000
WHERE id = 'singleton'
  AND publisher_min_publish_balance_light <= 0;

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
    AND publisher_min_publish_balance_light > 0
  );
