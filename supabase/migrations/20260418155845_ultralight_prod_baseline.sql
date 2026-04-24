


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "vector" WITH SCHEMA "public";






CREATE OR REPLACE FUNCTION "public"."accept_bid"("p_owner_id" "uuid", "p_bid_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public, extensions'
    AS $$
DECLARE
  v_bid RECORD;
  v_app RECORD;
  v_seller_email TEXT;
  v_fee FLOAT;
  v_payout FLOAT;
  v_sale_id UUID;
  v_slug_exists BOOLEAN;
  v_new_slug TEXT;
  v_other_bid RECORD;
  v_provenance JSONB;
BEGIN
  -- Lock and fetch the bid
  SELECT * INTO v_bid FROM public.app_bids WHERE id = p_bid_id AND status = 'active' FOR UPDATE;
  IF v_bid IS NULL THEN
    RAISE EXCEPTION 'Bid not found or not active';
  END IF;

  -- Fetch the app
  SELECT * INTO v_app FROM public.apps WHERE id = v_bid.app_id FOR UPDATE;
  IF v_app IS NULL THEN
    RAISE EXCEPTION 'App not found';
  END IF;

  -- Verify caller is the owner
  IF v_app.owner_id != p_owner_id THEN
    RAISE EXCEPTION 'Only the app owner can accept bids';
  END IF;

  -- Get seller email for provenance
  SELECT email INTO v_seller_email FROM public.users WHERE id = p_owner_id;

  -- Calculate fee (10%) and payout (90%)
  v_fee := v_bid.amount_light * 0.10;
  v_payout := v_bid.amount_light - v_fee;

  -- 1. Release buyer escrow
  UPDATE public.users
  SET escrow_light = escrow_light - v_bid.amount_light
  WHERE id = v_bid.bidder_id;

  -- 2. Credit seller 90% + track earnings
  UPDATE public.users
  SET balance_light = balance_light + v_payout,
      total_earned_light = total_earned_light + v_payout
  WHERE id = p_owner_id;

  -- 3. Transfer ownership — handle slug conflict
  SELECT EXISTS(
    SELECT 1 FROM public.apps
    WHERE owner_id = v_bid.bidder_id AND slug = v_app.slug AND id != v_app.id
  ) INTO v_slug_exists;

  IF v_slug_exists THEN
    v_new_slug := v_app.slug || '-acquired';
    WHILE EXISTS(SELECT 1 FROM public.apps WHERE owner_id = v_bid.bidder_id AND slug = v_new_slug AND id != v_app.id) LOOP
      v_new_slug := v_new_slug || '-' || substr(extensions.gen_random_uuid()::text, 1, 4);
    END LOOP;
    UPDATE public.apps SET owner_id = v_bid.bidder_id, slug = v_new_slug, updated_at = now() WHERE id = v_app.id;
  ELSE
    UPDATE public.apps SET owner_id = v_bid.bidder_id, updated_at = now() WHERE id = v_app.id;
  END IF;

  -- 4. Clear permissions (seller's grants shouldn't carry over)
  DELETE FROM public.user_app_permissions WHERE app_id = v_app.id;

  -- 5. Clear secrets (seller's env vars shouldn't transfer)
  DELETE FROM public.user_app_secrets WHERE app_id = v_app.id;

  -- 6. Update the accepted bid
  UPDATE public.app_bids
  SET status = 'accepted', escrow_status = 'released', resolved_at = now()
  WHERE id = p_bid_id;

  -- 7. Reject + refund all other active bids on this app
  FOR v_other_bid IN
    SELECT * FROM public.app_bids
    WHERE app_id = v_app.id AND status = 'active' AND id != p_bid_id
    FOR UPDATE
  LOOP
    UPDATE public.users
    SET balance_light = balance_light + v_other_bid.amount_light,
        escrow_light = escrow_light - v_other_bid.amount_light
    WHERE id = v_other_bid.bidder_id;

    UPDATE public.app_bids
    SET status = 'rejected', escrow_status = 'refunded', resolved_at = now()
    WHERE id = v_other_bid.id;
  END LOOP;

  -- 8. Update listing provenance and owner
  SELECT COALESCE(provenance, '[]'::JSONB) INTO v_provenance
  FROM public.app_listings WHERE app_id = v_app.id;

  v_provenance := v_provenance || jsonb_build_object(
    'owner_id', p_owner_id,
    'email', v_seller_email,
    'acquired_at', now(),
    'price_light', v_bid.amount_light,
    'method', 'marketplace_sale'
  );

  UPDATE public.app_listings
  SET owner_id = v_bid.bidder_id,
      status = 'sold',
      provenance = v_provenance,
      updated_at = now()
  WHERE app_id = v_app.id;

  -- 9. Insert sale record
  INSERT INTO public.app_sales (app_id, seller_id, buyer_id, sale_price_light, platform_fee_light, seller_payout_light, bid_id)
  VALUES (v_app.id, p_owner_id, v_bid.bidder_id, v_bid.amount_light, v_fee, v_payout, p_bid_id)
  RETURNING id INTO v_sale_id;

  -- 10. Log transfer
  INSERT INTO public.transfers (from_user_id, to_user_id, amount_light, reason, app_id)
  VALUES (v_bid.bidder_id, p_owner_id, v_payout, 'marketplace_sale', v_app.id);

  RETURN jsonb_build_object(
    'sale_id', v_sale_id,
    'app_id', v_app.id,
    'seller_id', p_owner_id,
    'buyer_id', v_bid.bidder_id,
    'sale_price_light', v_bid.amount_light,
    'platform_fee_light', v_fee,
    'seller_payout_light', v_payout
  );
END;
$$;


ALTER FUNCTION "public"."accept_bid"("p_owner_id" "uuid", "p_bid_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."adjust_data_storage"("p_user_id" "uuid", "p_delta_bytes" bigint) RETURNS TABLE("new_bytes" bigint, "combined_bytes" bigint, "storage_limit" bigint, "over_limit" boolean)
    LANGUAGE "sql"
    SET "search_path" TO 'public, extensions'
    AS $$
  UPDATE public.users
  SET data_storage_used_bytes = GREATEST(0::BIGINT, data_storage_used_bytes + p_delta_bytes),
      updated_at = NOW()
  WHERE id = p_user_id
  RETURNING
    data_storage_used_bytes AS new_bytes,
    (storage_used_bytes + data_storage_used_bytes) AS combined_bytes,
    storage_limit_bytes AS storage_limit,
    ((storage_used_bytes + data_storage_used_bytes) > storage_limit_bytes) AS over_limit;
$$;


ALTER FUNCTION "public"."adjust_data_storage"("p_user_id" "uuid", "p_delta_bytes" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cancel_bid"("p_bidder_id" "uuid", "p_bid_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public, extensions'
    AS $$
DECLARE
  v_bid RECORD;
BEGIN
  SELECT * INTO v_bid FROM public.app_bids WHERE id = p_bid_id AND status = 'active' FOR UPDATE;
  IF v_bid IS NULL THEN
    RAISE EXCEPTION 'Bid not found or not active';
  END IF;

  IF v_bid.bidder_id != p_bidder_id THEN
    RAISE EXCEPTION 'Only the bidder can cancel their own bid';
  END IF;

  -- Refund escrow
  UPDATE public.users
  SET hosting_balance_cents = hosting_balance_cents + v_bid.amount_cents,
      escrow_held_cents = escrow_held_cents - v_bid.amount_cents
  WHERE id = p_bidder_id;

  -- Mark cancelled
  UPDATE public.app_bids
  SET status = 'cancelled', escrow_status = 'refunded', resolved_at = now()
  WHERE id = p_bid_id;
END;
$$;


ALTER FUNCTION "public"."cancel_bid"("p_bidder_id" "uuid", "p_bid_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_d1_free_tier"("p_user_id" "uuid") RETURNS TABLE("within_free_tier" boolean, "rows_read_total" bigint, "rows_written_total" bigint, "storage_bytes" bigint)
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public, extensions'
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    (u.d1_rows_read_total < 50000 AND u.d1_rows_written_total < 10000 AND u.d1_storage_bytes < 52428800) AS within_free_tier,
    u.d1_rows_read_total,
    u.d1_rows_written_total,
    u.d1_storage_bytes
  FROM public.users u
  WHERE u.id = p_user_id;
END;
$$;


ALTER FUNCTION "public"."check_d1_free_tier"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_data_storage_quota"("p_user_id" "uuid", "p_additional_bytes" bigint) RETURNS TABLE("allowed" boolean, "source_used_bytes" bigint, "data_used_bytes" bigint, "combined_used_bytes" bigint, "limit_bytes" bigint, "remaining_bytes" bigint, "has_hosting_balance" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public, extensions'
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    ((u.storage_used_bytes + u.data_storage_used_bytes + p_additional_bytes) <= u.storage_limit_bytes
     OR u.hosting_balance_cents > 0) AS allowed,
    u.storage_used_bytes AS source_used_bytes,
    u.data_storage_used_bytes AS data_used_bytes,
    (u.storage_used_bytes + u.data_storage_used_bytes) AS combined_used_bytes,
    u.storage_limit_bytes AS limit_bytes,
    GREATEST(0::BIGINT, u.storage_limit_bytes - u.storage_used_bytes - u.data_storage_used_bytes) AS remaining_bytes,
    (u.hosting_balance_cents > 0) AS has_hosting_balance
  FROM public.users u
  WHERE u.id = p_user_id;
END;
$$;


ALTER FUNCTION "public"."check_data_storage_quota"("p_user_id" "uuid", "p_additional_bytes" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_http_rate_limit"("p_app_id" "uuid", "p_window_minutes" integer DEFAULT 1) RETURNS TABLE("allowed" boolean, "current_count" integer, "limit_count" integer, "reset_at" timestamp with time zone)
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public, extensions'
    AS $$
DECLARE
    v_limit INTEGER;
    v_count INTEGER;
    v_window_start TIMESTAMPTZ;
BEGIN
    -- Get app's rate limit
    SELECT COALESCE(http_rate_limit, 1000) INTO v_limit
    FROM public.apps WHERE id = p_app_id;

    -- Calculate window start
    v_window_start := NOW() - (p_window_minutes || ' minutes')::INTERVAL;

    -- Count requests in window
    SELECT COUNT(*) INTO v_count
    FROM public.http_requests
    WHERE app_id = p_app_id AND created_at >= v_window_start;

    RETURN QUERY SELECT
        v_count < v_limit AS allowed,
        v_count AS current_count,
        v_limit AS limit_count,
        v_window_start + (p_window_minutes || ' minutes')::INTERVAL AS reset_at;
END;
$$;


ALTER FUNCTION "public"."check_http_rate_limit"("p_app_id" "uuid", "p_window_minutes" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_rate_limit"("p_user_id" "uuid", "p_endpoint" "text", "p_limit" integer DEFAULT 100, "p_window_minutes" integer DEFAULT 1) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public, extensions'
    AS $$
DECLARE
  v_window_start TIMESTAMPTZ;
  v_count INTEGER;
BEGIN
  -- Truncate to minute boundary for windowing
  v_window_start := date_trunc('minute', NOW());

  -- Upsert rate limit entry and get count
  INSERT INTO public.rate_limits (user_id, endpoint, window_start, request_count)
  VALUES (p_user_id, p_endpoint, v_window_start, 1)
  ON CONFLICT (user_id, endpoint, window_start)
  DO UPDATE SET request_count = public.rate_limits.request_count + 1
  RETURNING request_count INTO v_count;

  -- Return true if under limit
  RETURN v_count <= p_limit;
END;
$$;


ALTER FUNCTION "public"."check_rate_limit"("p_user_id" "uuid", "p_endpoint" "text", "p_limit" integer, "p_window_minutes" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_seller_relist"("p_uploader_id" "uuid", "p_fingerprint" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public, extensions'
    AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.app_code_fingerprints
    WHERE seller_id = p_uploader_id
      AND fingerprint = p_fingerprint
  );
END;
$$;


ALTER FUNCTION "public"."check_seller_relist"("p_uploader_id" "uuid", "p_fingerprint" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cleanup_expired_provisionals"() RETURNS integer
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public, extensions'
    AS $$
DECLARE deleted_count INT;
BEGIN
  DELETE FROM public.users
  WHERE provisional = TRUE
    AND last_active_at < NOW() - INTERVAL '30 days';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;


ALTER FUNCTION "public"."cleanup_expired_provisionals"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cleanup_http_requests"() RETURNS integer
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public, extensions'
    AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM public.http_requests
    WHERE created_at < NOW() - INTERVAL '24 hours';

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$;


ALTER FUNCTION "public"."cleanup_http_requests"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cleanup_rate_limits"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public, extensions'
    AS $$
BEGIN
  DELETE FROM public.rate_limits WHERE window_start < NOW() - INTERVAL '1 hour';
END;
$$;


ALTER FUNCTION "public"."cleanup_rate_limits"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cleanup_stale_oauth_clients"() RETURNS integer
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public, extensions'
    AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM public.oauth_clients
    WHERE created_at < NOW() - INTERVAL '30 days'
      AND is_developer_app = FALSE;
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$;


ALTER FUNCTION "public"."cleanup_stale_oauth_clients"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compute_quality_scores"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public, extensions'
    AS $$
BEGIN
  UPDATE public.apps
  SET quality_score = ROUND((
    -- 40%: Success rate (with Wilson-like smoothing)
    CASE
      WHEN (calls_success_30d + calls_error_30d) >= 5
      THEN 0.4 * (calls_success_30d::FLOAT / (calls_success_30d + calls_error_30d))
      WHEN (calls_success_30d + calls_error_30d) > 0
      THEN 0.4 * ((calls_success_30d::FLOAT + 1) / (calls_success_30d + calls_error_30d + 2))  -- Laplace smoothing for small samples
      ELSE 0.4 * 0.5  -- neutral prior when no data
    END
    -- 30%: Like ratio
    + 0.3 * (COALESCE(weighted_likes, 0)::FLOAT / (COALESCE(weighted_likes, 0) + COALESCE(weighted_dislikes, 0) + 1))
    -- 20%: Usage volume (log-scaled, capped at 1.0)
    + 0.2 * LEAST(LN(COALESCE(calls_success_30d, 0) + 1) / 7.0, 1.0)  -- ~1100 calls/30d = 1.0
    -- 10%: Discovery traction (log-scaled, capped at 1.0)
    + 0.1 * LEAST(LN(COALESCE(impressions_7d, 0) + 1) / 5.0, 1.0)  -- ~150 impressions/7d = 1.0
  )::NUMERIC, 4)
  WHERE visibility = 'public' AND deleted_at IS NULL;
END;
$$;


ALTER FUNCTION "public"."compute_quality_scores"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."count_provisional_by_ip"("p_ip" "text", "p_window_hours" integer DEFAULT 24) RETURNS integer
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public, extensions'
    AS $$
DECLARE cnt INT;
BEGIN
  SELECT COUNT(*)::INT INTO cnt
  FROM public.users
  WHERE provisional = TRUE
    AND provisional_created_ip = p_ip
    AND provisional_created_at >= NOW() - make_interval(hours => p_window_hours);
  RETURN cnt;
END;
$$;


ALTER FUNCTION "public"."count_provisional_by_ip"("p_ip" "text", "p_window_hours" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_payout_record"("p_user_id" "uuid", "p_amount_light" double precision, "p_stripe_fee_cents" double precision, "p_net_cents" double precision) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public, extensions'
    AS $$
DECLARE
  v_payout_id UUID;
  v_available FLOAT;
  v_total_earned FLOAT;
  v_total_withdrawn FLOAT;
  v_withdrawable FLOAT;
BEGIN
  -- Lock the user row and check available balance (balance minus escrow)
  SELECT balance_light - COALESCE(escrow_light, 0),
         COALESCE(total_earned_light, 0)
  INTO v_available, v_total_earned
  FROM public.users WHERE id = p_user_id FOR UPDATE;

  IF v_available IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  IF v_available < p_amount_light THEN
    RAISE EXCEPTION 'Insufficient available balance. Available: % Light, requested: %', v_available, p_amount_light;
  END IF;

  -- Check earnings-only withdrawal constraint
  SELECT COALESCE(SUM(amount_light), 0) INTO v_total_withdrawn
  FROM public.payouts
  WHERE user_id = p_user_id AND status IN ('held', 'pending', 'processing', 'paid');

  v_withdrawable := v_total_earned - v_total_withdrawn;

  IF v_withdrawable < p_amount_light THEN
    RAISE EXCEPTION 'Withdrawal exceeds earnings. Only earned funds can be withdrawn. Withdrawable: % Light, requested: %', v_withdrawable, p_amount_light;
  END IF;

  -- Debit the balance (no platform fee on withdrawal — fee is per-transaction)
  UPDATE public.users
  SET balance_light = balance_light - p_amount_light
  WHERE id = p_user_id;

  -- Insert payout record with 14-day hold
  INSERT INTO public.payouts (
    user_id, amount_light, stripe_fee_cents, net_cents,
    platform_fee_light, status, release_at
  )
  VALUES (
    p_user_id, p_amount_light, p_stripe_fee_cents, p_net_cents,
    0, 'held', now() + interval '14 days'
  )
  RETURNING id INTO v_payout_id;

  -- Log the withdrawal transfer for audit trail
  INSERT INTO public.transfers (id, from_user_id, to_user_id, amount_light, reason, created_at)
  VALUES (extensions.gen_random_uuid(), p_user_id, p_user_id, p_amount_light, 'withdrawal', now());

  RETURN v_payout_id;
END;
$$;


ALTER FUNCTION "public"."create_payout_record"("p_user_id" "uuid", "p_amount_light" double precision, "p_stripe_fee_cents" double precision, "p_net_cents" double precision) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."credit_balance"("p_user_id" "uuid", "p_amount_light" double precision) RETURNS TABLE("old_balance" double precision, "new_balance" double precision)
    LANGUAGE "sql"
    SET "search_path" TO 'public, extensions'
    AS $$
  WITH old AS (
    SELECT balance_light FROM public.users WHERE id = p_user_id
  )
  UPDATE public.users
  SET balance_light = balance_light + p_amount_light
  WHERE id = p_user_id
  RETURNING
    (SELECT balance_light FROM old) AS old_balance,
    balance_light AS new_balance;
$$;


ALTER FUNCTION "public"."credit_balance"("p_user_id" "uuid", "p_amount_light" double precision) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."debit_balance"("p_user_id" "uuid", "p_amount" double precision, "p_update_billed_at" boolean DEFAULT true) RETURNS TABLE("old_balance" double precision, "new_balance" double precision, "was_depleted" boolean)
    LANGUAGE "sql"
    SET "search_path" TO 'public, extensions'
    AS $$
  WITH old AS (
    SELECT balance_light FROM public.users WHERE id = p_user_id
  )
  UPDATE public.users
  SET
    balance_light = GREATEST(balance_light - p_amount, 0),
    hosting_last_billed_at = CASE WHEN p_update_billed_at THEN NOW() ELSE hosting_last_billed_at END
  WHERE id = p_user_id
  RETURNING
    (SELECT balance_light FROM old) AS old_balance,
    balance_light AS new_balance,
    (balance_light <= 0) AS was_depleted;
$$;


ALTER FUNCTION "public"."debit_balance"("p_user_id" "uuid", "p_amount" double precision, "p_update_billed_at" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ensure_user_exists"("user_id" "uuid", "user_email" "text", "user_display_name" "text" DEFAULT NULL::"text", "user_avatar_url" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public, extensions'
    AS $$
BEGIN
  INSERT INTO public.users (id, email, display_name, avatar_url)
  VALUES (user_id, user_email, COALESCE(user_display_name, split_part(user_email, '@', 1)), user_avatar_url)
  ON CONFLICT (id) DO NOTHING;
END;
$$;


ALTER FUNCTION "public"."ensure_user_exists"("user_id" "uuid", "user_email" "text", "user_display_name" "text", "user_avatar_url" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."escrow_bid"("p_bidder_id" "uuid", "p_app_id" "uuid", "p_amount_cents" integer, "p_message" "text" DEFAULT NULL::"text", "p_expires_at" timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public, extensions'
    AS $$
DECLARE
  v_bid_id UUID;
  v_app_owner UUID;
  v_available FLOAT;
  v_new_slug TEXT;
BEGIN
  -- Get app owner
  SELECT owner_id INTO v_app_owner FROM public.apps WHERE id = p_app_id;
  IF v_app_owner IS NULL THEN
    RAISE EXCEPTION 'App not found';
  END IF;

  -- Can't bid on own app
  IF v_app_owner = p_bidder_id THEN
    RAISE EXCEPTION 'Cannot bid on your own app';
  END IF;

  -- Check available balance (balance minus already escrowed funds)
  SELECT hosting_balance_cents - escrow_held_cents INTO v_available
  FROM public.users WHERE id = p_bidder_id FOR UPDATE;

  IF v_available IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  IF v_available < p_amount_cents THEN
    RAISE EXCEPTION 'Insufficient balance. Available: % cents', v_available;
  END IF;

  -- Check floor price if listing exists
  PERFORM 1 FROM public.app_listings
  WHERE app_id = p_app_id AND floor_price_cents IS NOT NULL AND p_amount_cents < floor_price_cents;
  IF FOUND THEN
    RAISE EXCEPTION 'Bid below floor price';
  END IF;

  -- Deduct balance and increase escrow
  UPDATE public.users
  SET hosting_balance_cents = hosting_balance_cents - p_amount_cents,
      escrow_held_cents = escrow_held_cents + p_amount_cents
  WHERE id = p_bidder_id;

  -- Insert the bid
  INSERT INTO public.app_bids (app_id, bidder_id, amount_cents, message, expires_at)
  VALUES (p_app_id, p_bidder_id, p_amount_cents, p_message, p_expires_at)
  RETURNING id INTO v_bid_id;

  -- Lazy-create listing if it doesn't exist
  INSERT INTO public.app_listings (app_id, owner_id)
  VALUES (p_app_id, v_app_owner)
  ON CONFLICT (app_id) DO NOTHING;

  RETURN v_bid_id;
END;
$$;


ALTER FUNCTION "public"."escrow_bid"("p_bidder_id" "uuid", "p_app_id" "uuid", "p_amount_cents" integer, "p_message" "text", "p_expires_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."expire_old_bids"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public, extensions'
    AS $$
DECLARE
  v_expired RECORD;
  v_count INT := 0;
BEGIN
  FOR v_expired IN
    SELECT * FROM public.app_bids
    WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at < now()
    FOR UPDATE
  LOOP
    -- Refund escrow
    UPDATE public.users
    SET hosting_balance_cents = hosting_balance_cents + v_expired.amount_cents,
        escrow_held_cents = escrow_held_cents - v_expired.amount_cents
    WHERE id = v_expired.bidder_id;

    UPDATE public.app_bids
    SET status = 'expired', escrow_status = 'refunded', resolved_at = now()
    WHERE id = v_expired.id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;


ALTER FUNCTION "public"."expire_old_bids"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fail_payout_refund"("p_payout_id" "uuid", "p_failure_reason" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public, extensions'
    AS $$
DECLARE
  v_payout RECORD;
BEGIN
  -- Lock the payout row
  SELECT * INTO v_payout FROM public.payouts WHERE id = p_payout_id FOR UPDATE;

  IF v_payout IS NULL THEN
    RAISE EXCEPTION 'Payout not found';
  END IF;

  IF v_payout.status NOT IN ('held', 'pending', 'processing') THEN
    RAISE EXCEPTION 'Payout already finalized with status: %', v_payout.status;
  END IF;

  -- Refund the full balance
  UPDATE public.users
  SET balance_light = balance_light + v_payout.amount_light
  WHERE id = v_payout.user_id;

  -- Mark payout as failed
  UPDATE public.payouts
  SET status = 'failed',
      failure_reason = p_failure_reason,
      completed_at = now()
  WHERE id = p_payout_id;

  -- Log refund transfer for audit trail
  INSERT INTO public.transfers (id, from_user_id, to_user_id, amount_light, reason, created_at)
  VALUES (extensions.gen_random_uuid(), v_payout.user_id, v_payout.user_id, v_payout.amount_light, 'withdrawal_refund', now());
END;
$$;


ALTER FUNCTION "public"."fail_payout_refund"("p_payout_id" "uuid", "p_failure_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_analytics_summary"("p_days" integer DEFAULT 30) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public, extensions'
    AS $$
DECLARE
  result JSONB;
  v_since TIMESTAMPTZ := now() - (p_days || ' days')::INTERVAL;
BEGIN
  SELECT jsonb_build_object(
    -- Provisionals
    'provisionals_created', (
      SELECT COUNT(*) FROM public.users
      WHERE provisional = TRUE AND provisional_created_at >= v_since
    ),
    'provisionals_active', (
      SELECT COUNT(*) FROM public.users
      WHERE provisional = TRUE
    ),
    -- Conversions
    'conversions_total', (
      SELECT COUNT(*) FROM public.conversion_events
      WHERE created_at >= v_since
    ),
    'conversions_by_method', (
      SELECT COALESCE(jsonb_object_agg(merge_method, cnt), '{}'::JSONB)
      FROM (
        SELECT merge_method, COUNT(*) as cnt
        FROM public.conversion_events
        WHERE created_at >= v_since
        GROUP BY merge_method
      ) sub
    ),
    'avg_time_to_convert_minutes', (
      SELECT COALESCE(AVG(time_to_convert_minutes), 0)::INT
      FROM public.conversion_events
      WHERE created_at >= v_since AND time_to_convert_minutes IS NOT NULL
    ),
    'avg_calls_before_convert', (
      SELECT COALESCE(AVG(calls_as_provisional), 0)::INT
      FROM public.conversion_events
      WHERE created_at >= v_since
    ),
    -- Onboarding funnel
    'template_fetches', (
      SELECT COUNT(*) FROM public.onboarding_requests
      WHERE created_at >= v_since
    ),
    'template_to_provisional_rate', (
      SELECT CASE
        WHEN COUNT(*) = 0 THEN 0
        ELSE ROUND(COUNT(*) FILTER (WHERE provisional_created = TRUE)::NUMERIC / COUNT(*)::NUMERIC * 100, 1)
      END
      FROM public.onboarding_requests
      WHERE created_at >= v_since
    ),
    -- App usage
    'top_apps', (
      SELECT COALESCE(jsonb_agg(row_to_json(sub)), '[]'::JSONB)
      FROM (
        SELECT app_name, app_id,
               COUNT(*) as calls,
               COUNT(DISTINCT user_id) as unique_users,
               COUNT(*) FILTER (WHERE success = TRUE) as successful_calls,
               ROUND(AVG(duration_ms)::NUMERIC, 0) as avg_duration_ms
        FROM public.mcp_call_logs
        WHERE created_at >= v_since AND app_id IS NOT NULL
        GROUP BY app_name, app_id
        ORDER BY calls DESC
        LIMIT 20
      ) sub
    ),
    -- Discovery demand
    'top_searches', (
      SELECT COALESCE(jsonb_agg(row_to_json(sub)), '[]'::JSONB)
      FROM (
        SELECT query, COUNT(*) as count,
               ROUND(AVG(top_similarity)::NUMERIC, 3) as avg_similarity,
               ROUND(AVG(result_count)::NUMERIC, 0) as avg_results
        FROM public.appstore_queries
        WHERE created_at >= v_since
        GROUP BY query
        ORDER BY count DESC
        LIMIT 20
      ) sub
    ),
    'unmet_demand', (
      SELECT COALESCE(jsonb_agg(row_to_json(sub)), '[]'::JSONB)
      FROM (
        SELECT query, COUNT(*) as count,
               ROUND(AVG(top_similarity)::NUMERIC, 3) as avg_similarity
        FROM public.appstore_queries
        WHERE created_at >= v_since
          AND (top_similarity < 0.5 OR result_count = 0)
        GROUP BY query
        ORDER BY count DESC
        LIMIT 15
      ) sub
    ),
    -- Error rates
    'error_rate_percent', (
      SELECT CASE
        WHEN COUNT(*) = 0 THEN 0
        ELSE ROUND(COUNT(*) FILTER (WHERE success = FALSE)::NUMERIC / COUNT(*)::NUMERIC * 100, 1)
      END
      FROM public.mcp_call_logs
      WHERE created_at >= v_since
    ),
    'total_calls', (
      SELECT COUNT(*) FROM public.mcp_call_logs
      WHERE created_at >= v_since
    ),
    'unique_users', (
      SELECT COUNT(DISTINCT user_id) FROM public.mcp_call_logs
      WHERE created_at >= v_since
    ),
    -- First app attribution (what public.apps do provisional public.users try first?)
    'first_app_distribution', (
      SELECT COALESCE(jsonb_agg(row_to_json(sub)), '[]'::JSONB)
      FROM (
        SELECT first_app_name, first_app_id, COUNT(*) as count
        FROM public.conversion_events
        WHERE created_at >= v_since AND first_app_id IS NOT NULL
        GROUP BY first_app_name, first_app_id
        ORDER BY count DESC
        LIMIT 10
      ) sub
    ),
    -- Period info
    'period_days', p_days,
    'generated_at', now()
  ) INTO result;

  RETURN result;
END;
$$;


ALTER FUNCTION "public"."get_analytics_summary"("p_days" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_app_granted_users"("p_app_id" "uuid") RETURNS TABLE("user_id" "uuid", "email" "text", "display_name" "text", "function_count" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public, extensions'
    AS $$
BEGIN
  RETURN QUERY
    SELECT DISTINCT
      u.id AS user_id,
      u.email,
      u.display_name,
      COUNT(uap.function_name) AS function_count
    FROM public.user_app_permissions uap
    JOIN public.users u ON u.id = uap.granted_to_user_id
    WHERE uap.app_id = p_app_id
      AND uap.allowed = true
    GROUP BY u.id, u.email, u.display_name
    ORDER BY u.email;
END;
$$;


ALTER FUNCTION "public"."get_app_granted_users"("p_app_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_leaderboard"("p_interval" "text" DEFAULT '30d'::"text", "p_limit" integer DEFAULT 20) RETURNS TABLE("user_id" "uuid", "display_name" "text", "profile_slug" "text", "avatar_url" "text", "country" "text", "earnings_cents" bigint, "featured_app_id" "uuid", "featured_app_name" "text", "featured_app_slug" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public, extensions'
    AS $$
DECLARE
  v_interval INTERVAL;
BEGIN
  -- Parse interval string (1d, 7d, 30d, 90d, 365d, at)
  CASE p_interval
    WHEN '1d'   THEN v_interval := INTERVAL '1 day';
    WHEN '7d'   THEN v_interval := INTERVAL '7 days';
    WHEN '30d'  THEN v_interval := INTERVAL '30 days';
    WHEN '90d'  THEN v_interval := INTERVAL '90 days';
    WHEN '365d' THEN v_interval := INTERVAL '365 days';
    WHEN 'at'   THEN v_interval := INTERVAL '100 years'; -- effectively all-time
    ELSE v_interval := INTERVAL '30 days';
  END CASE;

  RETURN QUERY
  WITH earnings AS (
    -- Revenue from tool calls and page views
    SELECT t.to_user_id AS uid, SUM(t.amount_cents)::BIGINT AS earned
    FROM public.transfers t
    WHERE t.reason IN ('tool_call', 'page_view')
      AND t.created_at >= NOW() - v_interval
    GROUP BY t.to_user_id

    UNION ALL

    -- Revenue from marketplace sales (seller payout)
    SELECT s.seller_id AS uid, SUM(s.seller_payout_cents)::BIGINT AS earned
    FROM public.app_sales s
    WHERE s.created_at >= NOW() - v_interval
    GROUP BY s.seller_id
  ),
  ranked AS (
    SELECT e.uid, SUM(e.earned)::BIGINT AS total_earned
    FROM earnings e
    GROUP BY e.uid
    HAVING SUM(e.earned) > 0
    ORDER BY total_earned DESC
    LIMIT p_limit
  )
  SELECT
    r.uid AS user_id,
    u.display_name,
    u.profile_slug,
    u.avatar_url,
    u.country,
    r.total_earned AS earnings_cents,
    u.featured_app_id,
    a.name AS featured_app_name,
    a.slug AS featured_app_slug
  FROM ranked r
  JOIN public.users u ON u.id = r.uid
  LEFT JOIN public.apps a ON a.id = u.featured_app_id AND a.deleted_at IS NULL
  ORDER BY r.total_earned DESC;
END;
$$;


ALTER FUNCTION "public"."get_leaderboard"("p_interval" "text", "p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_platform_stats"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public, extensions'
    AS $$
DECLARE
  v_gmv_30d BIGINT;
  v_gmv_prev BIGINT;
  v_acq_30d INT;
  v_acq_prev INT;
  v_capabilities INT;
  v_gmv_change_pct FLOAT;
  v_acq_change INT;
BEGIN
  -- GMV last 30 days (total sale prices)
  SELECT COALESCE(SUM(sale_price_cents), 0) INTO v_gmv_30d
  FROM public.app_sales WHERE created_at >= NOW() - INTERVAL '30 days';

  -- GMV previous 30 days (for change %)
  SELECT COALESCE(SUM(sale_price_cents), 0) INTO v_gmv_prev
  FROM public.app_sales WHERE created_at >= NOW() - INTERVAL '60 days'
    AND created_at < NOW() - INTERVAL '30 days';

  -- Acquisitions last 30 days
  SELECT COUNT(*) INTO v_acq_30d
  FROM public.app_sales WHERE created_at >= NOW() - INTERVAL '30 days';

  -- Acquisitions previous 30 days
  SELECT COUNT(*) INTO v_acq_prev
  FROM public.app_sales WHERE created_at >= NOW() - INTERVAL '60 days'
    AND created_at < NOW() - INTERVAL '30 days';

  -- Total public capabilities
  SELECT COUNT(*) INTO v_capabilities
  FROM public.apps WHERE visibility = 'public' AND deleted_at IS NULL;

  -- Calculate change percentage
  IF v_gmv_prev > 0 THEN
    v_gmv_change_pct := ROUND((((v_gmv_30d - v_gmv_prev)::NUMERIC / v_gmv_prev::NUMERIC) * 100), 1)::FLOAT;
  ELSE
    v_gmv_change_pct := 0;
  END IF;

  v_acq_change := v_acq_30d - v_acq_prev;

  RETURN jsonb_build_object(
    'gmv_30d_cents', v_gmv_30d,
    'gmv_change_pct', v_gmv_change_pct,
    'acquisitions_30d', v_acq_30d,
    'acquisitions_change', v_acq_change,
    'capabilities_listed', v_capabilities
  );
END;
$$;


ALTER FUNCTION "public"."get_platform_stats"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_releasable_payouts"() RETURNS TABLE("id" "uuid", "user_id" "uuid", "amount_light" double precision, "stripe_fee_cents" double precision, "net_cents" double precision, "platform_fee_light" double precision, "created_at" timestamp with time zone, "release_at" timestamp with time zone)
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public, extensions'
    AS $$
  SELECT id, user_id, amount_light, stripe_fee_cents, net_cents,
         COALESCE(platform_fee_light, 0) as platform_fee_light,
         created_at, release_at
  FROM public.payouts
  WHERE status = 'held'
    AND release_at <= now()
  ORDER BY release_at ASC
  LIMIT 50;
$$;


ALTER FUNCTION "public"."get_releasable_payouts"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_allowed_functions"("p_user_id" "uuid", "p_app_id" "uuid") RETURNS TABLE("function_name" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public, extensions'
    AS $$
BEGIN
  RETURN QUERY
    SELECT uap.function_name
    FROM public.user_app_permissions uap
    WHERE uap.granted_to_user_id = p_user_id
      AND uap.app_id = p_app_id
      AND uap.allowed = true;
END;
$$;


ALTER FUNCTION "public"."get_user_allowed_functions"("p_user_id" "uuid", "p_app_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_profile_stats"("p_user_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public, extensions'
    AS $$
DECLARE
  v_lifetime_gross BIGINT;
  v_published INT;
  v_acquired INT;
BEGIN
  -- Lifetime gross (total_earned_cents from public.users table)
  SELECT COALESCE(u.total_earned_cents, 0)::BIGINT INTO v_lifetime_gross
  FROM public.users u WHERE u.id = p_user_id;

  -- Published count
  SELECT COUNT(*) INTO v_published
  FROM public.apps WHERE owner_id = p_user_id AND visibility = 'public' AND deleted_at IS NULL;

  -- Acquired count (public.apps bought)
  SELECT COUNT(*) INTO v_acquired
  FROM public.app_sales WHERE buyer_id = p_user_id;

  RETURN jsonb_build_object(
    'lifetime_gross_cents', v_lifetime_gross,
    'published_count', v_published,
    'acquired_count', v_acquired
  );
END;
$$;


ALTER FUNCTION "public"."get_user_profile_stats"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_weekly_usage"("p_user_id" "uuid", "p_week_start" timestamp with time zone) RETURNS TABLE("call_count" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public, extensions'
    AS $$
BEGIN
  RETURN QUERY
    SELECT COALESCE(wcu.call_count, 0)
    FROM public.weekly_call_usage wcu
    WHERE wcu.user_id = p_user_id AND wcu.week_start = p_week_start;

  -- If no rows returned, return 0
  IF NOT FOUND THEN
    RETURN QUERY SELECT 0::BIGINT;
  END IF;
END;
$$;


ALTER FUNCTION "public"."get_weekly_usage"("p_user_id" "uuid", "p_week_start" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."increment_app_runs"("app_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public, extensions'
    AS $$
BEGIN
  UPDATE public.apps
  SET total_runs = COALESCE(total_runs, 0) + 1,
      runs_7d = COALESCE(runs_7d, 0) + 1,
      runs_30d = COALESCE(runs_30d, 0) + 1,
      updated_at = NOW()
  WHERE id = app_id;
END;
$$;


ALTER FUNCTION "public"."increment_app_runs"("app_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."increment_budget_used"("p_user_id" "uuid", "p_app_id" "uuid", "p_function_name" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public, extensions'
    AS $$
BEGIN
  UPDATE public.user_app_permissions
  SET budget_used = COALESCE(budget_used, 0) + 1,
      updated_at = NOW()
  WHERE granted_to_user_id = p_user_id
    AND app_id = p_app_id
    AND function_name = p_function_name;
END;
$$;


ALTER FUNCTION "public"."increment_budget_used"("p_user_id" "uuid", "p_app_id" "uuid", "p_function_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."increment_caller_usage"("p_app_id" "uuid", "p_user_id" "uuid", "p_counter_key" "text") RETURNS integer
    LANGUAGE "sql"
    SET "search_path" TO 'public, extensions'
    AS $$
  INSERT INTO public.app_caller_usage (app_id, user_id, counter_key, call_count, first_call_at, last_call_at)
  VALUES (p_app_id, p_user_id, p_counter_key, 1, NOW(), NOW())
  ON CONFLICT (app_id, user_id, counter_key)
  DO UPDATE SET
    call_count = public.app_caller_usage.call_count + 1,
    last_call_at = NOW()
  RETURNING call_count;
$$;


ALTER FUNCTION "public"."increment_caller_usage"("p_app_id" "uuid", "p_user_id" "uuid", "p_counter_key" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."increment_weekly_calls"("p_user_id" "uuid", "p_week_start" timestamp with time zone) RETURNS TABLE("current_count" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public, extensions'
    AS $$
BEGIN
  INSERT INTO public.weekly_call_usage (user_id, week_start, call_count)
  VALUES (p_user_id, p_week_start, 1)
  ON CONFLICT (user_id, week_start)
  DO UPDATE SET
    call_count = public.weekly_call_usage.call_count + 1,
    updated_at = NOW();

  RETURN QUERY
    SELECT wcu.call_count
    FROM public.weekly_call_usage wcu
    WHERE wcu.user_id = p_user_id AND wcu.week_start = p_week_start;
END;
$$;


ALTER FUNCTION "public"."increment_weekly_calls"("p_user_id" "uuid", "p_week_start" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_payout_releasing"("p_payout_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public, extensions'
    AS $$
DECLARE
  v_updated INT;
BEGIN
  UPDATE public.payouts
  SET status = 'pending'
  WHERE id = p_payout_id
    AND status = 'held';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;


ALTER FUNCTION "public"."mark_payout_releasing"("p_payout_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."merge_provisional_user"("p_provisional_id" "uuid", "p_real_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public, extensions'
    AS $$
DECLARE
  apps_moved INT;
  tokens_moved INT;
  storage_transferred BIGINT;
BEGIN
  -- Verify source is actually provisional
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_provisional_id AND provisional = TRUE) THEN
    RETURN jsonb_build_object('error', 'Source user is not provisional');
  END IF;

  -- Verify target is a real (non-provisional) user
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_real_id AND provisional = FALSE) THEN
    RETURN jsonb_build_object('error', 'Target user is not a real account');
  END IF;

  -- Transfer public.apps
  UPDATE public.apps SET owner_id = p_real_id, updated_at = NOW()
  WHERE owner_id = p_provisional_id;
  GET DIAGNOSTICS apps_moved = ROW_COUNT;

  -- Transfer API tokens (re-assign to real user)
  UPDATE public.user_api_tokens SET user_id = p_real_id
  WHERE user_id = p_provisional_id;
  GET DIAGNOSTICS tokens_moved = ROW_COUNT;

  -- Transfer storage accounting
  SELECT COALESCE(storage_used_bytes, 0) INTO storage_transferred
  FROM public.users WHERE id = p_provisional_id;

  UPDATE public.users
  SET storage_used_bytes = COALESCE(storage_used_bytes, 0) + storage_transferred
  WHERE id = p_real_id;

  -- Delete provisional user record
  DELETE FROM public.users WHERE id = p_provisional_id;

  RETURN jsonb_build_object(
    'apps_moved', apps_moved,
    'tokens_moved', tokens_moved,
    'storage_transferred_bytes', storage_transferred
  );
END;
$$;


ALTER FUNCTION "public"."merge_provisional_user"("p_provisional_id" "uuid", "p_real_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_sale_fingerprint"("p_sale_id" "uuid", "p_app_id" "uuid", "p_seller_id" "uuid", "p_buyer_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public, extensions'
    AS $$
DECLARE
  v_fingerprint TEXT;
BEGIN
  SELECT source_fingerprint INTO v_fingerprint
  FROM public.apps WHERE id = p_app_id;

  -- Only record if the app has a fingerprint (computed at upload time)
  IF v_fingerprint IS NOT NULL THEN
    INSERT INTO public.app_code_fingerprints
      (app_id, seller_id, buyer_id, fingerprint, sale_id)
    VALUES
      (p_app_id, p_seller_id, p_buyer_id, v_fingerprint, p_sale_id);
  END IF;
END;
$$;


ALTER FUNCTION "public"."record_sale_fingerprint"("p_sale_id" "uuid", "p_app_id" "uuid", "p_seller_id" "uuid", "p_buyer_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_upload_storage"("p_user_id" "uuid", "p_app_id" "uuid", "p_version" "text", "p_size_bytes" bigint) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public, extensions'
    AS $$
DECLARE
  v_existing_metadata JSONB;
  v_new_entry JSONB;
BEGIN
  UPDATE public.users
  SET storage_used_bytes = storage_used_bytes + p_size_bytes,
      updated_at = NOW()
  WHERE id = p_user_id;

  UPDATE public.apps
  SET storage_bytes = p_size_bytes,
      updated_at = NOW()
  WHERE id = p_app_id;

  v_new_entry := jsonb_build_object(
    'version', p_version,
    'size_bytes', p_size_bytes,
    'created_at', NOW()
  );

  SELECT COALESCE(version_metadata, '[]'::JSONB)
  INTO v_existing_metadata
  FROM public.apps
  WHERE id = p_app_id;

  UPDATE public.apps
  SET version_metadata = v_existing_metadata || jsonb_build_array(v_new_entry)
  WHERE id = p_app_id;
END;
$$;


ALTER FUNCTION "public"."record_upload_storage"("p_user_id" "uuid", "p_app_id" "uuid", "p_version" "text", "p_size_bytes" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."refresh_gpu_reliability"() RETURNS "void"
    LANGUAGE "sql"
    SET "search_path" TO 'public, extensions'
    AS $$
  REFRESH MATERIALIZED VIEW CONCURRENTLY gpu_reliability_7d;
$$;


ALTER FUNCTION "public"."refresh_gpu_reliability"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reject_bid"("p_owner_id" "uuid", "p_bid_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public, extensions'
    AS $$
DECLARE
  v_bid RECORD;
  v_app_owner UUID;
BEGIN
  SELECT * INTO v_bid FROM public.app_bids WHERE id = p_bid_id AND status = 'active' FOR UPDATE;
  IF v_bid IS NULL THEN
    RAISE EXCEPTION 'Bid not found or not active';
  END IF;

  -- Verify owner
  SELECT owner_id INTO v_app_owner FROM public.apps WHERE id = v_bid.app_id;
  IF v_app_owner != p_owner_id THEN
    RAISE EXCEPTION 'Only the app owner can reject bids';
  END IF;

  -- Refund escrow to bidder
  UPDATE public.users
  SET hosting_balance_cents = hosting_balance_cents + v_bid.amount_cents,
      escrow_held_cents = escrow_held_cents - v_bid.amount_cents
  WHERE id = v_bid.bidder_id;

  -- Mark rejected
  UPDATE public.app_bids
  SET status = 'rejected', escrow_status = 'refunded', resolved_at = now()
  WHERE id = p_bid_id;
END;
$$;


ALTER FUNCTION "public"."reject_bid"("p_owner_id" "uuid", "p_bid_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rollup_call_metrics"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public, extensions'
    AS $$
DECLARE
  v_30d_ago TIMESTAMPTZ := now() - INTERVAL '30 days';
BEGIN
  -- Reset all to 0 first
  UPDATE public.apps
  SET calls_success_30d = 0, calls_error_30d = 0
  WHERE (calls_success_30d > 0 OR calls_error_30d > 0);

  -- Aggregate from public.mcp_call_logs
  UPDATE public.apps a
  SET
    calls_success_30d = COALESCE(sub.successes, 0),
    calls_error_30d = COALESCE(sub.errors, 0)
  FROM (
    SELECT
      app_id,
      COUNT(*) FILTER (WHERE success = TRUE) AS successes,
      COUNT(*) FILTER (WHERE success = FALSE) AS errors
    FROM public.mcp_call_logs
    WHERE created_at >= v_30d_ago AND app_id IS NOT NULL
    GROUP BY app_id
  ) sub
  WHERE a.id = sub.app_id;
END;
$$;


ALTER FUNCTION "public"."rollup_call_metrics"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rollup_discovery_metrics"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public, extensions'
    AS $$
BEGIN
  PERFORM public.rollup_impressions();
  PERFORM public.rollup_call_metrics();
  PERFORM public.compute_quality_scores();
END;
$$;


ALTER FUNCTION "public"."rollup_discovery_metrics"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rollup_impressions"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public, extensions'
    AS $$
DECLARE
  v_7d_ago TIMESTAMPTZ := now() - INTERVAL '7 days';
BEGIN
  -- Reset all to 0 first (handles public.apps whose impressions were deleted)
  UPDATE public.apps
  SET impressions_total = 0, impressions_7d = 0
  WHERE (impressions_total > 0 OR impressions_7d > 0);

  -- Aggregate from public.app_impressions and update
  UPDATE public.apps a
  SET
    impressions_total = sub.total,
    impressions_7d = sub.recent
  FROM (
    SELECT
      app_id,
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE created_at >= v_7d_ago) AS recent
    FROM public.app_impressions
    WHERE app_id IS NOT NULL
    GROUP BY app_id
  ) sub
  WHERE a.id = sub.app_id;
END;
$$;


ALTER FUNCTION "public"."rollup_impressions"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."search_apps"("p_query_embedding" "public"."vector", "p_user_id" "uuid", "p_limit" integer DEFAULT 20, "p_offset" integer DEFAULT 0) RETURNS TABLE("id" "uuid", "name" "text", "slug" "text", "description" "text", "owner_id" "uuid", "visibility" "text", "similarity" double precision, "skills_parsed" "jsonb", "likes" integer, "dislikes" integer, "weighted_likes" integer, "weighted_dislikes" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public, extensions'
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    a.id, a.name, a.slug, a.description, a.owner_id, a.visibility,
    1 - (a.skills_embedding OPERATOR(public.<=>) p_query_embedding) as similarity,
    a.skills_parsed,
    COALESCE(a.likes, 0),
    COALESCE(a.dislikes, 0),
    COALESCE(a.weighted_likes, 0),
    COALESCE(a.weighted_dislikes, 0)
  FROM public.apps a
  WHERE
    a.deleted_at IS NULL
    AND a.skills_embedding IS NOT NULL
    AND (a.visibility = 'public' OR a.owner_id = p_user_id)
  ORDER BY similarity DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;


ALTER FUNCTION "public"."search_apps"("p_query_embedding" "public"."vector", "p_user_id" "uuid", "p_limit" integer, "p_offset" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."search_content"("p_query_embedding" "public"."vector", "p_user_id" "uuid", "p_types" "text"[] DEFAULT NULL::"text"[], "p_visibility" "text" DEFAULT NULL::"text", "p_limit" integer DEFAULT 20) RETURNS TABLE("id" "uuid", "type" "text", "slug" "text", "title" "text", "description" "text", "owner_id" "uuid", "visibility" "text", "similarity" double precision, "tags" "text"[], "published" boolean, "updated_at" timestamp with time zone, "likes" integer, "dislikes" integer, "weighted_likes" integer, "weighted_dislikes" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public, extensions'
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    c.type,
    c.slug,
    c.title,
    c.description,
    c.owner_id,
    c.visibility,
    1 - (c.embedding OPERATOR(public.<=>) p_query_embedding) as similarity,
    c.tags,
    c.published,
    c.updated_at,
    COALESCE(c.likes, 0),
    COALESCE(c.dislikes, 0),
    COALESCE(c.weighted_likes, 0),
    COALESCE(c.weighted_dislikes, 0)
  FROM public.content c
  LEFT JOIN public.content_shares cs
    ON cs.content_id = c.id
    AND (cs.shared_with_user_id = p_user_id OR cs.shared_with_email = (
      SELECT u.email FROM public.users u WHERE u.id = p_user_id LIMIT 1
    ))
    AND (cs.expires_at IS NULL OR cs.expires_at > NOW())
  WHERE
    c.embedding IS NOT NULL
    AND (p_types IS NULL OR c.type = ANY(p_types))
    AND (
      c.visibility = 'public'
      OR c.owner_id = p_user_id
      OR cs.id IS NOT NULL
    )
    AND (p_visibility IS NULL OR c.visibility = p_visibility)
  ORDER BY similarity DESC
  LIMIT p_limit;
END;
$$;


ALTER FUNCTION "public"."search_content"("p_query_embedding" "public"."vector", "p_user_id" "uuid", "p_types" "text"[], "p_visibility" "text", "p_limit" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."search_content"("p_query_embedding" "public"."vector", "p_user_id" "uuid", "p_types" "text"[], "p_visibility" "text", "p_limit" integer) IS 'Vector search over content table (pages, memory, library). Respects visibility and sharing. Returns like counters for scoring.';



CREATE OR REPLACE FUNCTION "public"."search_content_fusion"("p_query_embedding" "public"."vector", "p_query_text" "text", "p_user_id" "uuid", "p_types" "text"[] DEFAULT NULL::"text"[], "p_visibility" "text" DEFAULT NULL::"text", "p_limit" integer DEFAULT 20) RETURNS TABLE("id" "uuid", "type" "text", "slug" "text", "title" "text", "description" "text", "owner_id" "uuid", "visibility" "text", "similarity" double precision, "keyword_score" double precision, "final_score" double precision, "tags" "text"[], "published" boolean, "updated_at" timestamp with time zone, "likes" integer, "dislikes" integer, "weighted_likes" integer, "weighted_dislikes" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public, extensions'
    AS $$
DECLARE
  v_words TEXT[];
  v_word_count INTEGER;
BEGIN
  -- Parse query into individual words (lowercase, trimmed, non-empty)
  v_words := array_remove(string_to_array(lower(trim(COALESCE(p_query_text, ''))), ' '), '');
  v_word_count := COALESCE(array_length(v_words, 1), 0);

  -- Handle empty query: return pure vector results
  IF v_word_count = 0 THEN
    v_word_count := 1;
  END IF;

  RETURN QUERY
  WITH accessible AS (
    -- Base: all accessible public.content (same visibility logic as search_content)
    SELECT DISTINCT ON (c.id) c.*
    FROM public.content c
    LEFT JOIN public.content_shares cs
      ON cs.content_id = c.id
      AND (cs.shared_with_user_id = p_user_id OR cs.shared_with_email = (
      SELECT u.email FROM public.users u WHERE u.id = p_user_id LIMIT 1
      ))
      AND (cs.expires_at IS NULL OR cs.expires_at > NOW())
    WHERE
      (p_types IS NULL OR c.type = ANY(p_types))
      AND (
        c.visibility = 'public'
        OR c.owner_id = p_user_id
        OR cs.id IS NOT NULL
      )
      AND (p_visibility IS NULL OR c.visibility = p_visibility)
  ),
  vector_results AS (
    -- Vector similarity search (only rows with embeddings)
    SELECT
      a.id,
      1 - (a.embedding OPERATOR(public.<=>) p_query_embedding) AS v_similarity
    FROM accessible a
    WHERE a.embedding IS NOT NULL
    ORDER BY a.embedding OPERATOR(public.<=>) p_query_embedding
    LIMIT p_limit * 3
  ),
  keyword_results AS (
    -- Keyword matching: count how many query words appear in embedding_text
    SELECT
      a.id,
      CASE WHEN v_word_count > 0 THEN
        (
          SELECT COUNT(*)::FLOAT / v_word_count
          FROM unnest(v_words) AS w(word)
          WHERE lower(COALESCE(a.embedding_text, '')) LIKE '%' || w.word || '%'
        )
      ELSE 0.0
      END AS k_score
    FROM accessible a
    WHERE a.embedding_text IS NOT NULL
      AND v_word_count > 0
      AND lower(a.embedding_text) LIKE '%' || v_words[1] || '%'
    ORDER BY k_score DESC
    LIMIT p_limit * 3
  ),
  fused AS (
    -- Merge with GREATEST(semantic, keyword * 0.85) per row
    SELECT
      COALESCE(vr.id, kr.id) AS fused_id,
      COALESCE(vr.v_similarity, 0.0) AS sem_score,
      COALESCE(kr.k_score, 0.0) AS kw_score,
      GREATEST(
        COALESCE(vr.v_similarity, 0.0),
        COALESCE(kr.k_score, 0.0) * 0.85
      ) AS f_score
    FROM vector_results vr
    FULL OUTER JOIN keyword_results kr ON vr.id = kr.id
  )
  SELECT
    c.id,
    c.type,
    c.slug,
    c.title,
    c.description,
    c.owner_id,
    c.visibility,
    f.sem_score AS similarity,
    f.kw_score AS keyword_score,
    f.f_score AS final_score,
    c.tags,
    c.published,
    c.updated_at,
    COALESCE(c.likes, 0),
    COALESCE(c.dislikes, 0),
    COALESCE(c.weighted_likes, 0),
    COALESCE(c.weighted_dislikes, 0)
  FROM fused f
  JOIN public.content c ON c.id = f.fused_id
  ORDER BY f.f_score DESC
  LIMIT p_limit;
END;
$$;


ALTER FUNCTION "public"."search_content_fusion"("p_query_embedding" "public"."vector", "p_query_text" "text", "p_user_id" "uuid", "p_types" "text"[], "p_visibility" "text", "p_limit" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."search_content_fusion"("p_query_embedding" "public"."vector", "p_query_text" "text", "p_user_id" "uuid", "p_types" "text"[], "p_visibility" "text", "p_limit" integer) IS 'Fusion search combining vector similarity and keyword matching. Returns GREATEST(semantic, keyword*0.85) per row. Content with NULL embedding is still keyword-searchable. Respects visibility and sharing.';



CREATE OR REPLACE FUNCTION "public"."search_conversation_embeddings"("p_query_embedding" "public"."vector", "p_user_id" "uuid", "p_match_threshold" double precision DEFAULT 0.5, "p_match_count" integer DEFAULT 3) RETURNS TABLE("conversation_id" "text", "conversation_name" "text", "summary" "text", "metadata" "jsonb", "similarity" double precision, "created_at" timestamp with time zone)
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public, extensions'
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    ce.conversation_id,
    ce.conversation_name,
    ce.summary,
    ce.metadata,
    1 - (ce.embedding OPERATOR(public.<=>) p_query_embedding) AS similarity,
    ce.created_at
  FROM public.conversation_embeddings ce
  WHERE ce.user_id = p_user_id
    AND 1 - (ce.embedding OPERATOR(public.<=>) p_query_embedding) > p_match_threshold
  ORDER BY ce.embedding OPERATOR(public.<=>) p_query_embedding
  LIMIT p_match_count;
END;
$$;


ALTER FUNCTION "public"."search_conversation_embeddings"("p_query_embedding" "public"."vector", "p_user_id" "uuid", "p_match_threshold" double precision, "p_match_count" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_d1_usage"("p_user_id" "uuid", "p_rows_read" bigint, "p_rows_written" bigint, "p_storage_bytes" bigint) RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public, extensions'
    AS $$
BEGIN
  UPDATE public.users SET
    d1_rows_read_total = d1_rows_read_total + p_rows_read,
    d1_rows_written_total = d1_rows_written_total + p_rows_written,
    d1_storage_bytes = GREATEST(d1_storage_bytes, p_storage_bytes),
    d1_billing_last_synced_at = NOW()
  WHERE id = p_user_id;
END;
$$;


ALTER FUNCTION "public"."sync_d1_usage"("p_user_id" "uuid", "p_rows_read" bigint, "p_rows_written" bigint, "p_storage_bytes" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."transfer_balance"("p_from_user" "uuid", "p_to_user" "uuid", "p_amount_light" double precision) RETURNS TABLE("from_new_balance" double precision, "to_new_balance" double precision, "platform_fee" double precision)
    LANGUAGE "sql"
    SET "search_path" TO 'public, extensions'
    AS $$
  WITH
  fee AS (SELECT p_amount_light * 0.10 AS val),
  net AS (SELECT p_amount_light - (SELECT val FROM fee) AS val),
  debit AS (
    UPDATE public.users
    SET balance_light = balance_light - p_amount_light
    WHERE id = p_from_user
      AND balance_light >= p_amount_light
    RETURNING balance_light
  ),
  credit AS (
    UPDATE public.users
    SET balance_light = balance_light + (SELECT val FROM net),
        total_earned_light = total_earned_light + (SELECT val FROM net)
    WHERE id = p_to_user
      AND EXISTS (SELECT 1 FROM debit)
    RETURNING balance_light
  )
  SELECT
    d.balance_light AS from_new_balance,
    c.balance_light AS to_new_balance,
    (SELECT val FROM fee) AS platform_fee
  FROM debit d, credit c;
$$;


ALTER FUNCTION "public"."transfer_balance"("p_from_user" "uuid", "p_to_user" "uuid", "p_amount_light" double precision) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_app_embedding"("p_app_id" "uuid", "p_embedding" "public"."vector") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public, extensions'
    AS $$
BEGIN
  UPDATE public.apps
  SET skills_embedding = p_embedding,
      updated_at = NOW()
  WHERE id = p_app_id;
END;
$$;


ALTER FUNCTION "public"."update_app_embedding"("p_app_id" "uuid", "p_embedding" "public"."vector") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_app_like_counts"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public, extensions'
    AS $$
DECLARE
  target_app_id UUID;
  like_count INTEGER;
  dislike_count INTEGER;
  w_like_count INTEGER;
  w_dislike_count INTEGER;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_app_id := OLD.app_id;
  ELSE
    target_app_id := NEW.app_id;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.app_id IS DISTINCT FROM NEW.app_id THEN
    SELECT
      COUNT(*) FILTER (WHERE al.positive),
      COUNT(*) FILTER (WHERE NOT al.positive),
      COUNT(*) FILTER (WHERE al.positive AND u.tier != 'free'),
      COUNT(*) FILTER (WHERE NOT al.positive AND u.tier != 'free')
    INTO like_count, dislike_count, w_like_count, w_dislike_count
    FROM public.app_likes al
    JOIN public.users u ON u.id = al.user_id
    WHERE al.app_id = OLD.app_id;

    UPDATE public.apps SET
      likes = like_count,
      dislikes = dislike_count,
      weighted_likes = w_like_count,
      weighted_dislikes = w_dislike_count,
      updated_at = NOW()
    WHERE id = OLD.app_id;
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE al.positive),
    COUNT(*) FILTER (WHERE NOT al.positive),
    COUNT(*) FILTER (WHERE al.positive AND u.tier != 'free'),
    COUNT(*) FILTER (WHERE NOT al.positive AND u.tier != 'free')
  INTO like_count, dislike_count, w_like_count, w_dislike_count
  FROM public.app_likes al
  JOIN public.users u ON u.id = al.user_id
  WHERE al.app_id = target_app_id;

  UPDATE public.apps SET
    likes = like_count,
    dislikes = dislike_count,
    weighted_likes = w_like_count,
    weighted_dislikes = w_dislike_count,
    updated_at = NOW()
  WHERE id = target_app_id;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_app_like_counts"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_content_like_counts"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public, extensions'
    AS $$
DECLARE
  target_content_id UUID;
  like_count INTEGER;
  dislike_count INTEGER;
  w_like_count INTEGER;
  w_dislike_count INTEGER;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_content_id := OLD.content_id;
  ELSE
    target_content_id := NEW.content_id;
  END IF;

  -- If UPDATE changed content_id, also recompute old public.content
  IF TG_OP = 'UPDATE' AND OLD.content_id IS DISTINCT FROM NEW.content_id THEN
    SELECT
      COUNT(*) FILTER (WHERE cl.positive),
      COUNT(*) FILTER (WHERE NOT cl.positive),
      COUNT(*) FILTER (WHERE cl.positive AND u.tier != 'free'),
      COUNT(*) FILTER (WHERE NOT cl.positive AND u.tier != 'free')
    INTO like_count, dislike_count, w_like_count, w_dislike_count
    FROM public.content_likes cl
    JOIN public.users u ON u.id = cl.user_id
    WHERE cl.content_id = OLD.content_id;

    UPDATE public.content SET
      likes = like_count,
      dislikes = dislike_count,
      weighted_likes = w_like_count,
      weighted_dislikes = w_dislike_count,
      updated_at = NOW()
    WHERE id = OLD.content_id;
  END IF;

  -- Recompute for the target public.content
  SELECT
    COUNT(*) FILTER (WHERE cl.positive),
    COUNT(*) FILTER (WHERE NOT cl.positive),
    COUNT(*) FILTER (WHERE cl.positive AND u.tier != 'free'),
    COUNT(*) FILTER (WHERE NOT cl.positive AND u.tier != 'free')
  INTO like_count, dislike_count, w_like_count, w_dislike_count
  FROM public.content_likes cl
  JOIN public.users u ON u.id = cl.user_id
  WHERE cl.content_id = target_content_id;

  UPDATE public.content SET
    likes = like_count,
    dislikes = dislike_count,
    weighted_likes = w_like_count,
    weighted_dislikes = w_dislike_count,
    updated_at = NOW()
  WHERE id = target_content_id;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_content_like_counts"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."app_bids" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "app_id" "uuid" NOT NULL,
    "bidder_id" "uuid" NOT NULL,
    "amount_cents" integer NOT NULL,
    "escrow_status" "text" DEFAULT 'held'::"text",
    "status" "text" DEFAULT 'active'::"text",
    "message" "text",
    "expires_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "resolved_at" timestamp with time zone,
    "amount_light" double precision,
    CONSTRAINT "app_bids_amount_cents_check" CHECK (("amount_cents" > 0))
);


ALTER TABLE "public"."app_bids" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."app_caller_usage" (
    "app_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "counter_key" "text" NOT NULL,
    "call_count" integer DEFAULT 0 NOT NULL,
    "first_call_at" timestamp with time zone DEFAULT "now"(),
    "last_call_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."app_caller_usage" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."app_code_fingerprints" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "app_id" "uuid" NOT NULL,
    "seller_id" "uuid" NOT NULL,
    "buyer_id" "uuid" NOT NULL,
    "fingerprint" "text" NOT NULL,
    "sold_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "sale_id" "uuid"
);


ALTER TABLE "public"."app_code_fingerprints" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."app_config" (
    "key" "text" NOT NULL,
    "value" "jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."app_config" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."app_health_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "app_id" "uuid" NOT NULL,
    "function_name" "text" NOT NULL,
    "status" "text" DEFAULT 'detected'::"text" NOT NULL,
    "error_rate" double precision NOT NULL,
    "total_calls" integer NOT NULL,
    "failed_calls" integer NOT NULL,
    "common_error" "text",
    "error_sample" "jsonb",
    "patch_description" "text",
    "patch_version" "text",
    "previous_version" "text",
    "resolved_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."app_health_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."app_impressions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "app_id" "uuid",
    "content_id" "uuid",
    "query_id" "uuid",
    "source" "text" DEFAULT 'appstore'::"text" NOT NULL,
    "position" integer,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."app_impressions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."app_likes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "app_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "positive" boolean NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."app_likes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."app_listings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "app_id" "uuid" NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "ask_price_cents" integer,
    "floor_price_cents" integer,
    "instant_buy" boolean DEFAULT false,
    "status" "text" DEFAULT 'active'::"text",
    "listing_note" "text",
    "provenance" "jsonb" DEFAULT '[]'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."app_listings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."app_sales" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "app_id" "uuid" NOT NULL,
    "seller_id" "uuid" NOT NULL,
    "buyer_id" "uuid" NOT NULL,
    "sale_price_cents" integer NOT NULL,
    "platform_fee_cents" integer NOT NULL,
    "seller_payout_cents" integer NOT NULL,
    "bid_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "sale_price_light" double precision,
    "platform_fee_light" double precision,
    "seller_payout_light" double precision
);


ALTER TABLE "public"."app_sales" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."apps" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "owner_id" "uuid",
    "slug" "text" NOT NULL,
    "name" "text" NOT NULL,
    "visibility" "text" DEFAULT 'private'::"text",
    "storage_key" "text" NOT NULL,
    "storage_bytes" bigint DEFAULT 0,
    "exports" "jsonb" DEFAULT '[]'::"jsonb",
    "total_runs" integer DEFAULT 0,
    "deleted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "download_access" "text" DEFAULT 'owner'::"text",
    "current_version" "text" DEFAULT '1.0.0'::"text",
    "versions" "text"[] DEFAULT ARRAY['1.0.0'::"text"],
    "skills_md" "text",
    "skills_parsed" "jsonb",
    "declared_permissions" "jsonb" DEFAULT '[]'::"jsonb",
    "last_build_at" timestamp with time zone,
    "last_build_success" boolean,
    "last_build_logs" "jsonb" DEFAULT '[]'::"jsonb",
    "last_build_error" "text",
    "total_unique_users" integer DEFAULT 0,
    "runs_7d" integer DEFAULT 0,
    "runs_30d" integer DEFAULT 0,
    "category" "text",
    "tags" "text"[] DEFAULT '{}'::"text"[],
    "icon_url" "text",
    "description" "text",
    "docs_generated_at" timestamp with time zone,
    "generation_in_progress" boolean DEFAULT false,
    "generation_config" "jsonb" DEFAULT '{"ai_enhance": false}'::"jsonb",
    "skills_embedding" "public"."vector"(1536),
    "draft_storage_key" "text",
    "draft_version" "text",
    "draft_uploaded_at" timestamp with time zone,
    "draft_exports" "text"[],
    "env_vars" "jsonb" DEFAULT '{}'::"jsonb",
    "http_rate_limit" integer DEFAULT 1000,
    "http_enabled" boolean DEFAULT true,
    "supabase_url" "text",
    "supabase_anon_key_encrypted" "text",
    "supabase_service_key_encrypted" "text",
    "supabase_enabled" boolean DEFAULT false,
    "manifest" "text",
    "app_type" "text",
    "version_metadata" "jsonb" DEFAULT '[]'::"jsonb",
    "supabase_config_id" "uuid",
    "http_path" "text",
    "likes" integer DEFAULT 0,
    "env_schema" "jsonb" DEFAULT '{}'::"jsonb",
    "dislikes" integer DEFAULT 0,
    "weighted_likes" integer DEFAULT 0,
    "weighted_dislikes" integer DEFAULT 0,
    "rate_limit_config" "jsonb",
    "gap_id" "uuid",
    "hosting_suspended" boolean DEFAULT false,
    "pricing_config" "jsonb",
    "health_status" "text" DEFAULT 'healthy'::"text",
    "last_healed_at" timestamp with time zone,
    "auto_heal_enabled" boolean DEFAULT true,
    "source_fingerprint" "text",
    "originality_score" double precision,
    "integrity_checked_at" timestamp with time zone,
    "safety_status" "text" DEFAULT 'pending'::"text",
    "first_published_at" timestamp with time zone,
    "quality_score" double precision DEFAULT 0,
    "impressions_total" integer DEFAULT 0,
    "impressions_7d" integer DEFAULT 0,
    "calls_success_30d" integer DEFAULT 0,
    "calls_error_30d" integer DEFAULT 0,
    "featured_at" timestamp with time zone,
    "hosting_last_billed_at" timestamp with time zone,
    "had_external_db" boolean DEFAULT false NOT NULL,
    "runtime" "text" DEFAULT 'deno'::"text",
    "gpu_type" "text",
    "gpu_status" "text",
    "gpu_endpoint_id" "text",
    "gpu_config" "jsonb",
    "gpu_benchmark" "jsonb",
    "gpu_pricing_config" "jsonb",
    "gpu_max_duration_ms" integer,
    "gpu_concurrency_limit" integer DEFAULT 5,
    "d1_database_id" "text",
    "d1_status" "text",
    "d1_provisioned_at" timestamp with time zone,
    "d1_last_migration_version" integer DEFAULT 0,
    "screenshots" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "long_description" "text",
    CONSTRAINT "apps_app_type_check" CHECK (("app_type" = ANY (ARRAY['mcp'::"text", 'ui'::"text", 'hybrid'::"text"]))),
    CONSTRAINT "apps_d1_status_check" CHECK (("d1_status" = ANY (ARRAY['pending'::"text", 'provisioning'::"text", 'ready'::"text", 'error'::"text"])))
);


ALTER TABLE "public"."apps" OWNER TO "postgres";


COMMENT ON COLUMN "public"."apps"."env_vars" IS 'Encrypted environment variables for the app. Keys starting with ULTRALIGHT are reserved.';



COMMENT ON COLUMN "public"."apps"."http_rate_limit" IS 'Maximum HTTP requests per minute for this app (default 1000)';



COMMENT ON COLUMN "public"."apps"."http_enabled" IS 'Whether HTTP endpoints are enabled for this app';



COMMENT ON COLUMN "public"."apps"."supabase_anon_key_encrypted" IS 'AES-GCM encrypted anon key, format: iv:ciphertext';



COMMENT ON COLUMN "public"."apps"."supabase_service_key_encrypted" IS 'AES-GCM encrypted service role key (optional), format: iv:ciphertext';



COMMENT ON COLUMN "public"."apps"."d1_database_id" IS 'Cloudflare D1 database UUID, null until first ultralight.db call';



COMMENT ON COLUMN "public"."apps"."d1_status" IS 'Provisioning state: pending->provisioning->ready or error';



COMMENT ON COLUMN "public"."apps"."d1_last_migration_version" IS 'Highest migration version applied to this apps D1';



CREATE TABLE IF NOT EXISTS "public"."appstore_queries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "query" "text" NOT NULL,
    "top_similarity" double precision,
    "top_final_score" double precision,
    "result_count" integer,
    "results" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."appstore_queries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."async_jobs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "app_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "function_name" "text" NOT NULL,
    "status" "text" DEFAULT 'running'::"text" NOT NULL,
    "result" "jsonb",
    "result_r2_key" "text",
    "error" "jsonb",
    "logs" "jsonb" DEFAULT '[]'::"jsonb",
    "duration_ms" integer,
    "ai_cost_light" numeric DEFAULT 0,
    "execution_id" "text" NOT NULL,
    "server_instance" "text",
    "completed_at" timestamp with time zone,
    "expires_at" timestamp with time zone DEFAULT ("now"() + '01:00:00'::interval),
    "meta" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."async_jobs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."billing_transactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "category" "text" NOT NULL,
    "description" "text" NOT NULL,
    "app_id" "uuid",
    "app_name" "text",
    "amount_cents" double precision NOT NULL,
    "balance_after" double precision,
    "metadata" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "amount_light" double precision,
    "balance_after_light" double precision
);


ALTER TABLE "public"."billing_transactions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."content" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "title" "text",
    "description" "text",
    "visibility" "text" DEFAULT 'private'::"text" NOT NULL,
    "access_token" "text",
    "embedding" "public"."vector"(1536),
    "embedding_text" "text",
    "size" integer,
    "tags" "text"[],
    "published" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "hosting_suspended" boolean DEFAULT false,
    "price_cents" integer DEFAULT 0,
    "likes" integer DEFAULT 0,
    "dislikes" integer DEFAULT 0,
    "weighted_likes" integer DEFAULT 0,
    "weighted_dislikes" integer DEFAULT 0,
    "hosting_last_billed_at" timestamp with time zone,
    "price_light" double precision DEFAULT 0
);


ALTER TABLE "public"."content" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."content_likes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "content_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "positive" boolean NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."content_likes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."content_shares" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "content_id" "uuid" NOT NULL,
    "shared_with_email" "text" NOT NULL,
    "shared_with_user_id" "uuid",
    "access_level" "text" DEFAULT 'read'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "expires_at" timestamp with time zone
);


ALTER TABLE "public"."content_shares" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."conversation_embeddings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "conversation_id" "text" NOT NULL,
    "conversation_name" "text" NOT NULL,
    "summary" "text" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "embedding" "public"."vector"(1536) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."conversation_embeddings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."conversion_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "provisional_user_id" "uuid" NOT NULL,
    "real_user_id" "uuid" NOT NULL,
    "merge_method" "text" DEFAULT 'unknown'::"text" NOT NULL,
    "provisional_created_at" timestamp with time zone,
    "provisional_ip" "text",
    "calls_as_provisional" integer DEFAULT 0,
    "apps_used_as_provisional" integer DEFAULT 0,
    "first_app_id" "uuid",
    "first_app_name" "text",
    "apps_moved" integer DEFAULT 0,
    "tokens_moved" integer DEFAULT 0,
    "storage_transferred_bytes" bigint DEFAULT 0,
    "time_to_convert_minutes" integer,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."conversion_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."desktop_oauth_sessions" (
    "session_id" "text" NOT NULL,
    "poll_secret_hash" "text",
    "access_token_encrypted" "text",
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone DEFAULT ("now"() + '00:05:00'::interval) NOT NULL
);


ALTER TABLE "public"."desktop_oauth_sessions" OWNER TO "postgres";


COMMENT ON TABLE "public"."desktop_oauth_sessions" IS 'Short-lived desktop OAuth polling sessions used to hand off Supabase access tokens to the desktop app.';



COMMENT ON COLUMN "public"."desktop_oauth_sessions"."poll_secret_hash" IS 'Optional SHA-256 hash of a desktop-held poll secret. Null keeps backward compatibility with older desktop builds.';



COMMENT ON COLUMN "public"."desktop_oauth_sessions"."access_token_encrypted" IS 'Encrypted Supabase access token, deleted once the desktop app successfully polls it.';



CREATE TABLE IF NOT EXISTS "public"."gap_assessments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "gap_id" "uuid" NOT NULL,
    "app_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "agent_score" integer,
    "agent_notes" "text",
    "proposed_points" integer,
    "status" "text" DEFAULT 'pending'::"text",
    "awarded_points" integer,
    "reviewed_by" "text",
    "reviewed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "gap_assessments_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'rejected'::"text", 'adjusted'::"text"])))
);


ALTER TABLE "public"."gap_assessments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."gaps" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "description" "text" NOT NULL,
    "severity" "text" DEFAULT 'medium'::"text",
    "points_value" integer DEFAULT 100 NOT NULL,
    "season" integer DEFAULT 1 NOT NULL,
    "status" "text" DEFAULT 'open'::"text",
    "source_shortcoming_ids" "uuid"[] DEFAULT '{}'::"uuid"[],
    "source_query_ids" "uuid"[] DEFAULT '{}'::"uuid"[],
    "fulfilled_by_app_id" "uuid",
    "fulfilled_by_user_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "gaps_severity_check" CHECK (("severity" = ANY (ARRAY['low'::"text", 'medium'::"text", 'high'::"text", 'critical'::"text"]))),
    CONSTRAINT "gaps_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'claimed'::"text", 'fulfilled'::"text", 'closed'::"text"])))
);


ALTER TABLE "public"."gaps" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."gpu_build_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "app_id" "uuid" NOT NULL,
    "version" "text" NOT NULL,
    "event_type" "text" NOT NULL,
    "details" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."gpu_build_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."gpu_endpoints" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "app_id" "uuid" NOT NULL,
    "version" "text" NOT NULL,
    "provider" "text" DEFAULT 'runpod'::"text" NOT NULL,
    "endpoint_id" "text" NOT NULL,
    "gpu_type" "text" NOT NULL,
    "status" "text" DEFAULT 'building'::"text",
    "build_logs" "jsonb" DEFAULT '[]'::"jsonb",
    "build_started_at" timestamp with time zone DEFAULT "now"(),
    "build_completed_at" timestamp with time zone,
    "last_invoked_at" timestamp with time zone,
    "invocation_count" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."gpu_endpoints" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."gpu_rate_table" (
    "gpu_type" "text" NOT NULL,
    "rate_per_ms" double precision NOT NULL,
    "vram_gb" integer NOT NULL,
    "provider" "text" DEFAULT 'runpod'::"text" NOT NULL,
    "active" boolean DEFAULT true,
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."gpu_rate_table" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."mcp_call_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "app_id" "uuid",
    "app_name" "text",
    "function_name" "text" NOT NULL,
    "method" "text" NOT NULL,
    "success" boolean,
    "duration_ms" integer,
    "error_message" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "source" "text" DEFAULT 'direct'::"text",
    "input_args" "jsonb",
    "output_result" "jsonb",
    "user_tier" "text",
    "app_version" "text",
    "ai_cost_cents" double precision DEFAULT 0,
    "session_id" "text",
    "sequence_number" integer,
    "user_query" "text",
    "response_size_bytes" integer,
    "execution_cost_estimate_cents" double precision,
    "call_charge_cents" double precision,
    "gpu_type" "text",
    "gpu_exit_code" "text",
    "gpu_duration_ms" double precision,
    "gpu_cost_cents" double precision,
    "gpu_peak_vram_gb" double precision,
    "gpu_developer_fee_cents" double precision,
    "gpu_failure_policy" "text",
    "call_charge_light" double precision
);


ALTER TABLE "public"."mcp_call_logs" OWNER TO "postgres";


CREATE MATERIALIZED VIEW "public"."gpu_reliability_7d" AS
 SELECT "app_id",
    "count"(*) AS "total_calls",
    "count"(*) FILTER (WHERE ("success" = true)) AS "successful_calls",
    "round"((("count"(*) FILTER (WHERE ("success" = true)))::numeric / (NULLIF("count"(*), 0))::numeric), 4) AS "success_rate",
    "avg"("gpu_duration_ms") FILTER (WHERE ("gpu_duration_ms" IS NOT NULL)) AS "avg_duration_ms",
    "sum"("gpu_cost_cents") FILTER (WHERE ("gpu_cost_cents" IS NOT NULL)) AS "total_compute_cents"
   FROM "public"."mcp_call_logs"
  WHERE (("created_at" > ("now"() - '7 days'::interval)) AND ("gpu_type" IS NOT NULL))
  GROUP BY "app_id"
  WITH NO DATA;


ALTER MATERIALIZED VIEW "public"."gpu_reliability_7d" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."http_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "app_id" "uuid",
    "endpoint" "text" NOT NULL,
    "method" "text" NOT NULL,
    "ip_address" "text",
    "user_agent" "text",
    "status_code" integer,
    "duration_ms" integer,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."http_requests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."memory" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid",
    "scope" "text" DEFAULT 'user'::"text",
    "key" "text" NOT NULL,
    "value" "jsonb" NOT NULL
);


ALTER TABLE "public"."memory" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."memory_shares" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner_user_id" "uuid" NOT NULL,
    "scope" "text" DEFAULT 'user'::"text" NOT NULL,
    "key_pattern" "text" NOT NULL,
    "shared_with_email" "text" NOT NULL,
    "shared_with_user_id" "uuid",
    "access_level" "text" DEFAULT 'read'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "expires_at" timestamp with time zone
);


ALTER TABLE "public"."memory_shares" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."oauth_authorization_codes" (
    "code" "text" NOT NULL,
    "client_id" "text" NOT NULL,
    "redirect_uri" "text" NOT NULL,
    "code_challenge" "text" NOT NULL,
    "code_challenge_method" "text" DEFAULT 'S256'::"text" NOT NULL,
    "supabase_access_token" "text" NOT NULL,
    "supabase_refresh_token" "text",
    "user_id" "uuid" NOT NULL,
    "user_email" "text" NOT NULL,
    "scope" "text" DEFAULT 'mcp:read mcp:write'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "expires_at" timestamp with time zone DEFAULT ("now"() + '00:05:00'::interval)
);


ALTER TABLE "public"."oauth_authorization_codes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."oauth_clients" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "text" NOT NULL,
    "client_name" "text",
    "redirect_uris" "text"[] NOT NULL,
    "grant_types" "text"[] DEFAULT ARRAY['authorization_code'::"text"],
    "response_types" "text"[] DEFAULT ARRAY['code'::"text"],
    "token_endpoint_auth_method" "text" DEFAULT 'none'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "owner_user_id" "uuid",
    "client_secret_hash" "text",
    "client_secret_salt" "text",
    "logo_url" "text",
    "description" "text",
    "is_developer_app" boolean DEFAULT false
);


ALTER TABLE "public"."oauth_clients" OWNER TO "postgres";


COMMENT ON TABLE "public"."oauth_clients" IS 'Dynamically registered OAuth 2.1 clients for MCP spec compliance (RFC 7591)';



COMMENT ON COLUMN "public"."oauth_clients"."client_id" IS 'UUID issued during dynamic client registration';



COMMENT ON COLUMN "public"."oauth_clients"."redirect_uris" IS 'Registered redirect URIs validated during authorization';



COMMENT ON COLUMN "public"."oauth_clients"."owner_user_id" IS 'NULL = MCP dynamic client (auto-cleanup). Non-null = developer-registered app (persists)';



COMMENT ON COLUMN "public"."oauth_clients"."client_secret_hash" IS 'HMAC-SHA256 hash of client secret (uls_xxx format). NULL for MCP dynamic clients.';



COMMENT ON COLUMN "public"."oauth_clients"."is_developer_app" IS 'TRUE for developer portal-created apps, FALSE for MCP dynamic registration';



CREATE TABLE IF NOT EXISTS "public"."oauth_consents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "client_id" "text" NOT NULL,
    "scopes" "text"[] NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "revoked_at" timestamp with time zone
);


ALTER TABLE "public"."oauth_consents" OWNER TO "postgres";


COMMENT ON TABLE "public"."oauth_consents" IS 'Tracks user consent grants to third-party OAuth applications';



CREATE TABLE IF NOT EXISTS "public"."onboarding_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_ip" "text",
    "user_agent" "text",
    "referrer" "text",
    "provisional_created" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."onboarding_requests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payouts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "amount_cents" double precision NOT NULL,
    "stripe_fee_cents" double precision NOT NULL,
    "net_cents" double precision NOT NULL,
    "stripe_transfer_id" "text",
    "stripe_payout_id" "text",
    "status" "text" DEFAULT 'pending'::"text",
    "failure_reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "completed_at" timestamp with time zone,
    "release_at" timestamp with time zone,
    "platform_fee_cents" double precision DEFAULT 0,
    "amount_light" double precision,
    "platform_fee_light" double precision DEFAULT 0
);


ALTER TABLE "public"."payouts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."pending_permissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "app_id" "uuid" NOT NULL,
    "invited_email" "text" NOT NULL,
    "granted_by_user_id" "uuid" NOT NULL,
    "function_name" "text" NOT NULL,
    "allowed" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "allowed_args" "jsonb"
);


ALTER TABLE "public"."pending_permissions" OWNER TO "postgres";


COMMENT ON COLUMN "public"."pending_permissions"."allowed_args" IS 'Per-parameter value whitelist carried from invite. Applied when user signs up.';



CREATE TABLE IF NOT EXISTS "public"."points_ledger" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "amount" integer NOT NULL,
    "reason" "text" NOT NULL,
    "gap_assessment_id" "uuid",
    "season" integer DEFAULT 1 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."points_ledger" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rate_limits" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "endpoint" "text" NOT NULL,
    "window_start" timestamp with time zone NOT NULL,
    "request_count" integer DEFAULT 1
);


ALTER TABLE "public"."rate_limits" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."seasons" (
    "id" integer NOT NULL,
    "name" "text" NOT NULL,
    "starts_at" timestamp with time zone NOT NULL,
    "ends_at" timestamp with time zone,
    "total_points_pool" integer,
    "multiplier_config" "jsonb" DEFAULT '{}'::"jsonb",
    "active" boolean DEFAULT false
);


ALTER TABLE "public"."seasons" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."seasons_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."seasons_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."seasons_id_seq" OWNED BY "public"."seasons"."id";



CREATE TABLE IF NOT EXISTS "public"."shortcomings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "session_id" "text",
    "type" "text" NOT NULL,
    "summary" "text" NOT NULL,
    "context" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."shortcomings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."supabase_oauth_state" (
    "state" "text" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "code_verifier" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."supabase_oauth_state" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."transfers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "from_user_id" "uuid" NOT NULL,
    "to_user_id" "uuid" NOT NULL,
    "amount_cents" double precision NOT NULL,
    "reason" "text" NOT NULL,
    "app_id" "uuid",
    "function_name" "text",
    "content_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "amount_light" double precision
);


ALTER TABLE "public"."transfers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_api_tokens" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "token_prefix" "text" NOT NULL,
    "token_hash" "text" NOT NULL,
    "scopes" "text"[] DEFAULT ARRAY['*'::"text"],
    "last_used_at" timestamp with time zone,
    "last_used_ip" "text",
    "expires_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "app_ids" "jsonb",
    "function_names" "jsonb",
    "token_salt" "text",
    "plaintext_token" "text"
);


ALTER TABLE "public"."user_api_tokens" OWNER TO "postgres";


COMMENT ON COLUMN "public"."user_api_tokens"."token_salt" IS 'Random hex salt for HMAC-SHA256 token hashing. NULL = legacy unsalted SHA-256.';



CREATE TABLE IF NOT EXISTS "public"."user_app_blocks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "app_id" "uuid" NOT NULL,
    "reason" "text" DEFAULT 'dislike'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."user_app_blocks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_app_library" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "app_id" "uuid" NOT NULL,
    "source" "text" DEFAULT 'like'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."user_app_library" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_app_permissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "app_id" "uuid" NOT NULL,
    "granted_to_user_id" "uuid" NOT NULL,
    "granted_by_user_id" "uuid" NOT NULL,
    "function_name" "text" NOT NULL,
    "allowed" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "allowed_ips" "jsonb",
    "time_window" "jsonb",
    "budget_limit" integer,
    "budget_used" integer DEFAULT 0,
    "budget_period" "text",
    "expires_at" timestamp with time zone,
    "allowed_args" "jsonb"
);


ALTER TABLE "public"."user_app_permissions" OWNER TO "postgres";


COMMENT ON COLUMN "public"."user_app_permissions"."allowed_args" IS 'Per-parameter value whitelist. Keys = param names, values = arrays of allowed values. null = unrestricted.';



CREATE TABLE IF NOT EXISTS "public"."user_app_secrets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "app_id" "uuid" NOT NULL,
    "key" "text" NOT NULL,
    "value_encrypted" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."user_app_secrets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_content_blocks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "content_id" "uuid" NOT NULL,
    "reason" "text" DEFAULT 'dislike'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."user_content_blocks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_content_library" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "content_id" "uuid" NOT NULL,
    "source" "text" DEFAULT 'like'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."user_content_library" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_supabase_configs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "supabase_url" "text" NOT NULL,
    "anon_key_encrypted" "text" NOT NULL,
    "service_key_encrypted" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."user_supabase_configs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_supabase_oauth" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "access_token_encrypted" "text" NOT NULL,
    "refresh_token_encrypted" "text" NOT NULL,
    "token_expires_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."user_supabase_oauth" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."users" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "email" "text" NOT NULL,
    "google_id" "text",
    "tier" "text" DEFAULT 'free'::"text",
    "storage_used_bytes" bigint DEFAULT 0,
    "storage_limit_bytes" bigint DEFAULT 104857600,
    "byok_enabled" boolean DEFAULT false,
    "byok_provider" "text",
    "byok_key_encrypted" "text",
    "root_memory" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "avatar_url" "text",
    "display_name" "text",
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "byok_keys" "jsonb",
    "supabase_url" "text",
    "supabase_anon_key_encrypted" "text",
    "supabase_service_key_encrypted" "text",
    "byok_configs" "jsonb" DEFAULT '[]'::"jsonb",
    "ai_credit_balance" integer DEFAULT 0,
    "ai_credit_resets_at" timestamp with time zone,
    "hosting_balance_cents" double precision DEFAULT 0,
    "hosting_last_billed_at" timestamp with time zone DEFAULT "now"(),
    "stripe_customer_id" "text",
    "auto_topup_enabled" boolean DEFAULT false,
    "auto_topup_threshold_cents" integer DEFAULT 100,
    "auto_topup_amount_cents" integer DEFAULT 1000,
    "auto_topup_last_failed_at" timestamp with time zone,
    "provisional" boolean DEFAULT false,
    "provisional_created_ip" "text",
    "provisional_created_at" timestamp with time zone,
    "last_active_at" timestamp with time zone DEFAULT "now"(),
    "escrow_held_cents" double precision DEFAULT 0,
    "stripe_connect_account_id" "text",
    "stripe_connect_onboarded" boolean DEFAULT false,
    "stripe_connect_payouts_enabled" boolean DEFAULT false,
    "total_earned_cents" double precision DEFAULT 0,
    "data_storage_used_bytes" bigint DEFAULT 0,
    "country" "text",
    "featured_app_id" "uuid",
    "profile_slug" "text",
    "balance_light" double precision DEFAULT 0,
    "escrow_light" double precision DEFAULT 0,
    "total_earned_light" double precision DEFAULT 0,
    "auto_topup_threshold_light" integer DEFAULT 100,
    "auto_topup_amount_light" integer DEFAULT 1000,
    "d1_rows_read_total" bigint DEFAULT 0,
    "d1_rows_written_total" bigint DEFAULT 0,
    "d1_storage_bytes" bigint DEFAULT 0,
    "d1_billing_last_synced_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "users_tier_check" CHECK (("tier" = ANY (ARRAY['free'::"text", 'fun'::"text", 'pro'::"text", 'scale'::"text", 'enterprise'::"text"])))
);


ALTER TABLE "public"."users" OWNER TO "postgres";


COMMENT ON COLUMN "public"."users"."byok_enabled" IS 'Whether BYOK is enabled for this user';



COMMENT ON COLUMN "public"."users"."byok_provider" IS 'Primary BYOK provider to use for AI calls';



COMMENT ON COLUMN "public"."users"."byok_keys" IS 'Encrypted API keys for BYOK providers. Structure: { provider: { encrypted_key, model?, added_at } }';



CREATE TABLE IF NOT EXISTS "public"."weekly_call_usage" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "week_start" timestamp with time zone NOT NULL,
    "call_count" bigint DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."weekly_call_usage" OWNER TO "postgres";


ALTER TABLE ONLY "public"."seasons" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."seasons_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."app_bids"
    ADD CONSTRAINT "app_bids_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."app_caller_usage"
    ADD CONSTRAINT "app_caller_usage_pkey" PRIMARY KEY ("app_id", "user_id", "counter_key");



ALTER TABLE ONLY "public"."app_code_fingerprints"
    ADD CONSTRAINT "app_code_fingerprints_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."app_config"
    ADD CONSTRAINT "app_config_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."app_health_events"
    ADD CONSTRAINT "app_health_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."app_impressions"
    ADD CONSTRAINT "app_impressions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."app_listings"
    ADD CONSTRAINT "app_listings_app_id_key" UNIQUE ("app_id");



ALTER TABLE ONLY "public"."app_listings"
    ADD CONSTRAINT "app_listings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."app_likes"
    ADD CONSTRAINT "app_reviews_app_id_user_id_key" UNIQUE ("app_id", "user_id");



ALTER TABLE ONLY "public"."app_likes"
    ADD CONSTRAINT "app_reviews_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."app_sales"
    ADD CONSTRAINT "app_sales_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."apps"
    ADD CONSTRAINT "apps_owner_id_slug_key" UNIQUE ("owner_id", "slug");



ALTER TABLE ONLY "public"."apps"
    ADD CONSTRAINT "apps_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."appstore_queries"
    ADD CONSTRAINT "appstore_queries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."async_jobs"
    ADD CONSTRAINT "async_jobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."billing_transactions"
    ADD CONSTRAINT "billing_transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."content_likes"
    ADD CONSTRAINT "content_likes_content_id_user_id_key" UNIQUE ("content_id", "user_id");



ALTER TABLE ONLY "public"."content_likes"
    ADD CONSTRAINT "content_likes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."content"
    ADD CONSTRAINT "content_owner_id_type_slug_key" UNIQUE ("owner_id", "type", "slug");



ALTER TABLE ONLY "public"."content"
    ADD CONSTRAINT "content_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."content_shares"
    ADD CONSTRAINT "content_shares_content_id_shared_with_email_key" UNIQUE ("content_id", "shared_with_email");



ALTER TABLE ONLY "public"."content_shares"
    ADD CONSTRAINT "content_shares_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."conversation_embeddings"
    ADD CONSTRAINT "conversation_embeddings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."conversation_embeddings"
    ADD CONSTRAINT "conversation_embeddings_user_id_conversation_id_key" UNIQUE ("user_id", "conversation_id");



ALTER TABLE ONLY "public"."conversion_events"
    ADD CONSTRAINT "conversion_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."desktop_oauth_sessions"
    ADD CONSTRAINT "desktop_oauth_sessions_pkey" PRIMARY KEY ("session_id");



ALTER TABLE ONLY "public"."gap_assessments"
    ADD CONSTRAINT "gap_assessments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."gaps"
    ADD CONSTRAINT "gaps_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."gpu_build_events"
    ADD CONSTRAINT "gpu_build_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."gpu_endpoints"
    ADD CONSTRAINT "gpu_endpoints_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."gpu_rate_table"
    ADD CONSTRAINT "gpu_rate_table_pkey" PRIMARY KEY ("gpu_type");



ALTER TABLE ONLY "public"."http_requests"
    ADD CONSTRAINT "http_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."mcp_call_logs"
    ADD CONSTRAINT "mcp_call_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."memory"
    ADD CONSTRAINT "memory_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."memory_shares"
    ADD CONSTRAINT "memory_shares_owner_user_id_scope_key_pattern_shared_with_e_key" UNIQUE ("owner_user_id", "scope", "key_pattern", "shared_with_email");



ALTER TABLE ONLY "public"."memory_shares"
    ADD CONSTRAINT "memory_shares_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."memory"
    ADD CONSTRAINT "memory_user_id_scope_key_key" UNIQUE ("user_id", "scope", "key");



ALTER TABLE ONLY "public"."oauth_authorization_codes"
    ADD CONSTRAINT "oauth_authorization_codes_pkey" PRIMARY KEY ("code");



ALTER TABLE ONLY "public"."oauth_clients"
    ADD CONSTRAINT "oauth_clients_client_id_key" UNIQUE ("client_id");



ALTER TABLE ONLY "public"."oauth_clients"
    ADD CONSTRAINT "oauth_clients_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."oauth_consents"
    ADD CONSTRAINT "oauth_consents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."oauth_consents"
    ADD CONSTRAINT "oauth_consents_user_id_client_id_key" UNIQUE ("user_id", "client_id");



ALTER TABLE ONLY "public"."onboarding_requests"
    ADD CONSTRAINT "onboarding_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payouts"
    ADD CONSTRAINT "payouts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."pending_permissions"
    ADD CONSTRAINT "pending_permissions_app_id_invited_email_function_name_key" UNIQUE ("app_id", "invited_email", "function_name");



ALTER TABLE ONLY "public"."pending_permissions"
    ADD CONSTRAINT "pending_permissions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."points_ledger"
    ADD CONSTRAINT "points_ledger_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rate_limits"
    ADD CONSTRAINT "rate_limits_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rate_limits"
    ADD CONSTRAINT "rate_limits_user_id_endpoint_window_start_key" UNIQUE ("user_id", "endpoint", "window_start");



ALTER TABLE ONLY "public"."seasons"
    ADD CONSTRAINT "seasons_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."shortcomings"
    ADD CONSTRAINT "shortcomings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."supabase_oauth_state"
    ADD CONSTRAINT "supabase_oauth_state_pkey" PRIMARY KEY ("state");



ALTER TABLE ONLY "public"."transfers"
    ADD CONSTRAINT "transfers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_api_tokens"
    ADD CONSTRAINT "user_api_tokens_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_api_tokens"
    ADD CONSTRAINT "user_api_tokens_user_id_name_key" UNIQUE ("user_id", "name");



ALTER TABLE ONLY "public"."user_app_blocks"
    ADD CONSTRAINT "user_app_blocks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_app_blocks"
    ADD CONSTRAINT "user_app_blocks_user_id_app_id_key" UNIQUE ("user_id", "app_id");



ALTER TABLE ONLY "public"."user_app_library"
    ADD CONSTRAINT "user_app_library_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_app_library"
    ADD CONSTRAINT "user_app_library_user_id_app_id_key" UNIQUE ("user_id", "app_id");



ALTER TABLE ONLY "public"."user_app_permissions"
    ADD CONSTRAINT "user_app_permissions_app_id_granted_to_user_id_function_nam_key" UNIQUE ("app_id", "granted_to_user_id", "function_name");



ALTER TABLE ONLY "public"."user_app_permissions"
    ADD CONSTRAINT "user_app_permissions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_app_secrets"
    ADD CONSTRAINT "user_app_secrets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_app_secrets"
    ADD CONSTRAINT "user_app_secrets_user_id_app_id_key_key" UNIQUE ("user_id", "app_id", "key");



ALTER TABLE ONLY "public"."user_content_blocks"
    ADD CONSTRAINT "user_content_blocks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_content_blocks"
    ADD CONSTRAINT "user_content_blocks_user_id_content_id_key" UNIQUE ("user_id", "content_id");



ALTER TABLE ONLY "public"."user_content_library"
    ADD CONSTRAINT "user_content_library_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_content_library"
    ADD CONSTRAINT "user_content_library_user_id_content_id_key" UNIQUE ("user_id", "content_id");



ALTER TABLE ONLY "public"."user_supabase_configs"
    ADD CONSTRAINT "user_supabase_configs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_supabase_configs"
    ADD CONSTRAINT "user_supabase_configs_user_id_name_key" UNIQUE ("user_id", "name");



ALTER TABLE ONLY "public"."user_supabase_oauth"
    ADD CONSTRAINT "user_supabase_oauth_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_supabase_oauth"
    ADD CONSTRAINT "user_supabase_oauth_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_google_id_key" UNIQUE ("google_id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."weekly_call_usage"
    ADD CONSTRAINT "weekly_call_usage_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."weekly_call_usage"
    ADD CONSTRAINT "weekly_call_usage_user_id_week_start_key" UNIQUE ("user_id", "week_start");



CREATE INDEX "apps_skills_embedding_idx" ON "public"."apps" USING "ivfflat" ("skills_embedding" "public"."vector_cosine_ops") WITH ("lists"='100');



CREATE INDEX "idx_api_tokens_prefix" ON "public"."user_api_tokens" USING "btree" ("token_prefix");



CREATE INDEX "idx_api_tokens_user" ON "public"."user_api_tokens" USING "btree" ("user_id");



CREATE INDEX "idx_app_impressions_app_time" ON "public"."app_impressions" USING "btree" ("app_id", "created_at" DESC) WHERE ("app_id" IS NOT NULL);



CREATE INDEX "idx_app_impressions_content_time" ON "public"."app_impressions" USING "btree" ("content_id", "created_at" DESC) WHERE ("content_id" IS NOT NULL);



CREATE INDEX "idx_app_impressions_time" ON "public"."app_impressions" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_app_likes_app" ON "public"."app_likes" USING "btree" ("app_id");



CREATE INDEX "idx_app_likes_user" ON "public"."app_likes" USING "btree" ("user_id");



CREATE INDEX "idx_apps_download_access" ON "public"."apps" USING "btree" ("download_access") WHERE ("download_access" = 'public'::"text");



CREATE INDEX "idx_apps_env_vars" ON "public"."apps" USING "gin" ("env_vars");



CREATE INDEX "idx_apps_featured" ON "public"."apps" USING "btree" ("featured_at" DESC NULLS LAST) WHERE ("featured_at" IS NOT NULL);



CREATE INDEX "idx_apps_first_published" ON "public"."apps" USING "btree" ("first_published_at" DESC) WHERE (("visibility" = 'public'::"text") AND ("deleted_at" IS NULL) AND ("first_published_at" IS NOT NULL));



CREATE INDEX "idx_apps_gap" ON "public"."apps" USING "btree" ("gap_id") WHERE ("gap_id" IS NOT NULL);



CREATE INDEX "idx_apps_has_draft" ON "public"."apps" USING "btree" ("id") WHERE ("draft_storage_key" IS NOT NULL);



CREATE INDEX "idx_apps_hosting_suspended" ON "public"."apps" USING "btree" ("owner_id") WHERE (("hosting_suspended" = true) AND ("deleted_at" IS NULL));



CREATE INDEX "idx_apps_not_deleted" ON "public"."apps" USING "btree" ("id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_apps_owner_id" ON "public"."apps" USING "btree" ("owner_id");



CREATE INDEX "idx_apps_quality_score" ON "public"."apps" USING "btree" ("quality_score" DESC) WHERE (("visibility" = 'public'::"text") AND ("deleted_at" IS NULL));



CREATE INDEX "idx_apps_slug" ON "public"."apps" USING "btree" ("slug");



CREATE INDEX "idx_apps_source_fingerprint" ON "public"."apps" USING "btree" ("source_fingerprint") WHERE ("source_fingerprint" IS NOT NULL);



CREATE INDEX "idx_apps_supabase_enabled" ON "public"."apps" USING "btree" ("supabase_enabled") WHERE ("supabase_enabled" = true);



CREATE INDEX "idx_apps_visibility" ON "public"."apps" USING "btree" ("visibility");



CREATE INDEX "idx_apps_visibility_not_deleted" ON "public"."apps" USING "btree" ("visibility") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_appstore_queries_time" ON "public"."appstore_queries" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_assessments_gap" ON "public"."gap_assessments" USING "btree" ("gap_id");



CREATE INDEX "idx_assessments_status" ON "public"."gap_assessments" USING "btree" ("status", "created_at" DESC);



CREATE INDEX "idx_async_jobs_expires" ON "public"."async_jobs" USING "btree" ("expires_at") WHERE ("status" = 'running'::"text");



CREATE INDEX "idx_async_jobs_status" ON "public"."async_jobs" USING "btree" ("status") WHERE ("status" = 'running'::"text");



CREATE INDEX "idx_async_jobs_user" ON "public"."async_jobs" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_bids_app" ON "public"."app_bids" USING "btree" ("app_id", "status", "amount_cents" DESC);



CREATE INDEX "idx_bids_bidder" ON "public"."app_bids" USING "btree" ("bidder_id", "status");



CREATE UNIQUE INDEX "idx_bids_one_active" ON "public"."app_bids" USING "btree" ("app_id", "bidder_id") WHERE ("status" = 'active'::"text");



CREATE INDEX "idx_billing_tx_category" ON "public"."billing_transactions" USING "btree" ("user_id", "category");



CREATE INDEX "idx_billing_tx_user_created" ON "public"."billing_transactions" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_caller_usage_app" ON "public"."app_caller_usage" USING "btree" ("app_id", "last_call_at" DESC);



CREATE INDEX "idx_content_embedding_ivfflat" ON "public"."content" USING "ivfflat" ("embedding" "public"."vector_cosine_ops") WITH ("lists"='100');



CREATE INDEX "idx_content_embedding_text_gin" ON "public"."content" USING "gin" ("to_tsvector"('"simple"'::"regconfig", COALESCE("embedding_text", ''::"text")));



CREATE INDEX "idx_content_likes_content" ON "public"."content_likes" USING "btree" ("content_id");



CREATE INDEX "idx_content_likes_user" ON "public"."content_likes" USING "btree" ("user_id");



CREATE INDEX "idx_content_owner" ON "public"."content" USING "btree" ("owner_id");



CREATE INDEX "idx_content_published" ON "public"."content" USING "btree" ("published") WHERE ("published" = true);



CREATE INDEX "idx_content_shares_email" ON "public"."content_shares" USING "btree" ("shared_with_email");



CREATE INDEX "idx_content_shares_user" ON "public"."content_shares" USING "btree" ("shared_with_user_id");



CREATE INDEX "idx_content_type_vis" ON "public"."content" USING "btree" ("type", "visibility");



CREATE INDEX "idx_conv_emb_user" ON "public"."conversation_embeddings" USING "btree" ("user_id");



CREATE INDEX "idx_conv_emb_vector" ON "public"."conversation_embeddings" USING "ivfflat" ("embedding" "public"."vector_cosine_ops") WITH ("lists"='100');



CREATE INDEX "idx_conversion_events_method" ON "public"."conversion_events" USING "btree" ("merge_method", "created_at" DESC);



CREATE INDEX "idx_conversion_events_real_user" ON "public"."conversion_events" USING "btree" ("real_user_id");



CREATE INDEX "idx_conversion_events_time" ON "public"."conversion_events" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_desktop_oauth_sessions_expires_at" ON "public"."desktop_oauth_sessions" USING "btree" ("expires_at");



CREATE INDEX "idx_fingerprints_hash" ON "public"."app_code_fingerprints" USING "btree" ("fingerprint");



CREATE INDEX "idx_fingerprints_seller" ON "public"."app_code_fingerprints" USING "btree" ("seller_id");



CREATE INDEX "idx_gaps_season" ON "public"."gaps" USING "btree" ("season", "points_value" DESC);



CREATE INDEX "idx_gaps_status" ON "public"."gaps" USING "btree" ("status", "season", "created_at" DESC);



CREATE INDEX "idx_gpu_build_events_app" ON "public"."gpu_build_events" USING "btree" ("app_id");



CREATE INDEX "idx_gpu_build_events_type" ON "public"."gpu_build_events" USING "btree" ("event_type");



CREATE INDEX "idx_gpu_endpoints_app" ON "public"."gpu_endpoints" USING "btree" ("app_id", "version");



CREATE INDEX "idx_gpu_endpoints_status" ON "public"."gpu_endpoints" USING "btree" ("status");



CREATE UNIQUE INDEX "idx_gpu_reliability_app" ON "public"."gpu_reliability_7d" USING "btree" ("app_id");



CREATE INDEX "idx_health_events_app" ON "public"."app_health_events" USING "btree" ("app_id", "created_at" DESC);



CREATE INDEX "idx_health_events_status" ON "public"."app_health_events" USING "btree" ("status") WHERE ("status" <> ALL (ARRAY['deployed'::"text", 'failed'::"text", 'rolled_back'::"text"]));



CREATE INDEX "idx_http_requests_app_created" ON "public"."http_requests" USING "btree" ("app_id", "created_at" DESC);



CREATE INDEX "idx_listings_owner" ON "public"."app_listings" USING "btree" ("owner_id");



CREATE INDEX "idx_listings_status" ON "public"."app_listings" USING "btree" ("status", "ask_price_cents");



CREATE INDEX "idx_mcp_call_logs_gpu_type" ON "public"."mcp_call_logs" USING "btree" ("gpu_type") WHERE ("gpu_type" IS NOT NULL);



CREATE INDEX "idx_mcp_logs_app_function" ON "public"."mcp_call_logs" USING "btree" ("app_id", "function_name");



CREATE INDEX "idx_mcp_logs_app_time" ON "public"."mcp_call_logs" USING "btree" ("app_id", "created_at" DESC);



CREATE INDEX "idx_mcp_logs_cost" ON "public"."mcp_call_logs" USING "btree" ("user_id", "created_at" DESC) WHERE ("execution_cost_estimate_cents" IS NOT NULL);



CREATE INDEX "idx_mcp_logs_rich" ON "public"."mcp_call_logs" USING "btree" ("created_at" DESC) WHERE (("input_args" IS NOT NULL) AND ("output_result" IS NOT NULL));



CREATE INDEX "idx_mcp_logs_session" ON "public"."mcp_call_logs" USING "btree" ("session_id", "sequence_number") WHERE ("session_id" IS NOT NULL);



CREATE INDEX "idx_mcp_logs_user_time" ON "public"."mcp_call_logs" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_memory_shares_email" ON "public"."memory_shares" USING "btree" ("shared_with_email");



CREATE INDEX "idx_memory_shares_owner" ON "public"."memory_shares" USING "btree" ("owner_user_id");



CREATE INDEX "idx_oauth_auth_codes_expires" ON "public"."oauth_authorization_codes" USING "btree" ("expires_at");



CREATE INDEX "idx_oauth_clients_client_id" ON "public"."oauth_clients" USING "btree" ("client_id");



CREATE INDEX "idx_oauth_clients_owner" ON "public"."oauth_clients" USING "btree" ("owner_user_id") WHERE ("owner_user_id" IS NOT NULL);



CREATE INDEX "idx_oauth_consents_client" ON "public"."oauth_consents" USING "btree" ("client_id");



CREATE INDEX "idx_oauth_consents_user" ON "public"."oauth_consents" USING "btree" ("user_id");



CREATE INDEX "idx_onboarding_requests_ip" ON "public"."onboarding_requests" USING "btree" ("client_ip", "created_at" DESC);



CREATE INDEX "idx_onboarding_requests_time" ON "public"."onboarding_requests" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_payouts_release" ON "public"."payouts" USING "btree" ("release_at") WHERE ("status" = 'held'::"text");



CREATE INDEX "idx_payouts_status" ON "public"."payouts" USING "btree" ("status");



CREATE INDEX "idx_payouts_stripe_payout" ON "public"."payouts" USING "btree" ("stripe_payout_id");



CREATE INDEX "idx_payouts_stripe_transfer" ON "public"."payouts" USING "btree" ("stripe_transfer_id");



CREATE INDEX "idx_payouts_user" ON "public"."payouts" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_pending_perms_app" ON "public"."pending_permissions" USING "btree" ("app_id");



CREATE INDEX "idx_pending_perms_email" ON "public"."pending_permissions" USING "btree" ("invited_email");



CREATE INDEX "idx_points_season" ON "public"."points_ledger" USING "btree" ("season", "created_at" DESC);



CREATE INDEX "idx_points_user" ON "public"."points_ledger" USING "btree" ("user_id", "season", "created_at" DESC);



CREATE INDEX "idx_sales_app" ON "public"."app_sales" USING "btree" ("app_id", "created_at" DESC);



CREATE INDEX "idx_sales_buyer" ON "public"."app_sales" USING "btree" ("buyer_id", "created_at" DESC);



CREATE INDEX "idx_sales_seller" ON "public"."app_sales" USING "btree" ("seller_id", "created_at" DESC);



CREATE INDEX "idx_sales_time" ON "public"."app_sales" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_shortcomings_recent" ON "public"."shortcomings" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_shortcomings_type" ON "public"."shortcomings" USING "btree" ("type", "created_at" DESC);



CREATE INDEX "idx_shortcomings_user" ON "public"."shortcomings" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_transfers_app" ON "public"."transfers" USING "btree" ("app_id", "created_at" DESC);



CREATE INDEX "idx_transfers_from_user" ON "public"."transfers" USING "btree" ("from_user_id", "created_at" DESC);



CREATE INDEX "idx_transfers_to_user" ON "public"."transfers" USING "btree" ("to_user_id", "created_at" DESC);



CREATE INDEX "idx_user_app_blocks_user" ON "public"."user_app_blocks" USING "btree" ("user_id");



CREATE INDEX "idx_user_app_library_app" ON "public"."user_app_library" USING "btree" ("app_id");



CREATE INDEX "idx_user_app_library_user" ON "public"."user_app_library" USING "btree" ("user_id");



CREATE INDEX "idx_user_app_permissions_lookup" ON "public"."user_app_permissions" USING "btree" ("granted_to_user_id", "app_id", "function_name");



CREATE INDEX "idx_user_app_perms_app" ON "public"."user_app_permissions" USING "btree" ("app_id");



CREATE INDEX "idx_user_app_perms_app_user" ON "public"."user_app_permissions" USING "btree" ("app_id", "granted_to_user_id");



CREATE INDEX "idx_user_app_perms_granted_to" ON "public"."user_app_permissions" USING "btree" ("granted_to_user_id");



CREATE INDEX "idx_user_app_secrets_app" ON "public"."user_app_secrets" USING "btree" ("app_id");



CREATE INDEX "idx_user_app_secrets_user_app" ON "public"."user_app_secrets" USING "btree" ("user_id", "app_id");



CREATE INDEX "idx_user_content_blocks_user" ON "public"."user_content_blocks" USING "btree" ("user_id");



CREATE INDEX "idx_user_content_library_content" ON "public"."user_content_library" USING "btree" ("content_id");



CREATE INDEX "idx_user_content_library_user" ON "public"."user_content_library" USING "btree" ("user_id");



CREATE INDEX "idx_user_supabase_configs_user" ON "public"."user_supabase_configs" USING "btree" ("user_id");



CREATE INDEX "idx_user_supabase_oauth_user" ON "public"."user_supabase_oauth" USING "btree" ("user_id");



CREATE INDEX "idx_users_auto_topup" ON "public"."users" USING "btree" ("id") WHERE ("auto_topup_enabled" = true);



CREATE INDEX "idx_users_data_storage_positive" ON "public"."users" USING "btree" ("data_storage_used_bytes") WHERE ("data_storage_used_bytes" > 0);



CREATE INDEX "idx_users_hosting_balance" ON "public"."users" USING "btree" ("hosting_balance_cents") WHERE ("hosting_balance_cents" > (0)::double precision);



CREATE INDEX "idx_users_last_active" ON "public"."users" USING "btree" ("last_active_at") WHERE ("provisional" = true);



CREATE UNIQUE INDEX "idx_users_profile_slug" ON "public"."users" USING "btree" ("profile_slug") WHERE ("profile_slug" IS NOT NULL);



CREATE INDEX "idx_users_provisional" ON "public"."users" USING "btree" ("provisional") WHERE ("provisional" = true);



CREATE INDEX "idx_weekly_calls_user_week" ON "public"."weekly_call_usage" USING "btree" ("user_id", "week_start");



CREATE INDEX "rate_limits_lookup_idx" ON "public"."rate_limits" USING "btree" ("user_id", "endpoint", "window_start");



CREATE OR REPLACE TRIGGER "trg_app_likes" AFTER INSERT OR DELETE OR UPDATE ON "public"."app_likes" FOR EACH ROW EXECUTE FUNCTION "public"."update_app_like_counts"();



CREATE OR REPLACE TRIGGER "trg_content_likes" AFTER INSERT OR DELETE OR UPDATE ON "public"."content_likes" FOR EACH ROW EXECUTE FUNCTION "public"."update_content_like_counts"();



ALTER TABLE ONLY "public"."app_bids"
    ADD CONSTRAINT "app_bids_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."app_bids"
    ADD CONSTRAINT "app_bids_bidder_id_fkey" FOREIGN KEY ("bidder_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."app_caller_usage"
    ADD CONSTRAINT "app_caller_usage_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."app_caller_usage"
    ADD CONSTRAINT "app_caller_usage_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."app_code_fingerprints"
    ADD CONSTRAINT "app_code_fingerprints_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id");



ALTER TABLE ONLY "public"."app_code_fingerprints"
    ADD CONSTRAINT "app_code_fingerprints_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."app_code_fingerprints"
    ADD CONSTRAINT "app_code_fingerprints_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "public"."app_sales"("id");



ALTER TABLE ONLY "public"."app_code_fingerprints"
    ADD CONSTRAINT "app_code_fingerprints_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."app_health_events"
    ADD CONSTRAINT "app_health_events_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id");



ALTER TABLE ONLY "public"."app_impressions"
    ADD CONSTRAINT "app_impressions_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."app_listings"
    ADD CONSTRAINT "app_listings_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."app_listings"
    ADD CONSTRAINT "app_listings_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."app_likes"
    ADD CONSTRAINT "app_reviews_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."app_likes"
    ADD CONSTRAINT "app_reviews_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."app_sales"
    ADD CONSTRAINT "app_sales_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id");



ALTER TABLE ONLY "public"."app_sales"
    ADD CONSTRAINT "app_sales_bid_id_fkey" FOREIGN KEY ("bid_id") REFERENCES "public"."app_bids"("id");



ALTER TABLE ONLY "public"."app_sales"
    ADD CONSTRAINT "app_sales_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."app_sales"
    ADD CONSTRAINT "app_sales_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."apps"
    ADD CONSTRAINT "apps_gap_id_fkey" FOREIGN KEY ("gap_id") REFERENCES "public"."gaps"("id");



ALTER TABLE ONLY "public"."apps"
    ADD CONSTRAINT "apps_supabase_config_id_fkey" FOREIGN KEY ("supabase_config_id") REFERENCES "public"."user_supabase_configs"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."billing_transactions"
    ADD CONSTRAINT "billing_transactions_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."billing_transactions"
    ADD CONSTRAINT "billing_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."content_likes"
    ADD CONSTRAINT "content_likes_content_id_fkey" FOREIGN KEY ("content_id") REFERENCES "public"."content"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."content_likes"
    ADD CONSTRAINT "content_likes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."content"
    ADD CONSTRAINT "content_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."content_shares"
    ADD CONSTRAINT "content_shares_content_id_fkey" FOREIGN KEY ("content_id") REFERENCES "public"."content"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."content_shares"
    ADD CONSTRAINT "content_shares_shared_with_user_id_fkey" FOREIGN KEY ("shared_with_user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."conversation_embeddings"
    ADD CONSTRAINT "conversation_embeddings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."conversion_events"
    ADD CONSTRAINT "conversion_events_real_user_id_fkey" FOREIGN KEY ("real_user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."gap_assessments"
    ADD CONSTRAINT "gap_assessments_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id");



ALTER TABLE ONLY "public"."gap_assessments"
    ADD CONSTRAINT "gap_assessments_gap_id_fkey" FOREIGN KEY ("gap_id") REFERENCES "public"."gaps"("id");



ALTER TABLE ONLY "public"."gpu_build_events"
    ADD CONSTRAINT "gpu_build_events_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."gpu_endpoints"
    ADD CONSTRAINT "gpu_endpoints_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."http_requests"
    ADD CONSTRAINT "http_requests_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."mcp_call_logs"
    ADD CONSTRAINT "mcp_call_logs_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."mcp_call_logs"
    ADD CONSTRAINT "mcp_call_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."memory_shares"
    ADD CONSTRAINT "memory_shares_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."memory_shares"
    ADD CONSTRAINT "memory_shares_shared_with_user_id_fkey" FOREIGN KEY ("shared_with_user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."memory"
    ADD CONSTRAINT "memory_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."oauth_clients"
    ADD CONSTRAINT "oauth_clients_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."oauth_consents"
    ADD CONSTRAINT "oauth_consents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payouts"
    ADD CONSTRAINT "payouts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."pending_permissions"
    ADD CONSTRAINT "pending_permissions_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."pending_permissions"
    ADD CONSTRAINT "pending_permissions_granted_by_user_id_fkey" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."points_ledger"
    ADD CONSTRAINT "points_ledger_gap_assessment_id_fkey" FOREIGN KEY ("gap_assessment_id") REFERENCES "public"."gap_assessments"("id");



ALTER TABLE ONLY "public"."supabase_oauth_state"
    ADD CONSTRAINT "supabase_oauth_state_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."transfers"
    ADD CONSTRAINT "transfers_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id");



ALTER TABLE ONLY "public"."transfers"
    ADD CONSTRAINT "transfers_from_user_id_fkey" FOREIGN KEY ("from_user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."transfers"
    ADD CONSTRAINT "transfers_to_user_id_fkey" FOREIGN KEY ("to_user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."user_api_tokens"
    ADD CONSTRAINT "user_api_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_app_blocks"
    ADD CONSTRAINT "user_app_blocks_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_app_blocks"
    ADD CONSTRAINT "user_app_blocks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_app_library"
    ADD CONSTRAINT "user_app_library_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_app_library"
    ADD CONSTRAINT "user_app_library_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_app_permissions"
    ADD CONSTRAINT "user_app_permissions_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_app_permissions"
    ADD CONSTRAINT "user_app_permissions_granted_by_user_id_fkey" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_app_permissions"
    ADD CONSTRAINT "user_app_permissions_granted_to_user_id_fkey" FOREIGN KEY ("granted_to_user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_app_secrets"
    ADD CONSTRAINT "user_app_secrets_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_app_secrets"
    ADD CONSTRAINT "user_app_secrets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_content_blocks"
    ADD CONSTRAINT "user_content_blocks_content_id_fkey" FOREIGN KEY ("content_id") REFERENCES "public"."content"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_content_blocks"
    ADD CONSTRAINT "user_content_blocks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_content_library"
    ADD CONSTRAINT "user_content_library_content_id_fkey" FOREIGN KEY ("content_id") REFERENCES "public"."content"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_content_library"
    ADD CONSTRAINT "user_content_library_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_supabase_configs"
    ADD CONSTRAINT "user_supabase_configs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_supabase_oauth"
    ADD CONSTRAINT "user_supabase_oauth_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_featured_app_id_fkey" FOREIGN KEY ("featured_app_id") REFERENCES "public"."apps"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."weekly_call_usage"
    ADD CONSTRAINT "weekly_call_usage_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



CREATE POLICY "App owners can view http requests" ON "public"."http_requests" FOR SELECT USING (("app_id" IN ( SELECT "apps"."id"
   FROM "public"."apps"
  WHERE ("apps"."owner_id" = "auth"."uid"()))));



CREATE POLICY "Service role full access" ON "public"."user_api_tokens" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Users can create own tokens" ON "public"."user_api_tokens" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can delete own tokens" ON "public"."user_api_tokens" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own tokens" ON "public"."user_api_tokens" FOR SELECT USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."app_bids" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "app_bids_own" ON "public"."app_bids" USING (("auth"."uid"() = "bidder_id"));



ALTER TABLE "public"."app_caller_usage" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "app_caller_usage_own" ON "public"."app_caller_usage" FOR SELECT USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."app_code_fingerprints" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "app_code_fingerprints_own" ON "public"."app_code_fingerprints" FOR SELECT USING ((("auth"."uid"() = "seller_id") OR ("auth"."uid"() = "buyer_id")));



ALTER TABLE "public"."app_config" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."app_health_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."app_impressions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."app_likes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "app_likes_own" ON "public"."app_likes" USING (("user_id" = "auth"."uid"()));



CREATE POLICY "app_likes_select" ON "public"."app_likes" FOR SELECT USING (true);



ALTER TABLE "public"."app_listings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "app_listings_owner" ON "public"."app_listings" USING (("auth"."uid"() = "owner_id"));



CREATE POLICY "app_listings_public_read" ON "public"."app_listings" FOR SELECT USING (("status" = 'active'::"text"));



ALTER TABLE "public"."app_sales" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "app_sales_own" ON "public"."app_sales" FOR SELECT USING ((("auth"."uid"() = "seller_id") OR ("auth"."uid"() = "buyer_id")));



ALTER TABLE "public"."apps" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "apps_owner" ON "public"."apps" USING (("auth"."uid"() = "owner_id"));



CREATE POLICY "apps_public_read" ON "public"."apps" FOR SELECT USING (("visibility" = 'public'::"text"));



ALTER TABLE "public"."appstore_queries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."billing_transactions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "billing_transactions_own" ON "public"."billing_transactions" FOR SELECT USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."content" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."content_likes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "content_likes_own" ON "public"."content_likes" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "content_owner" ON "public"."content" USING (("auth"."uid"() = "owner_id"));



CREATE POLICY "content_public_read" ON "public"."content" FOR SELECT USING (("visibility" = 'public'::"text"));



ALTER TABLE "public"."content_shares" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "content_shares_own" ON "public"."content_shares" FOR SELECT USING (("auth"."uid"() = "shared_with_user_id"));



ALTER TABLE "public"."conversion_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."gap_assessments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."gaps" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "gaps_public_read" ON "public"."gaps" FOR SELECT USING (true);



ALTER TABLE "public"."gpu_build_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."gpu_endpoints" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."gpu_rate_table" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "gpu_rate_table_public_read" ON "public"."gpu_rate_table" FOR SELECT USING (true);



ALTER TABLE "public"."http_requests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."mcp_call_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "mcp_call_logs_own" ON "public"."mcp_call_logs" FOR SELECT USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."memory" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "memory_own" ON "public"."memory" USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."memory_shares" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "memory_shares_own" ON "public"."memory_shares" USING (("auth"."uid"() = "owner_user_id"));



CREATE POLICY "memory_shares_recipient" ON "public"."memory_shares" FOR SELECT USING (("auth"."uid"() = "shared_with_user_id"));



ALTER TABLE "public"."oauth_authorization_codes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."oauth_clients" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."oauth_consents" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."onboarding_requests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."payouts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "payouts_own" ON "public"."payouts" FOR SELECT USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."pending_permissions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."points_ledger" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "points_ledger_own" ON "public"."points_ledger" FOR SELECT USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."rate_limits" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "rate_limits_own" ON "public"."rate_limits" FOR SELECT USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."seasons" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "seasons_public_read" ON "public"."seasons" FOR SELECT USING (true);



ALTER TABLE "public"."shortcomings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."supabase_oauth_state" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."transfers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "transfers_own" ON "public"."transfers" FOR SELECT USING ((("auth"."uid"() = "from_user_id") OR ("auth"."uid"() = "to_user_id")));



ALTER TABLE "public"."user_api_tokens" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_app_blocks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_app_blocks_own" ON "public"."user_app_blocks" USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."user_app_library" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_app_library_own" ON "public"."user_app_library" USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."user_app_permissions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_app_permissions_own" ON "public"."user_app_permissions" FOR SELECT USING ((("auth"."uid"() = "granted_to_user_id") OR ("auth"."uid"() = "granted_by_user_id")));



ALTER TABLE "public"."user_app_secrets" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_app_secrets_own" ON "public"."user_app_secrets" USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."user_content_blocks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_content_blocks_own" ON "public"."user_content_blocks" USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."user_content_library" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_content_library_own" ON "public"."user_content_library" USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."user_supabase_configs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_supabase_configs_own" ON "public"."user_supabase_configs" USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."user_supabase_oauth" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_supabase_oauth_own" ON "public"."user_supabase_oauth" USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "users_own" ON "public"."users" USING (("auth"."uid"() = "id"));



ALTER TABLE "public"."weekly_call_usage" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "weekly_call_usage_own" ON "public"."weekly_call_usage" FOR SELECT USING (("auth"."uid"() = "user_id"));





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_in"("cstring", "oid", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_in"("cstring", "oid", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_in"("cstring", "oid", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_in"("cstring", "oid", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_out"("public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_out"("public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_out"("public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_out"("public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_recv"("internal", "oid", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_recv"("internal", "oid", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_recv"("internal", "oid", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_recv"("internal", "oid", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_send"("public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_send"("public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_send"("public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_send"("public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_typmod_in"("cstring"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_typmod_in"("cstring"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_typmod_in"("cstring"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_typmod_in"("cstring"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_in"("cstring", "oid", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_in"("cstring", "oid", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_in"("cstring", "oid", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_in"("cstring", "oid", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_out"("public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_out"("public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_out"("public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_out"("public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_recv"("internal", "oid", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_recv"("internal", "oid", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_recv"("internal", "oid", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_recv"("internal", "oid", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_send"("public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_send"("public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_send"("public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_send"("public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_typmod_in"("cstring"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_typmod_in"("cstring"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_typmod_in"("cstring"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_typmod_in"("cstring"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_in"("cstring", "oid", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_in"("cstring", "oid", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_in"("cstring", "oid", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_in"("cstring", "oid", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_out"("public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_out"("public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_out"("public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_out"("public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_recv"("internal", "oid", integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_recv"("internal", "oid", integer) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_recv"("internal", "oid", integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_recv"("internal", "oid", integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_send"("public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_send"("public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_send"("public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_send"("public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_typmod_in"("cstring"[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_typmod_in"("cstring"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_typmod_in"("cstring"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_typmod_in"("cstring"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_halfvec"(real[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(real[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(real[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(real[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(real[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(real[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(real[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(real[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_vector"(real[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_vector"(real[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_vector"(real[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_vector"(real[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_halfvec"(double precision[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(double precision[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(double precision[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(double precision[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(double precision[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(double precision[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(double precision[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(double precision[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_vector"(double precision[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_vector"(double precision[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_vector"(double precision[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_vector"(double precision[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_halfvec"(integer[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(integer[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(integer[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(integer[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(integer[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(integer[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(integer[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(integer[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_vector"(integer[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_vector"(integer[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_vector"(integer[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_vector"(integer[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_halfvec"(numeric[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(numeric[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(numeric[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_halfvec"(numeric[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(numeric[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(numeric[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(numeric[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_sparsevec"(numeric[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."array_to_vector"(numeric[], integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."array_to_vector"(numeric[], integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."array_to_vector"(numeric[], integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."array_to_vector"(numeric[], integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_to_float4"("public"."halfvec", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_to_float4"("public"."halfvec", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_to_float4"("public"."halfvec", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_to_float4"("public"."halfvec", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec"("public"."halfvec", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec"("public"."halfvec", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec"("public"."halfvec", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec"("public"."halfvec", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_to_sparsevec"("public"."halfvec", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_to_sparsevec"("public"."halfvec", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_to_sparsevec"("public"."halfvec", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_to_sparsevec"("public"."halfvec", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_to_vector"("public"."halfvec", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_to_vector"("public"."halfvec", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_to_vector"("public"."halfvec", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_to_vector"("public"."halfvec", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_to_halfvec"("public"."sparsevec", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_to_halfvec"("public"."sparsevec", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_to_halfvec"("public"."sparsevec", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_to_halfvec"("public"."sparsevec", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec"("public"."sparsevec", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec"("public"."sparsevec", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec"("public"."sparsevec", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec"("public"."sparsevec", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_to_vector"("public"."sparsevec", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_to_vector"("public"."sparsevec", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_to_vector"("public"."sparsevec", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_to_vector"("public"."sparsevec", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_to_float4"("public"."vector", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_to_float4"("public"."vector", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_to_float4"("public"."vector", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_to_float4"("public"."vector", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_to_halfvec"("public"."vector", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_to_halfvec"("public"."vector", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_to_halfvec"("public"."vector", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_to_halfvec"("public"."vector", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_to_sparsevec"("public"."vector", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_to_sparsevec"("public"."vector", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_to_sparsevec"("public"."vector", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_to_sparsevec"("public"."vector", integer, boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector"("public"."vector", integer, boolean) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector"("public"."vector", integer, boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."vector"("public"."vector", integer, boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector"("public"."vector", integer, boolean) TO "service_role";

























































































































































GRANT ALL ON FUNCTION "public"."accept_bid"("p_owner_id" "uuid", "p_bid_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."accept_bid"("p_owner_id" "uuid", "p_bid_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."accept_bid"("p_owner_id" "uuid", "p_bid_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."adjust_data_storage"("p_user_id" "uuid", "p_delta_bytes" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."adjust_data_storage"("p_user_id" "uuid", "p_delta_bytes" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."adjust_data_storage"("p_user_id" "uuid", "p_delta_bytes" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."binary_quantize"("public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."binary_quantize"("public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."binary_quantize"("public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."binary_quantize"("public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."binary_quantize"("public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."binary_quantize"("public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."binary_quantize"("public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."binary_quantize"("public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."cancel_bid"("p_bidder_id" "uuid", "p_bid_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."cancel_bid"("p_bidder_id" "uuid", "p_bid_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cancel_bid"("p_bidder_id" "uuid", "p_bid_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."check_d1_free_tier"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."check_d1_free_tier"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_d1_free_tier"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."check_data_storage_quota"("p_user_id" "uuid", "p_additional_bytes" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."check_data_storage_quota"("p_user_id" "uuid", "p_additional_bytes" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_data_storage_quota"("p_user_id" "uuid", "p_additional_bytes" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."check_http_rate_limit"("p_app_id" "uuid", "p_window_minutes" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."check_http_rate_limit"("p_app_id" "uuid", "p_window_minutes" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_http_rate_limit"("p_app_id" "uuid", "p_window_minutes" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."check_rate_limit"("p_user_id" "uuid", "p_endpoint" "text", "p_limit" integer, "p_window_minutes" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."check_rate_limit"("p_user_id" "uuid", "p_endpoint" "text", "p_limit" integer, "p_window_minutes" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_rate_limit"("p_user_id" "uuid", "p_endpoint" "text", "p_limit" integer, "p_window_minutes" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."check_seller_relist"("p_uploader_id" "uuid", "p_fingerprint" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."check_seller_relist"("p_uploader_id" "uuid", "p_fingerprint" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_seller_relist"("p_uploader_id" "uuid", "p_fingerprint" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."cleanup_expired_provisionals"() TO "anon";
GRANT ALL ON FUNCTION "public"."cleanup_expired_provisionals"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_expired_provisionals"() TO "service_role";



GRANT ALL ON FUNCTION "public"."cleanup_http_requests"() TO "anon";
GRANT ALL ON FUNCTION "public"."cleanup_http_requests"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_http_requests"() TO "service_role";



GRANT ALL ON FUNCTION "public"."cleanup_rate_limits"() TO "anon";
GRANT ALL ON FUNCTION "public"."cleanup_rate_limits"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_rate_limits"() TO "service_role";



GRANT ALL ON FUNCTION "public"."cleanup_stale_oauth_clients"() TO "anon";
GRANT ALL ON FUNCTION "public"."cleanup_stale_oauth_clients"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_stale_oauth_clients"() TO "service_role";



GRANT ALL ON FUNCTION "public"."compute_quality_scores"() TO "anon";
GRANT ALL ON FUNCTION "public"."compute_quality_scores"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."compute_quality_scores"() TO "service_role";



GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cosine_distance"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."count_provisional_by_ip"("p_ip" "text", "p_window_hours" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."count_provisional_by_ip"("p_ip" "text", "p_window_hours" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."count_provisional_by_ip"("p_ip" "text", "p_window_hours" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."create_payout_record"("p_user_id" "uuid", "p_amount_light" double precision, "p_stripe_fee_cents" double precision, "p_net_cents" double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."create_payout_record"("p_user_id" "uuid", "p_amount_light" double precision, "p_stripe_fee_cents" double precision, "p_net_cents" double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_payout_record"("p_user_id" "uuid", "p_amount_light" double precision, "p_stripe_fee_cents" double precision, "p_net_cents" double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."credit_balance"("p_user_id" "uuid", "p_amount_light" double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."credit_balance"("p_user_id" "uuid", "p_amount_light" double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."credit_balance"("p_user_id" "uuid", "p_amount_light" double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."debit_balance"("p_user_id" "uuid", "p_amount" double precision, "p_update_billed_at" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."debit_balance"("p_user_id" "uuid", "p_amount" double precision, "p_update_billed_at" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."debit_balance"("p_user_id" "uuid", "p_amount" double precision, "p_update_billed_at" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."ensure_user_exists"("user_id" "uuid", "user_email" "text", "user_display_name" "text", "user_avatar_url" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."ensure_user_exists"("user_id" "uuid", "user_email" "text", "user_display_name" "text", "user_avatar_url" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ensure_user_exists"("user_id" "uuid", "user_email" "text", "user_display_name" "text", "user_avatar_url" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."escrow_bid"("p_bidder_id" "uuid", "p_app_id" "uuid", "p_amount_cents" integer, "p_message" "text", "p_expires_at" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."escrow_bid"("p_bidder_id" "uuid", "p_app_id" "uuid", "p_amount_cents" integer, "p_message" "text", "p_expires_at" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."escrow_bid"("p_bidder_id" "uuid", "p_app_id" "uuid", "p_amount_cents" integer, "p_message" "text", "p_expires_at" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."expire_old_bids"() TO "anon";
GRANT ALL ON FUNCTION "public"."expire_old_bids"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."expire_old_bids"() TO "service_role";



GRANT ALL ON FUNCTION "public"."fail_payout_refund"("p_payout_id" "uuid", "p_failure_reason" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."fail_payout_refund"("p_payout_id" "uuid", "p_failure_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fail_payout_refund"("p_payout_id" "uuid", "p_failure_reason" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_analytics_summary"("p_days" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_analytics_summary"("p_days" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_analytics_summary"("p_days" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_app_granted_users"("p_app_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_app_granted_users"("p_app_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_app_granted_users"("p_app_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_leaderboard"("p_interval" "text", "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_leaderboard"("p_interval" "text", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_leaderboard"("p_interval" "text", "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_platform_stats"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_platform_stats"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_platform_stats"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_releasable_payouts"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_releasable_payouts"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_releasable_payouts"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_user_allowed_functions"("p_user_id" "uuid", "p_app_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_user_allowed_functions"("p_user_id" "uuid", "p_app_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_allowed_functions"("p_user_id" "uuid", "p_app_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_user_profile_stats"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_user_profile_stats"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_profile_stats"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_weekly_usage"("p_user_id" "uuid", "p_week_start" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."get_weekly_usage"("p_user_id" "uuid", "p_week_start" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_weekly_usage"("p_user_id" "uuid", "p_week_start" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_accum"(double precision[], "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_accum"(double precision[], "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_accum"(double precision[], "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_accum"(double precision[], "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_add"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_add"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_add"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_add"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_avg"(double precision[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_avg"(double precision[]) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_avg"(double precision[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_avg"(double precision[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_cmp"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_cmp"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_cmp"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_cmp"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_combine"(double precision[], double precision[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_combine"(double precision[], double precision[]) TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_combine"(double precision[], double precision[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_combine"(double precision[], double precision[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_concat"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_concat"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_concat"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_concat"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_eq"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_eq"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_eq"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_eq"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_ge"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_ge"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_ge"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_ge"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_gt"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_gt"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_gt"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_gt"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_l2_squared_distance"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_l2_squared_distance"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_l2_squared_distance"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_l2_squared_distance"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_le"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_le"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_le"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_le"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_lt"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_lt"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_lt"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_lt"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_mul"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_mul"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_mul"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_mul"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_ne"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_ne"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_ne"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_ne"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_negative_inner_product"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_negative_inner_product"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_negative_inner_product"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_negative_inner_product"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_spherical_distance"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_spherical_distance"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_spherical_distance"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_spherical_distance"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."halfvec_sub"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."halfvec_sub"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."halfvec_sub"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."halfvec_sub"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."hamming_distance"(bit, bit) TO "postgres";
GRANT ALL ON FUNCTION "public"."hamming_distance"(bit, bit) TO "anon";
GRANT ALL ON FUNCTION "public"."hamming_distance"(bit, bit) TO "authenticated";
GRANT ALL ON FUNCTION "public"."hamming_distance"(bit, bit) TO "service_role";



GRANT ALL ON FUNCTION "public"."hnsw_bit_support"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."hnsw_bit_support"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."hnsw_bit_support"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hnsw_bit_support"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."hnsw_halfvec_support"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."hnsw_halfvec_support"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."hnsw_halfvec_support"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hnsw_halfvec_support"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."hnsw_sparsevec_support"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."hnsw_sparsevec_support"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."hnsw_sparsevec_support"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hnsw_sparsevec_support"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."hnswhandler"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."hnswhandler"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."hnswhandler"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."hnswhandler"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."increment_app_runs"("app_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."increment_app_runs"("app_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."increment_app_runs"("app_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."increment_budget_used"("p_user_id" "uuid", "p_app_id" "uuid", "p_function_name" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."increment_budget_used"("p_user_id" "uuid", "p_app_id" "uuid", "p_function_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."increment_budget_used"("p_user_id" "uuid", "p_app_id" "uuid", "p_function_name" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."increment_caller_usage"("p_app_id" "uuid", "p_user_id" "uuid", "p_counter_key" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."increment_caller_usage"("p_app_id" "uuid", "p_user_id" "uuid", "p_counter_key" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."increment_caller_usage"("p_app_id" "uuid", "p_user_id" "uuid", "p_counter_key" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."increment_weekly_calls"("p_user_id" "uuid", "p_week_start" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."increment_weekly_calls"("p_user_id" "uuid", "p_week_start" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."increment_weekly_calls"("p_user_id" "uuid", "p_week_start" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."inner_product"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."inner_product"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."inner_product"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."inner_product"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."ivfflat_bit_support"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."ivfflat_bit_support"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."ivfflat_bit_support"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ivfflat_bit_support"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."ivfflat_halfvec_support"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."ivfflat_halfvec_support"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."ivfflat_halfvec_support"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ivfflat_halfvec_support"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."ivfflathandler"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."ivfflathandler"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."ivfflathandler"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ivfflathandler"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."jaccard_distance"(bit, bit) TO "postgres";
GRANT ALL ON FUNCTION "public"."jaccard_distance"(bit, bit) TO "anon";
GRANT ALL ON FUNCTION "public"."jaccard_distance"(bit, bit) TO "authenticated";
GRANT ALL ON FUNCTION "public"."jaccard_distance"(bit, bit) TO "service_role";



GRANT ALL ON FUNCTION "public"."l1_distance"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."l1_distance"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."l1_distance"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l1_distance"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."l2_distance"("public"."halfvec", "public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."halfvec", "public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."halfvec", "public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."halfvec", "public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."l2_distance"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."l2_distance"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l2_distance"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."l2_norm"("public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."l2_norm"("public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."l2_norm"("public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l2_norm"("public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."l2_norm"("public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."l2_norm"("public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."l2_norm"("public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l2_norm"("public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."l2_normalize"("public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."mark_payout_releasing"("p_payout_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."mark_payout_releasing"("p_payout_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."mark_payout_releasing"("p_payout_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."merge_provisional_user"("p_provisional_id" "uuid", "p_real_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."merge_provisional_user"("p_provisional_id" "uuid", "p_real_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."merge_provisional_user"("p_provisional_id" "uuid", "p_real_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."record_sale_fingerprint"("p_sale_id" "uuid", "p_app_id" "uuid", "p_seller_id" "uuid", "p_buyer_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."record_sale_fingerprint"("p_sale_id" "uuid", "p_app_id" "uuid", "p_seller_id" "uuid", "p_buyer_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."record_sale_fingerprint"("p_sale_id" "uuid", "p_app_id" "uuid", "p_seller_id" "uuid", "p_buyer_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."record_upload_storage"("p_user_id" "uuid", "p_app_id" "uuid", "p_version" "text", "p_size_bytes" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."record_upload_storage"("p_user_id" "uuid", "p_app_id" "uuid", "p_version" "text", "p_size_bytes" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."record_upload_storage"("p_user_id" "uuid", "p_app_id" "uuid", "p_version" "text", "p_size_bytes" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."refresh_gpu_reliability"() TO "anon";
GRANT ALL ON FUNCTION "public"."refresh_gpu_reliability"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."refresh_gpu_reliability"() TO "service_role";



GRANT ALL ON FUNCTION "public"."reject_bid"("p_owner_id" "uuid", "p_bid_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."reject_bid"("p_owner_id" "uuid", "p_bid_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."reject_bid"("p_owner_id" "uuid", "p_bid_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."rollup_call_metrics"() TO "anon";
GRANT ALL ON FUNCTION "public"."rollup_call_metrics"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rollup_call_metrics"() TO "service_role";



GRANT ALL ON FUNCTION "public"."rollup_discovery_metrics"() TO "anon";
GRANT ALL ON FUNCTION "public"."rollup_discovery_metrics"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rollup_discovery_metrics"() TO "service_role";



GRANT ALL ON FUNCTION "public"."rollup_impressions"() TO "anon";
GRANT ALL ON FUNCTION "public"."rollup_impressions"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rollup_impressions"() TO "service_role";



GRANT ALL ON FUNCTION "public"."search_apps"("p_query_embedding" "public"."vector", "p_user_id" "uuid", "p_limit" integer, "p_offset" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."search_apps"("p_query_embedding" "public"."vector", "p_user_id" "uuid", "p_limit" integer, "p_offset" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."search_apps"("p_query_embedding" "public"."vector", "p_user_id" "uuid", "p_limit" integer, "p_offset" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."search_content"("p_query_embedding" "public"."vector", "p_user_id" "uuid", "p_types" "text"[], "p_visibility" "text", "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."search_content"("p_query_embedding" "public"."vector", "p_user_id" "uuid", "p_types" "text"[], "p_visibility" "text", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."search_content"("p_query_embedding" "public"."vector", "p_user_id" "uuid", "p_types" "text"[], "p_visibility" "text", "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."search_content_fusion"("p_query_embedding" "public"."vector", "p_query_text" "text", "p_user_id" "uuid", "p_types" "text"[], "p_visibility" "text", "p_limit" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."search_content_fusion"("p_query_embedding" "public"."vector", "p_query_text" "text", "p_user_id" "uuid", "p_types" "text"[], "p_visibility" "text", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."search_content_fusion"("p_query_embedding" "public"."vector", "p_query_text" "text", "p_user_id" "uuid", "p_types" "text"[], "p_visibility" "text", "p_limit" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."search_conversation_embeddings"("p_query_embedding" "public"."vector", "p_user_id" "uuid", "p_match_threshold" double precision, "p_match_count" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."search_conversation_embeddings"("p_query_embedding" "public"."vector", "p_user_id" "uuid", "p_match_threshold" double precision, "p_match_count" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."search_conversation_embeddings"("p_query_embedding" "public"."vector", "p_user_id" "uuid", "p_match_threshold" double precision, "p_match_count" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_cmp"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_cmp"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_cmp"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_cmp"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_eq"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_eq"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_eq"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_eq"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_ge"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_ge"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_ge"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_ge"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_gt"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_gt"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_gt"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_gt"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_l2_squared_distance"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_l2_squared_distance"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_l2_squared_distance"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_l2_squared_distance"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_le"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_le"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_le"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_le"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_lt"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_lt"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_lt"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_lt"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_ne"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_ne"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_ne"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_ne"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sparsevec_negative_inner_product"("public"."sparsevec", "public"."sparsevec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sparsevec_negative_inner_product"("public"."sparsevec", "public"."sparsevec") TO "anon";
GRANT ALL ON FUNCTION "public"."sparsevec_negative_inner_product"("public"."sparsevec", "public"."sparsevec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sparsevec_negative_inner_product"("public"."sparsevec", "public"."sparsevec") TO "service_role";



GRANT ALL ON FUNCTION "public"."subvector"("public"."halfvec", integer, integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."subvector"("public"."halfvec", integer, integer) TO "anon";
GRANT ALL ON FUNCTION "public"."subvector"("public"."halfvec", integer, integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."subvector"("public"."halfvec", integer, integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."subvector"("public"."vector", integer, integer) TO "postgres";
GRANT ALL ON FUNCTION "public"."subvector"("public"."vector", integer, integer) TO "anon";
GRANT ALL ON FUNCTION "public"."subvector"("public"."vector", integer, integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."subvector"("public"."vector", integer, integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_d1_usage"("p_user_id" "uuid", "p_rows_read" bigint, "p_rows_written" bigint, "p_storage_bytes" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."sync_d1_usage"("p_user_id" "uuid", "p_rows_read" bigint, "p_rows_written" bigint, "p_storage_bytes" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_d1_usage"("p_user_id" "uuid", "p_rows_read" bigint, "p_rows_written" bigint, "p_storage_bytes" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."transfer_balance"("p_from_user" "uuid", "p_to_user" "uuid", "p_amount_light" double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."transfer_balance"("p_from_user" "uuid", "p_to_user" "uuid", "p_amount_light" double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."transfer_balance"("p_from_user" "uuid", "p_to_user" "uuid", "p_amount_light" double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."update_app_embedding"("p_app_id" "uuid", "p_embedding" "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."update_app_embedding"("p_app_id" "uuid", "p_embedding" "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_app_embedding"("p_app_id" "uuid", "p_embedding" "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_app_like_counts"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_app_like_counts"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_app_like_counts"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_content_like_counts"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_content_like_counts"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_content_like_counts"() TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_accum"(double precision[], "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_accum"(double precision[], "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_accum"(double precision[], "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_accum"(double precision[], "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_add"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_add"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_add"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_add"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_avg"(double precision[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_avg"(double precision[]) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_avg"(double precision[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_avg"(double precision[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_cmp"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_cmp"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_cmp"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_cmp"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_combine"(double precision[], double precision[]) TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_combine"(double precision[], double precision[]) TO "anon";
GRANT ALL ON FUNCTION "public"."vector_combine"(double precision[], double precision[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_combine"(double precision[], double precision[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_concat"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_concat"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_concat"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_concat"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_dims"("public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_dims"("public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_dims"("public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_dims"("public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_dims"("public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_dims"("public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_dims"("public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_dims"("public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_eq"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_eq"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_eq"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_eq"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_ge"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_ge"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_ge"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_ge"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_gt"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_gt"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_gt"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_gt"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_l2_squared_distance"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_l2_squared_distance"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_l2_squared_distance"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_l2_squared_distance"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_le"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_le"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_le"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_le"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_lt"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_lt"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_lt"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_lt"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_mul"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_mul"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_mul"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_mul"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_ne"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_ne"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_ne"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_ne"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_negative_inner_product"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_negative_inner_product"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_negative_inner_product"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_negative_inner_product"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_norm"("public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_norm"("public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_norm"("public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_norm"("public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_spherical_distance"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_spherical_distance"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_spherical_distance"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_spherical_distance"("public"."vector", "public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."vector_sub"("public"."vector", "public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."vector_sub"("public"."vector", "public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."vector_sub"("public"."vector", "public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."vector_sub"("public"."vector", "public"."vector") TO "service_role";












GRANT ALL ON FUNCTION "public"."avg"("public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."avg"("public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."avg"("public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."avg"("public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."avg"("public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."avg"("public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."avg"("public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."avg"("public"."vector") TO "service_role";



GRANT ALL ON FUNCTION "public"."sum"("public"."halfvec") TO "postgres";
GRANT ALL ON FUNCTION "public"."sum"("public"."halfvec") TO "anon";
GRANT ALL ON FUNCTION "public"."sum"("public"."halfvec") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sum"("public"."halfvec") TO "service_role";



GRANT ALL ON FUNCTION "public"."sum"("public"."vector") TO "postgres";
GRANT ALL ON FUNCTION "public"."sum"("public"."vector") TO "anon";
GRANT ALL ON FUNCTION "public"."sum"("public"."vector") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sum"("public"."vector") TO "service_role";









GRANT ALL ON TABLE "public"."app_bids" TO "anon";
GRANT ALL ON TABLE "public"."app_bids" TO "authenticated";
GRANT ALL ON TABLE "public"."app_bids" TO "service_role";



GRANT ALL ON TABLE "public"."app_caller_usage" TO "anon";
GRANT ALL ON TABLE "public"."app_caller_usage" TO "authenticated";
GRANT ALL ON TABLE "public"."app_caller_usage" TO "service_role";



GRANT ALL ON TABLE "public"."app_code_fingerprints" TO "anon";
GRANT ALL ON TABLE "public"."app_code_fingerprints" TO "authenticated";
GRANT ALL ON TABLE "public"."app_code_fingerprints" TO "service_role";



GRANT ALL ON TABLE "public"."app_config" TO "anon";
GRANT ALL ON TABLE "public"."app_config" TO "authenticated";
GRANT ALL ON TABLE "public"."app_config" TO "service_role";



GRANT ALL ON TABLE "public"."app_health_events" TO "anon";
GRANT ALL ON TABLE "public"."app_health_events" TO "authenticated";
GRANT ALL ON TABLE "public"."app_health_events" TO "service_role";



GRANT ALL ON TABLE "public"."app_impressions" TO "anon";
GRANT ALL ON TABLE "public"."app_impressions" TO "authenticated";
GRANT ALL ON TABLE "public"."app_impressions" TO "service_role";



GRANT ALL ON TABLE "public"."app_likes" TO "anon";
GRANT ALL ON TABLE "public"."app_likes" TO "authenticated";
GRANT ALL ON TABLE "public"."app_likes" TO "service_role";



GRANT ALL ON TABLE "public"."app_listings" TO "anon";
GRANT ALL ON TABLE "public"."app_listings" TO "authenticated";
GRANT ALL ON TABLE "public"."app_listings" TO "service_role";



GRANT ALL ON TABLE "public"."app_sales" TO "anon";
GRANT ALL ON TABLE "public"."app_sales" TO "authenticated";
GRANT ALL ON TABLE "public"."app_sales" TO "service_role";



GRANT ALL ON TABLE "public"."apps" TO "anon";
GRANT ALL ON TABLE "public"."apps" TO "authenticated";
GRANT ALL ON TABLE "public"."apps" TO "service_role";



GRANT ALL ON TABLE "public"."appstore_queries" TO "anon";
GRANT ALL ON TABLE "public"."appstore_queries" TO "authenticated";
GRANT ALL ON TABLE "public"."appstore_queries" TO "service_role";



GRANT ALL ON TABLE "public"."async_jobs" TO "anon";
GRANT ALL ON TABLE "public"."async_jobs" TO "authenticated";
GRANT ALL ON TABLE "public"."async_jobs" TO "service_role";



GRANT ALL ON TABLE "public"."billing_transactions" TO "anon";
GRANT ALL ON TABLE "public"."billing_transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."billing_transactions" TO "service_role";



GRANT ALL ON TABLE "public"."content" TO "anon";
GRANT ALL ON TABLE "public"."content" TO "authenticated";
GRANT ALL ON TABLE "public"."content" TO "service_role";



GRANT ALL ON TABLE "public"."content_likes" TO "anon";
GRANT ALL ON TABLE "public"."content_likes" TO "authenticated";
GRANT ALL ON TABLE "public"."content_likes" TO "service_role";



GRANT ALL ON TABLE "public"."content_shares" TO "anon";
GRANT ALL ON TABLE "public"."content_shares" TO "authenticated";
GRANT ALL ON TABLE "public"."content_shares" TO "service_role";



GRANT ALL ON TABLE "public"."conversation_embeddings" TO "anon";
GRANT ALL ON TABLE "public"."conversation_embeddings" TO "authenticated";
GRANT ALL ON TABLE "public"."conversation_embeddings" TO "service_role";



GRANT ALL ON TABLE "public"."conversion_events" TO "anon";
GRANT ALL ON TABLE "public"."conversion_events" TO "authenticated";
GRANT ALL ON TABLE "public"."conversion_events" TO "service_role";



GRANT ALL ON TABLE "public"."desktop_oauth_sessions" TO "anon";
GRANT ALL ON TABLE "public"."desktop_oauth_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."desktop_oauth_sessions" TO "service_role";



GRANT ALL ON TABLE "public"."gap_assessments" TO "anon";
GRANT ALL ON TABLE "public"."gap_assessments" TO "authenticated";
GRANT ALL ON TABLE "public"."gap_assessments" TO "service_role";



GRANT ALL ON TABLE "public"."gaps" TO "anon";
GRANT ALL ON TABLE "public"."gaps" TO "authenticated";
GRANT ALL ON TABLE "public"."gaps" TO "service_role";



GRANT ALL ON TABLE "public"."gpu_build_events" TO "anon";
GRANT ALL ON TABLE "public"."gpu_build_events" TO "authenticated";
GRANT ALL ON TABLE "public"."gpu_build_events" TO "service_role";



GRANT ALL ON TABLE "public"."gpu_endpoints" TO "anon";
GRANT ALL ON TABLE "public"."gpu_endpoints" TO "authenticated";
GRANT ALL ON TABLE "public"."gpu_endpoints" TO "service_role";



GRANT ALL ON TABLE "public"."gpu_rate_table" TO "anon";
GRANT ALL ON TABLE "public"."gpu_rate_table" TO "authenticated";
GRANT ALL ON TABLE "public"."gpu_rate_table" TO "service_role";



GRANT ALL ON TABLE "public"."mcp_call_logs" TO "anon";
GRANT ALL ON TABLE "public"."mcp_call_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."mcp_call_logs" TO "service_role";



GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."gpu_reliability_7d" TO "anon";
GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."gpu_reliability_7d" TO "authenticated";
GRANT ALL ON TABLE "public"."gpu_reliability_7d" TO "service_role";



GRANT ALL ON TABLE "public"."http_requests" TO "anon";
GRANT ALL ON TABLE "public"."http_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."http_requests" TO "service_role";



GRANT ALL ON TABLE "public"."memory" TO "anon";
GRANT ALL ON TABLE "public"."memory" TO "authenticated";
GRANT ALL ON TABLE "public"."memory" TO "service_role";



GRANT ALL ON TABLE "public"."memory_shares" TO "anon";
GRANT ALL ON TABLE "public"."memory_shares" TO "authenticated";
GRANT ALL ON TABLE "public"."memory_shares" TO "service_role";



GRANT ALL ON TABLE "public"."oauth_authorization_codes" TO "anon";
GRANT ALL ON TABLE "public"."oauth_authorization_codes" TO "authenticated";
GRANT ALL ON TABLE "public"."oauth_authorization_codes" TO "service_role";



GRANT ALL ON TABLE "public"."oauth_clients" TO "anon";
GRANT ALL ON TABLE "public"."oauth_clients" TO "authenticated";
GRANT ALL ON TABLE "public"."oauth_clients" TO "service_role";



GRANT ALL ON TABLE "public"."oauth_consents" TO "anon";
GRANT ALL ON TABLE "public"."oauth_consents" TO "authenticated";
GRANT ALL ON TABLE "public"."oauth_consents" TO "service_role";



GRANT ALL ON TABLE "public"."onboarding_requests" TO "anon";
GRANT ALL ON TABLE "public"."onboarding_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."onboarding_requests" TO "service_role";



GRANT ALL ON TABLE "public"."payouts" TO "anon";
GRANT ALL ON TABLE "public"."payouts" TO "authenticated";
GRANT ALL ON TABLE "public"."payouts" TO "service_role";



GRANT ALL ON TABLE "public"."pending_permissions" TO "anon";
GRANT ALL ON TABLE "public"."pending_permissions" TO "authenticated";
GRANT ALL ON TABLE "public"."pending_permissions" TO "service_role";



GRANT ALL ON TABLE "public"."points_ledger" TO "anon";
GRANT ALL ON TABLE "public"."points_ledger" TO "authenticated";
GRANT ALL ON TABLE "public"."points_ledger" TO "service_role";



GRANT ALL ON TABLE "public"."rate_limits" TO "anon";
GRANT ALL ON TABLE "public"."rate_limits" TO "authenticated";
GRANT ALL ON TABLE "public"."rate_limits" TO "service_role";



GRANT ALL ON TABLE "public"."seasons" TO "anon";
GRANT ALL ON TABLE "public"."seasons" TO "authenticated";
GRANT ALL ON TABLE "public"."seasons" TO "service_role";



GRANT ALL ON SEQUENCE "public"."seasons_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."seasons_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."seasons_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."shortcomings" TO "anon";
GRANT ALL ON TABLE "public"."shortcomings" TO "authenticated";
GRANT ALL ON TABLE "public"."shortcomings" TO "service_role";



GRANT ALL ON TABLE "public"."supabase_oauth_state" TO "anon";
GRANT ALL ON TABLE "public"."supabase_oauth_state" TO "authenticated";
GRANT ALL ON TABLE "public"."supabase_oauth_state" TO "service_role";



GRANT ALL ON TABLE "public"."transfers" TO "anon";
GRANT ALL ON TABLE "public"."transfers" TO "authenticated";
GRANT ALL ON TABLE "public"."transfers" TO "service_role";



GRANT ALL ON TABLE "public"."user_api_tokens" TO "anon";
GRANT ALL ON TABLE "public"."user_api_tokens" TO "authenticated";
GRANT ALL ON TABLE "public"."user_api_tokens" TO "service_role";



GRANT ALL ON TABLE "public"."user_app_blocks" TO "anon";
GRANT ALL ON TABLE "public"."user_app_blocks" TO "authenticated";
GRANT ALL ON TABLE "public"."user_app_blocks" TO "service_role";



GRANT ALL ON TABLE "public"."user_app_library" TO "anon";
GRANT ALL ON TABLE "public"."user_app_library" TO "authenticated";
GRANT ALL ON TABLE "public"."user_app_library" TO "service_role";



GRANT ALL ON TABLE "public"."user_app_permissions" TO "anon";
GRANT ALL ON TABLE "public"."user_app_permissions" TO "authenticated";
GRANT ALL ON TABLE "public"."user_app_permissions" TO "service_role";



GRANT ALL ON TABLE "public"."user_app_secrets" TO "anon";
GRANT ALL ON TABLE "public"."user_app_secrets" TO "authenticated";
GRANT ALL ON TABLE "public"."user_app_secrets" TO "service_role";



GRANT ALL ON TABLE "public"."user_content_blocks" TO "anon";
GRANT ALL ON TABLE "public"."user_content_blocks" TO "authenticated";
GRANT ALL ON TABLE "public"."user_content_blocks" TO "service_role";



GRANT ALL ON TABLE "public"."user_content_library" TO "anon";
GRANT ALL ON TABLE "public"."user_content_library" TO "authenticated";
GRANT ALL ON TABLE "public"."user_content_library" TO "service_role";



GRANT ALL ON TABLE "public"."user_supabase_configs" TO "anon";
GRANT ALL ON TABLE "public"."user_supabase_configs" TO "authenticated";
GRANT ALL ON TABLE "public"."user_supabase_configs" TO "service_role";



GRANT ALL ON TABLE "public"."user_supabase_oauth" TO "anon";
GRANT ALL ON TABLE "public"."user_supabase_oauth" TO "authenticated";
GRANT ALL ON TABLE "public"."user_supabase_oauth" TO "service_role";



GRANT ALL ON TABLE "public"."users" TO "anon";
GRANT ALL ON TABLE "public"."users" TO "authenticated";
GRANT ALL ON TABLE "public"."users" TO "service_role";



GRANT ALL ON TABLE "public"."weekly_call_usage" TO "anon";
GRANT ALL ON TABLE "public"."weekly_call_usage" TO "authenticated";
GRANT ALL ON TABLE "public"."weekly_call_usage" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































drop extension if exists "pg_net";
