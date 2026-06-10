-- Platform-owned semantic embedding index for launch tool subjects.
--
-- This table is intentionally additive to apps.skills_embedding. The aggregate
-- app column remains the compatibility path while function/skill/widget/app
-- subject embeddings roll out through this normalized index.

CREATE EXTENSION IF NOT EXISTS "vector" WITH SCHEMA "public";

CREATE TABLE IF NOT EXISTS public.tool_semantic_embeddings (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  app_id uuid REFERENCES public.apps(id) ON DELETE CASCADE,
  app_version text NOT NULL DEFAULT 'unversioned',
  subject_type text NOT NULL,
  subject_id text NOT NULL,
  embedding public.vector(1536) NOT NULL,
  embedding_text text NOT NULL,
  embedding_text_hash text NOT NULL,
  model text NOT NULL,
  provider text NOT NULL,
  embedding_charge_id uuid REFERENCES public.embedding_generation_charges(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'ready',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT tool_semantic_embeddings_subject_type_check CHECK (
    subject_type IN ('app', 'function', 'skill', 'widget', 'platform_primitive')
  ),
  CONSTRAINT tool_semantic_embeddings_status_check CHECK (
    status IN ('pending', 'ready', 'failed', 'disabled')
  ),
  CONSTRAINT tool_semantic_embeddings_subject_id_check CHECK (btrim(subject_id) <> ''),
  CONSTRAINT tool_semantic_embeddings_embedding_text_hash_check CHECK (btrim(embedding_text_hash) <> ''),
  CONSTRAINT tool_semantic_embeddings_model_check CHECK (btrim(model) <> ''),
  CONSTRAINT tool_semantic_embeddings_provider_check CHECK (btrim(provider) <> ''),
  CONSTRAINT tool_semantic_embeddings_scope_check CHECK (
    (subject_type = 'platform_primitive' AND app_id IS NULL)
    OR (subject_type <> 'platform_primitive' AND app_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS tool_semantic_embeddings_app_idempotency_uidx
  ON public.tool_semantic_embeddings(
    app_id,
    app_version,
    subject_type,
    subject_id,
    embedding_text_hash,
    model,
    provider
  )
  WHERE app_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS tool_semantic_embeddings_platform_idempotency_uidx
  ON public.tool_semantic_embeddings(
    app_version,
    subject_type,
    subject_id,
    embedding_text_hash,
    model,
    provider
  )
  WHERE app_id IS NULL;

CREATE INDEX IF NOT EXISTS tool_semantic_embeddings_subject_lookup_idx
  ON public.tool_semantic_embeddings(app_id, app_version, subject_type, status);

CREATE INDEX IF NOT EXISTS tool_semantic_embeddings_charge_idx
  ON public.tool_semantic_embeddings(embedding_charge_id)
  WHERE embedding_charge_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS tool_semantic_embeddings_embedding_idx
  ON public.tool_semantic_embeddings
  USING ivfflat (embedding public.vector_cosine_ops)
  WITH (lists = 100)
  WHERE status = 'ready';

ALTER TABLE public.tool_semantic_embeddings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.tool_semantic_embeddings FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.tool_semantic_embeddings TO service_role;

DROP TRIGGER IF EXISTS touch_tool_semantic_embeddings_updated_at
  ON public.tool_semantic_embeddings;
CREATE TRIGGER touch_tool_semantic_embeddings_updated_at
BEFORE UPDATE ON public.tool_semantic_embeddings
FOR EACH ROW EXECUTE FUNCTION public.touch_fee_waiver_foundation_updated_at();

CREATE OR REPLACE FUNCTION public.upsert_tool_semantic_embedding(
  p_app_id uuid,
  p_app_version text,
  p_subject_type text,
  p_subject_id text,
  p_embedding public.vector,
  p_embedding_text text,
  p_embedding_text_hash text,
  p_model text,
  p_provider text,
  p_embedding_charge_id uuid DEFAULT NULL,
  p_status text DEFAULT 'ready',
  p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS TABLE(
  id uuid,
  app_id uuid,
  app_version text,
  subject_type text,
  subject_id text,
  embedding_text text,
  embedding_text_hash text,
  model text,
  provider text,
  embedding_charge_id uuid,
  status text,
  metadata jsonb,
  created_at timestamp with time zone,
  updated_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public, extensions'
AS $$
DECLARE
  v_existing_id uuid;
  v_app_version text := COALESCE(NULLIF(btrim(p_app_version), ''), 'unversioned');
  v_subject_type text := lower(COALESCE(NULLIF(btrim(p_subject_type), ''), ''));
  v_subject_id text := COALESCE(NULLIF(btrim(p_subject_id), ''), '');
  v_embedding_text text := COALESCE(p_embedding_text, '');
  v_embedding_text_hash text := COALESCE(NULLIF(btrim(p_embedding_text_hash), ''), '');
  v_model text := COALESCE(NULLIF(btrim(p_model), ''), 'unknown');
  v_provider text := COALESCE(NULLIF(btrim(p_provider), ''), 'unknown');
  v_status text := COALESCE(NULLIF(btrim(p_status), ''), 'ready');
  v_metadata jsonb := COALESCE(p_metadata, '{}'::jsonb);
BEGIN
  IF v_subject_type NOT IN ('app', 'function', 'skill', 'widget', 'platform_primitive') THEN
    RAISE EXCEPTION 'invalid tool semantic embedding subject type: %', p_subject_type;
  END IF;

  IF v_status NOT IN ('pending', 'ready', 'failed', 'disabled') THEN
    RAISE EXCEPTION 'invalid tool semantic embedding status: %', p_status;
  END IF;

  IF v_subject_type = 'platform_primitive' AND p_app_id IS NOT NULL THEN
    RAISE EXCEPTION 'platform primitive embeddings must not include app_id';
  END IF;

  IF v_subject_type <> 'platform_primitive' AND p_app_id IS NULL THEN
    RAISE EXCEPTION 'app_id is required for % embeddings', v_subject_type;
  END IF;

  IF v_subject_id = '' THEN
    RAISE EXCEPTION 'subject_id is required';
  END IF;

  IF v_embedding_text_hash = '' THEN
    RAISE EXCEPTION 'embedding_text_hash is required';
  END IF;

  SELECT tse.id
  INTO v_existing_id
  FROM public.tool_semantic_embeddings tse
  WHERE tse.app_id IS NOT DISTINCT FROM p_app_id
    AND tse.app_version = v_app_version
    AND tse.subject_type = v_subject_type
    AND tse.subject_id = v_subject_id
    AND tse.embedding_text_hash = v_embedding_text_hash
    AND tse.model = v_model
    AND tse.provider = v_provider
  LIMIT 1
  FOR UPDATE;

  IF v_existing_id IS NULL THEN
    INSERT INTO public.tool_semantic_embeddings (
      app_id,
      app_version,
      subject_type,
      subject_id,
      embedding,
      embedding_text,
      embedding_text_hash,
      model,
      provider,
      embedding_charge_id,
      status,
      metadata
    )
    VALUES (
      p_app_id,
      v_app_version,
      v_subject_type,
      v_subject_id,
      p_embedding,
      v_embedding_text,
      v_embedding_text_hash,
      v_model,
      v_provider,
      p_embedding_charge_id,
      v_status,
      v_metadata
    )
    RETURNING tool_semantic_embeddings.id INTO v_existing_id;
  ELSE
    UPDATE public.tool_semantic_embeddings tse
    SET
      embedding = p_embedding,
      embedding_text = v_embedding_text,
      embedding_charge_id = COALESCE(p_embedding_charge_id, tse.embedding_charge_id),
      status = v_status,
      metadata = COALESCE(tse.metadata, '{}'::jsonb) || v_metadata
    WHERE tse.id = v_existing_id;
  END IF;

  RETURN QUERY
  SELECT
    tse.id,
    tse.app_id,
    tse.app_version,
    tse.subject_type,
    tse.subject_id,
    tse.embedding_text,
    tse.embedding_text_hash,
    tse.model,
    tse.provider,
    tse.embedding_charge_id,
    tse.status,
    tse.metadata,
    tse.created_at,
    tse.updated_at
  FROM public.tool_semantic_embeddings tse
  WHERE tse.id = v_existing_id;
EXCEPTION WHEN unique_violation THEN
  SELECT tse.id
  INTO v_existing_id
  FROM public.tool_semantic_embeddings tse
  WHERE tse.app_id IS NOT DISTINCT FROM p_app_id
    AND tse.app_version = v_app_version
    AND tse.subject_type = v_subject_type
    AND tse.subject_id = v_subject_id
    AND tse.embedding_text_hash = v_embedding_text_hash
    AND tse.model = v_model
    AND tse.provider = v_provider
  LIMIT 1
  FOR UPDATE;

  UPDATE public.tool_semantic_embeddings tse
  SET
    embedding = p_embedding,
    embedding_text = v_embedding_text,
    embedding_charge_id = COALESCE(p_embedding_charge_id, tse.embedding_charge_id),
    status = v_status,
    metadata = COALESCE(tse.metadata, '{}'::jsonb) || v_metadata
  WHERE tse.id = v_existing_id;

  RETURN QUERY
  SELECT
    tse.id,
    tse.app_id,
    tse.app_version,
    tse.subject_type,
    tse.subject_id,
    tse.embedding_text,
    tse.embedding_text_hash,
    tse.model,
    tse.provider,
    tse.embedding_charge_id,
    tse.status,
    tse.metadata,
    tse.created_at,
    tse.updated_at
  FROM public.tool_semantic_embeddings tse
  WHERE tse.id = v_existing_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.search_tool_semantic_embeddings(
  p_query_embedding public.vector,
  p_match_threshold double precision DEFAULT 0.35,
  p_match_count integer DEFAULT 20,
  p_subject_types text[] DEFAULT NULL,
  p_app_version text DEFAULT NULL,
  p_visibility text[] DEFAULT ARRAY['public']::text[],
  p_include_platform_primitives boolean DEFAULT true
) RETURNS TABLE(
  embedding_id uuid,
  app_id uuid,
  app_version text,
  subject_type text,
  subject_id text,
  subject_label text,
  embedding_text text,
  embedding_text_hash text,
  model text,
  provider text,
  embedding_charge_id uuid,
  status text,
  metadata jsonb,
  similarity double precision,
  app_name text,
  app_slug text,
  app_description text,
  app_owner_id uuid,
  app_visibility text,
  app_current_version text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public, extensions'
AS $$
  WITH scored AS (
    SELECT
      tse.id AS embedding_id,
      tse.app_id,
      tse.app_version,
      tse.subject_type,
      tse.subject_id,
      COALESCE(
        NULLIF(tse.metadata ->> 'label', ''),
        NULLIF(tse.metadata ->> 'name', ''),
        tse.subject_id
      ) AS subject_label,
      tse.embedding_text,
      tse.embedding_text_hash,
      tse.model,
      tse.provider,
      tse.embedding_charge_id,
      tse.status,
      tse.metadata,
      1 - (tse.embedding OPERATOR(public.<=>) p_query_embedding) AS similarity,
      a.name AS app_name,
      a.slug AS app_slug,
      a.description AS app_description,
      a.owner_id AS app_owner_id,
      a.visibility AS app_visibility,
      a.current_version AS app_current_version
    FROM public.tool_semantic_embeddings tse
    LEFT JOIN public.apps a ON a.id = tse.app_id
    WHERE tse.status = 'ready'
      AND (p_subject_types IS NULL OR tse.subject_type = ANY(p_subject_types))
      AND (
        p_app_version IS NULL
        OR tse.app_version = p_app_version
      )
      AND (
        (
          tse.app_id IS NULL
          AND p_include_platform_primitives
        )
        OR (
          tse.app_id IS NOT NULL
          AND a.id IS NOT NULL
          AND a.deleted_at IS NULL
          AND (
            p_visibility IS NULL
            OR cardinality(p_visibility) = 0
            OR a.visibility = ANY(p_visibility)
          )
        )
      )
  )
  SELECT
    scored.embedding_id,
    scored.app_id,
    scored.app_version,
    scored.subject_type,
    scored.subject_id,
    scored.subject_label,
    scored.embedding_text,
    scored.embedding_text_hash,
    scored.model,
    scored.provider,
    scored.embedding_charge_id,
    scored.status,
    scored.metadata,
    scored.similarity,
    scored.app_name,
    scored.app_slug,
    scored.app_description,
    scored.app_owner_id,
    scored.app_visibility,
    scored.app_current_version
  FROM scored
  WHERE scored.similarity >= GREATEST(COALESCE(p_match_threshold, 0), -1)
  ORDER BY scored.similarity DESC
  LIMIT LEAST(GREATEST(COALESCE(p_match_count, 20), 1), 100);
$$;

REVOKE ALL ON FUNCTION public.upsert_tool_semantic_embedding(
  uuid,
  text,
  text,
  text,
  public.vector,
  text,
  text,
  text,
  text,
  uuid,
  text,
  jsonb
) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.search_tool_semantic_embeddings(
  public.vector,
  double precision,
  integer,
  text[],
  text,
  text[],
  boolean
) FROM PUBLIC, anon, authenticated;

GRANT ALL ON FUNCTION public.upsert_tool_semantic_embedding(
  uuid,
  text,
  text,
  text,
  public.vector,
  text,
  text,
  text,
  text,
  uuid,
  text,
  jsonb
) TO service_role;

GRANT ALL ON FUNCTION public.search_tool_semantic_embeddings(
  public.vector,
  double precision,
  integer,
  text[],
  text,
  text[],
  boolean
) TO service_role;
