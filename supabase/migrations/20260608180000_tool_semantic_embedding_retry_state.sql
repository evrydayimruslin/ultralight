-- NS-8 retry/backfill support for tool semantic embeddings.
--
-- Failed and pending subject embeddings need an index row before a provider
-- vector exists so operators can retry deterministically without corrupting
-- existing ready rows. Ready rows remain searchable only when a vector exists.

ALTER TABLE public.tool_semantic_embeddings
  ALTER COLUMN embedding DROP NOT NULL;

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
      AND tse.embedding IS NOT NULL
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

REVOKE ALL ON FUNCTION public.search_tool_semantic_embeddings(
  public.vector,
  double precision,
  integer,
  text[],
  text,
  text[],
  boolean
) FROM PUBLIC, anon, authenticated;

GRANT ALL ON FUNCTION public.search_tool_semantic_embeddings(
  public.vector,
  double precision,
  integer,
  text[],
  text,
  text[],
  boolean
) TO service_role;
