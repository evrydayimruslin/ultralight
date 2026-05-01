-- PR4: durable Stripe event processing and Light deposit ledger.

CREATE TABLE IF NOT EXISTS public.stripe_events (
  id text PRIMARY KEY,
  type text NOT NULL,
  object_id text,
  object_type text,
  livemode boolean,
  api_version text,
  stripe_created_at timestamp with time zone,
  status text NOT NULL DEFAULT 'processing',
  process_attempts integer NOT NULL DEFAULT 0,
  processing_started_at timestamp with time zone,
  processed_at timestamp with time zone,
  failed_at timestamp with time zone,
  last_error text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT stripe_events_status_check CHECK (
    status IN ('processing', 'processed', 'ignored', 'failed')
  )
);

CREATE INDEX IF NOT EXISTS idx_stripe_events_type_created
  ON public.stripe_events(type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stripe_events_status
  ON public.stripe_events(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_stripe_events_object
  ON public.stripe_events(object_type, object_id);

CREATE TABLE IF NOT EXISTS public.light_deposits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  funding_method text NOT NULL,
  requested_amount_cents bigint,
  received_amount_cents bigint NOT NULL DEFAULT 0,
  refunded_amount_cents bigint NOT NULL DEFAULT 0,
  disputed_amount_cents bigint NOT NULL DEFAULT 0,
  requested_light double precision,
  credited_light double precision NOT NULL DEFAULT 0,
  reversed_light double precision NOT NULL DEFAULT 0,
  recovered_light double precision NOT NULL DEFAULT 0,
  unrecovered_light double precision NOT NULL DEFAULT 0,
  light_per_usd_snapshot double precision NOT NULL DEFAULT 95,
  billing_config_version integer NOT NULL DEFAULT 1,
  stripe_customer_id text,
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  stripe_charge_id text,
  last_stripe_event_id text REFERENCES public.stripe_events(id) ON DELETE SET NULL,
  failure_code text,
  failure_message text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  credited_at timestamp with time zone,
  failed_at timestamp with time zone,
  refunded_at timestamp with time zone,
  disputed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT light_deposits_status_check CHECK (
    status IN (
      'pending',
      'succeeded',
      'partially_succeeded',
      'failed',
      'refunded',
      'partially_refunded',
      'disputed'
    )
  ),
  CONSTRAINT light_deposits_amounts_check CHECK (
    COALESCE(requested_amount_cents, 0) >= 0
    AND received_amount_cents >= 0
    AND refunded_amount_cents >= 0
    AND disputed_amount_cents >= 0
    AND credited_light >= 0
    AND reversed_light >= 0
    AND recovered_light >= 0
    AND unrecovered_light >= 0
    AND light_per_usd_snapshot > 0
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_light_deposits_checkout_session
  ON public.light_deposits(stripe_checkout_session_id)
  WHERE stripe_checkout_session_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_light_deposits_payment_intent
  ON public.light_deposits(stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_light_deposits_charge
  ON public.light_deposits(stripe_charge_id)
  WHERE stripe_charge_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_light_deposits_user_created
  ON public.light_deposits(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_light_deposits_status
  ON public.light_deposits(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_light_deposits_event
  ON public.light_deposits(last_stripe_event_id);

CREATE OR REPLACE FUNCTION public.touch_stripe_payment_ledgers_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS touch_stripe_events_updated_at ON public.stripe_events;
CREATE TRIGGER touch_stripe_events_updated_at
BEFORE UPDATE ON public.stripe_events
FOR EACH ROW EXECUTE FUNCTION public.touch_stripe_payment_ledgers_updated_at();

DROP TRIGGER IF EXISTS touch_light_deposits_updated_at ON public.light_deposits;
CREATE TRIGGER touch_light_deposits_updated_at
BEFORE UPDATE ON public.light_deposits
FOR EACH ROW EXECUTE FUNCTION public.touch_stripe_payment_ledgers_updated_at();

ALTER TABLE public.stripe_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.light_deposits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS light_deposits_own_select ON public.light_deposits;
CREATE POLICY light_deposits_own_select
  ON public.light_deposits
  FOR SELECT
  USING (auth.uid() = user_id);

REVOKE ALL ON TABLE public.stripe_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.light_deposits FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.light_deposits TO authenticated;
GRANT ALL ON TABLE public.stripe_events TO service_role;
GRANT ALL ON TABLE public.light_deposits TO service_role;

CREATE OR REPLACE FUNCTION public.find_light_deposit_for_stripe_object(
  p_stripe_payment_intent_id text DEFAULT NULL,
  p_stripe_checkout_session_id text DEFAULT NULL,
  p_stripe_charge_id text DEFAULT NULL
) RETURNS public.light_deposits
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public, extensions'
AS $$
DECLARE
  v_deposit public.light_deposits%ROWTYPE;
BEGIN
  SELECT *
  INTO v_deposit
  FROM public.light_deposits
  WHERE (
    p_stripe_payment_intent_id IS NOT NULL
    AND stripe_payment_intent_id = p_stripe_payment_intent_id
  ) OR (
    p_stripe_checkout_session_id IS NOT NULL
    AND stripe_checkout_session_id = p_stripe_checkout_session_id
  ) OR (
    p_stripe_charge_id IS NOT NULL
    AND stripe_charge_id = p_stripe_charge_id
  )
  ORDER BY created_at ASC
  LIMIT 1;

  RETURN v_deposit;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_stripe_event(
  p_event_id text,
  p_event_type text,
  p_object_id text DEFAULT NULL,
  p_object_type text DEFAULT NULL,
  p_livemode boolean DEFAULT NULL,
  p_api_version text DEFAULT NULL,
  p_stripe_created_at timestamp with time zone DEFAULT NULL,
  p_payload jsonb DEFAULT '{}'::jsonb
) RETURNS TABLE(
  event_id text,
  claimed boolean,
  status text,
  process_attempts integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public, extensions'
AS $$
DECLARE
  v_event public.stripe_events%ROWTYPE;
BEGIN
  IF p_event_id IS NULL OR p_event_id = '' THEN
    RAISE EXCEPTION 'Stripe event ID is required';
  END IF;

  SELECT *
  INTO v_event
  FROM public.stripe_events
  WHERE id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.stripe_events (
      id,
      type,
      object_id,
      object_type,
      livemode,
      api_version,
      stripe_created_at,
      status,
      process_attempts,
      processing_started_at,
      payload
    ) VALUES (
      p_event_id,
      COALESCE(p_event_type, 'unknown'),
      p_object_id,
      p_object_type,
      p_livemode,
      p_api_version,
      p_stripe_created_at,
      'processing',
      1,
      now(),
      COALESCE(p_payload, '{}'::jsonb)
    );

    RETURN QUERY SELECT p_event_id, true, 'processing'::text, 1;
    RETURN;
  END IF;

  IF v_event.status IN ('processed', 'ignored') THEN
    RETURN QUERY SELECT v_event.id, false, v_event.status, v_event.process_attempts;
    RETURN;
  END IF;

  IF (
    v_event.status = 'processing'
    AND v_event.processing_started_at IS NOT NULL
    AND v_event.processing_started_at > now() - interval '5 minutes'
  ) THEN
    RETURN QUERY SELECT v_event.id, false, v_event.status, v_event.process_attempts;
    RETURN;
  END IF;

  UPDATE public.stripe_events
  SET
    type = COALESCE(p_event_type, public.stripe_events.type),
    object_id = COALESCE(p_object_id, public.stripe_events.object_id),
    object_type = COALESCE(p_object_type, public.stripe_events.object_type),
    livemode = COALESCE(p_livemode, public.stripe_events.livemode),
    api_version = COALESCE(p_api_version, public.stripe_events.api_version),
    stripe_created_at = COALESCE(p_stripe_created_at, public.stripe_events.stripe_created_at),
    status = 'processing',
    process_attempts = public.stripe_events.process_attempts + 1,
    processing_started_at = now(),
    failed_at = NULL,
    last_error = NULL,
    payload = COALESCE(p_payload, public.stripe_events.payload)
  WHERE id = v_event.id
  RETURNING * INTO v_event;

  RETURN QUERY SELECT v_event.id, true, v_event.status, v_event.process_attempts;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_stripe_event(
  p_event_id text,
  p_status text,
  p_error text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public, extensions'
AS $$
BEGIN
  IF p_status NOT IN ('processed', 'ignored', 'failed') THEN
    RAISE EXCEPTION 'Invalid Stripe event status: %', p_status;
  END IF;

  UPDATE public.stripe_events
  SET
    status = p_status,
    processed_at = CASE WHEN p_status IN ('processed', 'ignored') THEN now() ELSE processed_at END,
    failed_at = CASE WHEN p_status = 'failed' THEN now() ELSE NULL END,
    last_error = CASE WHEN p_status = 'failed' THEN p_error ELSE NULL END,
    metadata = metadata || COALESCE(p_metadata, '{}'::jsonb)
  WHERE id = p_event_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_pending_light_deposit(
  p_user_id uuid,
  p_requested_amount_cents bigint,
  p_requested_light double precision,
  p_funding_method text,
  p_stripe_event_id text DEFAULT NULL,
  p_stripe_payment_intent_id text DEFAULT NULL,
  p_stripe_checkout_session_id text DEFAULT NULL,
  p_stripe_charge_id text DEFAULT NULL,
  p_stripe_customer_id text DEFAULT NULL,
  p_billing_config_version integer DEFAULT 1,
  p_light_per_usd_snapshot double precision DEFAULT 95,
  p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS TABLE(deposit_id uuid, status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public, extensions'
AS $$
DECLARE
  v_deposit public.light_deposits%ROWTYPE;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'User ID is required';
  END IF;

  IF p_requested_amount_cents IS NULL OR p_requested_amount_cents <= 0 THEN
    RAISE EXCEPTION 'Requested deposit amount must be positive';
  END IF;

  IF p_funding_method IS NULL OR p_funding_method = '' THEN
    RAISE EXCEPTION 'Funding method is required';
  END IF;

  SELECT *
  INTO v_deposit
  FROM public.light_deposits
  WHERE (
    p_stripe_payment_intent_id IS NOT NULL
    AND stripe_payment_intent_id = p_stripe_payment_intent_id
  ) OR (
    p_stripe_checkout_session_id IS NOT NULL
    AND stripe_checkout_session_id = p_stripe_checkout_session_id
  ) OR (
    p_stripe_charge_id IS NOT NULL
    AND stripe_charge_id = p_stripe_charge_id
  )
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.light_deposits (
      user_id,
      status,
      funding_method,
      requested_amount_cents,
      requested_light,
      light_per_usd_snapshot,
      billing_config_version,
      stripe_customer_id,
      stripe_checkout_session_id,
      stripe_payment_intent_id,
      stripe_charge_id,
      last_stripe_event_id,
      metadata
    ) VALUES (
      p_user_id,
      'pending',
      p_funding_method,
      p_requested_amount_cents,
      p_requested_light,
      COALESCE(NULLIF(p_light_per_usd_snapshot, 0), 95),
      COALESCE(p_billing_config_version, 1),
      p_stripe_customer_id,
      p_stripe_checkout_session_id,
      p_stripe_payment_intent_id,
      p_stripe_charge_id,
      p_stripe_event_id,
      COALESCE(p_metadata, '{}'::jsonb)
    )
    RETURNING * INTO v_deposit;
  ELSE
    UPDATE public.light_deposits
    SET
      requested_amount_cents = COALESCE(requested_amount_cents, p_requested_amount_cents),
      requested_light = COALESCE(requested_light, p_requested_light),
      funding_method = COALESCE(NULLIF(p_funding_method, ''), funding_method),
      light_per_usd_snapshot = COALESCE(NULLIF(p_light_per_usd_snapshot, 0), light_per_usd_snapshot),
      billing_config_version = COALESCE(p_billing_config_version, billing_config_version),
      stripe_customer_id = COALESCE(p_stripe_customer_id, stripe_customer_id),
      stripe_checkout_session_id = COALESCE(p_stripe_checkout_session_id, stripe_checkout_session_id),
      stripe_payment_intent_id = COALESCE(p_stripe_payment_intent_id, stripe_payment_intent_id),
      stripe_charge_id = COALESCE(p_stripe_charge_id, stripe_charge_id),
      last_stripe_event_id = COALESCE(p_stripe_event_id, last_stripe_event_id),
      metadata = metadata || COALESCE(p_metadata, '{}'::jsonb)
    WHERE id = v_deposit.id
    RETURNING * INTO v_deposit;
  END IF;

  RETURN QUERY SELECT v_deposit.id, v_deposit.status;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_light_deposit(
  p_user_id uuid,
  p_amount_cents bigint,
  p_light_amount double precision,
  p_funding_method text,
  p_stripe_event_id text,
  p_requested_amount_cents bigint DEFAULT NULL,
  p_requested_light double precision DEFAULT NULL,
  p_stripe_payment_intent_id text DEFAULT NULL,
  p_stripe_checkout_session_id text DEFAULT NULL,
  p_stripe_charge_id text DEFAULT NULL,
  p_stripe_customer_id text DEFAULT NULL,
  p_billing_config_version integer DEFAULT 1,
  p_light_per_usd_snapshot double precision DEFAULT 95,
  p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS TABLE(
  deposit_id uuid,
  previous_balance_light double precision,
  new_balance_light double precision,
  credited_light double precision,
  status text,
  already_finalized boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public, extensions'
AS $$
DECLARE
  v_deposit public.light_deposits%ROWTYPE;
  v_old_balance double precision;
  v_new_balance double precision;
  v_existing_light double precision;
  v_delta_light double precision;
  v_existing_cents bigint;
  v_delta_cents bigint;
  v_requested_cents bigint;
  v_status text;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'User ID is required';
  END IF;

  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'Received deposit amount must be positive';
  END IF;

  IF p_light_amount IS NULL OR p_light_amount <= 0 THEN
    RAISE EXCEPTION 'Light deposit amount must be positive';
  END IF;

  IF p_funding_method IS NULL OR p_funding_method = '' THEN
    RAISE EXCEPTION 'Funding method is required';
  END IF;

  SELECT *
  INTO v_deposit
  FROM public.light_deposits
  WHERE (
    p_stripe_payment_intent_id IS NOT NULL
    AND stripe_payment_intent_id = p_stripe_payment_intent_id
  ) OR (
    p_stripe_checkout_session_id IS NOT NULL
    AND stripe_checkout_session_id = p_stripe_checkout_session_id
  ) OR (
    p_stripe_charge_id IS NOT NULL
    AND stripe_charge_id = p_stripe_charge_id
  )
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.light_deposits (
      user_id,
      status,
      funding_method,
      requested_amount_cents,
      received_amount_cents,
      requested_light,
      credited_light,
      light_per_usd_snapshot,
      billing_config_version,
      stripe_customer_id,
      stripe_checkout_session_id,
      stripe_payment_intent_id,
      stripe_charge_id,
      last_stripe_event_id,
      metadata
    ) VALUES (
      p_user_id,
      'pending',
      p_funding_method,
      COALESCE(p_requested_amount_cents, p_amount_cents),
      0,
      COALESCE(p_requested_light, p_light_amount),
      0,
      COALESCE(NULLIF(p_light_per_usd_snapshot, 0), 95),
      COALESCE(p_billing_config_version, 1),
      p_stripe_customer_id,
      p_stripe_checkout_session_id,
      p_stripe_payment_intent_id,
      p_stripe_charge_id,
      p_stripe_event_id,
      COALESCE(p_metadata, '{}'::jsonb)
    )
    RETURNING * INTO v_deposit;
  END IF;

  v_existing_light := COALESCE(v_deposit.credited_light, 0);
  v_existing_cents := COALESCE(v_deposit.received_amount_cents, 0);

  IF v_existing_light >= p_light_amount AND v_existing_cents >= p_amount_cents THEN
    SELECT COALESCE(balance_light, 0)
    INTO v_new_balance
    FROM public.users
    WHERE id = v_deposit.user_id;

    RETURN QUERY SELECT
      v_deposit.id,
      v_new_balance,
      v_new_balance,
      0::double precision,
      v_deposit.status,
      true;
    RETURN;
  END IF;

  v_delta_light := p_light_amount - v_existing_light;
  IF v_delta_light <= 0 THEN
    v_delta_light := 0;
  END IF;
  v_delta_cents := GREATEST(0, p_amount_cents - v_existing_cents);

  SELECT COALESCE(balance_light, 0)
  INTO v_old_balance
  FROM public.users
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  IF v_delta_light > 0 THEN
    UPDATE public.users
    SET
      deposit_balance_light = deposit_balance_light + v_delta_light,
      balance_light = deposit_balance_light + earned_balance_light + v_delta_light
    WHERE id = p_user_id
    RETURNING balance_light INTO v_new_balance;
  ELSE
    v_new_balance := v_old_balance;
  END IF;

  v_requested_cents := COALESCE(
    v_deposit.requested_amount_cents,
    p_requested_amount_cents,
    p_amount_cents
  );
  v_status := CASE
    WHEN v_requested_cents > p_amount_cents THEN 'partially_succeeded'
    ELSE 'succeeded'
  END;

  UPDATE public.light_deposits
  SET
    user_id = p_user_id,
    status = v_status,
    funding_method = p_funding_method,
    requested_amount_cents = v_requested_cents,
    received_amount_cents = GREATEST(COALESCE(public.light_deposits.received_amount_cents, 0), p_amount_cents),
    requested_light = COALESCE(public.light_deposits.requested_light, p_requested_light, p_light_amount),
    credited_light = GREATEST(COALESCE(public.light_deposits.credited_light, 0), p_light_amount),
    light_per_usd_snapshot = COALESCE(NULLIF(p_light_per_usd_snapshot, 0), public.light_deposits.light_per_usd_snapshot),
    billing_config_version = COALESCE(p_billing_config_version, public.light_deposits.billing_config_version),
    stripe_customer_id = COALESCE(p_stripe_customer_id, public.light_deposits.stripe_customer_id),
    stripe_checkout_session_id = COALESCE(p_stripe_checkout_session_id, public.light_deposits.stripe_checkout_session_id),
    stripe_payment_intent_id = COALESCE(p_stripe_payment_intent_id, public.light_deposits.stripe_payment_intent_id),
    stripe_charge_id = COALESCE(p_stripe_charge_id, public.light_deposits.stripe_charge_id),
    last_stripe_event_id = p_stripe_event_id,
    credited_at = COALESCE(public.light_deposits.credited_at, now()),
    metadata = public.light_deposits.metadata || COALESCE(p_metadata, '{}'::jsonb)
  WHERE id = v_deposit.id
  RETURNING * INTO v_deposit;

  IF v_delta_light > 0 THEN
    PERFORM public.record_light_ledger_entry(
      p_user_id,
      NULL,
      NULL,
      'deposit',
      'deposit_credit',
      v_delta_light,
      'light_deposits',
      v_deposit.id,
      jsonb_build_object(
        'stripe_event_id', p_stripe_event_id,
        'stripe_payment_intent_id', p_stripe_payment_intent_id,
        'stripe_checkout_session_id', p_stripe_checkout_session_id,
        'stripe_charge_id', p_stripe_charge_id,
        'funding_method', p_funding_method,
        'received_amount_cents', p_amount_cents,
        'received_delta_cents', v_delta_cents,
        'light_per_usd_snapshot', p_light_per_usd_snapshot,
        'billing_config_version', p_billing_config_version
      ) || COALESCE(p_metadata, '{}'::jsonb)
    );

    INSERT INTO public.billing_transactions (
      user_id,
      type,
      category,
      description,
      amount_cents,
      amount_light,
      balance_after_light,
      billing_config_version,
      light_per_usd_snapshot,
      metadata
    ) VALUES (
      p_user_id,
      'credit',
      'deposit',
      'Light deposit',
      v_delta_cents,
      v_delta_light,
      v_new_balance,
      COALESCE(p_billing_config_version, 1),
      COALESCE(NULLIF(p_light_per_usd_snapshot, 0), 95),
      jsonb_build_object(
        'light_deposit_id', v_deposit.id,
        'stripe_event_id', p_stripe_event_id,
        'stripe_payment_intent_id', p_stripe_payment_intent_id,
        'stripe_checkout_session_id', p_stripe_checkout_session_id,
        'stripe_charge_id', p_stripe_charge_id,
        'funding_method', p_funding_method,
        'requested_amount_cents', v_requested_cents,
        'received_amount_cents', p_amount_cents,
        'received_delta_cents', v_delta_cents
      ) || COALESCE(p_metadata, '{}'::jsonb)
    );
  END IF;

  RETURN QUERY SELECT
    v_deposit.id,
    v_old_balance,
    v_new_balance,
    v_delta_light,
    v_deposit.status,
    false;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_light_deposit_failed(
  p_user_id uuid DEFAULT NULL,
  p_stripe_event_id text DEFAULT NULL,
  p_stripe_payment_intent_id text DEFAULT NULL,
  p_stripe_checkout_session_id text DEFAULT NULL,
  p_stripe_charge_id text DEFAULT NULL,
  p_stripe_customer_id text DEFAULT NULL,
  p_funding_method text DEFAULT 'unknown',
  p_failure_code text DEFAULT NULL,
  p_failure_message text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS TABLE(deposit_id uuid, status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public, extensions'
AS $$
DECLARE
  v_deposit public.light_deposits%ROWTYPE;
BEGIN
  SELECT *
  INTO v_deposit
  FROM public.light_deposits
  WHERE (
    p_stripe_payment_intent_id IS NOT NULL
    AND stripe_payment_intent_id = p_stripe_payment_intent_id
  ) OR (
    p_stripe_checkout_session_id IS NOT NULL
    AND stripe_checkout_session_id = p_stripe_checkout_session_id
  ) OR (
    p_stripe_charge_id IS NOT NULL
    AND stripe_charge_id = p_stripe_charge_id
  )
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    IF p_user_id IS NULL THEN
      RETURN;
    END IF;

    INSERT INTO public.light_deposits (
      user_id,
      status,
      funding_method,
      stripe_customer_id,
      stripe_checkout_session_id,
      stripe_payment_intent_id,
      stripe_charge_id,
      last_stripe_event_id,
      failure_code,
      failure_message,
      failed_at,
      metadata
    ) VALUES (
      p_user_id,
      'failed',
      COALESCE(NULLIF(p_funding_method, ''), 'unknown'),
      p_stripe_customer_id,
      p_stripe_checkout_session_id,
      p_stripe_payment_intent_id,
      p_stripe_charge_id,
      p_stripe_event_id,
      p_failure_code,
      p_failure_message,
      now(),
      COALESCE(p_metadata, '{}'::jsonb)
    )
    RETURNING * INTO v_deposit;
  ELSE
    UPDATE public.light_deposits
    SET
      status = CASE
        WHEN public.light_deposits.credited_light > 0 THEN public.light_deposits.status
        ELSE 'failed'
      END,
      failure_code = p_failure_code,
      failure_message = p_failure_message,
      failed_at = CASE
        WHEN public.light_deposits.credited_light > 0 THEN public.light_deposits.failed_at
        ELSE now()
      END,
      stripe_customer_id = COALESCE(p_stripe_customer_id, stripe_customer_id),
      stripe_checkout_session_id = COALESCE(p_stripe_checkout_session_id, stripe_checkout_session_id),
      stripe_payment_intent_id = COALESCE(p_stripe_payment_intent_id, stripe_payment_intent_id),
      stripe_charge_id = COALESCE(p_stripe_charge_id, stripe_charge_id),
      last_stripe_event_id = COALESCE(p_stripe_event_id, last_stripe_event_id),
      metadata = metadata || COALESCE(p_metadata, '{}'::jsonb)
    WHERE id = v_deposit.id
    RETURNING * INTO v_deposit;
  END IF;

  RETURN QUERY SELECT v_deposit.id, v_deposit.status;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_light_deposit_reversal(
  p_stripe_event_id text,
  p_reason text,
  p_amount_cents bigint,
  p_stripe_payment_intent_id text DEFAULT NULL,
  p_stripe_checkout_session_id text DEFAULT NULL,
  p_stripe_charge_id text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS TABLE(
  deposit_id uuid,
  status text,
  reversed_light double precision,
  recovered_light double precision,
  unrecovered_light double precision,
  previous_balance_light double precision,
  new_balance_light double precision
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public, extensions'
AS $$
DECLARE
  v_deposit public.light_deposits%ROWTYPE;
  v_user public.users%ROWTYPE;
  v_target_reversed_light double precision;
  v_delta_reversed_light double precision;
  v_recovered_delta double precision;
  v_unrecovered_delta double precision;
  v_old_balance double precision;
  v_new_balance double precision;
  v_new_status text;
BEGIN
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'Reversal amount must be positive';
  END IF;

  IF p_reason NOT IN ('refund', 'dispute') THEN
    RAISE EXCEPTION 'Invalid deposit reversal reason: %', p_reason;
  END IF;

  SELECT *
  INTO v_deposit
  FROM public.light_deposits
  WHERE (
    p_stripe_payment_intent_id IS NOT NULL
    AND stripe_payment_intent_id = p_stripe_payment_intent_id
  ) OR (
    p_stripe_checkout_session_id IS NOT NULL
    AND stripe_checkout_session_id = p_stripe_checkout_session_id
  ) OR (
    p_stripe_charge_id IS NOT NULL
    AND stripe_charge_id = p_stripe_charge_id
  )
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_target_reversed_light := LEAST(
    COALESCE(v_deposit.credited_light, 0),
    round(((p_amount_cents::double precision / 100.0) * v_deposit.light_per_usd_snapshot)::numeric, 6)::double precision
  );
  v_delta_reversed_light := v_target_reversed_light - COALESCE(v_deposit.reversed_light, 0);

  IF v_delta_reversed_light <= 0 THEN
    SELECT COALESCE(balance_light, 0)
    INTO v_new_balance
    FROM public.users
    WHERE id = v_deposit.user_id;

    RETURN QUERY SELECT
      v_deposit.id,
      v_deposit.status,
      0::double precision,
      0::double precision,
      0::double precision,
      v_new_balance,
      v_new_balance;
    RETURN;
  END IF;

  SELECT *
  INTO v_user
  FROM public.users
  WHERE id = v_deposit.user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  v_old_balance := COALESCE(v_user.balance_light, 0);
  v_recovered_delta := LEAST(v_delta_reversed_light, COALESCE(v_user.deposit_balance_light, 0));
  v_unrecovered_delta := v_delta_reversed_light - v_recovered_delta;

  IF v_recovered_delta > 0 THEN
    UPDATE public.users
    SET
      deposit_balance_light = deposit_balance_light - v_recovered_delta,
      balance_light = deposit_balance_light + earned_balance_light - v_recovered_delta
    WHERE id = v_deposit.user_id
    RETURNING balance_light INTO v_new_balance;

    PERFORM public.record_light_ledger_entry(
      v_deposit.user_id,
      NULL,
      NULL,
      'deposit',
      CASE WHEN p_reason = 'refund' THEN 'deposit_refund' ELSE 'deposit_dispute' END,
      -v_recovered_delta,
      'light_deposits',
      v_deposit.id,
      jsonb_build_object(
        'stripe_event_id', p_stripe_event_id,
        'stripe_payment_intent_id', p_stripe_payment_intent_id,
        'stripe_checkout_session_id', p_stripe_checkout_session_id,
        'stripe_charge_id', p_stripe_charge_id,
        'reversal_reason', p_reason,
        'reversal_amount_cents', p_amount_cents
      ) || COALESCE(p_metadata, '{}'::jsonb)
    );
  ELSE
    v_new_balance := v_old_balance;
  END IF;

  v_new_status := CASE
    WHEN p_reason = 'dispute' THEN 'disputed'
    WHEN v_target_reversed_light >= COALESCE(v_deposit.credited_light, 0) THEN 'refunded'
    ELSE 'partially_refunded'
  END;

  UPDATE public.light_deposits
  SET
    status = v_new_status,
    refunded_amount_cents = CASE
      WHEN p_reason = 'refund' THEN GREATEST(public.light_deposits.refunded_amount_cents, p_amount_cents)
      ELSE public.light_deposits.refunded_amount_cents
    END,
    disputed_amount_cents = CASE
      WHEN p_reason = 'dispute' THEN GREATEST(public.light_deposits.disputed_amount_cents, p_amount_cents)
      ELSE public.light_deposits.disputed_amount_cents
    END,
    reversed_light = public.light_deposits.reversed_light + v_delta_reversed_light,
    recovered_light = public.light_deposits.recovered_light + v_recovered_delta,
    unrecovered_light = public.light_deposits.unrecovered_light + v_unrecovered_delta,
    refunded_at = CASE WHEN p_reason = 'refund' THEN now() ELSE public.light_deposits.refunded_at END,
    disputed_at = CASE WHEN p_reason = 'dispute' THEN now() ELSE public.light_deposits.disputed_at END,
    last_stripe_event_id = p_stripe_event_id,
    metadata = public.light_deposits.metadata || COALESCE(p_metadata, '{}'::jsonb)
  WHERE id = v_deposit.id
  RETURNING * INTO v_deposit;

  INSERT INTO public.billing_transactions (
    user_id,
    type,
    category,
    description,
    amount_cents,
    amount_light,
    balance_after_light,
    billing_config_version,
    light_per_usd_snapshot,
    metadata
  ) VALUES (
    v_deposit.user_id,
    'debit',
    CASE WHEN p_reason = 'refund' THEN 'deposit_refund' ELSE 'deposit_dispute' END,
    CASE WHEN p_reason = 'refund' THEN 'Light deposit refund' ELSE 'Light deposit dispute' END,
    -p_amount_cents,
    -v_recovered_delta,
    v_new_balance,
    v_deposit.billing_config_version,
    v_deposit.light_per_usd_snapshot,
    jsonb_build_object(
      'light_deposit_id', v_deposit.id,
      'stripe_event_id', p_stripe_event_id,
      'stripe_payment_intent_id', p_stripe_payment_intent_id,
      'stripe_checkout_session_id', p_stripe_checkout_session_id,
      'stripe_charge_id', p_stripe_charge_id,
      'reversal_reason', p_reason,
      'recovered_light', v_recovered_delta,
      'unrecovered_light', v_unrecovered_delta
    ) || COALESCE(p_metadata, '{}'::jsonb)
  );

  RETURN QUERY SELECT
    v_deposit.id,
    v_deposit.status,
    v_delta_reversed_light,
    v_recovered_delta,
    v_unrecovered_delta,
    v_old_balance,
    v_new_balance;
END;
$$;

REVOKE ALL ON FUNCTION public.find_light_deposit_for_stripe_object(text, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.touch_stripe_payment_ledgers_updated_at()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_stripe_event(text, text, text, text, boolean, text, timestamp with time zone, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_stripe_event(text, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.upsert_pending_light_deposit(uuid, bigint, double precision, text, text, text, text, text, text, integer, double precision, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finalize_light_deposit(uuid, bigint, double precision, text, text, bigint, double precision, text, text, text, text, integer, double precision, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_light_deposit_failed(uuid, text, text, text, text, text, text, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_light_deposit_reversal(text, text, bigint, text, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;

GRANT ALL ON FUNCTION public.find_light_deposit_for_stripe_object(text, text, text)
  TO service_role;
GRANT ALL ON FUNCTION public.touch_stripe_payment_ledgers_updated_at()
  TO service_role;
GRANT ALL ON FUNCTION public.claim_stripe_event(text, text, text, text, boolean, text, timestamp with time zone, jsonb)
  TO service_role;
GRANT ALL ON FUNCTION public.finish_stripe_event(text, text, text, jsonb)
  TO service_role;
GRANT ALL ON FUNCTION public.upsert_pending_light_deposit(uuid, bigint, double precision, text, text, text, text, text, text, integer, double precision, jsonb)
  TO service_role;
GRANT ALL ON FUNCTION public.finalize_light_deposit(uuid, bigint, double precision, text, text, bigint, double precision, text, text, text, text, integer, double precision, jsonb)
  TO service_role;
GRANT ALL ON FUNCTION public.mark_light_deposit_failed(uuid, text, text, text, text, text, text, text, text, jsonb)
  TO service_role;
GRANT ALL ON FUNCTION public.record_light_deposit_reversal(text, text, bigint, text, text, text, jsonb)
  TO service_role;
