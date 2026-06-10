-- Central billing economics for Light.
-- This singleton is read by the API Worker and surfaced to clients through
-- API endpoints; direct client access is disabled.

CREATE TABLE IF NOT EXISTS public.platform_billing_config (
  id text PRIMARY KEY DEFAULT 'singleton',
  version integer NOT NULL DEFAULT 1,
  canonical_light_per_usd double precision NOT NULL DEFAULT 100,
  wallet_light_per_usd double precision NOT NULL DEFAULT 95,
  wire_light_per_usd double precision NOT NULL DEFAULT 99,
  payout_light_per_usd double precision NOT NULL DEFAULT 100,
  platform_fee_rate double precision NOT NULL DEFAULT 0.10,
  min_withdrawal_light double precision NOT NULL DEFAULT 5000,
  payout_policy_copy text NOT NULL DEFAULT 'Payouts are processed on the first business day of each month. Requests must be submitted at least 21 days before that payout date to be included. Purchased Light cannot be cashed out; only creator earnings are eligible for payout.',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT platform_billing_config_singleton CHECK (id = 'singleton'),
  CONSTRAINT platform_billing_config_rates_positive CHECK (
    canonical_light_per_usd > 0
    AND wallet_light_per_usd > 0
    AND wire_light_per_usd > 0
    AND payout_light_per_usd > 0
    AND min_withdrawal_light > 0
  ),
  CONSTRAINT platform_billing_config_fee_valid CHECK (
    platform_fee_rate >= 0 AND platform_fee_rate < 1
  )
);

INSERT INTO public.platform_billing_config (
  id,
  version,
  canonical_light_per_usd,
  wallet_light_per_usd,
  wire_light_per_usd,
  payout_light_per_usd,
  platform_fee_rate,
  min_withdrawal_light
) VALUES (
  'singleton',
  1,
  100,
  95,
  99,
  100,
  0.10,
  5000
) ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.touch_platform_billing_config_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  NEW.version := COALESCE(OLD.version, 0) + 1;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS touch_platform_billing_config_updated_at
  ON public.platform_billing_config;
CREATE TRIGGER touch_platform_billing_config_updated_at
BEFORE UPDATE ON public.platform_billing_config
FOR EACH ROW EXECUTE FUNCTION public.touch_platform_billing_config_updated_at();

ALTER TABLE public.platform_billing_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.platform_billing_config FROM anon, authenticated;
GRANT ALL ON TABLE public.platform_billing_config TO service_role;

ALTER TABLE public.payouts
  ADD COLUMN IF NOT EXISTS light_per_usd_snapshot double precision NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS billing_config_version integer NOT NULL DEFAULT 1;

ALTER TABLE public.billing_transactions
  ADD COLUMN IF NOT EXISTS billing_config_version integer,
  ADD COLUMN IF NOT EXISTS light_per_usd_snapshot double precision;

DROP FUNCTION IF EXISTS public.create_payout_record(
  uuid,
  double precision,
  double precision,
  double precision
);
CREATE OR REPLACE FUNCTION public.create_payout_record(
  p_user_id uuid,
  p_amount_light double precision,
  p_stripe_fee_cents double precision,
  p_net_cents double precision,
  p_light_per_usd_snapshot double precision DEFAULT 100,
  p_billing_config_version integer DEFAULT 1
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public, extensions'
AS $$
DECLARE
  v_payout_id uuid;
  v_available double precision;
  v_total_earned double precision;
  v_total_withdrawn double precision;
  v_withdrawable double precision;
BEGIN
  IF p_amount_light IS NULL OR p_amount_light <= 0 THEN
    RAISE EXCEPTION 'Withdrawal amount must be positive';
  END IF;

  IF p_light_per_usd_snapshot IS NULL OR p_light_per_usd_snapshot <= 0 THEN
    RAISE EXCEPTION 'Payout rate snapshot must be positive';
  END IF;

  SELECT balance_light,
         COALESCE(total_earned_light, 0)
  INTO v_available, v_total_earned
  FROM public.users
  WHERE id = p_user_id
  FOR UPDATE;

  IF v_available IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  IF v_available < p_amount_light THEN
    RAISE EXCEPTION 'Insufficient available balance. Available: % Light, requested: %', v_available, p_amount_light;
  END IF;

  SELECT COALESCE(SUM(amount_light), 0) INTO v_total_withdrawn
  FROM public.payouts
  WHERE user_id = p_user_id
    AND status IN ('held', 'pending', 'processing', 'paid');

  v_withdrawable := v_total_earned - v_total_withdrawn;

  IF v_withdrawable < p_amount_light THEN
    RAISE EXCEPTION 'Withdrawal exceeds earnings. Only earned funds can be withdrawn. Withdrawable: % Light, requested: %', v_withdrawable, p_amount_light;
  END IF;

  UPDATE public.users
  SET balance_light = balance_light - p_amount_light
  WHERE id = p_user_id
    AND balance_light >= p_amount_light;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Insufficient available balance. Available: % Light, requested: %', v_available, p_amount_light;
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
    billing_config_version
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
    now() + interval '14 days',
    p_light_per_usd_snapshot,
    COALESCE(p_billing_config_version, 1)
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
  light_per_usd_snapshot double precision
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public, extensions'
AS $$
  SELECT id, user_id, amount_light, stripe_fee_cents, net_cents,
         COALESCE(platform_fee_light, 0) as platform_fee_light,
         created_at, release_at,
         COALESCE(light_per_usd_snapshot, 100) as light_per_usd_snapshot
  FROM public.payouts
  WHERE status = 'held'
    AND release_at <= now()
  ORDER BY release_at ASC
  LIMIT 50;
$$;

GRANT ALL ON FUNCTION public.create_payout_record(
  uuid,
  double precision,
  double precision,
  double precision,
  double precision,
  integer
) TO service_role;
GRANT ALL ON FUNCTION public.get_releasable_payouts() TO service_role;
REVOKE ALL ON FUNCTION public.create_payout_record(
  uuid,
  double precision,
  double precision,
  double precision,
  double precision,
  integer
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_releasable_payouts() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_payout_record(
  uuid,
  double precision,
  double precision,
  double precision,
  double precision,
  integer
) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.get_releasable_payouts() FROM anon, authenticated;
