-- Capability suggestion telemetry foundation.
-- Captures ambient capability intents, suggestion sets, individual suggested
-- apps, and user/system events for revealed-preference training data.
-- Service-role only; product clients write through API endpoints.

CREATE TABLE IF NOT EXISTS "public"."capability_intents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() PRIMARY KEY,
    "user_id" "uuid" REFERENCES "public"."users"("id") ON DELETE SET NULL,
    "anon_user_id" "text" REFERENCES "public"."capture_subjects"("anon_user_id") ON DELETE SET NULL,
    "conversation_id" "text",
    "trace_id" "uuid",
    "message_id" "text",
    "source" "text" NOT NULL DEFAULT 'orchestrate',
    "intent_type" "text" NOT NULL DEFAULT 'ambient_tool_suggestion',
    "intent_summary" "text",
    "query_text" "text",
    "query_sha256" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

CREATE TABLE IF NOT EXISTS "public"."capability_suggestion_sets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() PRIMARY KEY,
    "intent_id" "uuid" REFERENCES "public"."capability_intents"("id") ON DELETE SET NULL,
    "user_id" "uuid" REFERENCES "public"."users"("id") ON DELETE SET NULL,
    "anon_user_id" "text" REFERENCES "public"."capture_subjects"("anon_user_id") ON DELETE SET NULL,
    "conversation_id" "text",
    "trace_id" "uuid",
    "message_id" "text",
    "source" "text" NOT NULL DEFAULT 'flash_broker',
    "retrieval_source" "text" NOT NULL DEFAULT 'ambient_marketplace_embedding',
    "query_text" "text",
    "query_sha256" "text",
    "candidate_count" integer DEFAULT 0 NOT NULL,
    "suggestion_count" integer DEFAULT 0 NOT NULL,
    "top_similarity" double precision,
    "min_similarity" double precision,
    "weak_match" boolean DEFAULT false NOT NULL,
    "no_match" boolean DEFAULT false NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

CREATE TABLE IF NOT EXISTS "public"."capability_suggestions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() PRIMARY KEY,
    "suggestion_set_id" "uuid" REFERENCES "public"."capability_suggestion_sets"("id") ON DELETE CASCADE,
    "intent_id" "uuid" REFERENCES "public"."capability_intents"("id") ON DELETE SET NULL,
    "user_id" "uuid" REFERENCES "public"."users"("id") ON DELETE SET NULL,
    "anon_user_id" "text" REFERENCES "public"."capture_subjects"("anon_user_id") ON DELETE SET NULL,
    "conversation_id" "text",
    "trace_id" "uuid",
    "message_id" "text",
    "app_id" "uuid",
    "app_slug" "text",
    "app_name" "text",
    "app_type" "text" NOT NULL DEFAULT 'app',
    "suggestion_source" "text" NOT NULL DEFAULT 'marketplace',
    "rank" integer,
    "similarity" double precision,
    "key_functions" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

CREATE TABLE IF NOT EXISTS "public"."capability_suggestion_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() PRIMARY KEY,
    "event_type" "text" NOT NULL,
    "intent_id" "uuid" REFERENCES "public"."capability_intents"("id") ON DELETE SET NULL,
    "suggestion_set_id" "uuid" REFERENCES "public"."capability_suggestion_sets"("id") ON DELETE SET NULL,
    "suggestion_id" "uuid" REFERENCES "public"."capability_suggestions"("id") ON DELETE SET NULL,
    "user_id" "uuid" REFERENCES "public"."users"("id") ON DELETE SET NULL,
    "anon_user_id" "text" REFERENCES "public"."capture_subjects"("anon_user_id") ON DELETE SET NULL,
    "conversation_id" "text",
    "trace_id" "uuid",
    "message_id" "text",
    "app_id" "uuid",
    "app_slug" "text",
    "event_source" "text" NOT NULL DEFAULT 'server',
    "library_installed" boolean DEFAULT false NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "capability_suggestion_events_type_check"
      CHECK ("event_type" = ANY (ARRAY[
        'suggested'::"text",
        'viewed'::"text",
        'accepted'::"text",
        'dismissed'::"text",
        'installed'::"text",
        'used'::"text",
        'failed'::"text",
        'weak_match'::"text",
        'no_match'::"text"
      ]))
);

CREATE INDEX IF NOT EXISTS "idx_capability_intents_conversation"
  ON "public"."capability_intents" ("conversation_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_capability_intents_trace"
  ON "public"."capability_intents" ("trace_id");
CREATE INDEX IF NOT EXISTS "idx_capability_intents_user"
  ON "public"."capability_intents" ("user_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_capability_suggestion_sets_intent"
  ON "public"."capability_suggestion_sets" ("intent_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_capability_suggestion_sets_conversation"
  ON "public"."capability_suggestion_sets" ("conversation_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_capability_suggestion_sets_trace"
  ON "public"."capability_suggestion_sets" ("trace_id");

CREATE INDEX IF NOT EXISTS "idx_capability_suggestions_set"
  ON "public"."capability_suggestions" ("suggestion_set_id", "rank");
CREATE INDEX IF NOT EXISTS "idx_capability_suggestions_app"
  ON "public"."capability_suggestions" ("app_id", "created_at" DESC)
  WHERE "app_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_capability_suggestions_conversation"
  ON "public"."capability_suggestions" ("conversation_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_capability_suggestion_events_conversation"
  ON "public"."capability_suggestion_events" ("conversation_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_capability_suggestion_events_suggestion"
  ON "public"."capability_suggestion_events" ("suggestion_id", "created_at" DESC)
  WHERE "suggestion_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_capability_suggestion_events_type"
  ON "public"."capability_suggestion_events" ("event_type", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_capability_suggestion_events_app_type"
  ON "public"."capability_suggestion_events" ("app_id", "event_type", "created_at" DESC)
  WHERE "app_id" IS NOT NULL;

ALTER TABLE "public"."capability_intents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."capability_suggestion_sets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."capability_suggestions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."capability_suggestion_events" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."capability_intents" FROM "anon", "authenticated";
REVOKE ALL ON TABLE "public"."capability_suggestion_sets" FROM "anon", "authenticated";
REVOKE ALL ON TABLE "public"."capability_suggestions" FROM "anon", "authenticated";
REVOKE ALL ON TABLE "public"."capability_suggestion_events" FROM "anon", "authenticated";

GRANT ALL ON TABLE "public"."capability_intents" TO "service_role";
GRANT ALL ON TABLE "public"."capability_suggestion_sets" TO "service_role";
GRANT ALL ON TABLE "public"."capability_suggestions" TO "service_role";
GRANT ALL ON TABLE "public"."capability_suggestion_events" TO "service_role";
