-- Monthly payout policy
-- Payouts process on the first business day of each month. Requests must be
-- created at least 21 days before that run; later requests roll forward.

CREATE TABLE IF NOT EXISTS public.payout_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scheduled_for date NOT NULL UNIQUE,
  cutoff_at timestamp with time zone NOT NULL,
  policy_version integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'processing', 'completed', 'failed')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.payouts
  ADD COLUMN IF NOT EXISTS payout_run_id uuid REFERENCES public.payout_runs(id),
  ADD COLUMN IF NOT EXISTS scheduled_payout_date date,
  ADD COLUMN IF NOT EXISTS payout_cutoff_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS payout_policy_version integer NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_payout_runs_scheduled_for
  ON public.payout_runs (scheduled_for);
CREATE INDEX IF NOT EXISTS idx_payouts_run
  ON public.payouts (payout_run_id);
CREATE INDEX IF NOT EXISTS idx_payouts_scheduled
  ON public.payouts (scheduled_payout_date, status);

CREATE OR REPLACE FUNCTION public.observed_fixed_us_bank_holiday(
  p_year integer,
  p_month integer,
  p_day integer
)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public, extensions'
AS $$
DECLARE
  v_day date := make_date(p_year, p_month, p_day);
BEGIN
  IF EXTRACT(ISODOW FROM v_day) = 6 THEN
    RETURN v_day - 1;
  END IF;

  IF EXTRACT(ISODOW FROM v_day) = 7 THEN
    RETURN v_day + 1;
  END IF;

  RETURN v_day;
END;
$$;

CREATE OR REPLACE FUNCTION public.nth_weekday_of_month(
  p_year integer,
  p_month integer,
  p_isodow integer,
  p_n integer
)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public, extensions'
AS $$
DECLARE
  v_day date := make_date(p_year, p_month, 1);
BEGIN
  WHILE EXTRACT(ISODOW FROM v_day) <> p_isodow LOOP
    v_day := v_day + 1;
  END LOOP;

  RETURN v_day + ((p_n - 1) * 7);
END;
$$;

CREATE OR REPLACE FUNCTION public.last_weekday_of_month(
  p_year integer,
  p_month integer,
  p_isodow integer
)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public, extensions'
AS $$
DECLARE
  v_day date := (
    make_date(p_year, p_month, 1) + interval '1 month' - interval '1 day'
  )::date;
BEGIN
  WHILE EXTRACT(ISODOW FROM v_day) <> p_isodow LOOP
    v_day := v_day - 1;
  END LOOP;

  RETURN v_day;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_us_bank_holiday(p_day date)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public, extensions'
AS $$
DECLARE
  v_year integer := EXTRACT(YEAR FROM p_day)::integer;
BEGIN
  FOR v_check_year IN (v_year - 1)..(v_year + 1) LOOP
    IF p_day IN (
      public.observed_fixed_us_bank_holiday(v_check_year, 1, 1),
      public.nth_weekday_of_month(v_check_year, 1, 1, 3),
      public.nth_weekday_of_month(v_check_year, 2, 1, 3),
      public.last_weekday_of_month(v_check_year, 5, 1),
      public.observed_fixed_us_bank_holiday(v_check_year, 6, 19),
      public.observed_fixed_us_bank_holiday(v_check_year, 7, 4),
      public.nth_weekday_of_month(v_check_year, 9, 1, 1),
      public.nth_weekday_of_month(v_check_year, 10, 1, 2),
      public.observed_fixed_us_bank_holiday(v_check_year, 11, 11),
      public.nth_weekday_of_month(v_check_year, 11, 4, 4),
      public.observed_fixed_us_bank_holiday(v_check_year, 12, 25)
    ) THEN
      RETURN true;
    END IF;
  END LOOP;

  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.first_business_day_of_month(p_month date)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public, extensions'
AS $$
DECLARE
  v_day date := make_date(
    EXTRACT(YEAR FROM p_month)::integer,
    EXTRACT(MONTH FROM p_month)::integer,
    1
  );
BEGIN
  WHILE EXTRACT(ISODOW FROM v_day) IN (6, 7) OR public.is_us_bank_holiday(v_day) LOOP
    v_day := v_day + 1;
  END LOOP;

  RETURN v_day;
END;
$$;

CREATE OR REPLACE FUNCTION public.next_monthly_payout_schedule(
  p_requested_at timestamp with time zone DEFAULT now(),
  p_policy_version integer DEFAULT 1,
  p_cutoff_days integer DEFAULT 21
)
RETURNS TABLE(
  release_at timestamp with time zone,
  scheduled_payout_date date,
  payout_cutoff_at timestamp with time zone,
  payout_policy_version integer
)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public, extensions'
AS $$
DECLARE
  v_requested_at timestamp with time zone := COALESCE(p_requested_at, now());
  v_month date := (
    date_trunc('month', COALESCE(p_requested_at, now()) AT TIME ZONE 'UTC') +
    interval '1 month'
  )::date;
  v_run_date date;
  v_release_at timestamp with time zone;
  v_cutoff_at timestamp with time zone;
BEGIN
  IF p_cutoff_days IS NULL OR p_cutoff_days <= 0 THEN
    RAISE EXCEPTION 'Payout cutoff days must be positive';
  END IF;

  LOOP
    v_run_date := public.first_business_day_of_month(v_month);
    v_release_at := v_run_date::timestamp AT TIME ZONE 'UTC';
    v_cutoff_at := v_release_at - make_interval(days => p_cutoff_days);

    IF v_requested_at <= v_cutoff_at THEN
      release_at := v_release_at;
      scheduled_payout_date := v_run_date;
      payout_cutoff_at := v_cutoff_at;
      payout_policy_version := COALESCE(p_policy_version, 1);
      RETURN NEXT;
      RETURN;
    END IF;

    v_month := (v_month + interval '1 month')::date;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_payout_run(
  p_scheduled_for date,
  p_cutoff_at timestamp with time zone,
  p_policy_version integer DEFAULT 1,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public, extensions'
AS $$
DECLARE
  v_run_id uuid;
BEGIN
  IF p_scheduled_for IS NULL THEN
    RAISE EXCEPTION 'Payout run date is required';
  END IF;
  IF p_cutoff_at IS NULL THEN
    RAISE EXCEPTION 'Payout cutoff timestamp is required';
  END IF;

  INSERT INTO public.payout_runs (
    scheduled_for,
    cutoff_at,
    policy_version,
    metadata
  )
  VALUES (
    p_scheduled_for,
    p_cutoff_at,
    COALESCE(p_policy_version, 1),
    COALESCE(p_metadata, '{}'::jsonb)
  )
  ON CONFLICT (scheduled_for)
  DO UPDATE SET
    cutoff_at = EXCLUDED.cutoff_at,
    policy_version = EXCLUDED.policy_version,
    metadata = public.payout_runs.metadata || EXCLUDED.metadata,
    updated_at = now()
  RETURNING id INTO v_run_id;

  RETURN v_run_id;
END;
$$;

DROP FUNCTION IF EXISTS public.create_payout_record(
  uuid,
  double precision,
  double precision,
  double precision,
  double precision,
  integer
);

CREATE OR REPLACE FUNCTION public.create_payout_record(
  p_user_id uuid,
  p_amount_light double precision,
  p_stripe_fee_cents double precision,
  p_net_cents double precision,
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
BEGIN
  IF p_amount_light IS NULL OR p_amount_light <= 0 THEN
    RAISE EXCEPTION 'Withdrawal amount must be positive';
  END IF;

  IF p_light_per_usd_snapshot IS NULL OR p_light_per_usd_snapshot <= 0 THEN
    RAISE EXCEPTION 'Payout rate snapshot must be positive';
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
    stripe_fee_cents,
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
    round(p_amount_light)::double precision,
    p_amount_light,
    p_stripe_fee_cents,
    p_net_cents,
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
      'stripe_fee_cents', p_stripe_fee_cents,
      'net_cents', p_net_cents,
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
CREATE FUNCTION public.get_releasable_payouts()
RETURNS TABLE(
  id uuid,
  user_id uuid,
  amount_light double precision,
  stripe_fee_cents double precision,
  net_cents double precision,
  platform_fee_light double precision,
  created_at timestamp with time zone,
  release_at timestamp with time zone,
  light_per_usd_snapshot double precision,
  payout_run_id uuid,
  scheduled_payout_date date,
  payout_cutoff_at timestamp with time zone,
  payout_policy_version integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public, extensions'
AS $$
  SELECT id, user_id, amount_light, stripe_fee_cents, net_cents,
         COALESCE(platform_fee_light, 0) as platform_fee_light,
         created_at, release_at,
         COALESCE(light_per_usd_snapshot, 100) as light_per_usd_snapshot,
         payout_run_id,
         scheduled_payout_date,
         payout_cutoff_at,
         COALESCE(payout_policy_version, 1) as payout_policy_version
  FROM public.payouts
  WHERE status = 'held'
    AND release_at <= now()
  ORDER BY release_at ASC
  LIMIT 50;
$$;

DO $$
DECLARE
  v_payout RECORD;
  v_run_id uuid;
BEGIN
  FOR v_payout IN
    SELECT
      p.id,
      s.release_at,
      s.scheduled_payout_date,
      s.payout_cutoff_at,
      s.payout_policy_version
    FROM public.payouts p
    CROSS JOIN LATERAL public.next_monthly_payout_schedule(
      COALESCE(p.created_at, now()),
      COALESCE(p.payout_policy_version, 1),
      21
    ) s
    WHERE p.status = 'held'
      AND (
        p.payout_run_id IS NULL OR
        p.scheduled_payout_date IS NULL OR
        p.payout_cutoff_at IS NULL
      )
  LOOP
    v_run_id := public.upsert_payout_run(
      v_payout.scheduled_payout_date,
      v_payout.payout_cutoff_at,
      v_payout.payout_policy_version,
      jsonb_build_object('source', 'monthly_payout_policy_backfill')
    );

    UPDATE public.payouts
    SET
      release_at = v_payout.release_at,
      scheduled_payout_date = v_payout.scheduled_payout_date,
      payout_cutoff_at = v_payout.payout_cutoff_at,
      payout_policy_version = v_payout.payout_policy_version,
      payout_run_id = v_run_id
    WHERE id = v_payout.id;
  END LOOP;
END;
$$;

GRANT ALL ON TABLE public.payout_runs TO service_role;
REVOKE ALL ON TABLE public.payout_runs FROM PUBLIC, anon, authenticated;

GRANT ALL ON FUNCTION public.observed_fixed_us_bank_holiday(integer, integer, integer) TO service_role;
GRANT ALL ON FUNCTION public.nth_weekday_of_month(integer, integer, integer, integer) TO service_role;
GRANT ALL ON FUNCTION public.last_weekday_of_month(integer, integer, integer) TO service_role;
GRANT ALL ON FUNCTION public.is_us_bank_holiday(date) TO service_role;
GRANT ALL ON FUNCTION public.first_business_day_of_month(date) TO service_role;
GRANT ALL ON FUNCTION public.next_monthly_payout_schedule(timestamp with time zone, integer, integer) TO service_role;
GRANT ALL ON FUNCTION public.upsert_payout_run(date, timestamp with time zone, integer, jsonb) TO service_role;
GRANT ALL ON FUNCTION public.create_payout_record(
  uuid,
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
GRANT ALL ON FUNCTION public.get_releasable_payouts() TO service_role;

REVOKE ALL ON FUNCTION public.observed_fixed_us_bank_holiday(integer, integer, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nth_weekday_of_month(integer, integer, integer, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.last_weekday_of_month(integer, integer, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_us_bank_holiday(date)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.first_business_day_of_month(date)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.next_monthly_payout_schedule(timestamp with time zone, integer, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.upsert_payout_run(date, timestamp with time zone, integer, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_payout_record(
  uuid,
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
REVOKE ALL ON FUNCTION public.get_releasable_payouts() FROM PUBLIC, anon, authenticated;
