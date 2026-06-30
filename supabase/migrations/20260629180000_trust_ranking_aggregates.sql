-- Phase 4: batch trust aggregates for discovery ranking.
--
-- One RPC returns, per app, the two earned trust signals that need a SQL
-- aggregate over the (RLS-locked) Phase 2/3 tables:
--   verifier_count   — DISTINCT callers who verified the Agent (gx.verify) AND
--                      also made a REAL, paid, successful call to it. Requiring
--                      a paid call is the Phase-2/3 deferral: a bare verify or a
--                      free call can't earn the ranking qualifier.
--   flag_pos/total_weight — weighted positive vs total post-call flags, so the
--                      read layer derives a flag_ratio.
-- SECURITY DEFINER so it can read app_verifications / app_call_flags, which are
-- REVOKE'd from the public roles; EXECUTE is granted only to service_role, so
-- the public PostgREST roles still cannot reach the per-actor rows.
CREATE OR REPLACE FUNCTION public.get_app_trust_aggregates(p_app_ids uuid[])
RETURNS TABLE(
  app_id uuid,
  verifier_count integer,
  flag_pos_weight real,
  flag_total_weight real
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH ids AS (
    SELECT DISTINCT unnest(p_app_ids) AS app_id
  ),
  v AS (
    SELECT av.app_id, count(DISTINCT av.user_id)::int AS verifier_count
    FROM public.app_verifications av
    WHERE av.app_id = ANY(p_app_ids)
      AND EXISTS (
        SELECT 1 FROM public.mcp_call_logs l
        WHERE l.app_id = av.app_id
          AND l.user_id = av.user_id
          AND l.success = true
          AND coalesce(l.call_charge_light, 0) > 0
      )
    GROUP BY av.app_id
  ),
  f AS (
    SELECT cf.app_id,
           sum(CASE WHEN cf.status = 'positive' THEN cf.weight ELSE 0 END)::real AS pos,
           sum(cf.weight)::real AS total
    FROM public.app_call_flags cf
    WHERE cf.app_id = ANY(p_app_ids)
    GROUP BY cf.app_id
  )
  SELECT ids.app_id,
         coalesce(v.verifier_count, 0) AS verifier_count,
         coalesce(f.pos, 0)::real AS flag_pos_weight,
         coalesce(f.total, 0)::real AS flag_total_weight
  FROM ids
  LEFT JOIN v ON v.app_id = ids.app_id
  LEFT JOIN f ON f.app_id = ids.app_id;
$$;

ALTER FUNCTION public.get_app_trust_aggregates(uuid[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_app_trust_aggregates(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_app_trust_aggregates(uuid[]) TO service_role;

-- The verified-reads probe filters mcp_call_logs by (app_id, user_id) for paid,
-- successful calls. A partial index makes each EXISTS check a single index probe
-- instead of scanning the (large, hot) call log.
CREATE INDEX IF NOT EXISTS idx_mcp_call_logs_app_user_paid
  ON public.mcp_call_logs (app_id, user_id)
  WHERE success = true AND call_charge_light > 0;
