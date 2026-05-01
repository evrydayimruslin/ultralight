-- Context-rich internal Light movement RPCs.
-- First-party services should use these instead of mutating users.balance_light
-- directly or pairing transfer_balance with a separate best-effort transfer row.

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
  p_metadata jsonb DEFAULT '{}'::jsonb
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
  v_old_balance double precision;
  v_debit RECORD;
  v_metadata jsonb;
BEGIN
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
      'function_name', p_function_name
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
) RETURNS TABLE(old_balance double precision, new_balance double precision, was_depleted boolean)
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
    '{}'::jsonb
  );
$$;

CREATE OR REPLACE FUNCTION public.transfer_light(
  p_from_user uuid,
  p_to_user uuid,
  p_amount_light double precision,
  p_reason text,
  p_app_id uuid DEFAULT NULL::uuid,
  p_function_name text DEFAULT NULL::text,
  p_content_id uuid DEFAULT NULL::uuid,
  p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS TABLE(
  from_new_balance double precision,
  to_new_balance double precision,
  platform_fee double precision,
  transfer_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public, extensions'
AS $$
DECLARE
  v_fee_rate double precision := 0.10;
  v_fee double precision;
  v_net double precision;
  v_from_available double precision;
  v_debit RECORD;
  v_to_new_balance double precision;
  v_transfer_id uuid;
  v_metadata jsonb;
BEGIN
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
    RETURN;
  END IF;

  SELECT COALESCE(platform_fee_rate, 0.10) INTO v_fee_rate
  FROM public.platform_billing_config
  WHERE id = 'singleton';

  v_fee := p_amount_light * COALESCE(v_fee_rate, 0.10);
  v_net := p_amount_light - v_fee;

  SELECT * INTO v_debit
  FROM public.debit_spendable_light(p_from_user, p_amount_light, false);

  UPDATE public.users
  SET
    earned_balance_light = earned_balance_light + v_net,
    total_earned_light = total_earned_light + v_net,
    balance_light = deposit_balance_light + earned_balance_light + v_net
  WHERE id = p_to_user
  RETURNING balance_light INTO v_to_new_balance;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recipient not found';
  END IF;

  INSERT INTO public.transfers (
    from_user_id,
    to_user_id,
    amount_cents,
    amount_light,
    reason,
    app_id,
    function_name,
    content_id
  )
  VALUES (
    p_from_user,
    p_to_user,
    round(v_net)::double precision,
    v_net,
    p_reason,
    p_app_id,
    p_function_name,
    p_content_id
  )
  RETURNING id INTO v_transfer_id;

  v_metadata := COALESCE(p_metadata, '{}'::jsonb)
    || jsonb_build_object(
      'gross_light', p_amount_light,
      'net_light', v_net,
      'platform_fee_light', v_fee,
      'function_name', p_function_name,
      'content_id', p_content_id
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
  PERFORM public.record_light_ledger_entry(
    p_to_user,
    p_from_user,
    p_app_id,
    'earned',
    p_reason || '_earning',
    v_net,
    'transfers',
    v_transfer_id,
    v_metadata
  );
  PERFORM public.record_light_ledger_entry(
    NULL,
    p_from_user,
    p_app_id,
    'platform',
    'platform_fee',
    v_fee,
    'transfers',
    v_transfer_id,
    v_metadata
  );

  RETURN QUERY SELECT v_debit.new_balance, v_to_new_balance, v_fee, v_transfer_id;
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
  jsonb
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.transfer_light(
  uuid,
  uuid,
  double precision,
  text,
  uuid,
  text,
  uuid,
  jsonb
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
  jsonb
) TO service_role;
GRANT ALL ON FUNCTION public.transfer_light(
  uuid,
  uuid,
  double precision,
  text,
  uuid,
  text,
  uuid,
  jsonb
) TO service_role;
