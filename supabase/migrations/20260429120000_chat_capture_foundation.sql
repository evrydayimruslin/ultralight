-- Phase 1 chat capture foundation.
-- Raw chat and artifact records are service-role only; product clients do not
-- receive direct table access.

CREATE TABLE IF NOT EXISTS "public"."capture_subjects" (
    "anon_user_id" "text" PRIMARY KEY,
    "user_id" "uuid" REFERENCES "public"."users"("id") ON DELETE SET NULL,
    "pepper_version" "text" NOT NULL DEFAULT 'v1',
    "first_seen_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_seen_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL
);

CREATE TABLE IF NOT EXISTS "public"."chat_threads" (
    "conversation_id" "text" PRIMARY KEY,
    "anon_user_id" "text" NOT NULL REFERENCES "public"."capture_subjects"("anon_user_id") ON DELETE RESTRICT,
    "source" "text" NOT NULL DEFAULT 'orchestrate',
    "capture_region" "text" NOT NULL DEFAULT 'us',
    "trace_id" "uuid",
    "model_route" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "scope" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "first_captured_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_captured_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

CREATE TABLE IF NOT EXISTS "public"."chat_messages" (
    "message_id" "text" PRIMARY KEY,
    "conversation_id" "text" NOT NULL REFERENCES "public"."chat_threads"("conversation_id") ON DELETE RESTRICT,
    "anon_user_id" "text" NOT NULL REFERENCES "public"."capture_subjects"("anon_user_id") ON DELETE RESTRICT,
    "role" "text" NOT NULL,
    "content" "text" NOT NULL DEFAULT '',
    "content_sha256" "text",
    "content_bytes" integer DEFAULT 0 NOT NULL,
    "sort_order" integer,
    "model" "text",
    "usage" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "cost_light" double precision,
    "source" "text" NOT NULL DEFAULT 'orchestrate',
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "captured_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "chat_messages_role_check" CHECK (("role" = ANY (ARRAY['system'::"text", 'user'::"text", 'assistant'::"text", 'tool'::"text", 'developer'::"text", 'event'::"text"])))
);

CREATE TABLE IF NOT EXISTS "public"."chat_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() PRIMARY KEY,
    "trace_id" "uuid" NOT NULL,
    "conversation_id" "text" NOT NULL REFERENCES "public"."chat_threads"("conversation_id") ON DELETE RESTRICT,
    "message_id" "text",
    "anon_user_id" "text" NOT NULL REFERENCES "public"."capture_subjects"("anon_user_id") ON DELETE RESTRICT,
    "event_type" "text" NOT NULL,
    "event_sequence" integer NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "payload_sha256" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    UNIQUE ("trace_id", "event_sequence")
);

CREATE TABLE IF NOT EXISTS "public"."capture_artifacts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() PRIMARY KEY,
    "idempotency_key" "text" NOT NULL UNIQUE,
    "anon_user_id" "text" NOT NULL REFERENCES "public"."capture_subjects"("anon_user_id") ON DELETE RESTRICT,
    "conversation_id" "text" REFERENCES "public"."chat_threads"("conversation_id") ON DELETE RESTRICT,
    "message_id" "text",
    "event_id" "uuid",
    "source" "text" NOT NULL,
    "sha256" "text" NOT NULL,
    "storage_key" "text" NOT NULL,
    "storage_region" "text" NOT NULL DEFAULT 'us',
    "mime_type" "text" NOT NULL DEFAULT 'application/octet-stream',
    "original_filename" "text",
    "size_bytes" bigint NOT NULL DEFAULT 0,
    "text_preview" "text",
    "parser_status" "text" NOT NULL DEFAULT 'pending',
    "sensitivity_class" "text" NOT NULL DEFAULT 'unknown',
    "training_eligibility" "text" NOT NULL DEFAULT 'pending',
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

CREATE TABLE IF NOT EXISTS "public"."capture_artifact_links" (
    "id" "uuid" DEFAULT "gen_random_uuid"() PRIMARY KEY,
    "idempotency_key" "text" NOT NULL UNIQUE,
    "artifact_id" "uuid" NOT NULL REFERENCES "public"."capture_artifacts"("id") ON DELETE RESTRICT,
    "conversation_id" "text" REFERENCES "public"."chat_threads"("conversation_id") ON DELETE RESTRICT,
    "message_id" "text",
    "event_id" "uuid",
    "relationship" "text" NOT NULL DEFAULT 'attached_to',
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

CREATE TABLE IF NOT EXISTS "public"."capture_access_audit" (
    "id" "uuid" DEFAULT "gen_random_uuid"() PRIMARY KEY,
    "actor_user_id" "uuid",
    "actor_service" "text",
    "anon_user_id" "text",
    "action" "text" NOT NULL,
    "table_name" "text",
    "record_id" "text",
    "reason" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

CREATE TABLE IF NOT EXISTS "public"."derived_signals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() PRIMARY KEY,
    "anon_user_id" "text" NOT NULL REFERENCES "public"."capture_subjects"("anon_user_id") ON DELETE RESTRICT,
    "conversation_id" "text" REFERENCES "public"."chat_threads"("conversation_id") ON DELETE RESTRICT,
    "message_id" "text",
    "artifact_id" "uuid" REFERENCES "public"."capture_artifacts"("id") ON DELETE RESTRICT,
    "signal_type" "text" NOT NULL,
    "label" "text" NOT NULL,
    "confidence" double precision,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "provenance" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "model" "text",
    "status" "text" NOT NULL DEFAULT 'pending_review',
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_capture_subjects_user_id" ON "public"."capture_subjects" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_chat_threads_anon_updated" ON "public"."chat_threads" ("anon_user_id", "updated_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_chat_messages_conversation_order" ON "public"."chat_messages" ("conversation_id", "sort_order", "captured_at");
CREATE INDEX IF NOT EXISTS "idx_chat_messages_anon_captured" ON "public"."chat_messages" ("anon_user_id", "captured_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_chat_events_conversation_sequence" ON "public"."chat_events" ("conversation_id", "event_sequence");
CREATE INDEX IF NOT EXISTS "idx_chat_events_type_created" ON "public"."chat_events" ("event_type", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_capture_artifacts_sha256" ON "public"."capture_artifacts" ("sha256");
CREATE INDEX IF NOT EXISTS "idx_capture_artifacts_conversation" ON "public"."capture_artifacts" ("conversation_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_capture_artifact_links_artifact" ON "public"."capture_artifact_links" ("artifact_id");
CREATE INDEX IF NOT EXISTS "idx_capture_artifact_links_conversation" ON "public"."capture_artifact_links" ("conversation_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_capture_access_audit_created" ON "public"."capture_access_audit" ("created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_derived_signals_type_label" ON "public"."derived_signals" ("signal_type", "label");
CREATE INDEX IF NOT EXISTS "idx_derived_signals_conversation" ON "public"."derived_signals" ("conversation_id", "created_at" DESC);

ALTER TABLE "public"."capture_subjects" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."chat_threads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."chat_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."chat_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."capture_artifacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."capture_artifact_links" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."capture_access_audit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."derived_signals" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."capture_subjects" FROM "anon", "authenticated";
REVOKE ALL ON TABLE "public"."chat_threads" FROM "anon", "authenticated";
REVOKE ALL ON TABLE "public"."chat_messages" FROM "anon", "authenticated";
REVOKE ALL ON TABLE "public"."chat_events" FROM "anon", "authenticated";
REVOKE ALL ON TABLE "public"."capture_artifacts" FROM "anon", "authenticated";
REVOKE ALL ON TABLE "public"."capture_artifact_links" FROM "anon", "authenticated";
REVOKE ALL ON TABLE "public"."capture_access_audit" FROM "anon", "authenticated";
REVOKE ALL ON TABLE "public"."derived_signals" FROM "anon", "authenticated";

GRANT ALL ON TABLE "public"."capture_subjects" TO "service_role";
GRANT ALL ON TABLE "public"."chat_threads" TO "service_role";
GRANT ALL ON TABLE "public"."chat_messages" TO "service_role";
GRANT ALL ON TABLE "public"."chat_events" TO "service_role";
GRANT ALL ON TABLE "public"."capture_artifacts" TO "service_role";
GRANT ALL ON TABLE "public"."capture_artifact_links" TO "service_role";
GRANT ALL ON TABLE "public"."capture_access_audit" TO "service_role";
GRANT ALL ON TABLE "public"."derived_signals" TO "service_role";
