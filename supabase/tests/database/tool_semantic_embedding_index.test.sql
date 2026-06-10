BEGIN;

SELECT plan(12);

CREATE OR REPLACE FUNCTION pg_temp.tool_semantic_test_vector(seed double precision)
RETURNS public.vector
LANGUAGE sql
AS $$
  SELECT (
    '[' ||
    string_agg(
      CASE WHEN idx = 1 THEN seed::text ELSE '0' END,
      ','
      ORDER BY idx
    ) ||
    ']'
  )::public.vector
  FROM generate_series(1, 1536) AS dimensions(idx);
$$;

CREATE TEMP TABLE tool_semantic_test_state (
  first_app_embedding_id uuid,
  duplicate_app_embedding_id uuid,
  versioned_app_embedding_id uuid,
  function_embedding_id uuid,
  skill_embedding_id uuid,
  private_function_embedding_id uuid
);

INSERT INTO tool_semantic_test_state DEFAULT VALUES;

INSERT INTO public.users (
  id,
  email,
  display_name,
  balance_light,
  escrow_light,
  total_earned_light
) VALUES (
  '00000000-0000-0000-0000-000000009101',
  'tool-semantic-owner@example.test',
  'Tool Semantic Owner',
  1000,
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
  current_version
) VALUES
  (
    '00000000-0000-0000-0000-000000009201',
    '00000000-0000-0000-0000-000000009101',
    'tool-semantic-public',
    'Tool Semantic Public',
    'apps/tool-semantic-public.zip',
    'public',
    '1.0.0'
  ),
  (
    '00000000-0000-0000-0000-000000009202',
    '00000000-0000-0000-0000-000000009101',
    'tool-semantic-private',
    'Tool Semantic Private',
    'apps/tool-semantic-private.zip',
    'private',
    '1.0.0'
  );

UPDATE tool_semantic_test_state
SET first_app_embedding_id = inserted.id
FROM public.upsert_tool_semantic_embedding(
  p_app_id => '00000000-0000-0000-0000-000000009201'::uuid,
  p_app_version => '1.0.0',
  p_subject_type => 'app',
  p_subject_id => 'app',
  p_embedding => pg_temp.tool_semantic_test_vector(1.0),
  p_embedding_text => 'Tool Semantic Public app summary',
  p_embedding_text_hash => 'hash-app-v1',
  p_model => 'openai/text-embedding-3-small',
  p_provider => 'openrouter',
  p_metadata => '{"label":"Tool Semantic Public"}'::jsonb
) AS inserted;

SELECT is(
  (SELECT first_app_embedding_id IS NOT NULL FROM tool_semantic_test_state),
  true,
  'app-level semantic embedding can be inserted'
);

UPDATE tool_semantic_test_state
SET duplicate_app_embedding_id = inserted.id
FROM public.upsert_tool_semantic_embedding(
  p_app_id => '00000000-0000-0000-0000-000000009201'::uuid,
  p_app_version => '1.0.0',
  p_subject_type => 'app',
  p_subject_id => 'app',
  p_embedding => pg_temp.tool_semantic_test_vector(1.0),
  p_embedding_text => 'Tool Semantic Public app summary retry',
  p_embedding_text_hash => 'hash-app-v1',
  p_model => 'openai/text-embedding-3-small',
  p_provider => 'openrouter',
  p_metadata => '{"retry":true}'::jsonb
) AS inserted;

SELECT is(
  (SELECT duplicate_app_embedding_id FROM tool_semantic_test_state),
  (SELECT first_app_embedding_id FROM tool_semantic_test_state),
  'duplicate app/version/subject/text/model/provider upsert returns the same row'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.tool_semantic_embeddings
    WHERE app_id = '00000000-0000-0000-0000-000000009201'
      AND app_version = '1.0.0'
      AND subject_type = 'app'
      AND embedding_text_hash = 'hash-app-v1'
  ),
  1,
  'duplicate app embedding upsert writes one row'
);

UPDATE tool_semantic_test_state
SET versioned_app_embedding_id = inserted.id
FROM public.upsert_tool_semantic_embedding(
  p_app_id => '00000000-0000-0000-0000-000000009201'::uuid,
  p_app_version => '2.0.0',
  p_subject_type => 'app',
  p_subject_id => 'app',
  p_embedding => pg_temp.tool_semantic_test_vector(1.0),
  p_embedding_text => 'Tool Semantic Public v2 app summary',
  p_embedding_text_hash => 'hash-app-v1',
  p_model => 'openai/text-embedding-3-small',
  p_provider => 'openrouter',
  p_metadata => '{"label":"Tool Semantic Public v2"}'::jsonb
) AS inserted;

SELECT is(
  (
    SELECT versioned_app_embedding_id IS DISTINCT FROM first_app_embedding_id
    FROM tool_semantic_test_state
  ),
  true,
  'new app version gets a distinct semantic embedding row'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.tool_semantic_embeddings
    WHERE app_id = '00000000-0000-0000-0000-000000009201'
      AND subject_type = 'app'
      AND embedding_text_hash = 'hash-app-v1'
  ),
  2,
  'semantic embedding rows are version-aware'
);

UPDATE tool_semantic_test_state
SET function_embedding_id = inserted.id
FROM public.upsert_tool_semantic_embedding(
  p_app_id => '00000000-0000-0000-0000-000000009201'::uuid,
  p_app_version => '1.0.0',
  p_subject_type => 'function',
  p_subject_id => 'function:search',
  p_embedding => pg_temp.tool_semantic_test_vector(1.0),
  p_embedding_text => 'Search records and return ranked matches',
  p_embedding_text_hash => 'hash-function-search-v1',
  p_model => 'openai/text-embedding-3-small',
  p_provider => 'openrouter',
  p_metadata => '{"label":"search"}'::jsonb
) AS inserted;

UPDATE tool_semantic_test_state
SET skill_embedding_id = inserted.id
FROM public.upsert_tool_semantic_embedding(
  p_app_id => '00000000-0000-0000-0000-000000009201'::uuid,
  p_app_version => '1.0.0',
  p_subject_type => 'skill',
  p_subject_id => 'skill:research',
  p_embedding => pg_temp.tool_semantic_test_vector(1.0),
  p_embedding_text => 'Research workflow context and examples',
  p_embedding_text_hash => 'hash-skill-research-v1',
  p_model => 'openai/text-embedding-3-small',
  p_provider => 'openrouter',
  p_metadata => '{"label":"research"}'::jsonb
) AS inserted;

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.tool_semantic_embeddings
    WHERE app_id = '00000000-0000-0000-0000-000000009201'
      AND app_version = '1.0.0'
      AND subject_type IN ('function', 'skill')
  ),
  2,
  'function and skill semantic embedding rows can be inserted'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.search_tool_semantic_embeddings(
      pg_temp.tool_semantic_test_vector(1.0),
      0.9,
      10,
      ARRAY['function', 'skill']::text[],
      '1.0.0',
      ARRAY['public']::text[],
      false
    )
  ),
  2,
  'semantic search can return function and skill matches'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.search_tool_semantic_embeddings(
      pg_temp.tool_semantic_test_vector(1.0),
      0.9,
      10,
      ARRAY['function']::text[],
      '1.0.0',
      ARRAY['public']::text[],
      false
    )
    WHERE subject_id = 'function:search'
  ),
  1,
  'semantic search can filter to function subjects'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.search_tool_semantic_embeddings(
      pg_temp.tool_semantic_test_vector(1.0),
      0.9,
      10,
      ARRAY['skill']::text[],
      '1.0.0',
      ARRAY['public']::text[],
      false
    )
    WHERE subject_id = 'skill:research'
  ),
  1,
  'semantic search can filter to skill subjects'
);

UPDATE tool_semantic_test_state
SET private_function_embedding_id = inserted.id
FROM public.upsert_tool_semantic_embedding(
  p_app_id => '00000000-0000-0000-0000-000000009202'::uuid,
  p_app_version => '1.0.0',
  p_subject_type => 'function',
  p_subject_id => 'function:hidden',
  p_embedding => pg_temp.tool_semantic_test_vector(1.0),
  p_embedding_text => 'Hidden function',
  p_embedding_text_hash => 'hash-function-hidden-v1',
  p_model => 'openai/text-embedding-3-small',
  p_provider => 'openrouter'
) AS inserted;

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.search_tool_semantic_embeddings(
      pg_temp.tool_semantic_test_vector(1.0),
      0.9,
      10,
      ARRAY['function']::text[],
      '1.0.0',
      ARRAY['public']::text[],
      false
    )
    WHERE subject_id = 'function:hidden'
  ),
  0,
  'semantic search respects app visibility'
);

UPDATE tool_semantic_test_state
SET private_function_embedding_id = inserted.id
FROM public.upsert_tool_semantic_embedding(
  p_app_id => '00000000-0000-0000-0000-000000009201'::uuid,
  p_app_version => '1.0.0',
  p_subject_type => 'function',
  p_subject_id => 'function:failed',
  p_embedding => NULL::public.vector,
  p_embedding_text => 'Failed function retry marker',
  p_embedding_text_hash => 'hash-function-failed-v1',
  p_model => 'openai/text-embedding-3-small',
  p_provider => 'openrouter',
  p_status => 'failed',
  p_metadata => '{"failure_stage":"provider"}'::jsonb
) AS inserted;

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.search_tool_semantic_embeddings(
      pg_temp.tool_semantic_test_vector(1.0),
      0.9,
      10,
      ARRAY['function']::text[],
      '1.0.0',
      ARRAY['public']::text[],
      false
    )
    WHERE subject_id = 'function:failed'
  ),
  0,
  'failed semantic embedding rows can omit vectors and stay out of search'
);

UPDATE public.apps
SET skills_embedding = pg_temp.tool_semantic_test_vector(1.0)
WHERE id = '00000000-0000-0000-0000-000000009201';

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.search_apps(
      pg_temp.tool_semantic_test_vector(1.0),
      '00000000-0000-0000-0000-000000000000'::uuid,
      10,
      0
    )
    WHERE id = '00000000-0000-0000-0000-000000009201'
  ),
  1,
  'legacy app embedding search continues to work'
);

SELECT * FROM finish();

ROLLBACK;
