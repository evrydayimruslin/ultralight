-- Secure legacy internal tables that are exposed by the public schema.
-- These tables are accessed by the API Worker with the Supabase service role;
-- product clients should not read or write them directly through PostgREST.

ALTER TABLE "public"."async_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."conversation_embeddings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."desktop_oauth_sessions" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."async_jobs" FROM "anon", "authenticated";
REVOKE ALL ON TABLE "public"."conversation_embeddings" FROM "anon", "authenticated";
REVOKE ALL ON TABLE "public"."desktop_oauth_sessions" FROM "anon", "authenticated";

GRANT ALL ON TABLE "public"."async_jobs" TO "service_role";
GRANT ALL ON TABLE "public"."conversation_embeddings" TO "service_role";
GRANT ALL ON TABLE "public"."desktop_oauth_sessions" TO "service_role";

-- The API Worker calls this RPC with the service role. Direct client access would
-- let callers choose an arbitrary p_user_id, so keep it server-only.
REVOKE ALL ON FUNCTION "public"."search_conversation_embeddings"(
  public.vector,
  uuid,
  double precision,
  integer
) FROM "anon", "authenticated";

GRANT ALL ON FUNCTION "public"."search_conversation_embeddings"(
  public.vector,
  uuid,
  double precision,
  integer
) TO "service_role";
