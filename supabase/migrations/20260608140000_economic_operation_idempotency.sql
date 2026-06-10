CREATE TABLE IF NOT EXISTS public.economic_idempotency_keys (
  idempotency_key text PRIMARY KEY,
  operation text NOT NULL,
  status text NOT NULL DEFAULT 'started',
  response jsonb,
  reference_table text,
  reference_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT economic_idempotency_keys_status_check
    CHECK (status IN ('started', 'completed'))
);

ALTER TABLE public.economic_idempotency_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.economic_idempotency_keys FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.economic_idempotency_keys TO service_role;

ALTER TABLE public.transfers
  ADD COLUMN IF NOT EXISTS idempotency_key text;

ALTER TABLE public.cloud_usage_events
  ADD COLUMN IF NOT EXISTS idempotency_key text;

ALTER TABLE public.cloud_usage_holds
  ADD COLUMN IF NOT EXISTS idempotency_key text;

ALTER TABLE public.skill_pull_receipts
  ADD COLUMN IF NOT EXISTS idempotency_key text;

ALTER TABLE public.embedding_generation_charges
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS transfers_idempotency_key_uidx
  ON public.transfers(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS cloud_usage_events_idempotency_key_uidx
  ON public.cloud_usage_events(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS cloud_usage_holds_idempotency_key_uidx
  ON public.cloud_usage_holds(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS skill_pull_receipts_idempotency_key_uidx
  ON public.skill_pull_receipts(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS embedding_generation_charges_idempotency_key_uidx
  ON public.embedding_generation_charges(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.begin_economic_idempotent_operation(
  p_idempotency_key text,
  p_operation text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public, extensions'
AS $$
DECLARE
  v_key text := NULLIF(btrim(COALESCE(p_idempotency_key, '')), '');
  v_inserted integer := 0;
  v_existing RECORD;
BEGIN
  IF v_key IS NULL THEN
    RETURN NULL;
  END IF;

  IF p_operation IS NULL OR btrim(p_operation) = '' THEN
    RAISE EXCEPTION 'Economic idempotency operation is required';
  END IF;

  INSERT INTO public.economic_idempotency_keys (
    idempotency_key,
    operation,
    status
  ) VALUES (
    v_key,
    p_operation,
    'started'
  )
  ON CONFLICT (idempotency_key) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted = 1 THEN
    RETURN NULL;
  END IF;

  SELECT *
  INTO v_existing
  FROM public.economic_idempotency_keys
  WHERE idempotency_key = v_key;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Economic idempotency key disappeared';
  END IF;

  IF v_existing.operation <> p_operation THEN
    RAISE EXCEPTION 'Economic idempotency key reused for different operation';
  END IF;

  IF v_existing.response IS NULL THEN
    RAISE EXCEPTION 'Economic idempotent operation is already in progress';
  END IF;

  RETURN v_existing.response;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_economic_idempotent_operation(
  p_idempotency_key text,
  p_response jsonb,
  p_reference_table text DEFAULT NULL::text,
  p_reference_id uuid DEFAULT NULL::uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public, extensions'
AS $$
DECLARE
  v_key text := NULLIF(btrim(COALESCE(p_idempotency_key, '')), '');
BEGIN
  IF v_key IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.economic_idempotency_keys
  SET
    status = 'completed',
    response = COALESCE(p_response, '{}'::jsonb),
    reference_table = p_reference_table,
    reference_id = p_reference_id,
    updated_at = now()
  WHERE idempotency_key = v_key;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Economic idempotency key was not claimed';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_economic_idempotent_operation(
  p_idempotency_key text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public, extensions'
AS $$
DECLARE
  v_key text := NULLIF(btrim(COALESCE(p_idempotency_key, '')), '');
BEGIN
  IF v_key IS NULL THEN
    RETURN;
  END IF;

  DELETE FROM public.economic_idempotency_keys
  WHERE idempotency_key = v_key
    AND status = 'started'
    AND response IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.begin_economic_idempotent_operation(text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_economic_idempotent_operation(text, jsonb, text, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cancel_economic_idempotent_operation(text)
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.begin_economic_idempotent_operation(text, text)
  TO service_role;
GRANT ALL ON FUNCTION public.finish_economic_idempotent_operation(text, jsonb, text, uuid)
  TO service_role;
GRANT ALL ON FUNCTION public.cancel_economic_idempotent_operation(text)
  TO service_role;

DROP FUNCTION IF EXISTS public.debit_light(
  uuid,
  double precision,
  text,
  boolean,
  boolean,
  uuid,
  text,
  text,
  uuid,
  jsonb
) CASCADE;

CREATE OR REPLACE FUNCTION public.debit_light(
  p_user_id uuid,
  p_amount_light double precision,
  p_reason text,
  p_update_billed_at boolean DEFAULT false,
  p_allow_partial boolean DEFAULT true,
  p_app_id uuid DEFAULT NULL::uuid,
  p_function_name text DEFAULT NULL::text,
  p_reference_table text DEFAULT NULL::text,
  p_reference_id uuid DEFAULT NULL::uuid,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_idempotency_key text DEFAULT NULL::text
) RETURNS TABLE(
  old_balance double precision,
  new_balance double precision,
  was_depleted boolean,
  amount_debited double precision,
  deposit_debited double precision,
  earned_debited double precision
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public, extensions'
AS $$
DECLARE
  v_key text := NULLIF(btrim(COALESCE(p_idempotency_key, '')), '');
  v_existing jsonb;
  v_old_balance double precision;
  v_debit RECORD;
  v_metadata jsonb;
  v_response jsonb;
BEGIN
  v_existing := public.begin_economic_idempotent_operation(v_key, 'debit_light');
  IF v_existing IS NOT NULL THEN
    RETURN QUERY SELECT
      (v_existing->>'old_balance')::double precision,
      (v_existing->>'new_balance')::double precision,
      (v_existing->>'was_depleted')::boolean,
      (v_existing->>'amount_debited')::double precision,
      (v_existing->>'deposit_debited')::double precision,
      (v_existing->>'earned_debited')::double precision;
    RETURN;
  END IF;

  IF p_amount_light IS NULL OR p_amount_light <= 0 THEN
    RAISE EXCEPTION 'Debit amount must be positive';
  END IF;

  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'Debit reason is required';
  END IF;

  SELECT COALESCE(balance_light, 0) INTO v_old_balance
  FROM public.users
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  SELECT * INTO v_debit
  FROM public.debit_spendable_light(
    p_user_id,
    p_amount_light,
    COALESCE(p_allow_partial, true)
  );

  IF COALESCE(p_update_billed_at, false) THEN
    UPDATE public.users
    SET hosting_last_billed_at = now()
    WHERE id = p_user_id;
  END IF;

  v_metadata := COALESCE(p_metadata, '{}'::jsonb)
    || jsonb_build_object(
      'requested_light', p_amount_light,
      'amount_debited_light', v_debit.deposit_debited + v_debit.earned_debited,
      'function_name', p_function_name,
      'idempotency_key', v_key
    );

  PERFORM public.record_light_ledger_entry(
    p_user_id,
    NULL,
    p_app_id,
    'deposit',
    p_reason,
    -v_debit.deposit_debited,
    p_reference_table,
    p_reference_id,
    v_metadata
  );
  PERFORM public.record_light_ledger_entry(
    p_user_id,
    NULL,
    p_app_id,
    'earned',
    p_reason,
    -v_debit.earned_debited,
    p_reference_table,
    p_reference_id,
    v_metadata
  );

  v_response := jsonb_build_object(
    'old_balance', v_old_balance,
    'new_balance', v_debit.new_balance,
    'was_depleted', v_debit.new_balance <= 0,
    'amount_debited', v_debit.deposit_debited + v_debit.earned_debited,
    'deposit_debited', v_debit.deposit_debited,
    'earned_debited', v_debit.earned_debited
  );

  PERFORM public.finish_economic_idempotent_operation(
    v_key,
    v_response,
    p_reference_table,
    p_reference_id
  );

  RETURN QUERY SELECT
    v_old_balance,
    v_debit.new_balance,
    (v_debit.new_balance <= 0),
    v_debit.deposit_debited + v_debit.earned_debited,
    v_debit.deposit_debited,
    v_debit.earned_debited;
END;
$$;

CREATE OR REPLACE FUNCTION public.debit_balance(
  p_user_id uuid,
  p_amount double precision,
  p_update_billed_at boolean DEFAULT true
) RETURNS TABLE(
  old_balance double precision,
  new_balance double precision,
  was_depleted boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public, extensions'
AS $$
  SELECT old_balance, new_balance, was_depleted
  FROM public.debit_light(
    p_user_id,
    p_amount,
    'spend_debit',
    p_update_billed_at,
    true,
    NULL::uuid,
    NULL::text,
    'users',
    p_user_id,
    '{}'::jsonb,
    NULL::text
  );
$$;

DROP FUNCTION IF EXISTS public.transfer_light(
  uuid,
  uuid,
  double precision,
  text,
  uuid,
  text,
  uuid,
  jsonb
);

CREATE OR REPLACE FUNCTION public.transfer_light(
  p_from_user uuid,
  p_to_user uuid,
  p_amount_light double precision,
  p_reason text,
  p_app_id uuid DEFAULT NULL::uuid,
  p_function_name text DEFAULT NULL::text,
  p_content_id uuid DEFAULT NULL::uuid,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_idempotency_key text DEFAULT NULL::text
) RETURNS TABLE(
  from_new_balance double precision,
  to_new_balance double precision,
  platform_fee double precision,
  transfer_id uuid,
  fee_would_have_been double precision,
  fee_waived double precision,
  waiver_source text,
  waiver_event_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public, extensions'
AS $$
DECLARE
  v_key text := NULLIF(btrim(COALESCE(p_idempotency_key, '')), '');
  v_existing jsonb;
  v_fee_rate double precision := 0.15;
  v_fee_would_have_been double precision;
  v_fee_waived double precision := 0;
  v_platform_fee_charged double precision;
  v_net double precision;
  v_from_available double precision;
  v_debit RECORD;
  v_credit RECORD;
  v_transfer_id uuid;
  v_metadata jsonb;
  v_transaction_kind text;
  v_waiver_source text;
  v_waiver_grant_id uuid;
  v_fee_credit_available double precision := 0;
  v_fee_credit_locked boolean := false;
  v_fee_credit_balance_after double precision;
  v_fee_credit_ledger_id uuid;
  v_customer_attribution_id uuid;
  v_customer_attribution_source text;
  v_recorded_attribution_source text;
  v_waiver_event_id uuid;
  v_response jsonb;
BEGIN
  v_existing := public.begin_economic_idempotent_operation(v_key, 'transfer_light');
  IF v_existing IS NOT NULL THEN
    RETURN QUERY SELECT
      (v_existing->>'from_new_balance')::double precision,
      (v_existing->>'to_new_balance')::double precision,
      (v_existing->>'platform_fee')::double precision,
      (v_existing->>'transfer_id')::uuid,
      (v_existing->>'fee_would_have_been')::double precision,
      (v_existing->>'fee_waived')::double precision,
      NULLIF(v_existing->>'waiver_source', ''),
      NULLIF(v_existing->>'waiver_event_id', '')::uuid;
    RETURN;
  END IF;

  IF p_amount_light IS NULL OR p_amount_light <= 0 THEN
    RAISE EXCEPTION 'Transfer amount must be positive';
  END IF;

  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'Transfer reason is required';
  END IF;

  IF p_from_user = p_to_user THEN
    RAISE EXCEPTION 'Cannot transfer Light to the same account';
  END IF;

  SELECT COALESCE(balance_light, 0) INTO v_from_available
  FROM public.users
  WHERE id = p_from_user
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sender not found';
  END IF;

  IF v_from_available < p_amount_light THEN
    PERFORM public.cancel_economic_idempotent_operation(v_key);
    RETURN;
  END IF;

  SELECT COALESCE(platform_fee_rate, 0.15) INTO v_fee_rate
  FROM public.platform_billing_config
  WHERE id = 'singleton';

  v_fee_would_have_been := p_amount_light * COALESCE(v_fee_rate, 0.15);

  v_transaction_kind := CASE
    WHEN p_reason = 'gpu_call' THEN 'gpu_developer_fee'
    WHEN p_reason IN ('tool_call', 'tool_call_suspended') THEN 'tool_call'
    WHEN p_reason = 'skill_pull' THEN 'skill_pull'
    ELSE NULL
  END;

  IF v_transaction_kind IS NOT NULL AND v_fee_would_have_been > 0 THEN
    v_recorded_attribution_source :=
      COALESCE(NULLIF(COALESCE(p_metadata, '{}'::jsonb)->>'customer_attribution_source', ''), 'platform_discovery');
    IF v_recorded_attribution_source NOT IN (
      'publisher_referral',
      'platform_discovery',
      'platform_marketplace',
      'direct_internal',
      'admin_override'
    ) THEN
      v_recorded_attribution_source := 'platform_discovery';
    END IF;

    PERFORM public.upsert_publisher_customer_attribution(
      p_from_user,
      p_to_user,
      v_recorded_attribution_source,
      NULL,
      NULL,
      p_app_id,
      jsonb_build_object(
        'reason', p_reason,
        'function_name', p_function_name,
        'content_id', p_content_id
      ) || COALESCE(p_metadata, '{}'::jsonb)
    );

    SELECT id, source INTO v_customer_attribution_id, v_customer_attribution_source
    FROM public.publisher_customer_attributions
    WHERE payer_user_id = p_from_user
      AND publisher_user_id = p_to_user
    FOR UPDATE;

    IF v_customer_attribution_source = 'publisher_referral' THEN
      v_fee_waived := v_fee_would_have_been;
      v_waiver_source := 'publisher_customer_attribution';
    ELSE
      SELECT id INTO v_waiver_grant_id
      FROM public.publisher_fee_waiver_grants
      WHERE user_id = p_from_user
        AND publisher_user_id = p_to_user
        AND source = 'referral'
        AND starts_at <= now()
        AND expires_at > now()
      ORDER BY starts_at ASC
      LIMIT 1;

      IF v_waiver_grant_id IS NOT NULL THEN
        v_fee_waived := v_fee_would_have_been;
        v_waiver_source := 'referral_grant';
      ELSE
        SELECT COALESCE(balance_light, 0) INTO v_fee_credit_available
        FROM public.publisher_fee_credit_accounts
        WHERE publisher_user_id = p_to_user
        FOR UPDATE;
        v_fee_credit_locked := FOUND;

        IF v_fee_credit_locked AND v_fee_credit_available > 0 THEN
          v_fee_waived := LEAST(v_fee_would_have_been, v_fee_credit_available);
          v_waiver_source := 'publisher_fee_credit';
        END IF;
      END IF;
    END IF;
  END IF;

  v_platform_fee_charged := v_fee_would_have_been - v_fee_waived;
  v_net := p_amount_light - v_platform_fee_charged;

  SELECT * INTO v_debit
  FROM public.debit_spendable_light(p_from_user, p_amount_light, false);

  INSERT INTO public.transfers (
    from_user_id,
    to_user_id,
    amount_cents,
    amount_light,
    reason,
    app_id,
    function_name,
    content_id,
    idempotency_key
  )
  VALUES (
    p_from_user,
    p_to_user,
    round(v_net)::double precision,
    v_net,
    p_reason,
    p_app_id,
    p_function_name,
    p_content_id,
    v_key
  )
  RETURNING id INTO v_transfer_id;

  IF v_waiver_source = 'publisher_fee_credit' AND v_fee_waived > 0 THEN
    UPDATE public.publisher_fee_credit_accounts
    SET balance_light = balance_light - v_fee_waived,
        lifetime_spent_light = lifetime_spent_light + v_fee_waived,
        updated_at = now()
    WHERE publisher_user_id = p_to_user
    RETURNING balance_light INTO v_fee_credit_balance_after;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Fee credit account disappeared during transfer settlement';
    END IF;

    INSERT INTO public.publisher_fee_credit_ledger (
      publisher_user_id,
      amount_light,
      balance_after_light,
      kind,
      reason,
      reference_table,
      reference_id,
      metadata
    )
    VALUES (
      p_to_user,
      -v_fee_waived,
      v_fee_credit_balance_after,
      'spend',
      'platform_fee_waiver',
      'transfers',
      v_transfer_id,
      jsonb_build_object(
        'payer_user_id', p_from_user,
        'gross_light', p_amount_light,
        'fee_would_have_been_light', v_fee_would_have_been,
        'platform_fee_charged_light', v_platform_fee_charged,
        'reason', p_reason,
        'idempotency_key', v_key
      )
    )
    RETURNING id INTO v_fee_credit_ledger_id;
  END IF;

  v_metadata := COALESCE(p_metadata, '{}'::jsonb)
    || jsonb_build_object(
      'gross_light', p_amount_light,
      'net_light', v_net,
      'platform_fee_light', v_platform_fee_charged,
      'fee_would_have_been_light', v_fee_would_have_been,
      'fee_waived_light', v_fee_waived,
      'waiver_source', v_waiver_source,
      'customer_attribution_id', v_customer_attribution_id,
      'customer_attribution_source', v_customer_attribution_source,
      'function_name', p_function_name,
      'content_id', p_content_id,
      'idempotency_key', v_key
    );

  PERFORM public.record_light_ledger_entry(
    p_from_user,
    p_to_user,
    p_app_id,
    'deposit',
    p_reason || '_debit',
    -v_debit.deposit_debited,
    'transfers',
    v_transfer_id,
    v_metadata
  );
  PERFORM public.record_light_ledger_entry(
    p_from_user,
    p_to_user,
    p_app_id,
    'earned',
    p_reason || '_debit',
    -v_debit.earned_debited,
    'transfers',
    v_transfer_id,
    v_metadata
  );

  SELECT * INTO v_credit
  FROM public.credit_creator_earning(
    p_to_user,
    v_net,
    p_reason || '_earning',
    'transfers',
    v_transfer_id,
    p_from_user,
    p_app_id,
    v_metadata
  );

  PERFORM public.record_light_ledger_entry(
    NULL,
    p_from_user,
    p_app_id,
    'platform',
    'platform_fee',
    v_platform_fee_charged,
    'transfers',
    v_transfer_id,
    v_metadata
  );

  IF v_waiver_source IS NOT NULL AND v_fee_waived > 0 THEN
    INSERT INTO public.platform_fee_waiver_events (
      payer_user_id,
      publisher_user_id,
      app_id,
      transaction_kind,
      transaction_reference_table,
      transaction_reference_id,
      gross_light,
      fee_rate,
      fee_would_have_been_light,
      fee_waived_light,
      platform_fee_charged_light,
      waiver_source,
      waiver_grant_id,
      fee_credit_ledger_id,
      customer_attribution_id,
      metadata
    )
    VALUES (
      p_from_user,
      p_to_user,
      p_app_id,
      v_transaction_kind,
      'transfers',
      v_transfer_id,
      p_amount_light,
      COALESCE(v_fee_rate, 0.15),
      v_fee_would_have_been,
      v_fee_waived,
      v_platform_fee_charged,
      v_waiver_source,
      v_waiver_grant_id,
      v_fee_credit_ledger_id,
      CASE WHEN v_waiver_source = 'publisher_customer_attribution' THEN v_customer_attribution_id ELSE NULL END,
      v_metadata || jsonb_build_object('reason', p_reason)
    )
    RETURNING id INTO v_waiver_event_id;
  END IF;

  v_response := jsonb_build_object(
    'from_new_balance', v_debit.new_balance,
    'to_new_balance', v_credit.new_balance,
    'platform_fee', v_platform_fee_charged,
    'transfer_id', v_transfer_id,
    'fee_would_have_been', v_fee_would_have_been,
    'fee_waived', v_fee_waived,
    'waiver_source', COALESCE(v_waiver_source, ''),
    'waiver_event_id', COALESCE(v_waiver_event_id::text, '')
  );

  PERFORM public.finish_economic_idempotent_operation(
    v_key,
    v_response,
    'transfers',
    v_transfer_id
  );

  RETURN QUERY SELECT
    v_debit.new_balance,
    v_credit.new_balance,
    v_platform_fee_charged,
    v_transfer_id,
    v_fee_would_have_been,
    v_fee_waived,
    v_waiver_source,
    v_waiver_event_id;
END;
$$;

DROP FUNCTION IF EXISTS public.debit_cloud_usage(
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
);

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
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_idempotency_key text DEFAULT NULL::text
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
  v_key text := NULLIF(btrim(COALESCE(p_idempotency_key, '')), '');
  v_existing jsonb;
  v_event_id uuid;
  v_old_balance double precision;
  v_debit RECORD;
  v_response jsonb;
BEGIN
  v_existing := public.begin_economic_idempotent_operation(v_key, 'debit_cloud_usage');
  IF v_existing IS NOT NULL THEN
    RETURN QUERY SELECT
      (v_existing->>'event_id')::uuid,
      (v_existing->>'old_balance')::double precision,
      (v_existing->>'new_balance')::double precision,
      (v_existing->>'amount_debited')::double precision,
      (v_existing->>'deposit_debited')::double precision,
      (v_existing->>'earned_debited')::double precision;
    RETURN;
  END IF;

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
    metadata,
    idempotency_key
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
      || jsonb_build_object('idempotency_key', v_key),
    v_key
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
      'receipt_id', p_receipt_id,
      'idempotency_key', v_key
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
      'receipt_id', p_receipt_id,
      'idempotency_key', v_key
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

  v_response := jsonb_build_object(
    'event_id', v_event_id,
    'old_balance', v_old_balance,
    'new_balance', v_debit.new_balance,
    'amount_debited', v_debit.deposit_debited + v_debit.earned_debited,
    'deposit_debited', v_debit.deposit_debited,
    'earned_debited', v_debit.earned_debited
  );
  PERFORM public.finish_economic_idempotent_operation(
    v_key,
    v_response,
    'cloud_usage_events',
    v_event_id
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

DROP FUNCTION IF EXISTS public.create_cloud_usage_hold(
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
);

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
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_idempotency_key text DEFAULT NULL::text
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
  v_key text := NULLIF(btrim(COALESCE(p_idempotency_key, '')), '');
  v_existing jsonb;
  v_hold_id uuid;
  v_old_balance double precision;
  v_debit RECORD;
  v_response jsonb;
BEGIN
  v_existing := public.begin_economic_idempotent_operation(v_key, 'create_cloud_usage_hold');
  IF v_existing IS NOT NULL THEN
    RETURN QUERY SELECT
      (v_existing->>'hold_id')::uuid,
      (v_existing->>'old_balance')::double precision,
      (v_existing->>'new_balance')::double precision,
      (v_existing->>'held_amount_light')::double precision,
      (v_existing->>'held_deposit_light')::double precision,
      (v_existing->>'held_earned_light')::double precision;
    RETURN;
  END IF;

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
    metadata,
    idempotency_key
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
      || jsonb_build_object('idempotency_key', v_key),
    v_key
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
      'receipt_id', p_receipt_id,
      'idempotency_key', v_key
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
      'receipt_id', p_receipt_id,
      'idempotency_key', v_key
    ) || COALESCE(p_metadata, '{}'::jsonb)
  );

  v_response := jsonb_build_object(
    'hold_id', v_hold_id,
    'old_balance', v_old_balance,
    'new_balance', v_debit.new_balance,
    'held_amount_light', v_debit.deposit_debited + v_debit.earned_debited,
    'held_deposit_light', v_debit.deposit_debited,
    'held_earned_light', v_debit.earned_debited
  );
  PERFORM public.finish_economic_idempotent_operation(
    v_key,
    v_response,
    'cloud_usage_holds',
    v_hold_id
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

DROP FUNCTION IF EXISTS public.settle_cloud_usage_hold(
  uuid,
  double precision,
  double precision,
  double precision,
  jsonb
);

CREATE OR REPLACE FUNCTION public.settle_cloud_usage_hold(
  p_hold_id uuid,
  p_units double precision,
  p_cloud_units double precision,
  p_amount_light double precision,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_idempotency_key text DEFAULT NULL::text
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
  v_key text := NULLIF(btrim(COALESCE(p_idempotency_key, '')), '');
  v_existing jsonb;
  v_hold RECORD;
  v_event_id uuid;
  v_consumed_deposit double precision := 0;
  v_consumed_earned double precision := 0;
  v_release_deposit double precision := 0;
  v_release_earned double precision := 0;
  v_released_amount double precision := 0;
  v_response jsonb;
BEGIN
  v_existing := public.begin_economic_idempotent_operation(v_key, 'settle_cloud_usage_hold');
  IF v_existing IS NOT NULL THEN
    RETURN QUERY SELECT
      (v_existing->>'event_id')::uuid,
      (v_existing->>'hold_id')::uuid,
      (v_existing->>'settled_amount_light')::double precision,
      (v_existing->>'released_amount_light')::double precision;
    RETURN;
  END IF;

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

  IF v_hold.status = 'settled' THEN
    v_response := jsonb_build_object(
      'event_id', v_hold.settlement_event_id,
      'hold_id', p_hold_id,
      'settled_amount_light', v_hold.settled_amount_light,
      'released_amount_light', v_hold.released_amount_light
    );
    PERFORM public.finish_economic_idempotent_operation(
      v_key,
      v_response,
      'cloud_usage_events',
      v_hold.settlement_event_id
    );
    RETURN QUERY SELECT
      v_hold.settlement_event_id,
      p_hold_id,
      v_hold.settled_amount_light,
      v_hold.released_amount_light;
    RETURN;
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
    metadata,
    idempotency_key
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
      || jsonb_build_object('hold_id', p_hold_id, 'idempotency_key', v_key),
    v_key
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
        'resource', v_hold.resource,
        'idempotency_key', v_key
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
        'resource', v_hold.resource,
        'idempotency_key', v_key
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
      || COALESCE(p_metadata, '{}'::jsonb)
      || jsonb_build_object('settlement_idempotency_key', v_key),
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

  v_response := jsonb_build_object(
    'event_id', v_event_id,
    'hold_id', p_hold_id,
    'settled_amount_light', p_amount_light,
    'released_amount_light', v_released_amount
  );
  PERFORM public.finish_economic_idempotent_operation(
    v_key,
    v_response,
    'cloud_usage_events',
    v_event_id
  );

  RETURN QUERY SELECT
    v_event_id,
    p_hold_id,
    p_amount_light,
    v_released_amount;
END;
$$;

DROP FUNCTION IF EXISTS public.release_cloud_usage_hold(uuid, jsonb);

CREATE OR REPLACE FUNCTION public.release_cloud_usage_hold(
  p_hold_id uuid,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_idempotency_key text DEFAULT NULL::text
) RETURNS TABLE(
  hold_id uuid,
  released_amount_light double precision
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public, extensions'
AS $$
DECLARE
  v_key text := NULLIF(btrim(COALESCE(p_idempotency_key, '')), '');
  v_existing jsonb;
  v_hold RECORD;
  v_released_amount double precision := 0;
  v_response jsonb;
BEGIN
  v_existing := public.begin_economic_idempotent_operation(v_key, 'release_cloud_usage_hold');
  IF v_existing IS NOT NULL THEN
    RETURN QUERY SELECT
      (v_existing->>'hold_id')::uuid,
      (v_existing->>'released_amount_light')::double precision;
    RETURN;
  END IF;

  SELECT *
  INTO v_hold
  FROM public.cloud_usage_holds
  WHERE id = p_hold_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cloud usage hold not found';
  END IF;

  IF v_hold.status = 'released' THEN
    v_response := jsonb_build_object(
      'hold_id', p_hold_id,
      'released_amount_light', v_hold.released_amount_light
    );
    PERFORM public.finish_economic_idempotent_operation(
      v_key,
      v_response,
      'cloud_usage_holds',
      p_hold_id
    );
    RETURN QUERY SELECT p_hold_id, v_hold.released_amount_light;
    RETURN;
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
      'release_reason', 'manual',
      'idempotency_key', v_key
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
      'release_reason', 'manual',
      'idempotency_key', v_key
    ) || COALESCE(p_metadata, '{}'::jsonb)
  );

  UPDATE public.cloud_usage_holds
  SET
    status = 'released',
    released_amount_light = v_released_amount,
    metadata = COALESCE(metadata, '{}'::jsonb)
      || COALESCE(p_metadata, '{}'::jsonb)
      || jsonb_build_object('release_idempotency_key', v_key),
    updated_at = now()
  WHERE id = p_hold_id;

  v_response := jsonb_build_object(
    'hold_id', p_hold_id,
    'released_amount_light', v_released_amount
  );
  PERFORM public.finish_economic_idempotent_operation(
    v_key,
    v_response,
    'cloud_usage_holds',
    p_hold_id
  );

  RETURN QUERY SELECT p_hold_id, v_released_amount;
END;
$$;

DROP FUNCTION IF EXISTS public.create_app_call_runtime_cloud_hold(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  double precision,
  double precision,
  double precision,
  double precision,
  integer,
  text,
  timestamptz,
  integer,
  jsonb
);

CREATE OR REPLACE FUNCTION public.create_app_call_runtime_cloud_hold(
  p_caller_user_id uuid,
  p_owner_user_id uuid,
  p_app_id uuid,
  p_function_name text,
  p_receipt_id text,
  p_source text,
  p_expected_units double precision,
  p_expected_cloud_units double precision,
  p_expected_amount_light double precision,
  p_app_price_light double precision DEFAULT 0,
  p_free_call_limit integer DEFAULT 0,
  p_free_call_counter_key text DEFAULT NULL::text,
  p_expires_at timestamptz DEFAULT NULL::timestamptz,
  p_billing_config_version integer DEFAULT NULL::integer,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_idempotency_key text DEFAULT NULL::text
) RETURNS TABLE(
  hold_id uuid,
  payer_user_id uuid,
  sponsor_user_id uuid,
  app_price_light double precision,
  app_charge_light double precision,
  free_call boolean,
  free_call_count integer,
  free_call_limit integer,
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
  v_key text := NULLIF(btrim(COALESCE(p_idempotency_key, '')), '');
  v_existing jsonb;
  v_payer_user_id uuid;
  v_sponsor_user_id uuid;
  v_app_price_light double precision := GREATEST(COALESCE(p_app_price_light, 0), 0);
  v_app_charge_light double precision := 0;
  v_free_call boolean := false;
  v_free_call_count integer := NULL;
  v_free_call_limit integer := GREATEST(COALESCE(p_free_call_limit, 0), 0);
  v_owner_sponsored boolean := false;
  v_hold RECORD;
  v_metadata jsonb;
  v_response jsonb;
BEGIN
  v_existing := public.begin_economic_idempotent_operation(v_key, 'create_app_call_runtime_cloud_hold');
  IF v_existing IS NOT NULL THEN
    RETURN QUERY SELECT
      (v_existing->>'hold_id')::uuid,
      (v_existing->>'payer_user_id')::uuid,
      NULLIF(v_existing->>'sponsor_user_id', '')::uuid,
      (v_existing->>'app_price_light')::double precision,
      (v_existing->>'app_charge_light')::double precision,
      (v_existing->>'free_call')::boolean,
      NULLIF(v_existing->>'free_call_count', '')::integer,
      (v_existing->>'free_call_limit')::integer,
      (v_existing->>'old_balance')::double precision,
      (v_existing->>'new_balance')::double precision,
      (v_existing->>'held_amount_light')::double precision,
      (v_existing->>'held_deposit_light')::double precision,
      (v_existing->>'held_earned_light')::double precision;
    RETURN;
  END IF;

  IF p_caller_user_id IS NULL THEN
    RAISE EXCEPTION 'Caller user id is required';
  END IF;

  IF p_owner_user_id IS NULL THEN
    RAISE EXCEPTION 'Owner user id is required';
  END IF;

  IF p_expected_amount_light IS NULL OR p_expected_amount_light <= 0 THEN
    RAISE EXCEPTION 'Runtime cloud hold amount must be positive';
  END IF;

  IF p_caller_user_id = p_owner_user_id THEN
    v_payer_user_id := p_owner_user_id;
    v_app_charge_light := 0;
  ELSIF v_app_price_light <= 0 THEN
    v_payer_user_id := p_owner_user_id;
    v_app_charge_light := 0;
    v_free_call := true;
  ELSIF v_free_call_limit > 0 THEN
    INSERT INTO public.app_caller_usage (
      app_id,
      user_id,
      counter_key,
      call_count,
      first_call_at,
      last_call_at
    ) VALUES (
      p_app_id,
      p_caller_user_id,
      COALESCE(NULLIF(p_free_call_counter_key, ''), p_function_name),
      1,
      now(),
      now()
    )
    ON CONFLICT (app_id, user_id, counter_key)
    DO UPDATE SET
      call_count = public.app_caller_usage.call_count + 1,
      last_call_at = now()
    RETURNING call_count INTO v_free_call_count;

    IF v_free_call_count <= v_free_call_limit THEN
      v_payer_user_id := p_owner_user_id;
      v_app_charge_light := 0;
      v_free_call := true;
    ELSE
      v_payer_user_id := p_caller_user_id;
      v_app_charge_light := v_app_price_light;
      v_free_call := false;
    END IF;
  ELSE
    v_payer_user_id := p_caller_user_id;
    v_app_charge_light := v_app_price_light;
  END IF;

  IF v_payer_user_id = p_owner_user_id AND p_caller_user_id <> p_owner_user_id THEN
    v_sponsor_user_id := p_owner_user_id;
    v_owner_sponsored := true;
  END IF;

  v_metadata := COALESCE(p_metadata, '{}'::jsonb)
    || jsonb_build_object(
      'app_price_light', v_app_price_light,
      'app_charge_light', v_app_charge_light,
      'free_call', v_free_call,
      'free_call_count', v_free_call_count,
      'free_call_limit', v_free_call_limit,
      'caller_infra_fallback', false,
      'idempotency_key', v_key,
      'payer_role', CASE
        WHEN v_sponsor_user_id IS NOT NULL THEN 'owner_sponsor'
        WHEN v_payer_user_id = p_owner_user_id THEN 'owner'
        ELSE 'caller'
      END
    );

  BEGIN
    SELECT * INTO v_hold
    FROM public.create_cloud_usage_hold(
      v_payer_user_id,
      COALESCE(NULLIF(p_source, ''), 'runtime'),
      'worker_execution',
      p_expected_units,
      p_expected_cloud_units,
      p_expected_amount_light,
      v_sponsor_user_id,
      p_caller_user_id,
      p_owner_user_id,
      p_app_id,
      p_function_name,
      p_receipt_id,
      p_expires_at,
      p_billing_config_version,
      v_metadata,
      CASE WHEN v_key IS NULL THEN NULL ELSE v_key || ':hold' END
    );
  EXCEPTION WHEN OTHERS THEN
    IF v_owner_sponsored AND SQLERRM ILIKE 'Insufficient available balance%' THEN
      v_payer_user_id := p_caller_user_id;
      v_sponsor_user_id := NULL;

      v_metadata := COALESCE(p_metadata, '{}'::jsonb)
        || jsonb_build_object(
          'app_price_light', v_app_price_light,
          'app_charge_light', v_app_charge_light,
          'free_call', v_free_call,
          'free_call_count', v_free_call_count,
          'free_call_limit', v_free_call_limit,
          'caller_infra_fallback', true,
          'fallback_from_sponsor_user_id', p_owner_user_id,
          'idempotency_key', v_key,
          'payer_role', 'caller_infra_fallback'
        );

      BEGIN
        SELECT * INTO v_hold
        FROM public.create_cloud_usage_hold(
          v_payer_user_id,
          COALESCE(NULLIF(p_source, ''), 'runtime'),
          'worker_execution',
          p_expected_units,
          p_expected_cloud_units,
          p_expected_amount_light,
          v_sponsor_user_id,
          p_caller_user_id,
          p_owner_user_id,
          p_app_id,
          p_function_name,
          p_receipt_id,
          p_expires_at,
          p_billing_config_version,
          v_metadata,
          CASE WHEN v_key IS NULL THEN NULL ELSE v_key || ':hold' END
        );
      EXCEPTION WHEN OTHERS THEN
        IF SQLERRM ILIKE 'Insufficient available balance%' THEN
          RAISE EXCEPTION 'caller_infra_fallback_light_required: %', SQLERRM;
        END IF;
        RAISE;
      END;
    ELSE
      RAISE;
    END IF;
  END;

  v_response := jsonb_build_object(
    'hold_id', v_hold.hold_id,
    'payer_user_id', v_payer_user_id,
    'sponsor_user_id', COALESCE(v_sponsor_user_id::text, ''),
    'app_price_light', v_app_price_light,
    'app_charge_light', v_app_charge_light,
    'free_call', v_free_call,
    'free_call_count', COALESCE(v_free_call_count::text, ''),
    'free_call_limit', v_free_call_limit,
    'old_balance', v_hold.old_balance,
    'new_balance', v_hold.new_balance,
    'held_amount_light', v_hold.held_amount_light,
    'held_deposit_light', v_hold.held_deposit_light,
    'held_earned_light', v_hold.held_earned_light
  );
  PERFORM public.finish_economic_idempotent_operation(
    v_key,
    v_response,
    'cloud_usage_holds',
    v_hold.hold_id
  );

  RETURN QUERY SELECT
    v_hold.hold_id,
    v_payer_user_id,
    v_sponsor_user_id,
    v_app_price_light,
    v_app_charge_light,
    v_free_call,
    v_free_call_count,
    v_free_call_limit,
    v_hold.old_balance,
    v_hold.new_balance,
    v_hold.held_amount_light,
    v_hold.held_deposit_light,
    v_hold.held_earned_light;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_skill_pull_receipt(
  p_caller_user_id uuid,
  p_publisher_user_id uuid,
  p_app_id uuid,
  p_skill_id text,
  p_skill_name text,
  p_amount_light double precision DEFAULT 0,
  p_developer_revenue_light double precision DEFAULT 0,
  p_platform_fee_light double precision DEFAULT 0,
  p_fee_would_have_been_light double precision DEFAULT 0,
  p_fee_waived_light double precision DEFAULT 0,
  p_waiver_source text DEFAULT NULL::text,
  p_waiver_event_id uuid DEFAULT NULL::uuid,
  p_transfer_id uuid DEFAULT NULL::uuid,
  p_free_pull boolean DEFAULT false,
  p_free_pull_count integer DEFAULT NULL::integer,
  p_free_pull_limit integer DEFAULT NULL::integer,
  p_pricing_config jsonb DEFAULT NULL::jsonb,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_idempotency_key text DEFAULT NULL::text
) RETURNS TABLE(
  receipt_id uuid,
  transfer_id uuid,
  waiver_event_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public, extensions'
AS $$
DECLARE
  v_key text := NULLIF(btrim(COALESCE(p_idempotency_key, '')), '');
  v_existing jsonb;
  v_receipt_id uuid;
  v_response jsonb;
BEGIN
  v_existing := public.begin_economic_idempotent_operation(v_key, 'record_skill_pull_receipt');
  IF v_existing IS NOT NULL THEN
    RETURN QUERY SELECT
      (v_existing->>'receipt_id')::uuid,
      NULLIF(v_existing->>'transfer_id', '')::uuid,
      NULLIF(v_existing->>'waiver_event_id', '')::uuid;
    RETURN;
  END IF;

  INSERT INTO public.skill_pull_receipts (
    caller_user_id,
    publisher_user_id,
    app_id,
    skill_id,
    skill_name,
    amount_light,
    developer_revenue_light,
    platform_fee_light,
    fee_would_have_been_light,
    fee_waived_light,
    waiver_source,
    waiver_event_id,
    transfer_id,
    free_pull,
    free_pull_count,
    free_pull_limit,
    pricing_config,
    metadata,
    idempotency_key
  ) VALUES (
    p_caller_user_id,
    p_publisher_user_id,
    p_app_id,
    p_skill_id,
    p_skill_name,
    COALESCE(p_amount_light, 0),
    COALESCE(p_developer_revenue_light, 0),
    COALESCE(p_platform_fee_light, 0),
    COALESCE(p_fee_would_have_been_light, 0),
    COALESCE(p_fee_waived_light, 0),
    p_waiver_source,
    p_waiver_event_id,
    p_transfer_id,
    COALESCE(p_free_pull, false),
    p_free_pull_count,
    p_free_pull_limit,
    p_pricing_config,
    COALESCE(p_metadata, '{}'::jsonb)
      || jsonb_build_object('idempotency_key', v_key),
    v_key
  )
  RETURNING id INTO v_receipt_id;

  v_response := jsonb_build_object(
    'receipt_id', v_receipt_id,
    'transfer_id', COALESCE(p_transfer_id::text, ''),
    'waiver_event_id', COALESCE(p_waiver_event_id::text, '')
  );
  PERFORM public.finish_economic_idempotent_operation(
    v_key,
    v_response,
    'skill_pull_receipts',
    v_receipt_id
  );

  RETURN QUERY SELECT v_receipt_id, p_transfer_id, p_waiver_event_id;
END;
$$;

DROP FUNCTION IF EXISTS public.record_embedding_generation_charge(
  uuid,
  uuid,
  text,
  text,
  integer,
  integer,
  double precision,
  jsonb
);

CREATE OR REPLACE FUNCTION public.record_embedding_generation_charge(
  p_publisher_user_id uuid,
  p_app_id uuid,
  p_app_version text,
  p_model text,
  p_prompt_tokens integer,
  p_total_tokens integer,
  p_rate_light_per_1k_tokens double precision,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_idempotency_key text DEFAULT NULL::text
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
  v_key text := NULLIF(btrim(COALESCE(p_idempotency_key, '')), '');
  v_existing jsonb;
  v_charge_id uuid;
  v_amount_light double precision;
  v_debit RECORD;
  v_status text := 'pending';
  v_error text;
  v_response jsonb;
  v_amount_debited double precision := 0;
BEGIN
  v_existing := public.begin_economic_idempotent_operation(v_key, 'record_embedding_generation_charge');
  IF v_existing IS NOT NULL THEN
    RETURN QUERY SELECT
      (v_existing->>'charge_id')::uuid,
      (v_existing->>'amount_light')::double precision,
      (v_existing->>'amount_debited_light')::double precision,
      v_existing->>'status';
    RETURN;
  END IF;

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
    metadata,
    idempotency_key
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
      || jsonb_build_object('idempotency_key', v_key),
    v_key
  )
  RETURNING id INTO v_charge_id;

  IF v_amount_light <= 0 THEN
    v_response := jsonb_build_object(
      'charge_id', v_charge_id,
      'amount_light', v_amount_light,
      'amount_debited_light', 0,
      'status', 'no_charge'
    );
    PERFORM public.finish_economic_idempotent_operation(
      v_key,
      v_response,
      'embedding_generation_charges',
      v_charge_id
    );
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
          'rate_light_per_1k_tokens', p_rate_light_per_1k_tokens,
          'idempotency_key', v_key
        ),
      CASE WHEN v_key IS NULL THEN NULL ELSE v_key || ':debit' END
    );
    v_amount_debited := v_debit.amount_debited;
    v_status := 'charged';
  EXCEPTION WHEN OTHERS THEN
    v_status := 'insufficient_balance';
    v_error := SQLERRM;
  END;

  UPDATE public.embedding_generation_charges
  SET
    amount_debited_light = v_amount_debited,
    status = v_status,
    debit_error = v_error,
    charged_at = CASE WHEN v_status = 'charged' THEN now() ELSE NULL END
  WHERE id = v_charge_id;

  v_response := jsonb_build_object(
    'charge_id', v_charge_id,
    'amount_light', v_amount_light,
    'amount_debited_light', v_amount_debited,
    'status', v_status
  );
  PERFORM public.finish_economic_idempotent_operation(
    v_key,
    v_response,
    'embedding_generation_charges',
    v_charge_id
  );

  RETURN QUERY SELECT
    v_charge_id,
    v_amount_light,
    v_amount_debited,
    v_status;
END;
$$;

REVOKE ALL ON FUNCTION public.debit_light(
  uuid,
  double precision,
  text,
  boolean,
  boolean,
  uuid,
  text,
  text,
  uuid,
  jsonb,
  text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.debit_balance(uuid, double precision, boolean)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.transfer_light(
  uuid,
  uuid,
  double precision,
  text,
  uuid,
  text,
  uuid,
  jsonb,
  text
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
  jsonb,
  text
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
  jsonb,
  text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.settle_cloud_usage_hold(
  uuid,
  double precision,
  double precision,
  double precision,
  jsonb,
  text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_cloud_usage_hold(uuid, jsonb, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_app_call_runtime_cloud_hold(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  double precision,
  double precision,
  double precision,
  double precision,
  integer,
  text,
  timestamptz,
  integer,
  jsonb,
  text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_skill_pull_receipt(
  uuid,
  uuid,
  uuid,
  text,
  text,
  double precision,
  double precision,
  double precision,
  double precision,
  double precision,
  text,
  uuid,
  uuid,
  boolean,
  integer,
  integer,
  jsonb,
  jsonb,
  text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_embedding_generation_charge(
  uuid,
  uuid,
  text,
  text,
  integer,
  integer,
  double precision,
  jsonb,
  text
) FROM PUBLIC, anon, authenticated;

GRANT ALL ON FUNCTION public.debit_light(
  uuid,
  double precision,
  text,
  boolean,
  boolean,
  uuid,
  text,
  text,
  uuid,
  jsonb,
  text
) TO service_role;
GRANT ALL ON FUNCTION public.debit_balance(uuid, double precision, boolean)
  TO service_role;
GRANT ALL ON FUNCTION public.transfer_light(
  uuid,
  uuid,
  double precision,
  text,
  uuid,
  text,
  uuid,
  jsonb,
  text
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
  jsonb,
  text
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
  jsonb,
  text
) TO service_role;
GRANT ALL ON FUNCTION public.settle_cloud_usage_hold(
  uuid,
  double precision,
  double precision,
  double precision,
  jsonb,
  text
) TO service_role;
GRANT ALL ON FUNCTION public.release_cloud_usage_hold(uuid, jsonb, text)
  TO service_role;
GRANT ALL ON FUNCTION public.create_app_call_runtime_cloud_hold(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  double precision,
  double precision,
  double precision,
  double precision,
  integer,
  text,
  timestamptz,
  integer,
  jsonb,
  text
) TO service_role;
GRANT ALL ON FUNCTION public.record_skill_pull_receipt(
  uuid,
  uuid,
  uuid,
  text,
  text,
  double precision,
  double precision,
  double precision,
  double precision,
  double precision,
  text,
  uuid,
  uuid,
  boolean,
  integer,
  integer,
  jsonb,
  jsonb,
  text
) TO service_role;
GRANT ALL ON FUNCTION public.record_embedding_generation_charge(
  uuid,
  uuid,
  text,
  text,
  integer,
  integer,
  double precision,
  jsonb,
  text
) TO service_role;
