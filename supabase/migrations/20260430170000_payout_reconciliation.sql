-- PR9: payout processor and reconciliation hardening.
-- Track Stripe transfer and payout states separately so payout runs are
-- inspectable and retryable without double-paying.

ALTER TABLE public.payouts
  ADD COLUMN IF NOT EXISTS stripe_transfer_status text NOT NULL DEFAULT 'not_started',
  ADD COLUMN IF NOT EXISTS stripe_payout_status text NOT NULL DEFAULT 'not_started',
  ADD COLUMN IF NOT EXISTS stripe_transfer_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS stripe_payout_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS processor_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS processor_claimed_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS stripe_transfer_idempotency_key text,
  ADD COLUMN IF NOT EXISTS stripe_payout_idempotency_key text,
  ADD COLUMN IF NOT EXISTS stripe_transfer_requested_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS stripe_transfer_completed_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS stripe_payout_requested_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS stripe_payout_completed_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS stripe_transfer_error jsonb,
  ADD COLUMN IF NOT EXISTS stripe_payout_error jsonb,
  ADD COLUMN IF NOT EXISTS stripe_transfer_response jsonb,
  ADD COLUMN IF NOT EXISTS stripe_payout_response jsonb;

DO $$
BEGIN
  ALTER TABLE public.payouts
    ADD CONSTRAINT payouts_stripe_transfer_status_check
    CHECK (stripe_transfer_status IN ('not_started', 'pending', 'succeeded', 'failed'));
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  ALTER TABLE public.payouts
    ADD CONSTRAINT payouts_stripe_payout_status_check
    CHECK (stripe_payout_status IN ('not_started', 'pending', 'succeeded', 'failed'));
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_payouts_transfer_status
  ON public.payouts (stripe_transfer_status, status);
CREATE INDEX IF NOT EXISTS idx_payouts_payout_status
  ON public.payouts (stripe_payout_status, status);
CREATE INDEX IF NOT EXISTS idx_payouts_processor_claim
  ON public.payouts (processor_claimed_at)
  WHERE status IN ('held', 'pending', 'processing');

UPDATE public.payouts
SET
  stripe_transfer_status = CASE
    WHEN stripe_transfer_id IS NOT NULL THEN 'succeeded'
    WHEN status IN ('pending', 'processing') THEN 'pending'
    WHEN status = 'failed' AND failure_reason LIKE 'stripe_transfer%' THEN 'failed'
    ELSE stripe_transfer_status
  END,
  stripe_payout_status = CASE
    WHEN status = 'paid' THEN 'succeeded'
    WHEN stripe_payout_id IS NOT NULL THEN 'pending'
    WHEN status = 'failed' AND failure_reason LIKE 'payout%' THEN 'failed'
    ELSE stripe_payout_status
  END,
  stripe_transfer_completed_at = CASE
    WHEN stripe_transfer_id IS NOT NULL THEN COALESCE(stripe_transfer_completed_at, completed_at, now())
    ELSE stripe_transfer_completed_at
  END,
  stripe_payout_completed_at = CASE
    WHEN status = 'paid' THEN COALESCE(stripe_payout_completed_at, completed_at, now())
    ELSE stripe_payout_completed_at
  END;

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
  stripe_fee_cents double precision,
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
  stripe_payout_idempotency_key text
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
         COALESCE(payout_policy_version, 1) as payout_policy_version,
         stripe_transfer_id,
         stripe_payout_id,
         COALESCE(stripe_transfer_status, 'not_started') as stripe_transfer_status,
         COALESCE(stripe_payout_status, 'not_started') as stripe_payout_status,
         COALESCE(stripe_transfer_attempts, 0) as stripe_transfer_attempts,
         COALESCE(stripe_payout_attempts, 0) as stripe_payout_attempts,
         stripe_transfer_idempotency_key,
         stripe_payout_idempotency_key
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

CREATE OR REPLACE FUNCTION public.mark_payout_releasing(
  p_payout_id uuid
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public, extensions'
AS $$
DECLARE
  v_updated integer;
BEGIN
  UPDATE public.payouts
  SET
    status = CASE
      WHEN COALESCE(stripe_transfer_status, 'not_started') = 'succeeded'
        THEN 'processing'
      ELSE 'pending'
    END,
    processor_claimed_at = now(),
    processor_attempts = COALESCE(processor_attempts, 0) + 1,
    stripe_transfer_attempts = CASE
      WHEN COALESCE(stripe_transfer_status, 'not_started') <> 'succeeded'
        THEN COALESCE(stripe_transfer_attempts, 0) + 1
      ELSE COALESCE(stripe_transfer_attempts, 0)
    END,
    stripe_payout_attempts = CASE
      WHEN COALESCE(stripe_transfer_status, 'not_started') = 'succeeded'
        THEN COALESCE(stripe_payout_attempts, 0) + 1
      ELSE COALESCE(stripe_payout_attempts, 0)
    END,
    failure_reason = NULL
  WHERE id = p_payout_id
    AND release_at <= now()
    AND (
      processor_claimed_at IS NULL
      OR processor_claimed_at < now() - interval '30 minutes'
    )
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
    );

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_payout_refund(
  p_payout_id uuid,
  p_failure_reason text DEFAULT NULL::text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public, extensions'
AS $$
DECLARE
  v_payout RECORD;
BEGIN
  SELECT * INTO v_payout
  FROM public.payouts
  WHERE id = p_payout_id
  FOR UPDATE;

  IF v_payout IS NULL THEN
    RAISE EXCEPTION 'Payout not found';
  END IF;

  IF v_payout.status NOT IN ('held', 'pending', 'processing') THEN
    RAISE EXCEPTION 'Payout already finalized with status: %', v_payout.status;
  END IF;

  UPDATE public.users
  SET
    earned_balance_light = earned_balance_light + v_payout.amount_light,
    balance_light = deposit_balance_light + earned_balance_light + v_payout.amount_light
  WHERE id = v_payout.user_id;

  UPDATE public.payouts
  SET
    status = 'failed',
    failure_reason = p_failure_reason,
    completed_at = now(),
    processor_claimed_at = NULL,
    stripe_transfer_status = CASE
      WHEN stripe_transfer_id IS NULL THEN 'failed'
      ELSE COALESCE(stripe_transfer_status, 'succeeded')
    END,
    stripe_payout_status = CASE
      WHEN stripe_payout_id IS NULL THEN COALESCE(stripe_payout_status, 'failed')
      ELSE 'failed'
    END,
    stripe_transfer_error = CASE
      WHEN stripe_transfer_id IS NULL
        THEN jsonb_build_object('reason', COALESCE(p_failure_reason, 'payout_failed'))
      ELSE stripe_transfer_error
    END,
    stripe_payout_error = jsonb_build_object('reason', COALESCE(p_failure_reason, 'payout_failed'))
  WHERE id = p_payout_id;

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
    v_payout.user_id,
    v_payout.user_id,
    round(v_payout.amount_light)::double precision,
    v_payout.amount_light,
    'withdrawal_refund',
    now()
  );

  PERFORM public.record_light_ledger_entry(
    v_payout.user_id,
    NULL,
    NULL,
    'earned',
    'payout_refund',
    v_payout.amount_light,
    'payouts',
    p_payout_id,
    jsonb_build_object('failure_reason', p_failure_reason)
  );
END;
$$;

GRANT ALL ON FUNCTION public.get_releasable_payouts(uuid, date, integer)
  TO service_role;
GRANT ALL ON FUNCTION public.mark_payout_releasing(uuid)
  TO service_role;
GRANT ALL ON FUNCTION public.fail_payout_refund(uuid, text)
  TO service_role;

REVOKE ALL ON FUNCTION public.get_releasable_payouts(uuid, date, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_payout_releasing(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_payout_refund(uuid, text)
  FROM PUBLIC, anon, authenticated;
