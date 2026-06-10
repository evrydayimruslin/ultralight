-- PR24: payout fee pass-through and reconciliation amounts.
-- Store gross, estimated fee, actual Stripe transfer, and actual Stripe payout
-- amounts explicitly so the payout processor can move net proceeds and the
-- platform does not absorb Stripe payout fees.

ALTER TABLE public.payouts
  ADD COLUMN IF NOT EXISTS gross_cents double precision,
  ADD COLUMN IF NOT EXISTS fee_estimate_cents double precision,
  ADD COLUMN IF NOT EXISTS stripe_transfer_amount_cents double precision,
  ADD COLUMN IF NOT EXISTS stripe_payout_amount_cents double precision;

UPDATE public.payouts
SET
  gross_cents = COALESCE(
    gross_cents,
    CASE
      WHEN COALESCE(light_per_usd_snapshot, 0) > 0
        THEN round((amount_light / light_per_usd_snapshot) * 100)::double precision
      ELSE amount_cents
    END,
    amount_cents,
    0
  ),
  fee_estimate_cents = COALESCE(
    fee_estimate_cents,
    stripe_fee_cents,
    0
  );

UPDATE public.payouts
SET
  net_cents = CASE
    WHEN net_cents IS NULL OR net_cents < 0
      THEN GREATEST(0, COALESCE(gross_cents, 0) - COALESCE(fee_estimate_cents, stripe_fee_cents, 0))
    ELSE net_cents
  END,
  stripe_transfer_amount_cents = COALESCE(
    stripe_transfer_amount_cents,
    CASE
      WHEN stripe_transfer_response IS NOT NULL AND stripe_transfer_response ? 'amount'
        THEN (stripe_transfer_response->>'amount')::double precision
      ELSE NULL
    END
  ),
  stripe_payout_amount_cents = COALESCE(
    stripe_payout_amount_cents,
    CASE
      WHEN stripe_payout_response IS NOT NULL AND stripe_payout_response ? 'amount'
        THEN (stripe_payout_response->>'amount')::double precision
      ELSE NULL
    END
  );

DO $$
BEGIN
  ALTER TABLE public.payouts
    ADD CONSTRAINT payouts_gross_cents_check CHECK (gross_cents IS NULL OR gross_cents >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  ALTER TABLE public.payouts
    ADD CONSTRAINT payouts_fee_estimate_cents_check CHECK (fee_estimate_cents IS NULL OR fee_estimate_cents >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  ALTER TABLE public.payouts
    ADD CONSTRAINT payouts_net_not_above_gross_check CHECK (
      gross_cents IS NULL OR net_cents IS NULL OR net_cents <= gross_cents
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  ALTER TABLE public.payouts
    ADD CONSTRAINT payouts_actual_transfer_cents_check CHECK (
      stripe_transfer_amount_cents IS NULL OR stripe_transfer_amount_cents >= 0
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  ALTER TABLE public.payouts
    ADD CONSTRAINT payouts_actual_payout_cents_check CHECK (
      stripe_payout_amount_cents IS NULL OR stripe_payout_amount_cents >= 0
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;

DROP FUNCTION IF EXISTS public.create_payout_record(uuid, double precision, double precision, double precision);
DROP FUNCTION IF EXISTS public.create_payout_record(uuid, double precision, double precision, double precision, double precision, integer);
DROP FUNCTION IF EXISTS public.create_payout_record(uuid, double precision, double precision, double precision, double precision, integer, timestamp with time zone, date, timestamp with time zone, integer);
DROP FUNCTION IF EXISTS public.create_payout_record(uuid, double precision, double precision, double precision, double precision, double precision, double precision, integer, timestamp with time zone, date, timestamp with time zone, integer);

CREATE OR REPLACE FUNCTION public.create_payout_record(
  p_user_id uuid,
  p_amount_light double precision,
  p_stripe_fee_cents double precision,
  p_net_cents double precision,
  p_gross_cents double precision DEFAULT NULL,
  p_fee_estimate_cents double precision DEFAULT NULL,
  p_light_per_usd_snapshot double precision DEFAULT 100,
  p_billing_config_version integer DEFAULT 1,
  p_release_at timestamp with time zone DEFAULT NULL,
  p_scheduled_payout_date date DEFAULT NULL,
  p_payout_cutoff_at timestamp with time zone DEFAULT NULL,
  p_payout_policy_version integer DEFAULT 1
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public, extensions'
AS $$
DECLARE
  v_payout_id uuid;
  v_earned_available double precision;
  v_total_earned double precision;
  v_total_withdrawn double precision;
  v_withdrawable double precision;
  v_schedule RECORD;
  v_release_at timestamp with time zone;
  v_scheduled_payout_date date;
  v_payout_cutoff_at timestamp with time zone;
  v_payout_policy_version integer;
  v_payout_run_id uuid;
  v_gross_cents double precision;
  v_fee_estimate_cents double precision;
  v_net_cents double precision;
BEGIN
  IF p_amount_light IS NULL OR p_amount_light <= 0 THEN
    RAISE EXCEPTION 'Withdrawal amount must be positive';
  END IF;

  IF p_light_per_usd_snapshot IS NULL OR p_light_per_usd_snapshot <= 0 THEN
    RAISE EXCEPTION 'Payout rate snapshot must be positive';
  END IF;

  v_gross_cents := COALESCE(
    p_gross_cents,
    round((p_amount_light / p_light_per_usd_snapshot) * 100)::double precision
  );
  v_fee_estimate_cents := COALESCE(p_fee_estimate_cents, p_stripe_fee_cents, 0);
  v_net_cents := COALESCE(
    p_net_cents,
    GREATEST(0, v_gross_cents - v_fee_estimate_cents)
  );

  IF v_gross_cents < 0 OR v_fee_estimate_cents < 0 OR v_net_cents < 0 THEN
    RAISE EXCEPTION 'Payout cent amounts must be non-negative';
  END IF;

  IF v_net_cents > v_gross_cents THEN
    RAISE EXCEPTION 'Net payout cannot exceed gross payout';
  END IF;

  SELECT *
  INTO v_schedule
  FROM public.next_monthly_payout_schedule(
    now(),
    COALESCE(p_payout_policy_version, 1),
    21
  )
  LIMIT 1;

  v_release_at := COALESCE(p_release_at, v_schedule.release_at);
  v_scheduled_payout_date := COALESCE(
    p_scheduled_payout_date,
    v_schedule.scheduled_payout_date
  );
  v_payout_cutoff_at := COALESCE(
    p_payout_cutoff_at,
    v_schedule.payout_cutoff_at
  );
  v_payout_policy_version := COALESCE(
    p_payout_policy_version,
    v_schedule.payout_policy_version,
    1
  );

  IF v_release_at IS NULL OR v_scheduled_payout_date IS NULL OR v_payout_cutoff_at IS NULL THEN
    RAISE EXCEPTION 'Payout schedule could not be calculated';
  END IF;

  v_payout_run_id := public.upsert_payout_run(
    v_scheduled_payout_date,
    v_payout_cutoff_at,
    v_payout_policy_version,
    jsonb_build_object('source', 'create_payout_record')
  );

  SELECT COALESCE(earned_balance_light, 0),
         COALESCE(total_earned_light, 0)
  INTO v_earned_available, v_total_earned
  FROM public.users
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  SELECT COALESCE(SUM(amount_light), 0) INTO v_total_withdrawn
  FROM public.payouts
  WHERE user_id = p_user_id
    AND status IN ('held', 'pending', 'processing', 'paid');

  v_withdrawable := LEAST(
    v_earned_available,
    GREATEST(v_total_earned - v_total_withdrawn, 0)
  );

  IF v_withdrawable < p_amount_light THEN
    RAISE EXCEPTION 'Withdrawal exceeds earnings. Only earned funds can be withdrawn. Withdrawable: % Light, requested: %',
      v_withdrawable, p_amount_light;
  END IF;

  UPDATE public.users
  SET
    earned_balance_light = earned_balance_light - p_amount_light,
    balance_light = deposit_balance_light + earned_balance_light - p_amount_light
  WHERE id = p_user_id
    AND earned_balance_light >= p_amount_light;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Withdrawal exceeds earnings. Only earned funds can be withdrawn. Withdrawable: % Light, requested: %',
      v_withdrawable, p_amount_light;
  END IF;

  INSERT INTO public.payouts (
    user_id,
    amount_cents,
    amount_light,
    gross_cents,
    stripe_fee_cents,
    fee_estimate_cents,
    net_cents,
    platform_fee_cents,
    platform_fee_light,
    status,
    release_at,
    light_per_usd_snapshot,
    billing_config_version,
    payout_run_id,
    scheduled_payout_date,
    payout_cutoff_at,
    payout_policy_version
  )
  VALUES (
    p_user_id,
    v_gross_cents,
    p_amount_light,
    v_gross_cents,
    COALESCE(p_stripe_fee_cents, v_fee_estimate_cents),
    v_fee_estimate_cents,
    v_net_cents,
    0,
    0,
    'held',
    v_release_at,
    p_light_per_usd_snapshot,
    COALESCE(p_billing_config_version, 1),
    v_payout_run_id,
    v_scheduled_payout_date,
    v_payout_cutoff_at,
    v_payout_policy_version
  )
  RETURNING id INTO v_payout_id;

  INSERT INTO public.transfers (
    id,
    from_user_id,
    to_user_id,
    amount_cents,
    amount_light,
    reason,
    created_at
  )
  VALUES (
    extensions.gen_random_uuid(),
    p_user_id,
    p_user_id,
    round(p_amount_light)::double precision,
    p_amount_light,
    'withdrawal',
    now()
  );

  PERFORM public.record_light_ledger_entry(
    p_user_id,
    NULL,
    NULL,
    'earned',
    'payout_hold',
    -p_amount_light,
    'payouts',
    v_payout_id,
    jsonb_build_object(
      'gross_cents', v_gross_cents,
      'stripe_fee_cents', COALESCE(p_stripe_fee_cents, v_fee_estimate_cents),
      'fee_estimate_cents', v_fee_estimate_cents,
      'net_cents', v_net_cents,
      'light_per_usd_snapshot', p_light_per_usd_snapshot,
      'billing_config_version', COALESCE(p_billing_config_version, 1),
      'payout_run_id', v_payout_run_id,
      'scheduled_payout_date', v_scheduled_payout_date,
      'payout_cutoff_at', v_payout_cutoff_at,
      'payout_policy_version', v_payout_policy_version
    )
  );

  RETURN v_payout_id;
END;
$$;

DROP FUNCTION IF EXISTS public.get_releasable_payouts();
DROP FUNCTION IF EXISTS public.get_releasable_payouts(uuid, date, integer);

CREATE FUNCTION public.get_releasable_payouts(
  p_payout_run_id uuid DEFAULT NULL,
  p_scheduled_payout_date date DEFAULT NULL,
  p_limit integer DEFAULT 50
)
RETURNS TABLE(
  id uuid,
  user_id uuid,
  amount_light double precision,
  gross_cents double precision,
  stripe_fee_cents double precision,
  fee_estimate_cents double precision,
  net_cents double precision,
  platform_fee_light double precision,
  created_at timestamp with time zone,
  release_at timestamp with time zone,
  light_per_usd_snapshot double precision,
  payout_run_id uuid,
  scheduled_payout_date date,
  payout_cutoff_at timestamp with time zone,
  payout_policy_version integer,
  stripe_transfer_id text,
  stripe_payout_id text,
  stripe_transfer_status text,
  stripe_payout_status text,
  stripe_transfer_attempts integer,
  stripe_payout_attempts integer,
  stripe_transfer_idempotency_key text,
  stripe_payout_idempotency_key text,
  stripe_transfer_amount_cents double precision,
  stripe_payout_amount_cents double precision
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public, extensions'
AS $$
  SELECT id,
         user_id,
         amount_light,
         COALESCE(gross_cents, amount_cents) as gross_cents,
         stripe_fee_cents,
         COALESCE(fee_estimate_cents, stripe_fee_cents, 0) as fee_estimate_cents,
         net_cents,
         COALESCE(platform_fee_light, 0) as platform_fee_light,
         created_at,
         release_at,
         COALESCE(light_per_usd_snapshot, 100) as light_per_usd_snapshot,
         payout_run_id,
         scheduled_payout_date,
         payout_cutoff_at,
         COALESCE(payout_policy_version, 1) as payout_policy_version,
         stripe_transfer_id,
         stripe_payout_id,
         COALESCE(stripe_transfer_status, 'not_started') as stripe_transfer_status,
         COALESCE(stripe_payout_status, 'not_started') as stripe_payout_status,
         COALESCE(stripe_transfer_attempts, 0) as stripe_transfer_attempts,
         COALESCE(stripe_payout_attempts, 0) as stripe_payout_attempts,
         stripe_transfer_idempotency_key,
         stripe_payout_idempotency_key,
         stripe_transfer_amount_cents,
         stripe_payout_amount_cents
  FROM public.payouts
  WHERE release_at <= now()
    AND (p_payout_run_id IS NULL OR payout_run_id = p_payout_run_id)
    AND (p_scheduled_payout_date IS NULL OR scheduled_payout_date = p_scheduled_payout_date)
    AND (
      status = 'held'
      OR (
        status = 'pending'
        AND COALESCE(stripe_transfer_status, 'not_started') IN ('not_started', 'failed')
      )
      OR (
        status = 'pending'
        AND COALESCE(stripe_transfer_status, 'not_started') = 'pending'
        AND stripe_transfer_id IS NULL
        AND processor_claimed_at < now() - interval '30 minutes'
      )
      OR (
        status = 'processing'
        AND COALESCE(stripe_transfer_status, 'not_started') = 'succeeded'
        AND COALESCE(stripe_payout_status, 'not_started') IN ('not_started', 'failed')
      )
      OR (
        status = 'processing'
        AND COALESCE(stripe_transfer_status, 'not_started') = 'succeeded'
        AND COALESCE(stripe_payout_status, 'not_started') = 'pending'
        AND stripe_payout_id IS NULL
        AND processor_claimed_at < now() - interval '30 minutes'
      )
    )
  ORDER BY scheduled_payout_date ASC NULLS LAST, release_at ASC, created_at ASC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200));
$$;

GRANT ALL ON FUNCTION public.create_payout_record(
  uuid,
  double precision,
  double precision,
  double precision,
  double precision,
  double precision,
  double precision,
  integer,
  timestamp with time zone,
  date,
  timestamp with time zone,
  integer
) TO service_role;
GRANT ALL ON FUNCTION public.get_releasable_payouts(uuid, date, integer)
  TO service_role;

REVOKE ALL ON FUNCTION public.create_payout_record(
  uuid,
  double precision,
  double precision,
  double precision,
  double precision,
  double precision,
  double precision,
  integer,
  timestamp with time zone,
  date,
  timestamp with time zone,
  integer
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_releasable_payouts(uuid, date, integer)
  FROM PUBLIC, anon, authenticated;
