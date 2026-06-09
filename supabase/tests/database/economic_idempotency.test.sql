BEGIN;

SELECT plan(20);

CREATE TEMP TABLE economic_idempotency_test_state (
  first_transfer_id uuid,
  second_transfer_id uuid,
  first_cloud_event_id uuid,
  second_cloud_event_id uuid,
  first_hold_id uuid,
  second_hold_id uuid,
  first_settlement_event_id uuid,
  second_settlement_event_id uuid,
  first_embedding_charge_id uuid,
  second_embedding_charge_id uuid,
  first_failed_embedding_charge_id uuid,
  second_failed_embedding_charge_id uuid
);

INSERT INTO economic_idempotency_test_state DEFAULT VALUES;

INSERT INTO public.users (
  id,
  email,
  display_name,
  balance_light,
  escrow_light,
  total_earned_light
) VALUES
  (
    '00000000-0000-0000-0000-000000008101',
    'idem-payer@example.test',
    'Idempotency Payer',
    1000,
    0,
    0
  ),
  (
    '00000000-0000-0000-0000-000000008102',
    'idem-publisher@example.test',
    'Idempotency Publisher',
    10,
    0,
    0
  ),
  (
    '00000000-0000-0000-0000-000000008103',
    'idem-cloud@example.test',
    'Idempotency Cloud Payer',
    10,
    0,
    0
  ),
  (
    '00000000-0000-0000-0000-000000008104',
    'idem-empty-publisher@example.test',
    'Idempotency Empty Publisher',
    0,
    0,
    0
  );

INSERT INTO public.apps (
  id,
  owner_id,
  slug,
  name,
  storage_key,
  visibility,
  had_external_db
) VALUES (
  '00000000-0000-0000-0000-000000008201',
  '00000000-0000-0000-0000-000000008102',
  'economic-idempotency-app',
  'Economic Idempotency App',
  'apps/economic-idempotency-app.zip',
  'public',
  false
);

UPDATE economic_idempotency_test_state
SET first_transfer_id = t.transfer_id
FROM public.transfer_light(
  p_from_user => '00000000-0000-0000-0000-000000008101'::uuid,
  p_to_user => '00000000-0000-0000-0000-000000008102'::uuid,
  p_amount_light => 100,
  p_reason => 'tool_call',
  p_app_id => '00000000-0000-0000-0000-000000008201'::uuid,
  p_function_name => 'run',
  p_metadata => '{"source":"test"}'::jsonb,
  p_idempotency_key => 'idem-transfer-1'
) AS t;

UPDATE economic_idempotency_test_state
SET second_transfer_id = t.transfer_id
FROM public.transfer_light(
  p_from_user => '00000000-0000-0000-0000-000000008101'::uuid,
  p_to_user => '00000000-0000-0000-0000-000000008102'::uuid,
  p_amount_light => 100,
  p_reason => 'tool_call',
  p_app_id => '00000000-0000-0000-0000-000000008201'::uuid,
  p_function_name => 'run',
  p_metadata => '{"source":"test"}'::jsonb,
  p_idempotency_key => 'idem-transfer-1'
) AS t;

SELECT is(
  (SELECT second_transfer_id FROM economic_idempotency_test_state),
  (SELECT first_transfer_id FROM economic_idempotency_test_state),
  'transfer_light duplicate returns original transfer id'
);

SELECT is(
  (SELECT count(*)::integer FROM public.transfers WHERE idempotency_key = 'idem-transfer-1'),
  1,
  'transfer_light duplicate writes one transfer row'
);

SELECT is(
  (SELECT balance_light::numeric FROM public.users WHERE id = '00000000-0000-0000-0000-000000008101'),
  900::numeric,
  'transfer_light duplicate debits payer once'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.economic_idempotency_keys
    WHERE idempotency_key = 'idem-transfer-1'
      AND operation = 'transfer_light'
      AND status = 'completed'
  ),
  1,
  'transfer_light stores completed idempotency response'
);

UPDATE economic_idempotency_test_state
SET first_cloud_event_id = d.event_id
FROM public.debit_cloud_usage(
  p_payer_user_id => '00000000-0000-0000-0000-000000008103'::uuid,
  p_source => 'mcp',
  p_resource => 'worker_execution',
  p_units => 1,
  p_cloud_units => 1,
  p_amount_light => 0.1,
  p_app_id => '00000000-0000-0000-0000-000000008201'::uuid,
  p_function_name => 'run',
  p_receipt_id => 'receipt-cloud-idem',
  p_metadata => '{"source":"test"}'::jsonb,
  p_idempotency_key => 'idem-cloud-debit-1'
) AS d;

UPDATE economic_idempotency_test_state
SET second_cloud_event_id = d.event_id
FROM public.debit_cloud_usage(
  p_payer_user_id => '00000000-0000-0000-0000-000000008103'::uuid,
  p_source => 'mcp',
  p_resource => 'worker_execution',
  p_units => 1,
  p_cloud_units => 1,
  p_amount_light => 0.1,
  p_app_id => '00000000-0000-0000-0000-000000008201'::uuid,
  p_function_name => 'run',
  p_receipt_id => 'receipt-cloud-idem',
  p_metadata => '{"source":"test"}'::jsonb,
  p_idempotency_key => 'idem-cloud-debit-1'
) AS d;

SELECT is(
  (SELECT second_cloud_event_id FROM economic_idempotency_test_state),
  (SELECT first_cloud_event_id FROM economic_idempotency_test_state),
  'debit_cloud_usage duplicate returns original event id'
);

SELECT is(
  (SELECT count(*)::integer FROM public.cloud_usage_events WHERE idempotency_key = 'idem-cloud-debit-1'),
  1,
  'debit_cloud_usage duplicate writes one event row'
);

SELECT is(
  (SELECT round(balance_light::numeric, 1) FROM public.users WHERE id = '00000000-0000-0000-0000-000000008103'),
  9.9::numeric,
  'debit_cloud_usage duplicate debits payer once'
);

UPDATE economic_idempotency_test_state
SET first_hold_id = h.hold_id
FROM public.create_cloud_usage_hold(
  p_payer_user_id => '00000000-0000-0000-0000-000000008103'::uuid,
  p_source => 'mcp',
  p_resource => 'worker_execution',
  p_expected_units => 100,
  p_expected_cloud_units => 100,
  p_expected_amount_light => 0.5,
  p_app_id => '00000000-0000-0000-0000-000000008201'::uuid,
  p_function_name => 'run',
  p_receipt_id => 'receipt-hold-idem',
  p_metadata => '{"source":"test"}'::jsonb,
  p_idempotency_key => 'idem-hold-1'
) AS h;

UPDATE economic_idempotency_test_state
SET second_hold_id = h.hold_id
FROM public.create_cloud_usage_hold(
  p_payer_user_id => '00000000-0000-0000-0000-000000008103'::uuid,
  p_source => 'mcp',
  p_resource => 'worker_execution',
  p_expected_units => 100,
  p_expected_cloud_units => 100,
  p_expected_amount_light => 0.5,
  p_app_id => '00000000-0000-0000-0000-000000008201'::uuid,
  p_function_name => 'run',
  p_receipt_id => 'receipt-hold-idem',
  p_metadata => '{"source":"test"}'::jsonb,
  p_idempotency_key => 'idem-hold-1'
) AS h;

SELECT is(
  (SELECT second_hold_id FROM economic_idempotency_test_state),
  (SELECT first_hold_id FROM economic_idempotency_test_state),
  'create_cloud_usage_hold duplicate returns original hold id'
);

SELECT is(
  (SELECT count(*)::integer FROM public.cloud_usage_holds WHERE idempotency_key = 'idem-hold-1'),
  1,
  'create_cloud_usage_hold duplicate writes one hold row'
);

SELECT is(
  (SELECT round(balance_light::numeric, 1) FROM public.users WHERE id = '00000000-0000-0000-0000-000000008103'),
  9.4::numeric,
  'create_cloud_usage_hold duplicate reserves once'
);

UPDATE economic_idempotency_test_state
SET first_settlement_event_id = s.event_id
FROM public.settle_cloud_usage_hold(
  p_hold_id => (SELECT first_hold_id FROM economic_idempotency_test_state),
  p_units => 20,
  p_cloud_units => 20,
  p_amount_light => 0.2,
  p_metadata => '{"status":"ok"}'::jsonb,
  p_idempotency_key => 'idem-hold-settle-1'
) AS s;

UPDATE economic_idempotency_test_state
SET second_settlement_event_id = s.event_id
FROM public.settle_cloud_usage_hold(
  p_hold_id => (SELECT first_hold_id FROM economic_idempotency_test_state),
  p_units => 20,
  p_cloud_units => 20,
  p_amount_light => 0.2,
  p_metadata => '{"status":"ok"}'::jsonb,
  p_idempotency_key => 'idem-hold-settle-1'
) AS s;

SELECT is(
  (SELECT second_settlement_event_id FROM economic_idempotency_test_state),
  (SELECT first_settlement_event_id FROM economic_idempotency_test_state),
  'settle_cloud_usage_hold duplicate returns original settlement event'
);

SELECT is(
  (SELECT count(*)::integer FROM public.cloud_usage_events WHERE idempotency_key = 'idem-hold-settle-1'),
  1,
  'settle_cloud_usage_hold duplicate writes one event row'
);

SELECT is(
  (SELECT round(balance_light::numeric, 1) FROM public.users WHERE id = '00000000-0000-0000-0000-000000008103'),
  9.7::numeric,
  'settle_cloud_usage_hold duplicate releases unused hold once'
);

UPDATE economic_idempotency_test_state
SET first_embedding_charge_id = e.charge_id
FROM public.record_embedding_generation_charge(
  p_publisher_user_id => '00000000-0000-0000-0000-000000008102'::uuid,
  p_app_id => '00000000-0000-0000-0000-000000008201'::uuid,
  p_app_version => 'v1',
  p_model => 'embedding-model',
  p_prompt_tokens => 100,
  p_total_tokens => 1000,
  p_rate_light_per_1k_tokens => 1,
  p_metadata => '{"source":"test"}'::jsonb,
  p_idempotency_key => 'idem-embedding-1'
) AS e;

UPDATE economic_idempotency_test_state
SET second_embedding_charge_id = e.charge_id
FROM public.record_embedding_generation_charge(
  p_publisher_user_id => '00000000-0000-0000-0000-000000008102'::uuid,
  p_app_id => '00000000-0000-0000-0000-000000008201'::uuid,
  p_app_version => 'v1',
  p_model => 'embedding-model',
  p_prompt_tokens => 100,
  p_total_tokens => 1000,
  p_rate_light_per_1k_tokens => 1,
  p_metadata => '{"source":"test"}'::jsonb,
  p_idempotency_key => 'idem-embedding-1'
) AS e;

SELECT is(
  (SELECT second_embedding_charge_id FROM economic_idempotency_test_state),
  (SELECT first_embedding_charge_id FROM economic_idempotency_test_state),
  'record_embedding_generation_charge duplicate returns original charge id'
);

SELECT is(
  (SELECT count(*)::integer FROM public.embedding_generation_charges WHERE idempotency_key = 'idem-embedding-1'),
  1,
  'record_embedding_generation_charge duplicate writes one charge row'
);

SELECT is(
  (SELECT balance_light::numeric FROM public.users WHERE id = '00000000-0000-0000-0000-000000008102'),
  9::numeric,
  'record_embedding_generation_charge duplicate debits publisher once'
);

UPDATE economic_idempotency_test_state
SET first_failed_embedding_charge_id = e.charge_id
FROM public.record_embedding_generation_charge(
  p_publisher_user_id => '00000000-0000-0000-0000-000000008104'::uuid,
  p_app_id => '00000000-0000-0000-0000-000000008201'::uuid,
  p_app_version => 'v1',
  p_model => 'embedding-model',
  p_prompt_tokens => 100,
  p_total_tokens => 1000,
  p_rate_light_per_1k_tokens => 1,
  p_metadata => '{"source":"test"}'::jsonb,
  p_idempotency_key => 'idem-embedding-insufficient-1'
) AS e;

UPDATE economic_idempotency_test_state
SET second_failed_embedding_charge_id = e.charge_id
FROM public.record_embedding_generation_charge(
  p_publisher_user_id => '00000000-0000-0000-0000-000000008104'::uuid,
  p_app_id => '00000000-0000-0000-0000-000000008201'::uuid,
  p_app_version => 'v1',
  p_model => 'embedding-model',
  p_prompt_tokens => 100,
  p_total_tokens => 1000,
  p_rate_light_per_1k_tokens => 1,
  p_metadata => '{"source":"test"}'::jsonb,
  p_idempotency_key => 'idem-embedding-insufficient-1'
) AS e;

SELECT is(
  (SELECT second_failed_embedding_charge_id FROM economic_idempotency_test_state),
  (SELECT first_failed_embedding_charge_id FROM economic_idempotency_test_state),
  'failed embedding charge duplicate returns original charge id'
);

SELECT is(
  (
    SELECT status
    FROM public.embedding_generation_charges
    WHERE idempotency_key = 'idem-embedding-insufficient-1'
  ),
  'insufficient_balance',
  'failed embedding charge stores deterministic insufficient balance status'
);

SELECT is(
  (SELECT count(*)::integer FROM public.embedding_generation_charges WHERE idempotency_key = 'idem-embedding-insufficient-1'),
  1,
  'failed embedding charge duplicate writes one charge row'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.economic_idempotency_keys
    WHERE status = 'completed'
      AND idempotency_key IN (
        'idem-transfer-1',
        'idem-cloud-debit-1',
        'idem-hold-1',
        'idem-hold-settle-1',
        'idem-embedding-1',
        'idem-embedding-insufficient-1'
      )
  ),
  6,
  'economic idempotency table stores completed responses for replayed operations'
);

SELECT * FROM finish();

ROLLBACK;
