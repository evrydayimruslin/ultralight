CREATE TABLE IF NOT EXISTS public.cloud_usage_holds (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  status text NOT NULL DEFAULT 'held',
  payer_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  sponsor_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  caller_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  owner_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  app_id uuid REFERENCES public.apps(id) ON DELETE SET NULL,
  function_name text,
  receipt_id text,
  source text NOT NULL,
  resource text NOT NULL,
  expected_units double precision NOT NULL,
  expected_cloud_units double precision NOT NULL,
  expected_amount_light double precision NOT NULL,
  held_amount_light double precision NOT NULL,
  held_deposit_light double precision NOT NULL DEFAULT 0,
  held_earned_light double precision NOT NULL DEFAULT 0,
  settled_amount_light double precision NOT NULL DEFAULT 0,
  released_amount_light double precision NOT NULL DEFAULT 0,
  settlement_event_id uuid,
  billing_config_version integer,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT cloud_usage_holds_status_check CHECK (
    status IN ('held', 'settled', 'released', 'expired')
  ),
  CONSTRAINT cloud_usage_holds_resource_check CHECK (
    resource IN (
      'worker_execution',
      'r2_operation',
      'kv_operation',
      'd1_read',
      'd1_write',
      'widget_pull',
      'storage_at_rest'
    )
  ),
  CONSTRAINT cloud_usage_holds_amount_check CHECK (
    expected_units >= 0
    AND expected_cloud_units >= 0
    AND expected_amount_light > 0
    AND held_amount_light > 0
    AND held_deposit_light >= 0
    AND held_earned_light >= 0
    AND settled_amount_light >= 0
    AND released_amount_light >= 0
  )
);

CREATE TABLE IF NOT EXISTS public.cloud_usage_events (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  payer_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  sponsor_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  caller_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  owner_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  app_id uuid REFERENCES public.apps(id) ON DELETE SET NULL,
  function_name text,
  receipt_id text,
  source text NOT NULL,
  resource text NOT NULL,
  units double precision NOT NULL,
  cloud_units double precision NOT NULL,
  amount_light double precision NOT NULL,
  billing_config_version integer,
  hold_id uuid REFERENCES public.cloud_usage_holds(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT cloud_usage_events_resource_check CHECK (
    resource IN (
      'worker_execution',
      'r2_operation',
      'kv_operation',
      'd1_read',
      'd1_write',
      'widget_pull',
      'storage_at_rest'
    )
  ),
  CONSTRAINT cloud_usage_events_amount_check CHECK (
    units >= 0
    AND cloud_units >= 0
    AND amount_light >= 0
  )
);

ALTER TABLE public.cloud_usage_holds
  DROP CONSTRAINT IF EXISTS cloud_usage_holds_settlement_event_id_fkey;

ALTER TABLE public.cloud_usage_holds
  ADD CONSTRAINT cloud_usage_holds_settlement_event_id_fkey
  FOREIGN KEY (settlement_event_id)
  REFERENCES public.cloud_usage_events(id)
  ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.cloud_usage_rollups (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  period_start date NOT NULL,
  payer_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  app_id uuid REFERENCES public.apps(id) ON DELETE SET NULL,
  app_rollup_key uuid NOT NULL,
  source text NOT NULL,
  resource text NOT NULL,
  event_count integer NOT NULL DEFAULT 0,
  units double precision NOT NULL DEFAULT 0,
  cloud_units double precision NOT NULL DEFAULT 0,
  amount_light double precision NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cloud_usage_rollups_resource_check CHECK (
    resource IN (
      'worker_execution',
      'r2_operation',
      'kv_operation',
      'd1_read',
      'd1_write',
      'widget_pull',
      'storage_at_rest'
    )
  ),
  CONSTRAINT cloud_usage_rollups_amount_check CHECK (
    event_count >= 0
    AND units >= 0
    AND cloud_units >= 0
    AND amount_light >= 0
  ),
  CONSTRAINT cloud_usage_rollups_unique_day UNIQUE (
    period_start,
    payer_user_id,
    app_rollup_key,
    source,
    resource
  )
);

CREATE INDEX IF NOT EXISTS cloud_usage_events_payer_created_idx
  ON public.cloud_usage_events(payer_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS cloud_usage_events_app_created_idx
  ON public.cloud_usage_events(app_id, created_at DESC);
CREATE INDEX IF NOT EXISTS cloud_usage_events_receipt_idx
  ON public.cloud_usage_events(receipt_id)
  WHERE receipt_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS cloud_usage_events_hold_idx
  ON public.cloud_usage_events(hold_id)
  WHERE hold_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS cloud_usage_holds_payer_created_idx
  ON public.cloud_usage_holds(payer_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS cloud_usage_holds_status_expires_idx
  ON public.cloud_usage_holds(status, expires_at)
  WHERE status = 'held';
CREATE INDEX IF NOT EXISTS cloud_usage_holds_receipt_idx
  ON public.cloud_usage_holds(receipt_id)
  WHERE receipt_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS cloud_usage_rollups_payer_period_idx
  ON public.cloud_usage_rollups(payer_user_id, period_start DESC);
CREATE INDEX IF NOT EXISTS cloud_usage_rollups_app_period_idx
  ON public.cloud_usage_rollups(app_id, period_start DESC);

ALTER TABLE public.cloud_usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cloud_usage_holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cloud_usage_rollups ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.cloud_usage_events FROM anon, authenticated;
REVOKE ALL ON TABLE public.cloud_usage_holds FROM anon, authenticated;
REVOKE ALL ON TABLE public.cloud_usage_rollups FROM anon, authenticated;
GRANT ALL ON TABLE public.cloud_usage_events TO service_role;
GRANT ALL ON TABLE public.cloud_usage_holds TO service_role;
GRANT ALL ON TABLE public.cloud_usage_rollups TO service_role;

CREATE OR REPLACE FUNCTION public.upsert_cloud_usage_rollup(
  p_payer_user_id uuid,
  p_app_id uuid,
  p_source text,
  p_resource text,
  p_units double precision,
  p_cloud_units double precision,
  p_amount_light double precision
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public, extensions'
AS $$
DECLARE
  v_app_rollup_key uuid := COALESCE(p_app_id, '00000000-0000-0000-0000-000000000000'::uuid);
  v_period_start date := (now() AT TIME ZONE 'UTC')::date;
BEGIN
  INSERT INTO public.cloud_usage_rollups (
    period_start,
    payer_user_id,
    app_id,
    app_rollup_key,
    source,
    resource,
    event_count,
    units,
    cloud_units,
    amount_light
  ) VALUES (
    v_period_start,
    p_payer_user_id,
    p_app_id,
    v_app_rollup_key,
    p_source,
    p_resource,
    1,
    p_units,
    p_cloud_units,
    p_amount_light
  )
  ON CONFLICT (period_start, payer_user_id, app_rollup_key, source, resource)
  DO UPDATE SET
    event_count = public.cloud_usage_rollups.event_count + 1,
    units = public.cloud_usage_rollups.units + EXCLUDED.units,
    cloud_units = public.cloud_usage_rollups.cloud_units + EXCLUDED.cloud_units,
    amount_light = public.cloud_usage_rollups.amount_light + EXCLUDED.amount_light,
    updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.record_cloud_usage_event(
  p_payer_user_id uuid,
  p_source text,
  p_resource text,
  p_units double precision,
  p_cloud_units double precision,
  p_amount_light double precision,
  p_sponsor_user_id uuid DEFAULT NULL::uuid,
  p_caller_user_id uuid DEFAULT NULL::uuid,
  p_owner_user_id uuid DEFAULT NULL::uuid,
  p_app_id uuid DEFAULT NULL::uuid,
  p_function_name text DEFAULT NULL::text,
  p_receipt_id text DEFAULT NULL::text,
  p_billing_config_version integer DEFAULT NULL::integer,
  p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public, extensions'
AS $$
DECLARE
  v_event_id uuid;
BEGIN
  IF p_payer_user_id IS NULL THEN
    RAISE EXCEPTION 'Payer user id is required';
  END IF;

  IF p_source IS NULL OR length(trim(p_source)) = 0 THEN
    RAISE EXCEPTION 'Cloud usage source is required';
  END IF;

  IF p_resource IS NULL OR length(trim(p_resource)) = 0 THEN
    RAISE EXCEPTION 'Cloud usage resource is required';
  END IF;

  IF p_units IS NULL OR p_units < 0 THEN
    RAISE EXCEPTION 'Cloud usage units must be non-negative';
  END IF;

  IF p_cloud_units IS NULL OR p_cloud_units < 0 THEN
    RAISE EXCEPTION 'Cloud units must be non-negative';
  END IF;

  IF p_amount_light IS NULL OR p_amount_light < 0 THEN
    RAISE EXCEPTION 'Cloud usage amount must be non-negative';
  END IF;

  INSERT INTO public.cloud_usage_events (
    payer_user_id,
    sponsor_user_id,
    caller_user_id,
    owner_user_id,
    app_id,
    function_name,
    receipt_id,
    source,
    resource,
    units,
    cloud_units,
    amount_light,
    billing_config_version,
    metadata
  ) VALUES (
    p_payer_user_id,
    p_sponsor_user_id,
    p_caller_user_id,
    p_owner_user_id,
    p_app_id,
    p_function_name,
    p_receipt_id,
    p_source,
    p_resource,
    p_units,
    p_cloud_units,
    p_amount_light,
    p_billing_config_version,
    COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING id INTO v_event_id;

  PERFORM public.upsert_cloud_usage_rollup(
    p_payer_user_id,
    p_app_id,
    p_source,
    p_resource,
    p_units,
    p_cloud_units,
    p_amount_light
  );

  RETURN v_event_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.debit_cloud_usage(
  p_payer_user_id uuid,
  p_source text,
  p_resource text,
  p_units double precision,
  p_cloud_units double precision,
  p_amount_light double precision,
  p_sponsor_user_id uuid DEFAULT NULL::uuid,
  p_caller_user_id uuid DEFAULT NULL::uuid,
  p_owner_user_id uuid DEFAULT NULL::uuid,
  p_app_id uuid DEFAULT NULL::uuid,
  p_function_name text DEFAULT NULL::text,
  p_receipt_id text DEFAULT NULL::text,
  p_billing_config_version integer DEFAULT NULL::integer,
  p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS TABLE(
  event_id uuid,
  old_balance double precision,
  new_balance double precision,
  amount_debited double precision,
  deposit_debited double precision,
  earned_debited double precision
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public, extensions'
AS $$
DECLARE
  v_event_id uuid;
  v_old_balance double precision;
  v_debit RECORD;
BEGIN
  IF p_amount_light IS NULL OR p_amount_light <= 0 THEN
    RAISE EXCEPTION 'Cloud usage debit amount must be positive';
  END IF;

  SELECT COALESCE(balance_light, 0)
  INTO v_old_balance
  FROM public.users
  WHERE id = p_payer_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  SELECT * INTO v_debit
  FROM public.debit_spendable_light(p_payer_user_id, p_amount_light, false);

  INSERT INTO public.cloud_usage_events (
    payer_user_id,
    sponsor_user_id,
    caller_user_id,
    owner_user_id,
    app_id,
    function_name,
    receipt_id,
    source,
    resource,
    units,
    cloud_units,
    amount_light,
    billing_config_version,
    metadata
  ) VALUES (
    p_payer_user_id,
    p_sponsor_user_id,
    p_caller_user_id,
    p_owner_user_id,
    p_app_id,
    p_function_name,
    p_receipt_id,
    p_source,
    p_resource,
    p_units,
    p_cloud_units,
    p_amount_light,
    p_billing_config_version,
    COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING id INTO v_event_id;

  PERFORM public.record_light_ledger_entry(
    p_payer_user_id,
    p_owner_user_id,
    p_app_id,
    'deposit',
    'cloud_usage_debit',
    -v_debit.deposit_debited,
    'cloud_usage_events',
    v_event_id,
    jsonb_build_object(
      'source', p_source,
      'resource', p_resource,
      'units', p_units,
      'cloud_units', p_cloud_units,
      'receipt_id', p_receipt_id
    ) || COALESCE(p_metadata, '{}'::jsonb)
  );
  PERFORM public.record_light_ledger_entry(
    p_payer_user_id,
    p_owner_user_id,
    p_app_id,
    'earned',
    'cloud_usage_debit',
    -v_debit.earned_debited,
    'cloud_usage_events',
    v_event_id,
    jsonb_build_object(
      'source', p_source,
      'resource', p_resource,
      'units', p_units,
      'cloud_units', p_cloud_units,
      'receipt_id', p_receipt_id
    ) || COALESCE(p_metadata, '{}'::jsonb)
  );

  PERFORM public.upsert_cloud_usage_rollup(
    p_payer_user_id,
    p_app_id,
    p_source,
    p_resource,
    p_units,
    p_cloud_units,
    p_amount_light
  );

  RETURN QUERY SELECT
    v_event_id,
    v_old_balance,
    v_debit.new_balance,
    v_debit.deposit_debited + v_debit.earned_debited,
    v_debit.deposit_debited,
    v_debit.earned_debited;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_cloud_usage_hold(
  p_payer_user_id uuid,
  p_source text,
  p_resource text,
  p_expected_units double precision,
  p_expected_cloud_units double precision,
  p_expected_amount_light double precision,
  p_sponsor_user_id uuid DEFAULT NULL::uuid,
  p_caller_user_id uuid DEFAULT NULL::uuid,
  p_owner_user_id uuid DEFAULT NULL::uuid,
  p_app_id uuid DEFAULT NULL::uuid,
  p_function_name text DEFAULT NULL::text,
  p_receipt_id text DEFAULT NULL::text,
  p_expires_at timestamptz DEFAULT NULL::timestamptz,
  p_billing_config_version integer DEFAULT NULL::integer,
  p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS TABLE(
  hold_id uuid,
  old_balance double precision,
  new_balance double precision,
  held_amount_light double precision,
  held_deposit_light double precision,
  held_earned_light double precision
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public, extensions'
AS $$
DECLARE
  v_hold_id uuid;
  v_old_balance double precision;
  v_debit RECORD;
BEGIN
  IF p_expected_amount_light IS NULL OR p_expected_amount_light <= 0 THEN
    RAISE EXCEPTION 'Cloud usage hold amount must be positive';
  END IF;

  SELECT COALESCE(balance_light, 0)
  INTO v_old_balance
  FROM public.users
  WHERE id = p_payer_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  SELECT * INTO v_debit
  FROM public.debit_spendable_light(p_payer_user_id, p_expected_amount_light, false);

  INSERT INTO public.cloud_usage_holds (
    payer_user_id,
    sponsor_user_id,
    caller_user_id,
    owner_user_id,
    app_id,
    function_name,
    receipt_id,
    source,
    resource,
    expected_units,
    expected_cloud_units,
    expected_amount_light,
    held_amount_light,
    held_deposit_light,
    held_earned_light,
    expires_at,
    billing_config_version,
    metadata
  ) VALUES (
    p_payer_user_id,
    p_sponsor_user_id,
    p_caller_user_id,
    p_owner_user_id,
    p_app_id,
    p_function_name,
    p_receipt_id,
    p_source,
    p_resource,
    p_expected_units,
    p_expected_cloud_units,
    p_expected_amount_light,
    v_debit.deposit_debited + v_debit.earned_debited,
    v_debit.deposit_debited,
    v_debit.earned_debited,
    p_expires_at,
    p_billing_config_version,
    COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING id INTO v_hold_id;

  PERFORM public.record_light_ledger_entry(
    p_payer_user_id,
    p_owner_user_id,
    p_app_id,
    'deposit',
    'cloud_usage_hold',
    -v_debit.deposit_debited,
    'cloud_usage_holds',
    v_hold_id,
    jsonb_build_object(
      'source', p_source,
      'resource', p_resource,
      'expected_units', p_expected_units,
      'expected_cloud_units', p_expected_cloud_units,
      'receipt_id', p_receipt_id
    ) || COALESCE(p_metadata, '{}'::jsonb)
  );
  PERFORM public.record_light_ledger_entry(
    p_payer_user_id,
    p_owner_user_id,
    p_app_id,
    'earned',
    'cloud_usage_hold',
    -v_debit.earned_debited,
    'cloud_usage_holds',
    v_hold_id,
    jsonb_build_object(
      'source', p_source,
      'resource', p_resource,
      'expected_units', p_expected_units,
      'expected_cloud_units', p_expected_cloud_units,
      'receipt_id', p_receipt_id
    ) || COALESCE(p_metadata, '{}'::jsonb)
  );

  RETURN QUERY SELECT
    v_hold_id,
    v_old_balance,
    v_debit.new_balance,
    v_debit.deposit_debited + v_debit.earned_debited,
    v_debit.deposit_debited,
    v_debit.earned_debited;
END;
$$;

CREATE OR REPLACE FUNCTION public.settle_cloud_usage_hold(
  p_hold_id uuid,
  p_units double precision,
  p_cloud_units double precision,
  p_amount_light double precision,
  p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS TABLE(
  event_id uuid,
  hold_id uuid,
  settled_amount_light double precision,
  released_amount_light double precision
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public, extensions'
AS $$
DECLARE
  v_hold RECORD;
  v_event_id uuid;
  v_consumed_deposit double precision := 0;
  v_consumed_earned double precision := 0;
  v_release_deposit double precision := 0;
  v_release_earned double precision := 0;
  v_released_amount double precision := 0;
BEGIN
  IF p_amount_light IS NULL OR p_amount_light < 0 THEN
    RAISE EXCEPTION 'Cloud usage settlement amount must be non-negative';
  END IF;

  SELECT *
  INTO v_hold
  FROM public.cloud_usage_holds
  WHERE id = p_hold_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cloud usage hold not found';
  END IF;

  IF v_hold.status <> 'held' THEN
    RAISE EXCEPTION 'Cloud usage hold is not active';
  END IF;

  IF p_amount_light - v_hold.held_amount_light > 0.000000001 THEN
    RAISE EXCEPTION 'Cloud usage settlement exceeds held amount';
  END IF;

  v_consumed_deposit := LEAST(v_hold.held_deposit_light, p_amount_light);
  v_consumed_earned := GREATEST(p_amount_light - v_consumed_deposit, 0);
  v_release_deposit := GREATEST(v_hold.held_deposit_light - v_consumed_deposit, 0);
  v_release_earned := GREATEST(v_hold.held_earned_light - v_consumed_earned, 0);
  v_released_amount := v_release_deposit + v_release_earned;

  INSERT INTO public.cloud_usage_events (
    payer_user_id,
    sponsor_user_id,
    caller_user_id,
    owner_user_id,
    app_id,
    function_name,
    receipt_id,
    source,
    resource,
    units,
    cloud_units,
    amount_light,
    billing_config_version,
    hold_id,
    metadata
  ) VALUES (
    v_hold.payer_user_id,
    v_hold.sponsor_user_id,
    v_hold.caller_user_id,
    v_hold.owner_user_id,
    v_hold.app_id,
    v_hold.function_name,
    v_hold.receipt_id,
    v_hold.source,
    v_hold.resource,
    p_units,
    p_cloud_units,
    p_amount_light,
    v_hold.billing_config_version,
    p_hold_id,
    COALESCE(v_hold.metadata, '{}'::jsonb)
      || COALESCE(p_metadata, '{}'::jsonb)
      || jsonb_build_object('hold_id', p_hold_id)
  )
  RETURNING id INTO v_event_id;

  IF v_released_amount > 0 THEN
    UPDATE public.users
    SET
      deposit_balance_light = deposit_balance_light + v_release_deposit,
      earned_balance_light = earned_balance_light + v_release_earned,
      balance_light = deposit_balance_light + earned_balance_light + v_released_amount
    WHERE id = v_hold.payer_user_id;

    PERFORM public.record_light_ledger_entry(
      v_hold.payer_user_id,
      v_hold.owner_user_id,
      v_hold.app_id,
      'deposit',
      'cloud_usage_hold_release',
      v_release_deposit,
      'cloud_usage_holds',
      p_hold_id,
      jsonb_build_object(
        'settlement_event_id', v_event_id,
        'source', v_hold.source,
        'resource', v_hold.resource
      ) || COALESCE(p_metadata, '{}'::jsonb)
    );
    PERFORM public.record_light_ledger_entry(
      v_hold.payer_user_id,
      v_hold.owner_user_id,
      v_hold.app_id,
      'earned',
      'cloud_usage_hold_release',
      v_release_earned,
      'cloud_usage_holds',
      p_hold_id,
      jsonb_build_object(
        'settlement_event_id', v_event_id,
        'source', v_hold.source,
        'resource', v_hold.resource
      ) || COALESCE(p_metadata, '{}'::jsonb)
    );
  END IF;

  UPDATE public.cloud_usage_holds
  SET
    status = 'settled',
    settled_amount_light = p_amount_light,
    released_amount_light = v_released_amount,
    settlement_event_id = v_event_id,
    metadata = COALESCE(metadata, '{}'::jsonb)
      || COALESCE(p_metadata, '{}'::jsonb),
    updated_at = now()
  WHERE id = p_hold_id;

  PERFORM public.upsert_cloud_usage_rollup(
    v_hold.payer_user_id,
    v_hold.app_id,
    v_hold.source,
    v_hold.resource,
    p_units,
    p_cloud_units,
    p_amount_light
  );

  RETURN QUERY SELECT
    v_event_id,
    p_hold_id,
    p_amount_light,
    v_released_amount;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_cloud_usage_hold(
  p_hold_id uuid,
  p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS TABLE(
  hold_id uuid,
  released_amount_light double precision
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public, extensions'
AS $$
DECLARE
  v_hold RECORD;
  v_released_amount double precision := 0;
BEGIN
  SELECT *
  INTO v_hold
  FROM public.cloud_usage_holds
  WHERE id = p_hold_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cloud usage hold not found';
  END IF;

  IF v_hold.status <> 'held' THEN
    RAISE EXCEPTION 'Cloud usage hold is not active';
  END IF;

  v_released_amount := v_hold.held_deposit_light + v_hold.held_earned_light;

  UPDATE public.users
  SET
    deposit_balance_light = deposit_balance_light + v_hold.held_deposit_light,
    earned_balance_light = earned_balance_light + v_hold.held_earned_light,
    balance_light = deposit_balance_light + earned_balance_light + v_released_amount
  WHERE id = v_hold.payer_user_id;

  PERFORM public.record_light_ledger_entry(
    v_hold.payer_user_id,
    v_hold.owner_user_id,
    v_hold.app_id,
    'deposit',
    'cloud_usage_hold_release',
    v_hold.held_deposit_light,
    'cloud_usage_holds',
    p_hold_id,
    jsonb_build_object(
      'source', v_hold.source,
      'resource', v_hold.resource,
      'release_reason', 'manual'
    ) || COALESCE(p_metadata, '{}'::jsonb)
  );
  PERFORM public.record_light_ledger_entry(
    v_hold.payer_user_id,
    v_hold.owner_user_id,
    v_hold.app_id,
    'earned',
    'cloud_usage_hold_release',
    v_hold.held_earned_light,
    'cloud_usage_holds',
    p_hold_id,
    jsonb_build_object(
      'source', v_hold.source,
      'resource', v_hold.resource,
      'release_reason', 'manual'
    ) || COALESCE(p_metadata, '{}'::jsonb)
  );

  UPDATE public.cloud_usage_holds
  SET
    status = 'released',
    released_amount_light = v_released_amount,
    metadata = COALESCE(metadata, '{}'::jsonb)
      || COALESCE(p_metadata, '{}'::jsonb),
    updated_at = now()
  WHERE id = p_hold_id;

  RETURN QUERY SELECT p_hold_id, v_released_amount;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_cloud_usage_rollup(
  uuid,
  uuid,
  text,
  text,
  double precision,
  double precision,
  double precision
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_cloud_usage_event(
  uuid,
  text,
  text,
  double precision,
  double precision,
  double precision,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  integer,
  jsonb
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.debit_cloud_usage(
  uuid,
  text,
  text,
  double precision,
  double precision,
  double precision,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  integer,
  jsonb
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_cloud_usage_hold(
  uuid,
  text,
  text,
  double precision,
  double precision,
  double precision,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  timestamptz,
  integer,
  jsonb
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.settle_cloud_usage_hold(
  uuid,
  double precision,
  double precision,
  double precision,
  jsonb
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_cloud_usage_hold(uuid, jsonb)
  FROM PUBLIC, anon, authenticated;

GRANT ALL ON FUNCTION public.record_cloud_usage_event(
  uuid,
  text,
  text,
  double precision,
  double precision,
  double precision,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  integer,
  jsonb
) TO service_role;
GRANT ALL ON FUNCTION public.debit_cloud_usage(
  uuid,
  text,
  text,
  double precision,
  double precision,
  double precision,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  integer,
  jsonb
) TO service_role;
GRANT ALL ON FUNCTION public.create_cloud_usage_hold(
  uuid,
  text,
  text,
  double precision,
  double precision,
  double precision,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  timestamptz,
  integer,
  jsonb
) TO service_role;
GRANT ALL ON FUNCTION public.settle_cloud_usage_hold(
  uuid,
  double precision,
  double precision,
  double precision,
  jsonb
) TO service_role;
GRANT ALL ON FUNCTION public.release_cloud_usage_hold(uuid, jsonb)
  TO service_role;
