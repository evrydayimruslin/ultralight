-- Internal sales-tax and embedding pass-through foundations.
--
-- Tax tables store Ultralight-managed rate data and user accruals. They do not
-- automatically collect tax yet.
-- Embedding charges are recorded and optionally debited using an explicit
-- Light-per-1k-tokens rate supplied by the API service.

CREATE TABLE IF NOT EXISTS public.sales_tax_rate_rules (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  country text NOT NULL,
  state text,
  postal_prefix text,
  city text,
  tax_category text NOT NULL DEFAULT 'digital_service',
  rate_bps integer NOT NULL,
  status text NOT NULL DEFAULT 'active',
  source text NOT NULL DEFAULT 'internal',
  effective_from timestamp with time zone NOT NULL DEFAULT now(),
  effective_until timestamp with time zone,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT sales_tax_rate_rules_country_check CHECK (country ~ '^[A-Z]{2}$'),
  CONSTRAINT sales_tax_rate_rules_rate_check CHECK (rate_bps >= 0 AND rate_bps <= 2500),
  CONSTRAINT sales_tax_rate_rules_status_check CHECK (status IN ('active', 'inactive')),
  CONSTRAINT sales_tax_rate_rules_window_check CHECK (
    effective_until IS NULL OR effective_until > effective_from
  )
);

CREATE INDEX IF NOT EXISTS sales_tax_rate_rules_lookup_idx
  ON public.sales_tax_rate_rules(country, state, postal_prefix, tax_category, effective_from DESC)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS public.user_sales_tax_accruals (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  billing_address_id uuid REFERENCES public.user_billing_addresses(id) ON DELETE SET NULL,
  billing_address_version integer,
  tax_category text NOT NULL DEFAULT 'digital_service',
  taxable_spend_since_last_charge_light double precision NOT NULL DEFAULT 0,
  untaxed_monetized_spend_light double precision NOT NULL DEFAULT 0,
  lifetime_taxable_spend_light double precision NOT NULL DEFAULT 0,
  lifetime_tax_charged_light double precision NOT NULL DEFAULT 0,
  last_balance_snapshot_light double precision NOT NULL DEFAULT 0,
  last_tax_rate_bps integer NOT NULL DEFAULT 0,
  last_charged_at timestamp with time zone,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT user_sales_tax_accruals_nonnegative_check CHECK (
    taxable_spend_since_last_charge_light >= 0
    AND untaxed_monetized_spend_light >= 0
    AND lifetime_taxable_spend_light >= 0
    AND lifetime_tax_charged_light >= 0
    AND last_balance_snapshot_light >= 0
    AND last_tax_rate_bps >= 0
  )
);

CREATE TABLE IF NOT EXISTS public.sales_tax_charges (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  billing_address_id uuid REFERENCES public.user_billing_addresses(id) ON DELETE SET NULL,
  billing_address_version integer,
  tax_rate_rule_id uuid REFERENCES public.sales_tax_rate_rules(id) ON DELETE SET NULL,
  tax_category text NOT NULL DEFAULT 'digital_service',
  taxable_amount_light double precision NOT NULL,
  tax_rate_bps integer NOT NULL,
  tax_amount_light double precision NOT NULL,
  trigger_balance_light double precision NOT NULL DEFAULT 0,
  trigger_spend_since_last_charge_light double precision NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  debit_amount_light double precision NOT NULL DEFAULT 0,
  debit_error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  charged_at timestamp with time zone,
  CONSTRAINT sales_tax_charges_status_check CHECK (
    status IN ('pending', 'charged', 'insufficient_balance', 'void')
  ),
  CONSTRAINT sales_tax_charges_nonnegative_check CHECK (
    taxable_amount_light >= 0
    AND tax_rate_bps >= 0
    AND tax_amount_light >= 0
    AND trigger_balance_light >= 0
    AND trigger_spend_since_last_charge_light >= 0
    AND debit_amount_light >= 0
  )
);

CREATE INDEX IF NOT EXISTS sales_tax_charges_user_created_idx
  ON public.sales_tax_charges(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.embedding_generation_charges (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  publisher_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  app_id uuid REFERENCES public.apps(id) ON DELETE SET NULL,
  app_version text,
  model text NOT NULL,
  prompt_tokens integer NOT NULL DEFAULT 0,
  total_tokens integer NOT NULL DEFAULT 0,
  rate_light_per_1k_tokens double precision NOT NULL DEFAULT 0,
  amount_light double precision NOT NULL DEFAULT 0,
  amount_debited_light double precision NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  debit_error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  charged_at timestamp with time zone,
  CONSTRAINT embedding_generation_charges_status_check CHECK (
    status IN ('pending', 'charged', 'no_charge', 'insufficient_balance', 'failed')
  ),
  CONSTRAINT embedding_generation_charges_nonnegative_check CHECK (
    prompt_tokens >= 0
    AND total_tokens >= 0
    AND rate_light_per_1k_tokens >= 0
    AND amount_light >= 0
    AND amount_debited_light >= 0
  )
);

CREATE INDEX IF NOT EXISTS embedding_generation_charges_publisher_created_idx
  ON public.embedding_generation_charges(publisher_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS embedding_generation_charges_app_created_idx
  ON public.embedding_generation_charges(app_id, created_at DESC)
  WHERE app_id IS NOT NULL;

ALTER TABLE public.sales_tax_rate_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_sales_tax_accruals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_tax_charges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.embedding_generation_charges ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.sales_tax_rate_rules FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.user_sales_tax_accruals FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.sales_tax_charges FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.embedding_generation_charges FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public.sales_tax_rate_rules TO service_role;
GRANT ALL ON TABLE public.user_sales_tax_accruals TO service_role;
GRANT ALL ON TABLE public.sales_tax_charges TO service_role;
GRANT ALL ON TABLE public.embedding_generation_charges TO service_role;

DROP TRIGGER IF EXISTS touch_sales_tax_rate_rules_updated_at
  ON public.sales_tax_rate_rules;
CREATE TRIGGER touch_sales_tax_rate_rules_updated_at
BEFORE UPDATE ON public.sales_tax_rate_rules
FOR EACH ROW EXECUTE FUNCTION public.touch_fee_waiver_foundation_updated_at();

DROP TRIGGER IF EXISTS touch_user_sales_tax_accruals_updated_at
  ON public.user_sales_tax_accruals;
CREATE TRIGGER touch_user_sales_tax_accruals_updated_at
BEFORE UPDATE ON public.user_sales_tax_accruals
FOR EACH ROW EXECUTE FUNCTION public.touch_fee_waiver_foundation_updated_at();

CREATE OR REPLACE FUNCTION public.record_embedding_generation_charge(
  p_publisher_user_id uuid,
  p_app_id uuid,
  p_app_version text,
  p_model text,
  p_prompt_tokens integer,
  p_total_tokens integer,
  p_rate_light_per_1k_tokens double precision,
  p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS TABLE(
  charge_id uuid,
  amount_light double precision,
  amount_debited_light double precision,
  status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public, extensions'
AS $$
DECLARE
  v_charge_id uuid;
  v_amount_light double precision;
  v_debit RECORD;
  v_status text := 'pending';
  v_error text;
BEGIN
  IF p_publisher_user_id IS NULL THEN
    RAISE EXCEPTION 'publisher user id is required';
  END IF;

  v_amount_light :=
    GREATEST(COALESCE(p_total_tokens, 0), 0)::double precision
    * GREATEST(COALESCE(p_rate_light_per_1k_tokens, 0), 0)
    / 1000.0;

  INSERT INTO public.embedding_generation_charges (
    publisher_user_id,
    app_id,
    app_version,
    model,
    prompt_tokens,
    total_tokens,
    rate_light_per_1k_tokens,
    amount_light,
    status,
    metadata
  )
  VALUES (
    p_publisher_user_id,
    p_app_id,
    p_app_version,
    COALESCE(NULLIF(btrim(p_model), ''), 'unknown'),
    GREATEST(COALESCE(p_prompt_tokens, 0), 0),
    GREATEST(COALESCE(p_total_tokens, 0), 0),
    GREATEST(COALESCE(p_rate_light_per_1k_tokens, 0), 0),
    v_amount_light,
    CASE WHEN v_amount_light > 0 THEN 'pending' ELSE 'no_charge' END,
    COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING id INTO v_charge_id;

  IF v_amount_light <= 0 THEN
    RETURN QUERY SELECT v_charge_id, v_amount_light, 0::double precision, 'no_charge'::text;
    RETURN;
  END IF;

  BEGIN
    SELECT * INTO v_debit
    FROM public.debit_light(
      p_publisher_user_id,
      v_amount_light,
      'embedding_generation',
      false,
      false,
      p_app_id,
      NULL::text,
      'embedding_generation_charges',
      v_charge_id,
      COALESCE(p_metadata, '{}'::jsonb)
        || jsonb_build_object(
          'model', p_model,
          'prompt_tokens', p_prompt_tokens,
          'total_tokens', p_total_tokens,
          'rate_light_per_1k_tokens', p_rate_light_per_1k_tokens
        )
    );
    v_status := 'charged';
  EXCEPTION WHEN OTHERS THEN
    v_status := 'insufficient_balance';
    v_error := SQLERRM;
  END;

  UPDATE public.embedding_generation_charges
  SET
    amount_debited_light = CASE WHEN v_status = 'charged' THEN v_debit.amount_debited ELSE 0 END,
    status = v_status,
    debit_error = v_error,
    charged_at = CASE WHEN v_status = 'charged' THEN now() ELSE NULL END
  WHERE id = v_charge_id;

  RETURN QUERY SELECT
    v_charge_id,
    v_amount_light,
    CASE WHEN v_status = 'charged' THEN v_debit.amount_debited ELSE 0 END,
    v_status;
END;
$$;

REVOKE ALL ON FUNCTION public.record_embedding_generation_charge(
  uuid,
  uuid,
  text,
  text,
  integer,
  integer,
  double precision,
  jsonb
) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.record_embedding_generation_charge(
  uuid,
  uuid,
  text,
  text,
  integer,
  integer,
  double precision,
  jsonb
) TO service_role;

COMMENT ON TABLE public.sales_tax_rate_rules IS
  'Internal sales-tax rate table managed by Ultralight; no external tax API dependency.';
COMMENT ON TABLE public.user_sales_tax_accruals IS
  'Per-user untaxed monetized-spend accrual state for threshold-based Light tax charging.';
COMMENT ON TABLE public.sales_tax_charges IS
  'Internal sales-tax charge ledger. Rows are created when accrual thresholds trigger a Light debit.';
COMMENT ON TABLE public.embedding_generation_charges IS
  'OpenRouter/platform embedding pass-through ledger for published tool iterations.';
