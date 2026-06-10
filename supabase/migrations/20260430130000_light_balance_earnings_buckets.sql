-- Split Light into spend-only deposits, withdrawable earnings, and source-preserving escrow.
-- Legacy balance_light / escrow_light remain as synced totals for existing API reads.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS deposit_balance_light double precision NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS earned_balance_light double precision NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS escrow_deposit_light double precision NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS escrow_earned_light double precision NOT NULL DEFAULT 0;

ALTER TABLE public.app_bids
  ADD COLUMN IF NOT EXISTS escrow_deposit_light double precision NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS escrow_earned_light double precision NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.light_ledger_entries (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  user_id uuid REFERENCES public.users(id),
  counterparty_user_id uuid REFERENCES public.users(id),
  app_id uuid REFERENCES public.apps(id),
  bucket text NOT NULL,
  kind text NOT NULL,
  amount_light double precision NOT NULL,
  reference_table text,
  reference_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  balance_after_light double precision,
  deposit_balance_after_light double precision,
  earned_balance_after_light double precision,
  escrow_deposit_after_light double precision,
  escrow_earned_after_light double precision,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT light_ledger_entries_bucket_check CHECK (
    bucket IN ('deposit', 'earned', 'escrow_deposit', 'escrow_earned', 'platform')
  ),
  CONSTRAINT light_ledger_entries_amount_nonzero CHECK (amount_light <> 0)
);

CREATE INDEX IF NOT EXISTS light_ledger_entries_user_created_idx
  ON public.light_ledger_entries(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS light_ledger_entries_reference_idx
  ON public.light_ledger_entries(reference_table, reference_id);
CREATE INDEX IF NOT EXISTS light_ledger_entries_app_created_idx
  ON public.light_ledger_entries(app_id, created_at DESC);

ALTER TABLE public.light_ledger_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.light_ledger_entries FROM anon, authenticated;
GRANT ALL ON TABLE public.light_ledger_entries TO service_role;

CREATE OR REPLACE FUNCTION public.prevent_light_ledger_entries_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'light_ledger_entries are immutable';
END;
$$;

DROP TRIGGER IF EXISTS prevent_light_ledger_entries_update
  ON public.light_ledger_entries;
CREATE TRIGGER prevent_light_ledger_entries_update
BEFORE UPDATE OR DELETE ON public.light_ledger_entries
FOR EACH ROW EXECUTE FUNCTION public.prevent_light_ledger_entries_mutation();

WITH active_payouts AS (
  SELECT user_id, COALESCE(SUM(amount_light), 0) AS amount_light
  FROM public.payouts
  WHERE status IN ('held', 'pending', 'processing', 'paid')
  GROUP BY user_id
),
computed AS (
  SELECT
    u.id,
    COALESCE(u.balance_light, 0) AS balance_light,
    COALESCE(u.escrow_light, 0) AS escrow_light,
    LEAST(
      GREATEST(COALESCE(u.balance_light, 0), 0),
      GREATEST(COALESCE(u.total_earned_light, 0) - COALESCE(p.amount_light, 0), 0)
    ) AS earned_remaining
  FROM public.users u
  LEFT JOIN active_payouts p ON p.user_id = u.id
)
UPDATE public.users u
SET
  earned_balance_light = c.earned_remaining,
  deposit_balance_light = GREATEST(c.balance_light - c.earned_remaining, 0),
  escrow_deposit_light = GREATEST(c.escrow_light, 0),
  escrow_earned_light = 0
FROM computed c
WHERE u.id = c.id;

UPDATE public.app_bids
SET
  escrow_deposit_light = CASE
    WHEN status = 'active' AND COALESCE(escrow_status, 'held') = 'held'
      THEN COALESCE(amount_light, amount_cents::double precision)
    ELSE COALESCE(escrow_deposit_light, 0)
  END,
  escrow_earned_light = COALESCE(escrow_earned_light, 0);

CREATE OR REPLACE FUNCTION public.sync_user_light_buckets()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_balance_delta double precision;
  v_escrow_delta double precision;
  v_remaining double precision;
  v_from_deposit double precision;
  v_bucket_changed boolean;
  v_escrow_bucket_changed boolean;
  v_earned_remaining double precision;
BEGIN
  NEW.deposit_balance_light := GREATEST(COALESCE(NEW.deposit_balance_light, 0), 0);
  NEW.earned_balance_light := GREATEST(COALESCE(NEW.earned_balance_light, 0), 0);
  NEW.escrow_deposit_light := GREATEST(COALESCE(NEW.escrow_deposit_light, 0), 0);
  NEW.escrow_earned_light := GREATEST(COALESCE(NEW.escrow_earned_light, 0), 0);
  NEW.balance_light := GREATEST(COALESCE(NEW.balance_light, 0), 0);
  NEW.escrow_light := GREATEST(COALESCE(NEW.escrow_light, 0), 0);

  IF TG_OP = 'INSERT' THEN
    IF NEW.deposit_balance_light + NEW.earned_balance_light = 0 AND NEW.balance_light > 0 THEN
      v_earned_remaining := LEAST(
        NEW.balance_light,
        GREATEST(COALESCE(NEW.total_earned_light, 0), 0)
      );
      NEW.earned_balance_light := v_earned_remaining;
      NEW.deposit_balance_light := GREATEST(NEW.balance_light - v_earned_remaining, 0);
    END IF;

    IF NEW.escrow_deposit_light + NEW.escrow_earned_light = 0 AND NEW.escrow_light > 0 THEN
      NEW.escrow_deposit_light := NEW.escrow_light;
      NEW.escrow_earned_light := 0;
    END IF;

    NEW.balance_light := NEW.deposit_balance_light + NEW.earned_balance_light;
    NEW.escrow_light := NEW.escrow_deposit_light + NEW.escrow_earned_light;
    RETURN NEW;
  END IF;

  v_bucket_changed :=
    NEW.deposit_balance_light IS DISTINCT FROM OLD.deposit_balance_light
    OR NEW.earned_balance_light IS DISTINCT FROM OLD.earned_balance_light;

  IF NOT v_bucket_changed THEN
    NEW.deposit_balance_light := GREATEST(COALESCE(OLD.deposit_balance_light, 0), 0);
    NEW.earned_balance_light := GREATEST(COALESCE(OLD.earned_balance_light, 0), 0);
    v_balance_delta := NEW.balance_light - GREATEST(COALESCE(OLD.balance_light, 0), 0);

    IF v_balance_delta > 0 THEN
      NEW.deposit_balance_light := NEW.deposit_balance_light + v_balance_delta;
    ELSIF v_balance_delta < 0 THEN
      v_remaining := ABS(v_balance_delta);
      v_from_deposit := LEAST(NEW.deposit_balance_light, v_remaining);
      NEW.deposit_balance_light := NEW.deposit_balance_light - v_from_deposit;
      v_remaining := v_remaining - v_from_deposit;
      NEW.earned_balance_light := GREATEST(NEW.earned_balance_light - v_remaining, 0);
    END IF;
  END IF;

  v_escrow_bucket_changed :=
    NEW.escrow_deposit_light IS DISTINCT FROM OLD.escrow_deposit_light
    OR NEW.escrow_earned_light IS DISTINCT FROM OLD.escrow_earned_light;

  IF NOT v_escrow_bucket_changed THEN
    NEW.escrow_deposit_light := GREATEST(COALESCE(OLD.escrow_deposit_light, 0), 0);
    NEW.escrow_earned_light := GREATEST(COALESCE(OLD.escrow_earned_light, 0), 0);
    v_escrow_delta := NEW.escrow_light - GREATEST(COALESCE(OLD.escrow_light, 0), 0);

    IF v_escrow_delta > 0 THEN
      NEW.escrow_deposit_light := NEW.escrow_deposit_light + v_escrow_delta;
    ELSIF v_escrow_delta < 0 THEN
      v_remaining := ABS(v_escrow_delta);
      v_from_deposit := LEAST(NEW.escrow_deposit_light, v_remaining);
      NEW.escrow_deposit_light := NEW.escrow_deposit_light - v_from_deposit;
      v_remaining := v_remaining - v_from_deposit;
      NEW.escrow_earned_light := GREATEST(NEW.escrow_earned_light - v_remaining, 0);
    END IF;
  END IF;

  NEW.balance_light := NEW.deposit_balance_light + NEW.earned_balance_light;
  NEW.escrow_light := NEW.escrow_deposit_light + NEW.escrow_earned_light;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_user_light_buckets ON public.users;
CREATE TRIGGER sync_user_light_buckets
BEFORE INSERT OR UPDATE ON public.users
FOR EACH ROW EXECUTE FUNCTION public.sync_user_light_buckets();

CREATE OR REPLACE FUNCTION public.record_light_ledger_entry(
  p_user_id uuid,
  p_counterparty_user_id uuid,
  p_app_id uuid,
  p_bucket text,
  p_kind text,
  p_amount_light double precision,
  p_reference_table text DEFAULT NULL::text,
  p_reference_id uuid DEFAULT NULL::uuid,
  p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public, extensions'
AS $$
DECLARE
  v_entry_id uuid;
BEGIN
  IF p_amount_light IS NULL OR p_amount_light = 0 THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.light_ledger_entries (
    user_id,
    counterparty_user_id,
    app_id,
    bucket,
    kind,
    amount_light,
    reference_table,
    reference_id,
    metadata,
    balance_after_light,
    deposit_balance_after_light,
    earned_balance_after_light,
    escrow_deposit_after_light,
    escrow_earned_after_light
  )
  SELECT
    p_user_id,
    p_counterparty_user_id,
    p_app_id,
    p_bucket,
    p_kind,
    p_amount_light,
    p_reference_table,
    p_reference_id,
    COALESCE(p_metadata, '{}'::jsonb),
    u.balance_light,
    u.deposit_balance_light,
    u.earned_balance_light,
    u.escrow_deposit_light,
    u.escrow_earned_light
  FROM (SELECT 1) s
  LEFT JOIN public.users u ON u.id = p_user_id
  RETURNING public.light_ledger_entries.id INTO v_entry_id;

  RETURN v_entry_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.debit_spendable_light(
  p_user_id uuid,
  p_amount_light double precision,
  p_allow_partial boolean DEFAULT false
) RETURNS TABLE(
  deposit_debited double precision,
  earned_debited double precision,
  new_deposit_balance double precision,
  new_earned_balance double precision,
  new_balance double precision
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public, extensions'
AS $$
DECLARE
  v_user RECORD;
  v_amount_to_debit double precision;
  v_deposit_debited double precision := 0;
  v_earned_debited double precision := 0;
  v_new_deposit double precision := 0;
  v_new_earned double precision := 0;
BEGIN
  IF p_amount_light IS NULL OR p_amount_light <= 0 THEN
    RAISE EXCEPTION 'Debit amount must be positive';
  END IF;

  SELECT
    COALESCE(balance_light, 0) AS balance_light,
    COALESCE(deposit_balance_light, 0) AS deposit_balance_light,
    COALESCE(earned_balance_light, 0) AS earned_balance_light
  INTO v_user
  FROM public.users
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  IF v_user.balance_light < p_amount_light THEN
    IF p_allow_partial THEN
      v_amount_to_debit := v_user.balance_light;
    ELSE
      RAISE EXCEPTION 'Insufficient available balance. Available: % Light, requested: %',
        v_user.balance_light, p_amount_light;
    END IF;
  ELSE
    v_amount_to_debit := p_amount_light;
  END IF;

  v_deposit_debited := LEAST(v_user.deposit_balance_light, v_amount_to_debit);
  v_earned_debited := v_amount_to_debit - v_deposit_debited;
  v_new_deposit := v_user.deposit_balance_light - v_deposit_debited;
  v_new_earned := v_user.earned_balance_light - v_earned_debited;

  UPDATE public.users
  SET
    deposit_balance_light = v_new_deposit,
    earned_balance_light = v_new_earned,
    balance_light = v_new_deposit + v_new_earned
  WHERE id = p_user_id;

  RETURN QUERY SELECT
    v_deposit_debited,
    v_earned_debited,
    v_new_deposit,
    v_new_earned,
    v_new_deposit + v_new_earned;
END;
$$;

CREATE OR REPLACE FUNCTION public.credit_balance(
  p_user_id uuid,
  p_amount_light double precision
) RETURNS TABLE(old_balance double precision, new_balance double precision)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public, extensions'
AS $$
DECLARE
  v_old_balance double precision;
  v_new_balance double precision;
BEGIN
  IF p_amount_light IS NULL OR p_amount_light <= 0 THEN
    RAISE EXCEPTION 'Credit amount must be positive';
  END IF;

  SELECT COALESCE(balance_light, 0) INTO v_old_balance
  FROM public.users
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  UPDATE public.users
  SET
    deposit_balance_light = deposit_balance_light + p_amount_light,
    balance_light = deposit_balance_light + earned_balance_light + p_amount_light
  WHERE id = p_user_id
  RETURNING balance_light INTO v_new_balance;

  PERFORM public.record_light_ledger_entry(
    p_user_id,
    NULL,
    NULL,
    'deposit',
    'deposit_credit',
    p_amount_light,
    'users',
    p_user_id,
    jsonb_build_object('source', 'credit_balance')
  );

  RETURN QUERY SELECT v_old_balance, v_new_balance;
END;
$$;

CREATE OR REPLACE FUNCTION public.debit_balance(
  p_user_id uuid,
  p_amount double precision,
  p_update_billed_at boolean DEFAULT true
) RETURNS TABLE(old_balance double precision, new_balance double precision, was_depleted boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public, extensions'
AS $$
DECLARE
  v_old_balance double precision;
  v_debit RECORD;
BEGIN
  SELECT COALESCE(balance_light, 0) INTO v_old_balance
  FROM public.users
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  SELECT * INTO v_debit
  FROM public.debit_spendable_light(p_user_id, p_amount, true);

  IF COALESCE(p_update_billed_at, true) THEN
    UPDATE public.users
    SET hosting_last_billed_at = now()
    WHERE id = p_user_id;
  END IF;

  PERFORM public.record_light_ledger_entry(
    p_user_id,
    NULL,
    NULL,
    'deposit',
    'spend_debit',
    -v_debit.deposit_debited,
    'users',
    p_user_id,
    jsonb_build_object('source', 'debit_balance')
  );
  PERFORM public.record_light_ledger_entry(
    p_user_id,
    NULL,
    NULL,
    'earned',
    'spend_debit',
    -v_debit.earned_debited,
    'users',
    p_user_id,
    jsonb_build_object('source', 'debit_balance')
  );

  RETURN QUERY SELECT
    v_old_balance,
    v_debit.new_balance,
    (v_debit.new_balance <= 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.transfer_balance(
  p_from_user uuid,
  p_to_user uuid,
  p_amount_light double precision
) RETURNS TABLE(from_new_balance double precision, to_new_balance double precision, platform_fee double precision)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public, extensions'
AS $$
DECLARE
  v_fee_rate double precision := 0.10;
  v_fee double precision;
  v_net double precision;
  v_debit RECORD;
  v_to_new_balance double precision;
BEGIN
  IF p_amount_light IS NULL OR p_amount_light <= 0 THEN
    RAISE EXCEPTION 'Transfer amount must be positive';
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

  PERFORM public.record_light_ledger_entry(
    p_from_user,
    p_to_user,
    NULL,
    'deposit',
    'transfer_debit',
    -v_debit.deposit_debited,
    NULL,
    NULL,
    jsonb_build_object('gross_light', p_amount_light, 'platform_fee_light', v_fee)
  );
  PERFORM public.record_light_ledger_entry(
    p_from_user,
    p_to_user,
    NULL,
    'earned',
    'transfer_debit',
    -v_debit.earned_debited,
    NULL,
    NULL,
    jsonb_build_object('gross_light', p_amount_light, 'platform_fee_light', v_fee)
  );
  PERFORM public.record_light_ledger_entry(
    p_to_user,
    p_from_user,
    NULL,
    'earned',
    'transfer_earning',
    v_net,
    NULL,
    NULL,
    jsonb_build_object('gross_light', p_amount_light, 'platform_fee_light', v_fee)
  );
  PERFORM public.record_light_ledger_entry(
    NULL,
    p_from_user,
    NULL,
    'platform',
    'platform_fee',
    v_fee,
    NULL,
    NULL,
    jsonb_build_object('source', 'transfer_balance')
  );

  RETURN QUERY SELECT v_debit.new_balance, v_to_new_balance, v_fee;
END;
$$;

CREATE OR REPLACE FUNCTION public.escrow_bid(
  p_bidder_id uuid,
  p_app_id uuid,
  p_amount_light double precision,
  p_message text DEFAULT NULL::text,
  p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public, extensions'
AS $$
DECLARE
  v_bid_id uuid;
  v_app RECORD;
  v_available double precision;
  v_debit RECORD;
BEGIN
  IF p_amount_light IS NULL OR p_amount_light <= 0 THEN
    RAISE EXCEPTION 'Bid amount must be positive';
  END IF;

  SELECT id, owner_id, had_external_db INTO v_app
  FROM public.apps
  WHERE id = p_app_id;

  IF v_app IS NULL THEN
    RAISE EXCEPTION 'App not found';
  END IF;

  IF COALESCE(v_app.had_external_db, false) THEN
    RAISE EXCEPTION 'This app is permanently ineligible for trading because it has used an external database.';
  END IF;

  IF v_app.owner_id = p_bidder_id THEN
    RAISE EXCEPTION 'Cannot bid on your own app';
  END IF;

  SELECT COALESCE(balance_light, 0) INTO v_available
  FROM public.users
  WHERE id = p_bidder_id
  FOR UPDATE;

  IF v_available IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  IF v_available < p_amount_light THEN
    RAISE EXCEPTION 'Insufficient balance. Available: % Light', v_available;
  END IF;

  PERFORM 1
  FROM public.app_listings
  WHERE app_id = p_app_id
    AND status = 'active'
    AND floor_price_light IS NOT NULL
    AND p_amount_light < floor_price_light;

  IF FOUND THEN
    RAISE EXCEPTION 'Bid below floor price';
  END IF;

  SELECT * INTO v_debit
  FROM public.debit_spendable_light(p_bidder_id, p_amount_light, false);

  UPDATE public.users
  SET
    escrow_deposit_light = escrow_deposit_light + v_debit.deposit_debited,
    escrow_earned_light = escrow_earned_light + v_debit.earned_debited,
    escrow_light = escrow_deposit_light + escrow_earned_light + p_amount_light
  WHERE id = p_bidder_id;

  INSERT INTO public.app_bids (
    app_id,
    bidder_id,
    amount_cents,
    amount_light,
    escrow_deposit_light,
    escrow_earned_light,
    message,
    expires_at
  )
  VALUES (
    p_app_id,
    p_bidder_id,
    round(p_amount_light)::integer,
    p_amount_light,
    v_debit.deposit_debited,
    v_debit.earned_debited,
    p_message,
    p_expires_at
  )
  RETURNING id INTO v_bid_id;

  PERFORM public.record_light_ledger_entry(
    p_bidder_id,
    v_app.owner_id,
    p_app_id,
    'deposit',
    'escrow_hold',
    -v_debit.deposit_debited,
    'app_bids',
    v_bid_id,
    jsonb_build_object('amount_light', p_amount_light)
  );
  PERFORM public.record_light_ledger_entry(
    p_bidder_id,
    v_app.owner_id,
    p_app_id,
    'earned',
    'escrow_hold',
    -v_debit.earned_debited,
    'app_bids',
    v_bid_id,
    jsonb_build_object('amount_light', p_amount_light)
  );
  PERFORM public.record_light_ledger_entry(
    p_bidder_id,
    v_app.owner_id,
    p_app_id,
    'escrow_deposit',
    'escrow_hold',
    v_debit.deposit_debited,
    'app_bids',
    v_bid_id,
    jsonb_build_object('amount_light', p_amount_light)
  );
  PERFORM public.record_light_ledger_entry(
    p_bidder_id,
    v_app.owner_id,
    p_app_id,
    'escrow_earned',
    'escrow_hold',
    v_debit.earned_debited,
    'app_bids',
    v_bid_id,
    jsonb_build_object('amount_light', p_amount_light)
  );

  INSERT INTO public.app_listings (app_id, owner_id)
  VALUES (p_app_id, v_app.owner_id)
  ON CONFLICT (app_id) DO NOTHING;

  RETURN v_bid_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_bid(
  p_bidder_id uuid,
  p_bid_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public, extensions'
AS $$
DECLARE
  v_bid RECORD;
  v_refund_deposit double precision;
  v_refund_earned double precision;
BEGIN
  SELECT * INTO v_bid
  FROM public.app_bids
  WHERE id = p_bid_id
    AND status = 'active'
  FOR UPDATE;

  IF v_bid IS NULL THEN
    RAISE EXCEPTION 'Bid not found or not active';
  END IF;

  IF v_bid.bidder_id != p_bidder_id THEN
    RAISE EXCEPTION 'Only the bidder can cancel their own bid';
  END IF;

  v_refund_deposit := COALESCE(v_bid.escrow_deposit_light, 0);
  v_refund_earned := COALESCE(v_bid.escrow_earned_light, 0);
  IF v_refund_deposit + v_refund_earned <= 0 THEN
    v_refund_deposit := COALESCE(v_bid.amount_light, v_bid.amount_cents::double precision);
    v_refund_earned := 0;
  END IF;

  UPDATE public.users
  SET
    deposit_balance_light = deposit_balance_light + v_refund_deposit,
    earned_balance_light = earned_balance_light + v_refund_earned,
    escrow_deposit_light = escrow_deposit_light - v_refund_deposit,
    escrow_earned_light = escrow_earned_light - v_refund_earned,
    balance_light = deposit_balance_light + earned_balance_light + v_refund_deposit + v_refund_earned,
    escrow_light = escrow_deposit_light + escrow_earned_light - v_refund_deposit - v_refund_earned
  WHERE id = p_bidder_id
    AND escrow_deposit_light >= v_refund_deposit
    AND escrow_earned_light >= v_refund_earned;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Escrow invariant violation while cancelling bid';
  END IF;

  UPDATE public.app_bids
  SET status = 'cancelled',
      escrow_status = 'refunded',
      resolved_at = now()
  WHERE id = p_bid_id;

  PERFORM public.record_light_ledger_entry(p_bidder_id, NULL, v_bid.app_id, 'escrow_deposit', 'escrow_refund', -v_refund_deposit, 'app_bids', p_bid_id);
  PERFORM public.record_light_ledger_entry(p_bidder_id, NULL, v_bid.app_id, 'escrow_earned', 'escrow_refund', -v_refund_earned, 'app_bids', p_bid_id);
  PERFORM public.record_light_ledger_entry(p_bidder_id, NULL, v_bid.app_id, 'deposit', 'escrow_refund', v_refund_deposit, 'app_bids', p_bid_id);
  PERFORM public.record_light_ledger_entry(p_bidder_id, NULL, v_bid.app_id, 'earned', 'escrow_refund', v_refund_earned, 'app_bids', p_bid_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_bid(
  p_owner_id uuid,
  p_bid_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public, extensions'
AS $$
DECLARE
  v_bid RECORD;
  v_app_owner uuid;
  v_refund_deposit double precision;
  v_refund_earned double precision;
BEGIN
  SELECT * INTO v_bid
  FROM public.app_bids
  WHERE id = p_bid_id
    AND status = 'active'
  FOR UPDATE;

  IF v_bid IS NULL THEN
    RAISE EXCEPTION 'Bid not found or not active';
  END IF;

  SELECT owner_id INTO v_app_owner
  FROM public.apps
  WHERE id = v_bid.app_id;

  IF v_app_owner != p_owner_id THEN
    RAISE EXCEPTION 'Only the app owner can reject bids';
  END IF;

  v_refund_deposit := COALESCE(v_bid.escrow_deposit_light, 0);
  v_refund_earned := COALESCE(v_bid.escrow_earned_light, 0);
  IF v_refund_deposit + v_refund_earned <= 0 THEN
    v_refund_deposit := COALESCE(v_bid.amount_light, v_bid.amount_cents::double precision);
    v_refund_earned := 0;
  END IF;

  UPDATE public.users
  SET
    deposit_balance_light = deposit_balance_light + v_refund_deposit,
    earned_balance_light = earned_balance_light + v_refund_earned,
    escrow_deposit_light = escrow_deposit_light - v_refund_deposit,
    escrow_earned_light = escrow_earned_light - v_refund_earned,
    balance_light = deposit_balance_light + earned_balance_light + v_refund_deposit + v_refund_earned,
    escrow_light = escrow_deposit_light + escrow_earned_light - v_refund_deposit - v_refund_earned
  WHERE id = v_bid.bidder_id
    AND escrow_deposit_light >= v_refund_deposit
    AND escrow_earned_light >= v_refund_earned;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Escrow invariant violation while rejecting bid';
  END IF;

  UPDATE public.app_bids
  SET status = 'rejected',
      escrow_status = 'refunded',
      resolved_at = now()
  WHERE id = p_bid_id;

  PERFORM public.record_light_ledger_entry(v_bid.bidder_id, p_owner_id, v_bid.app_id, 'escrow_deposit', 'escrow_refund', -v_refund_deposit, 'app_bids', p_bid_id);
  PERFORM public.record_light_ledger_entry(v_bid.bidder_id, p_owner_id, v_bid.app_id, 'escrow_earned', 'escrow_refund', -v_refund_earned, 'app_bids', p_bid_id);
  PERFORM public.record_light_ledger_entry(v_bid.bidder_id, p_owner_id, v_bid.app_id, 'deposit', 'escrow_refund', v_refund_deposit, 'app_bids', p_bid_id);
  PERFORM public.record_light_ledger_entry(v_bid.bidder_id, p_owner_id, v_bid.app_id, 'earned', 'escrow_refund', v_refund_earned, 'app_bids', p_bid_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.expire_old_bids()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public, extensions'
AS $$
DECLARE
  v_expired RECORD;
  v_count integer := 0;
  v_refund_deposit double precision;
  v_refund_earned double precision;
BEGIN
  FOR v_expired IN
    SELECT *
    FROM public.app_bids
    WHERE status = 'active'
      AND expires_at IS NOT NULL
      AND expires_at < now()
    FOR UPDATE
  LOOP
    v_refund_deposit := COALESCE(v_expired.escrow_deposit_light, 0);
    v_refund_earned := COALESCE(v_expired.escrow_earned_light, 0);
    IF v_refund_deposit + v_refund_earned <= 0 THEN
      v_refund_deposit := COALESCE(v_expired.amount_light, v_expired.amount_cents::double precision);
      v_refund_earned := 0;
    END IF;

    UPDATE public.users
    SET
      deposit_balance_light = deposit_balance_light + v_refund_deposit,
      earned_balance_light = earned_balance_light + v_refund_earned,
      escrow_deposit_light = escrow_deposit_light - v_refund_deposit,
      escrow_earned_light = escrow_earned_light - v_refund_earned,
      balance_light = deposit_balance_light + earned_balance_light + v_refund_deposit + v_refund_earned,
      escrow_light = escrow_deposit_light + escrow_earned_light - v_refund_deposit - v_refund_earned
    WHERE id = v_expired.bidder_id
      AND escrow_deposit_light >= v_refund_deposit
      AND escrow_earned_light >= v_refund_earned;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Escrow invariant violation while expiring bid %', v_expired.id;
    END IF;

    UPDATE public.app_bids
    SET status = 'expired',
        escrow_status = 'refunded',
        resolved_at = now()
    WHERE id = v_expired.id;

    PERFORM public.record_light_ledger_entry(v_expired.bidder_id, NULL, v_expired.app_id, 'escrow_deposit', 'escrow_refund', -v_refund_deposit, 'app_bids', v_expired.id);
    PERFORM public.record_light_ledger_entry(v_expired.bidder_id, NULL, v_expired.app_id, 'escrow_earned', 'escrow_refund', -v_refund_earned, 'app_bids', v_expired.id);
    PERFORM public.record_light_ledger_entry(v_expired.bidder_id, NULL, v_expired.app_id, 'deposit', 'escrow_refund', v_refund_deposit, 'app_bids', v_expired.id);
    PERFORM public.record_light_ledger_entry(v_expired.bidder_id, NULL, v_expired.app_id, 'earned', 'escrow_refund', v_refund_earned, 'app_bids', v_expired.id);

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_marketplace_sale(
  p_seller_id uuid,
  p_buyer_id uuid,
  p_app_id uuid,
  p_sale_price_light double precision,
  p_bid_id uuid,
  p_sale_method text,
  p_debit_source text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public, extensions'
AS $$
DECLARE
  v_app RECORD;
  v_seller_email text;
  v_fee_rate double precision := 0.10;
  v_fee double precision;
  v_payout double precision;
  v_sale_id uuid;
  v_slug_exists boolean;
  v_new_slug text;
  v_other_bid RECORD;
  v_provenance jsonb;
  v_sale_bid RECORD;
  v_buyer_deposit_used double precision := 0;
  v_buyer_earned_used double precision := 0;
  v_debit RECORD;
  v_refund_deposit double precision;
  v_refund_earned double precision;
BEGIN
  IF p_sale_price_light IS NULL OR p_sale_price_light <= 0 THEN
    RAISE EXCEPTION 'Sale price must be positive';
  END IF;

  IF p_debit_source NOT IN ('balance', 'escrow') THEN
    RAISE EXCEPTION 'Invalid debit source';
  END IF;

  IF p_buyer_id = p_seller_id THEN
    RAISE EXCEPTION 'Cannot buy your own app';
  END IF;

  SELECT * INTO v_app
  FROM public.apps
  WHERE id = p_app_id
  FOR UPDATE;

  IF v_app IS NULL THEN
    RAISE EXCEPTION 'App not found';
  END IF;

  IF v_app.owner_id != p_seller_id THEN
    RAISE EXCEPTION 'Only the app owner can complete this sale';
  END IF;

  IF COALESCE(v_app.had_external_db, false) THEN
    RAISE EXCEPTION 'This app is permanently ineligible for trading because it has used an external database.';
  END IF;

  SELECT email INTO v_seller_email
  FROM public.users
  WHERE id = p_seller_id;

  IF v_seller_email IS NULL THEN
    RAISE EXCEPTION 'Seller not found';
  END IF;

  SELECT COALESCE(platform_fee_rate, 0.10) INTO v_fee_rate
  FROM public.platform_billing_config
  WHERE id = 'singleton';

  v_fee := p_sale_price_light * COALESCE(v_fee_rate, 0.10);
  v_payout := p_sale_price_light - v_fee;

  IF p_debit_source = 'escrow' THEN
    IF p_bid_id IS NULL THEN
      RAISE EXCEPTION 'Bid id required for escrow sale';
    END IF;

    SELECT * INTO v_sale_bid
    FROM public.app_bids
    WHERE id = p_bid_id
    FOR UPDATE;

    IF v_sale_bid IS NULL THEN
      RAISE EXCEPTION 'Bid not found';
    END IF;

    v_buyer_deposit_used := COALESCE(v_sale_bid.escrow_deposit_light, 0);
    v_buyer_earned_used := COALESCE(v_sale_bid.escrow_earned_light, 0);
    IF v_buyer_deposit_used + v_buyer_earned_used <= 0 THEN
      v_buyer_deposit_used := p_sale_price_light;
      v_buyer_earned_used := 0;
    END IF;

    IF ABS((v_buyer_deposit_used + v_buyer_earned_used) - p_sale_price_light) > 0.000001 THEN
      RAISE EXCEPTION 'Escrow source buckets do not match sale price';
    END IF;

    UPDATE public.users
    SET
      escrow_deposit_light = escrow_deposit_light - v_buyer_deposit_used,
      escrow_earned_light = escrow_earned_light - v_buyer_earned_used,
      escrow_light = escrow_deposit_light + escrow_earned_light - p_sale_price_light
    WHERE id = p_buyer_id
      AND escrow_deposit_light >= v_buyer_deposit_used
      AND escrow_earned_light >= v_buyer_earned_used;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Insufficient balance or escrow for purchase';
    END IF;
  ELSE
    SELECT * INTO v_debit
    FROM public.debit_spendable_light(p_buyer_id, p_sale_price_light, false);
    v_buyer_deposit_used := v_debit.deposit_debited;
    v_buyer_earned_used := v_debit.earned_debited;
  END IF;

  UPDATE public.users
  SET
    earned_balance_light = earned_balance_light + v_payout,
    total_earned_light = total_earned_light + v_payout,
    balance_light = deposit_balance_light + earned_balance_light + v_payout
  WHERE id = p_seller_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Seller not found';
  END IF;

  SELECT EXISTS(
    SELECT 1
    FROM public.apps
    WHERE owner_id = p_buyer_id
      AND slug = v_app.slug
      AND id != v_app.id
  ) INTO v_slug_exists;

  IF v_slug_exists THEN
    v_new_slug := v_app.slug || '-acquired';
    WHILE EXISTS(
      SELECT 1
      FROM public.apps
      WHERE owner_id = p_buyer_id
        AND slug = v_new_slug
        AND id != v_app.id
    ) LOOP
      v_new_slug := v_app.slug || '-acquired-' || substr(extensions.gen_random_uuid()::text, 1, 4);
    END LOOP;

    UPDATE public.apps
    SET owner_id = p_buyer_id,
        slug = v_new_slug,
        updated_at = now()
    WHERE id = v_app.id;
  ELSE
    UPDATE public.apps
    SET owner_id = p_buyer_id,
        updated_at = now()
    WHERE id = v_app.id;
  END IF;

  DELETE FROM public.user_app_permissions
  WHERE app_id = v_app.id;

  DELETE FROM public.user_app_secrets
  WHERE app_id = v_app.id;

  IF p_bid_id IS NOT NULL THEN
    UPDATE public.app_bids
    SET status = 'accepted',
        escrow_status = 'released',
        resolved_at = now()
    WHERE id = p_bid_id;
  END IF;

  FOR v_other_bid IN
    SELECT *
    FROM public.app_bids
    WHERE app_id = v_app.id
      AND status = 'active'
      AND (p_bid_id IS NULL OR id != p_bid_id)
    FOR UPDATE
  LOOP
    v_refund_deposit := COALESCE(v_other_bid.escrow_deposit_light, 0);
    v_refund_earned := COALESCE(v_other_bid.escrow_earned_light, 0);
    IF v_refund_deposit + v_refund_earned <= 0 THEN
      v_refund_deposit := COALESCE(v_other_bid.amount_light, v_other_bid.amount_cents::double precision);
      v_refund_earned := 0;
    END IF;

    UPDATE public.users
    SET
      deposit_balance_light = deposit_balance_light + v_refund_deposit,
      earned_balance_light = earned_balance_light + v_refund_earned,
      escrow_deposit_light = escrow_deposit_light - v_refund_deposit,
      escrow_earned_light = escrow_earned_light - v_refund_earned,
      balance_light = deposit_balance_light + earned_balance_light + v_refund_deposit + v_refund_earned,
      escrow_light = escrow_deposit_light + escrow_earned_light - v_refund_deposit - v_refund_earned
    WHERE id = v_other_bid.bidder_id
      AND escrow_deposit_light >= v_refund_deposit
      AND escrow_earned_light >= v_refund_earned;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Escrow invariant violation while refunding competing bid %', v_other_bid.id;
    END IF;

    UPDATE public.app_bids
    SET status = 'rejected',
        escrow_status = 'refunded',
        resolved_at = now()
    WHERE id = v_other_bid.id;

    PERFORM public.record_light_ledger_entry(v_other_bid.bidder_id, p_seller_id, v_app.id, 'escrow_deposit', 'escrow_refund', -v_refund_deposit, 'app_bids', v_other_bid.id);
    PERFORM public.record_light_ledger_entry(v_other_bid.bidder_id, p_seller_id, v_app.id, 'escrow_earned', 'escrow_refund', -v_refund_earned, 'app_bids', v_other_bid.id);
    PERFORM public.record_light_ledger_entry(v_other_bid.bidder_id, p_seller_id, v_app.id, 'deposit', 'escrow_refund', v_refund_deposit, 'app_bids', v_other_bid.id);
    PERFORM public.record_light_ledger_entry(v_other_bid.bidder_id, p_seller_id, v_app.id, 'earned', 'escrow_refund', v_refund_earned, 'app_bids', v_other_bid.id);
  END LOOP;

  INSERT INTO public.app_listings (app_id, owner_id, status, provenance)
  VALUES (v_app.id, p_seller_id, 'active', '[]'::jsonb)
  ON CONFLICT (app_id) DO NOTHING;

  SELECT COALESCE(provenance, '[]'::jsonb) INTO v_provenance
  FROM public.app_listings
  WHERE app_id = v_app.id
  FOR UPDATE;

  v_provenance := v_provenance || jsonb_build_array(jsonb_build_object(
    'owner_id', p_seller_id,
    'email', v_seller_email,
    'acquired_at', now(),
    'price_light', p_sale_price_light,
    'method', p_sale_method
  ));

  UPDATE public.app_listings
  SET owner_id = p_buyer_id,
      status = 'sold',
      provenance = v_provenance,
      updated_at = now()
  WHERE app_id = v_app.id;

  INSERT INTO public.app_sales (
    app_id,
    seller_id,
    buyer_id,
    sale_price_cents,
    platform_fee_cents,
    seller_payout_cents,
    sale_price_light,
    platform_fee_light,
    seller_payout_light,
    bid_id
  )
  VALUES (
    v_app.id,
    p_seller_id,
    p_buyer_id,
    round(p_sale_price_light)::integer,
    round(v_fee)::integer,
    round(v_payout)::integer,
    p_sale_price_light,
    v_fee,
    v_payout,
    p_bid_id
  )
  RETURNING id INTO v_sale_id;

  INSERT INTO public.transfers (
    from_user_id,
    to_user_id,
    amount_cents,
    amount_light,
    reason,
    app_id
  )
  VALUES (
    p_buyer_id,
    p_seller_id,
    round(v_payout)::double precision,
    v_payout,
    'marketplace_sale',
    v_app.id
  );

  IF p_debit_source = 'escrow' THEN
    PERFORM public.record_light_ledger_entry(p_buyer_id, p_seller_id, v_app.id, 'escrow_deposit', 'marketplace_sale_debit', -v_buyer_deposit_used, 'app_sales', v_sale_id);
    PERFORM public.record_light_ledger_entry(p_buyer_id, p_seller_id, v_app.id, 'escrow_earned', 'marketplace_sale_debit', -v_buyer_earned_used, 'app_sales', v_sale_id);
  ELSE
    PERFORM public.record_light_ledger_entry(p_buyer_id, p_seller_id, v_app.id, 'deposit', 'marketplace_sale_debit', -v_buyer_deposit_used, 'app_sales', v_sale_id);
    PERFORM public.record_light_ledger_entry(p_buyer_id, p_seller_id, v_app.id, 'earned', 'marketplace_sale_debit', -v_buyer_earned_used, 'app_sales', v_sale_id);
  END IF;
  PERFORM public.record_light_ledger_entry(p_seller_id, p_buyer_id, v_app.id, 'earned', 'marketplace_sale_earning', v_payout, 'app_sales', v_sale_id);
  PERFORM public.record_light_ledger_entry(NULL, p_buyer_id, v_app.id, 'platform', 'platform_fee', v_fee, 'app_sales', v_sale_id);

  RETURN jsonb_build_object(
    'sale_id', v_sale_id,
    'app_id', v_app.id,
    'seller_id', p_seller_id,
    'buyer_id', p_buyer_id,
    'sale_price_light', p_sale_price_light,
    'platform_fee_light', v_fee,
    'seller_payout_light', v_payout
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_bid(
  p_owner_id uuid,
  p_bid_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public, extensions'
AS $$
DECLARE
  v_bid RECORD;
BEGIN
  SELECT * INTO v_bid
  FROM public.app_bids
  WHERE id = p_bid_id
    AND status = 'active'
  FOR UPDATE;

  IF v_bid IS NULL THEN
    RAISE EXCEPTION 'Bid not found or not active';
  END IF;

  IF v_bid.amount_light IS NULL OR v_bid.amount_light <= 0 THEN
    RAISE EXCEPTION 'Bid amount is invalid';
  END IF;

  RETURN public.complete_marketplace_sale(
    p_owner_id,
    v_bid.bidder_id,
    v_bid.app_id,
    v_bid.amount_light,
    p_bid_id,
    'marketplace_sale',
    'escrow'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.buy_now(
  p_buyer_id uuid,
  p_app_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public, extensions'
AS $$
DECLARE
  v_listing RECORD;
  v_bid_id uuid;
BEGIN
  SELECT * INTO v_listing
  FROM public.app_listings
  WHERE app_id = p_app_id
    AND status = 'active'
  FOR UPDATE;

  IF v_listing IS NULL THEN
    RAISE EXCEPTION 'No active listing found for this app';
  END IF;

  IF COALESCE(v_listing.instant_buy, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'This listing does not allow instant buy';
  END IF;

  IF v_listing.ask_price_light IS NULL OR v_listing.ask_price_light <= 0 THEN
    RAISE EXCEPTION 'No ask price set';
  END IF;

  IF v_listing.owner_id = p_buyer_id THEN
    RAISE EXCEPTION 'Cannot buy your own app';
  END IF;

  INSERT INTO public.app_bids (
    app_id,
    bidder_id,
    amount_cents,
    amount_light,
    escrow_deposit_light,
    escrow_earned_light,
    status,
    escrow_status,
    resolved_at,
    message
  )
  VALUES (
    p_app_id,
    p_buyer_id,
    round(v_listing.ask_price_light)::integer,
    v_listing.ask_price_light,
    0,
    0,
    'accepted',
    'released',
    now(),
    'Instant buy'
  )
  RETURNING id INTO v_bid_id;

  RETURN public.complete_marketplace_sale(
    v_listing.owner_id,
    p_buyer_id,
    p_app_id,
    v_listing.ask_price_light,
    v_bid_id,
    'instant_buy',
    'balance'
  );
END;
$$;

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
  v_earned_available double precision;
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
      'billing_config_version', COALESCE(p_billing_config_version, 1)
    )
  );

  RETURN v_payout_id;
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
  SET status = 'failed',
      failure_reason = p_failure_reason,
      completed_at = now()
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

REVOKE ALL ON FUNCTION public.record_light_ledger_entry(uuid, uuid, uuid, text, text, double precision, text, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.debit_spendable_light(uuid, double precision, boolean)
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.credit_balance(uuid, double precision)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.debit_balance(uuid, double precision, boolean)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.transfer_balance(uuid, uuid, double precision)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_marketplace_sale(uuid, uuid, uuid, double precision, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.escrow_bid(uuid, uuid, double precision, text, timestamp with time zone)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cancel_bid(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reject_bid(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.expire_old_bids()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.accept_bid(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.buy_now(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_payout_record(uuid, double precision, double precision, double precision, double precision, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_payout_refund(uuid, text)
  FROM PUBLIC, anon, authenticated;

GRANT ALL ON FUNCTION public.record_light_ledger_entry(uuid, uuid, uuid, text, text, double precision, text, uuid, jsonb)
  TO service_role;
GRANT ALL ON FUNCTION public.debit_spendable_light(uuid, double precision, boolean)
  TO service_role;
GRANT ALL ON FUNCTION public.credit_balance(uuid, double precision)
  TO service_role;
GRANT ALL ON FUNCTION public.debit_balance(uuid, double precision, boolean)
  TO service_role;
GRANT ALL ON FUNCTION public.transfer_balance(uuid, uuid, double precision)
  TO service_role;
GRANT ALL ON FUNCTION public.complete_marketplace_sale(uuid, uuid, uuid, double precision, uuid, text, text)
  TO service_role;
GRANT ALL ON FUNCTION public.escrow_bid(uuid, uuid, double precision, text, timestamp with time zone)
  TO service_role;
GRANT ALL ON FUNCTION public.cancel_bid(uuid, uuid)
  TO service_role;
GRANT ALL ON FUNCTION public.reject_bid(uuid, uuid)
  TO service_role;
GRANT ALL ON FUNCTION public.expire_old_bids()
  TO service_role;
GRANT ALL ON FUNCTION public.accept_bid(uuid, uuid)
  TO service_role;
GRANT ALL ON FUNCTION public.buy_now(uuid, uuid)
  TO service_role;
GRANT ALL ON FUNCTION public.create_payout_record(uuid, double precision, double precision, double precision, double precision, integer)
  TO service_role;
GRANT ALL ON FUNCTION public.fail_payout_refund(uuid, text)
  TO service_role;
