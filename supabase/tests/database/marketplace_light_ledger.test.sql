BEGIN;

SELECT plan(37);

CREATE TEMP TABLE marketplace_wave1_state (
  first_bid_id uuid,
  accepted_bid_id uuid,
  rival_bid_id uuid,
  sale jsonb,
  instant_sale jsonb,
  payout_id uuid
);

CREATE TEMP TABLE marketplace_wave1_errors (
  message text
);

INSERT INTO marketplace_wave1_state DEFAULT VALUES;

INSERT INTO public.users (
  id,
  email,
  display_name,
  balance_light,
  escrow_light,
  total_earned_light,
  stripe_connect_account_id,
  stripe_connect_payouts_enabled
) VALUES
  (
    '00000000-0000-0000-0000-000000000101',
    'wave1-seller@example.test',
    'Wave 1 Seller',
    0,
    0,
    0,
    'acct_wave1_seller',
    true
  ),
  (
    '00000000-0000-0000-0000-000000000102',
    'wave1-buyer@example.test',
    'Wave 1 Buyer',
    10000,
    0,
    0,
    NULL,
    false
  ),
  (
    '00000000-0000-0000-0000-000000000103',
    'wave1-rival@example.test',
    'Wave 1 Rival',
    10000,
    0,
    0,
    NULL,
    false
  );

INSERT INTO public.apps (
  id,
  owner_id,
  slug,
  name,
  storage_key,
  visibility,
  had_external_db
) VALUES
  (
    '00000000-0000-0000-0000-000000000201',
    '00000000-0000-0000-0000-000000000101',
    'wave-one-app',
    'Wave One App',
    'apps/wave-one-app.zip',
    'public',
    false
  ),
  (
    '00000000-0000-0000-0000-000000000202',
    '00000000-0000-0000-0000-000000000101',
    'wave-two-app',
    'Wave Two App',
    'apps/wave-two-app.zip',
    'public',
    false
  ),
  (
    '00000000-0000-0000-0000-000000000203',
    '00000000-0000-0000-0000-000000000101',
    'wave-three-external-app',
    'Wave Three External App',
    'apps/wave-three-external-app.zip',
    'public',
    true
  );

INSERT INTO public.app_listings (
  app_id,
  owner_id,
  floor_price_light,
  show_metrics
) VALUES (
  '00000000-0000-0000-0000-000000000201',
  '00000000-0000-0000-0000-000000000101',
  1000,
  true
);

SELECT is(
  (SELECT show_metrics FROM public.app_listings WHERE app_id = '00000000-0000-0000-0000-000000000201'),
  true,
  'listings expose show_metrics for marketplace trust/metrics cards'
);

UPDATE marketplace_wave1_state
SET first_bid_id = public.escrow_bid(
  '00000000-0000-0000-0000-000000000102',
  '00000000-0000-0000-0000-000000000201',
  4000,
  'Initial offer',
  NULL
);

SELECT ok(
  (SELECT first_bid_id IS NOT NULL FROM marketplace_wave1_state),
  'escrow_bid returns a bid id'
);

SELECT is(
  (SELECT balance_light::numeric FROM public.users WHERE id = '00000000-0000-0000-0000-000000000102'),
  6000::numeric,
  'bidding moves Light out of spendable balance'
);

SELECT is(
  (SELECT escrow_light::numeric FROM public.users WHERE id = '00000000-0000-0000-0000-000000000102'),
  4000::numeric,
  'bidding moves Light into escrow'
);

SELECT is(
  (SELECT amount_light::numeric FROM public.app_bids WHERE id = (SELECT first_bid_id FROM marketplace_wave1_state)),
  4000::numeric,
  'bid stores authoritative amount_light'
);

SELECT is(
  (SELECT amount_cents FROM public.app_bids WHERE id = (SELECT first_bid_id FROM marketplace_wave1_state)),
  4000,
  'bid keeps legacy amount_cents compatible'
);

SELECT public.cancel_bid(
  '00000000-0000-0000-0000-000000000102',
  (SELECT first_bid_id FROM marketplace_wave1_state)
);

SELECT is(
  (SELECT balance_light::numeric FROM public.users WHERE id = '00000000-0000-0000-0000-000000000102'),
  10000::numeric,
  'cancel_bid returns escrow to spendable balance'
);

SELECT is(
  (SELECT escrow_light::numeric FROM public.users WHERE id = '00000000-0000-0000-0000-000000000102'),
  0::numeric,
  'cancel_bid clears escrow'
);

SELECT is(
  (SELECT status FROM public.app_bids WHERE id = (SELECT first_bid_id FROM marketplace_wave1_state)),
  'cancelled',
  'cancel_bid marks bid cancelled'
);

UPDATE marketplace_wave1_state
SET accepted_bid_id = public.escrow_bid(
  '00000000-0000-0000-0000-000000000102',
  '00000000-0000-0000-0000-000000000201',
  4000,
  'Accepted offer',
  NULL
);

UPDATE marketplace_wave1_state
SET rival_bid_id = public.escrow_bid(
  '00000000-0000-0000-0000-000000000103',
  '00000000-0000-0000-0000-000000000201',
  2500,
  'Competing offer',
  NULL
);

INSERT INTO public.user_app_permissions (
  app_id,
  granted_to_user_id,
  granted_by_user_id,
  function_name,
  allowed
) VALUES (
  '00000000-0000-0000-0000-000000000201',
  '00000000-0000-0000-0000-000000000103',
  '00000000-0000-0000-0000-000000000101',
  'run',
  true
);

INSERT INTO public.user_app_secrets (
  user_id,
  app_id,
  key,
  value_encrypted
) VALUES (
  '00000000-0000-0000-0000-000000000101',
  '00000000-0000-0000-0000-000000000201',
  'API_KEY',
  'encrypted'
);

UPDATE marketplace_wave1_state
SET sale = public.accept_bid(
  '00000000-0000-0000-0000-000000000101',
  (SELECT accepted_bid_id FROM marketplace_wave1_state)
);

SELECT ok(
  (SELECT sale->>'sale_id' IS NOT NULL FROM marketplace_wave1_state),
  'accept_bid returns a sale id'
);

SELECT is(
  (SELECT balance_light::numeric FROM public.users WHERE id = '00000000-0000-0000-0000-000000000101'),
  3600::numeric,
  'accepted sale credits seller with 90 percent payout'
);

SELECT is(
  (SELECT total_earned_light::numeric FROM public.users WHERE id = '00000000-0000-0000-0000-000000000101'),
  3600::numeric,
  'accepted sale tracks seller earned Light'
);

SELECT is(
  (SELECT balance_light::numeric FROM public.users WHERE id = '00000000-0000-0000-0000-000000000102'),
  6000::numeric,
  'accepted sale leaves buyer spendable balance debited'
);

SELECT is(
  (SELECT escrow_light::numeric FROM public.users WHERE id = '00000000-0000-0000-0000-000000000102'),
  0::numeric,
  'accepted sale releases buyer escrow'
);

SELECT is(
  (SELECT balance_light::numeric FROM public.users WHERE id = '00000000-0000-0000-0000-000000000103'),
  10000::numeric,
  'accepted sale refunds competing bidder balance'
);

SELECT is(
  (SELECT escrow_light::numeric FROM public.users WHERE id = '00000000-0000-0000-0000-000000000103'),
  0::numeric,
  'accepted sale clears competing bidder escrow'
);

SELECT is(
  (SELECT owner_id::text FROM public.apps WHERE id = '00000000-0000-0000-0000-000000000201'),
  '00000000-0000-0000-0000-000000000102',
  'accepted sale transfers app ownership'
);

SELECT is(
  (SELECT status FROM public.app_bids WHERE id = (SELECT accepted_bid_id FROM marketplace_wave1_state)),
  'accepted',
  'accepted bid is marked accepted'
);

SELECT is(
  (SELECT status FROM public.app_bids WHERE id = (SELECT rival_bid_id FROM marketplace_wave1_state)),
  'rejected',
  'competing bid is marked rejected'
);

SELECT is(
  (SELECT COUNT(*)::integer FROM public.user_app_permissions WHERE app_id = '00000000-0000-0000-0000-000000000201'),
  0,
  'accepted sale clears app permission grants'
);

SELECT is(
  (SELECT COUNT(*)::integer FROM public.user_app_secrets WHERE app_id = '00000000-0000-0000-0000-000000000201'),
  0,
  'accepted sale clears app secrets'
);

SELECT is(
  (SELECT sale_price_light::numeric FROM public.app_sales WHERE id = ((SELECT sale FROM marketplace_wave1_state)->>'sale_id')::uuid),
  4000::numeric,
  'sale record stores Light sale price'
);

SELECT is(
  (SELECT sale_price_cents FROM public.app_sales WHERE id = ((SELECT sale FROM marketplace_wave1_state)->>'sale_id')::uuid),
  4000,
  'sale record keeps legacy sale_price_cents compatible'
);

SELECT is(
  (
    SELECT amount_light::numeric
    FROM public.transfers
    WHERE app_id = '00000000-0000-0000-0000-000000000201'
      AND reason = 'marketplace_sale'
  ),
  3600::numeric,
  'accepted sale logs seller payout transfer'
);

SELECT is(
  (SELECT status FROM public.app_listings WHERE app_id = '00000000-0000-0000-0000-000000000201'),
  'sold',
  'accepted sale marks listing sold'
);

INSERT INTO public.app_listings (
  app_id,
  owner_id,
  ask_price_light,
  instant_buy
) VALUES (
  '00000000-0000-0000-0000-000000000202',
  '00000000-0000-0000-0000-000000000101',
  3000,
  true
);

UPDATE marketplace_wave1_state
SET instant_sale = public.buy_now(
  '00000000-0000-0000-0000-000000000102',
  '00000000-0000-0000-0000-000000000202'
);

SELECT ok(
  (SELECT instant_sale->>'sale_id' IS NOT NULL FROM marketplace_wave1_state),
  'buy_now returns a sale id'
);

SELECT is(
  (SELECT balance_light::numeric FROM public.users WHERE id = '00000000-0000-0000-0000-000000000102'),
  3000::numeric,
  'buy_now debits buyer spendable balance without transient escrow'
);

SELECT is(
  (SELECT escrow_light::numeric FROM public.users WHERE id = '00000000-0000-0000-0000-000000000102'),
  0::numeric,
  'buy_now leaves buyer escrow unchanged'
);

SELECT is(
  (SELECT balance_light::numeric FROM public.users WHERE id = '00000000-0000-0000-0000-000000000101'),
  6300::numeric,
  'buy_now credits seller payout'
);

SELECT is(
  (SELECT owner_id::text FROM public.apps WHERE id = '00000000-0000-0000-0000-000000000202'),
  '00000000-0000-0000-0000-000000000102',
  'buy_now transfers app ownership'
);

SELECT is(
  (SELECT sale_price_light::numeric FROM public.app_sales WHERE id = ((SELECT instant_sale FROM marketplace_wave1_state)->>'sale_id')::uuid),
  3000::numeric,
  'buy_now records sale price'
);

DO $$
BEGIN
  PERFORM public.escrow_bid(
    '00000000-0000-0000-0000-000000000102',
    '00000000-0000-0000-0000-000000000203',
    1000,
    NULL,
    NULL
  );
EXCEPTION WHEN OTHERS THEN
  INSERT INTO marketplace_wave1_errors (message) VALUES (SQLERRM);
END;
$$;

SELECT ok(
  (SELECT message LIKE '%external database%' FROM marketplace_wave1_errors LIMIT 1),
  'external database apps cannot receive bids'
);

UPDATE public.users
SET escrow_light = 500
WHERE id = '00000000-0000-0000-0000-000000000101';

UPDATE marketplace_wave1_state
SET payout_id = public.create_payout_record(
  '00000000-0000-0000-0000-000000000101',
  6000,
  25,
  5975
);

SELECT ok(
  (SELECT payout_id IS NOT NULL FROM marketplace_wave1_state),
  'create_payout_record allows spendable balance even when escrow exists separately'
);

SELECT is(
  (SELECT balance_light::numeric FROM public.users WHERE id = '00000000-0000-0000-0000-000000000101'),
  300::numeric,
  'withdrawal debits spendable balance'
);

SELECT is(
  (SELECT escrow_light::numeric FROM public.users WHERE id = '00000000-0000-0000-0000-000000000101'),
  500::numeric,
  'withdrawal leaves escrow bucket untouched'
);

SELECT is(
  (SELECT amount_light::numeric FROM public.payouts WHERE id = (SELECT payout_id FROM marketplace_wave1_state)),
  6000::numeric,
  'payout record stores Light amount'
);

SELECT is(
  (
    SELECT amount_light::numeric
    FROM public.transfers
    WHERE reason = 'withdrawal'
      AND from_user_id = '00000000-0000-0000-0000-000000000101'
    ORDER BY created_at DESC
    LIMIT 1
  ),
  6000::numeric,
  'withdrawal logs Light transfer'
);

SELECT * FROM finish();

ROLLBACK;
