-- Wave 1 marketplace ledger hardening.
-- Light is authoritative at the app resale boundary:
--   users.balance_light = spendable Light
--   users.escrow_light  = Light reserved for active marketplace bids
--   total holdings      = balance_light + escrow_light

ALTER TABLE public.app_listings
  ADD COLUMN IF NOT EXISTS ask_price_light double precision,
  ADD COLUMN IF NOT EXISTS floor_price_light double precision,
  ADD COLUMN IF NOT EXISTS show_metrics boolean NOT NULL DEFAULT false;

UPDATE public.app_listings
SET
  ask_price_light = COALESCE(ask_price_light, ask_price_cents::double precision),
  floor_price_light = COALESCE(floor_price_light, floor_price_cents::double precision),
  show_metrics = COALESCE(show_metrics, false);

UPDATE public.app_bids
SET amount_light = COALESCE(amount_light, amount_cents::double precision)
WHERE amount_light IS NULL;

UPDATE public.app_sales
SET
  sale_price_light = COALESCE(sale_price_light, sale_price_cents::double precision),
  platform_fee_light = COALESCE(platform_fee_light, platform_fee_cents::double precision),
  seller_payout_light = COALESCE(seller_payout_light, seller_payout_cents::double precision)
WHERE sale_price_light IS NULL
   OR platform_fee_light IS NULL
   OR seller_payout_light IS NULL;

UPDATE public.payouts
SET amount_light = COALESCE(amount_light, amount_cents::double precision)
WHERE amount_light IS NULL;

UPDATE public.transfers
SET amount_light = COALESCE(amount_light, amount_cents::double precision)
WHERE amount_light IS NULL;

UPDATE public.users
SET
  balance_light = COALESCE(balance_light, 0),
  escrow_light = COALESCE(escrow_light, 0),
  total_earned_light = COALESCE(total_earned_light, 0);

ALTER TABLE public.users
  ALTER COLUMN balance_light SET DEFAULT 0,
  ALTER COLUMN balance_light SET NOT NULL,
  ALTER COLUMN escrow_light SET DEFAULT 0,
  ALTER COLUMN escrow_light SET NOT NULL,
  ALTER COLUMN total_earned_light SET DEFAULT 0,
  ALTER COLUMN total_earned_light SET NOT NULL;

ALTER TABLE public.app_bids
  ALTER COLUMN amount_light SET NOT NULL;

ALTER TABLE public.app_sales
  ALTER COLUMN sale_price_light SET NOT NULL,
  ALTER COLUMN platform_fee_light SET NOT NULL,
  ALTER COLUMN seller_payout_light SET NOT NULL;

ALTER TABLE public.payouts
  ALTER COLUMN amount_light SET NOT NULL;

ALTER TABLE public.transfers
  ALTER COLUMN amount_light SET NOT NULL;

ALTER TABLE public.app_bids
  DROP CONSTRAINT IF EXISTS app_bids_amount_light_check;
ALTER TABLE public.app_bids
  ADD CONSTRAINT app_bids_amount_light_check CHECK (amount_light > 0);

ALTER TABLE public.app_listings
  DROP CONSTRAINT IF EXISTS app_listings_light_prices_check;
ALTER TABLE public.app_listings
  ADD CONSTRAINT app_listings_light_prices_check CHECK (
    (ask_price_light IS NULL OR ask_price_light > 0)
    AND (floor_price_light IS NULL OR floor_price_light >= 0)
    AND (
      ask_price_light IS NULL
      OR floor_price_light IS NULL
      OR floor_price_light <= ask_price_light
    )
  );

ALTER TABLE public.app_sales
  DROP CONSTRAINT IF EXISTS app_sales_light_amounts_check;
ALTER TABLE public.app_sales
  ADD CONSTRAINT app_sales_light_amounts_check CHECK (
    sale_price_light > 0
    AND platform_fee_light >= 0
    AND seller_payout_light >= 0
  );

ALTER TABLE public.payouts
  DROP CONSTRAINT IF EXISTS payouts_amount_light_check;
ALTER TABLE public.payouts
  ADD CONSTRAINT payouts_amount_light_check CHECK (amount_light > 0);

ALTER TABLE public.transfers
  DROP CONSTRAINT IF EXISTS transfers_amount_light_check;
ALTER TABLE public.transfers
  ADD CONSTRAINT transfers_amount_light_check CHECK (amount_light >= 0);

ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_balance_light_nonnegative,
  DROP CONSTRAINT IF EXISTS users_escrow_light_nonnegative,
  DROP CONSTRAINT IF EXISTS users_total_earned_light_nonnegative;
ALTER TABLE public.users
  ADD CONSTRAINT users_balance_light_nonnegative CHECK (balance_light >= 0),
  ADD CONSTRAINT users_escrow_light_nonnegative CHECK (escrow_light >= 0),
  ADD CONSTRAINT users_total_earned_light_nonnegative CHECK (total_earned_light >= 0);

CREATE INDEX IF NOT EXISTS idx_bids_app_light
  ON public.app_bids USING btree (app_id, status, amount_light DESC);

CREATE INDEX IF NOT EXISTS idx_listings_status_light
  ON public.app_listings USING btree (status, ask_price_light);

COMMENT ON COLUMN public.users.balance_light IS
  'Spendable Light. Reserved marketplace bid funds live in escrow_light; total holdings are balance_light + escrow_light.';

COMMENT ON COLUMN public.users.escrow_light IS
  'Light reserved for active marketplace bids. Bid cancellation/rejection returns this to balance_light; accepted sales release it.';

COMMENT ON COLUMN public.app_listings.show_metrics IS
  'When true, marketplace listing viewers can see public usage/revenue metrics for the app.';

CREATE OR REPLACE FUNCTION public.sync_app_bid_light_amounts()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public, extensions'
AS $$
BEGIN
  IF NEW.amount_light IS NULL AND NEW.amount_cents IS NOT NULL THEN
    NEW.amount_light := NEW.amount_cents::double precision;
  END IF;

  IF NEW.amount_cents IS NULL AND NEW.amount_light IS NOT NULL THEN
    NEW.amount_cents := round(NEW.amount_light)::integer;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_app_bid_light_amounts ON public.app_bids;
CREATE TRIGGER sync_app_bid_light_amounts
BEFORE INSERT OR UPDATE OF amount_light, amount_cents ON public.app_bids
FOR EACH ROW EXECUTE FUNCTION public.sync_app_bid_light_amounts();

CREATE OR REPLACE FUNCTION public.sync_app_listing_light_amounts()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public, extensions'
AS $$
BEGIN
  IF NEW.ask_price_light IS NULL AND NEW.ask_price_cents IS NOT NULL THEN
    NEW.ask_price_light := NEW.ask_price_cents::double precision;
  END IF;
  IF NEW.ask_price_cents IS NULL AND NEW.ask_price_light IS NOT NULL THEN
    NEW.ask_price_cents := round(NEW.ask_price_light)::integer;
  END IF;

  IF NEW.floor_price_light IS NULL AND NEW.floor_price_cents IS NOT NULL THEN
    NEW.floor_price_light := NEW.floor_price_cents::double precision;
  END IF;
  IF NEW.floor_price_cents IS NULL AND NEW.floor_price_light IS NOT NULL THEN
    NEW.floor_price_cents := round(NEW.floor_price_light)::integer;
  END IF;

  NEW.show_metrics := COALESCE(NEW.show_metrics, false);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_app_listing_light_amounts ON public.app_listings;
CREATE TRIGGER sync_app_listing_light_amounts
BEFORE INSERT OR UPDATE OF ask_price_light, ask_price_cents, floor_price_light, floor_price_cents, show_metrics
ON public.app_listings
FOR EACH ROW EXECUTE FUNCTION public.sync_app_listing_light_amounts();

CREATE OR REPLACE FUNCTION public.sync_app_sale_light_amounts()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public, extensions'
AS $$
BEGIN
  IF NEW.sale_price_light IS NULL AND NEW.sale_price_cents IS NOT NULL THEN
    NEW.sale_price_light := NEW.sale_price_cents::double precision;
  END IF;
  IF NEW.sale_price_cents IS NULL AND NEW.sale_price_light IS NOT NULL THEN
    NEW.sale_price_cents := round(NEW.sale_price_light)::integer;
  END IF;

  IF NEW.platform_fee_light IS NULL AND NEW.platform_fee_cents IS NOT NULL THEN
    NEW.platform_fee_light := NEW.platform_fee_cents::double precision;
  END IF;
  IF NEW.platform_fee_cents IS NULL AND NEW.platform_fee_light IS NOT NULL THEN
    NEW.platform_fee_cents := round(NEW.platform_fee_light)::integer;
  END IF;

  IF NEW.seller_payout_light IS NULL AND NEW.seller_payout_cents IS NOT NULL THEN
    NEW.seller_payout_light := NEW.seller_payout_cents::double precision;
  END IF;
  IF NEW.seller_payout_cents IS NULL AND NEW.seller_payout_light IS NOT NULL THEN
    NEW.seller_payout_cents := round(NEW.seller_payout_light)::integer;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_app_sale_light_amounts ON public.app_sales;
CREATE TRIGGER sync_app_sale_light_amounts
BEFORE INSERT OR UPDATE OF
  sale_price_light, sale_price_cents,
  platform_fee_light, platform_fee_cents,
  seller_payout_light, seller_payout_cents
ON public.app_sales
FOR EACH ROW EXECUTE FUNCTION public.sync_app_sale_light_amounts();

CREATE OR REPLACE FUNCTION public.sync_payout_light_amounts()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public, extensions'
AS $$
BEGIN
  IF NEW.amount_light IS NULL AND NEW.amount_cents IS NOT NULL THEN
    NEW.amount_light := NEW.amount_cents::double precision;
  END IF;
  IF NEW.amount_cents IS NULL AND NEW.amount_light IS NOT NULL THEN
    NEW.amount_cents := round(NEW.amount_light)::double precision;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_payout_light_amounts ON public.payouts;
CREATE TRIGGER sync_payout_light_amounts
BEFORE INSERT OR UPDATE OF amount_light, amount_cents ON public.payouts
FOR EACH ROW EXECUTE FUNCTION public.sync_payout_light_amounts();

CREATE OR REPLACE FUNCTION public.sync_transfer_light_amounts()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public, extensions'
AS $$
BEGIN
  IF NEW.amount_light IS NULL AND NEW.amount_cents IS NOT NULL THEN
    NEW.amount_light := NEW.amount_cents::double precision;
  END IF;
  IF NEW.amount_cents IS NULL AND NEW.amount_light IS NOT NULL THEN
    NEW.amount_cents := round(NEW.amount_light)::double precision;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_transfer_light_amounts ON public.transfers;
CREATE TRIGGER sync_transfer_light_amounts
BEFORE INSERT OR UPDATE OF amount_light, amount_cents ON public.transfers
FOR EACH ROW EXECUTE FUNCTION public.sync_transfer_light_amounts();

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
  v_fee double precision;
  v_payout double precision;
  v_sale_id uuid;
  v_slug_exists boolean;
  v_new_slug text;
  v_other_bid RECORD;
  v_provenance jsonb;
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

  v_fee := p_sale_price_light * 0.10;
  v_payout := p_sale_price_light - v_fee;

  IF p_debit_source = 'escrow' THEN
    UPDATE public.users
    SET escrow_light = escrow_light - p_sale_price_light
    WHERE id = p_buyer_id
      AND escrow_light >= p_sale_price_light;
  ELSE
    UPDATE public.users
    SET balance_light = balance_light - p_sale_price_light
    WHERE id = p_buyer_id
      AND balance_light >= p_sale_price_light;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Insufficient balance or escrow for purchase';
  END IF;

  UPDATE public.users
  SET
    balance_light = balance_light + v_payout,
    total_earned_light = total_earned_light + v_payout
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
    UPDATE public.users
    SET
      balance_light = balance_light + v_other_bid.amount_light,
      escrow_light = escrow_light - v_other_bid.amount_light
    WHERE id = v_other_bid.bidder_id
      AND escrow_light >= v_other_bid.amount_light;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Escrow invariant violation while refunding competing bid %', v_other_bid.id;
    END IF;

    UPDATE public.app_bids
    SET status = 'rejected',
        escrow_status = 'refunded',
        resolved_at = now()
    WHERE id = v_other_bid.id;
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

REVOKE ALL ON FUNCTION public.complete_marketplace_sale(
  uuid,
  uuid,
  uuid,
  double precision,
  uuid,
  text,
  text
) FROM PUBLIC, anon, authenticated, service_role;

DROP FUNCTION IF EXISTS public.escrow_bid(uuid, uuid, integer, text, timestamp with time zone);

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

  SELECT balance_light INTO v_available
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

  UPDATE public.users
  SET
    balance_light = balance_light - p_amount_light,
    escrow_light = escrow_light + p_amount_light
  WHERE id = p_bidder_id
    AND balance_light >= p_amount_light;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Insufficient balance. Available: % Light', v_available;
  END IF;

  INSERT INTO public.app_bids (
    app_id,
    bidder_id,
    amount_cents,
    amount_light,
    message,
    expires_at
  )
  VALUES (
    p_app_id,
    p_bidder_id,
    round(p_amount_light)::integer,
    p_amount_light,
    p_message,
    p_expires_at
  )
  RETURNING id INTO v_bid_id;

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

  UPDATE public.users
  SET
    balance_light = balance_light + v_bid.amount_light,
    escrow_light = escrow_light - v_bid.amount_light
  WHERE id = p_bidder_id
    AND escrow_light >= v_bid.amount_light;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Escrow invariant violation while cancelling bid';
  END IF;

  UPDATE public.app_bids
  SET status = 'cancelled',
      escrow_status = 'refunded',
      resolved_at = now()
  WHERE id = p_bid_id;
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

  UPDATE public.users
  SET
    balance_light = balance_light + v_bid.amount_light,
    escrow_light = escrow_light - v_bid.amount_light
  WHERE id = v_bid.bidder_id
    AND escrow_light >= v_bid.amount_light;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Escrow invariant violation while rejecting bid';
  END IF;

  UPDATE public.app_bids
  SET status = 'rejected',
      escrow_status = 'refunded',
      resolved_at = now()
  WHERE id = p_bid_id;
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
BEGIN
  FOR v_expired IN
    SELECT *
    FROM public.app_bids
    WHERE status = 'active'
      AND expires_at IS NOT NULL
      AND expires_at < now()
    FOR UPDATE
  LOOP
    UPDATE public.users
    SET
      balance_light = balance_light + v_expired.amount_light,
      escrow_light = escrow_light - v_expired.amount_light
    WHERE id = v_expired.bidder_id
      AND escrow_light >= v_expired.amount_light;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Escrow invariant violation while expiring bid %', v_expired.id;
    END IF;

    UPDATE public.app_bids
    SET status = 'expired',
        escrow_status = 'refunded',
        resolved_at = now()
    WHERE id = v_expired.id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
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
  p_net_cents double precision
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
    release_at
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
    now() + interval '14 days'
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
  SET balance_light = balance_light + v_payout.amount_light
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
END;
$$;

GRANT ALL ON FUNCTION public.escrow_bid(uuid, uuid, double precision, text, timestamp with time zone)
  TO anon, authenticated, service_role;
GRANT ALL ON FUNCTION public.cancel_bid(uuid, uuid)
  TO anon, authenticated, service_role;
GRANT ALL ON FUNCTION public.reject_bid(uuid, uuid)
  TO anon, authenticated, service_role;
GRANT ALL ON FUNCTION public.expire_old_bids()
  TO anon, authenticated, service_role;
GRANT ALL ON FUNCTION public.accept_bid(uuid, uuid)
  TO anon, authenticated, service_role;
GRANT ALL ON FUNCTION public.buy_now(uuid, uuid)
  TO anon, authenticated, service_role;
GRANT ALL ON FUNCTION public.create_payout_record(uuid, double precision, double precision, double precision)
  TO anon, authenticated, service_role;
GRANT ALL ON FUNCTION public.fail_payout_refund(uuid, text)
  TO anon, authenticated, service_role;
