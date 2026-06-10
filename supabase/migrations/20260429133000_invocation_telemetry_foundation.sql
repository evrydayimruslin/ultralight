-- Invocation telemetry foundation.
-- Captures model calls, exact context snapshots, tool calls, failures, and
-- future training/signal annotations. Service-role only.

CREATE TABLE IF NOT EXISTS "public"."llm_invocations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() PRIMARY KEY,
    "invocation_id" "text" NOT NULL UNIQUE,
    "trace_id" "uuid",
    "conversation_id" "text",
    "anon_user_id" "text" REFERENCES "public"."capture_subjects"("anon_user_id") ON DELETE SET NULL,
    "source" "text" NOT NULL,
    "phase" "text",
    "provider" "text",
    "requested_model" "text",
    "resolved_model" "text",
    "billing_mode" "text",
    "key_source" "text",
    "request_params" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "context_snapshot_id" "uuid",
    "context_sha256" "text",
    "context_bytes" integer DEFAULT 0 NOT NULL,
    "context_message_count" integer DEFAULT 0 NOT NULL,
    "tool_schema_count" integer DEFAULT 0 NOT NULL,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone,
    "duration_ms" integer,
    "status" "text" NOT NULL DEFAULT 'started',
    "finish_reason" "text",
    "usage" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "cost_light" double precision,
    "error_type" "text",
    "error_message" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL
);

CREATE TABLE IF NOT EXISTS "public"."llm_context_snapshots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() PRIMARY KEY,
    "invocation_id" "text" NOT NULL REFERENCES "public"."llm_invocations"("invocation_id") ON DELETE CASCADE,
    "trace_id" "uuid",
    "conversation_id" "text",
    "anon_user_id" "text" REFERENCES "public"."capture_subjects"("anon_user_id") ON DELETE SET NULL,
    "source" "text" NOT NULL,
    "snapshot_type" "text" NOT NULL DEFAULT 'llm_request',
    "message_count" integer DEFAULT 0 NOT NULL,
    "tool_schema_count" integer DEFAULT 0 NOT NULL,
    "artifact_id" "uuid" REFERENCES "public"."capture_artifacts"("id") ON DELETE SET NULL,
    "sha256" "text",
    "size_bytes" integer DEFAULT 0 NOT NULL,
    "text_preview" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

CREATE TABLE IF NOT EXISTS "public"."tool_invocations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() PRIMARY KEY,
    "invocation_id" "text" NOT NULL UNIQUE,
    "trace_id" "uuid",
    "conversation_id" "text",
    "parent_llm_invocation_id" "text",
    "anon_user_id" "text" REFERENCES "public"."capture_subjects"("anon_user_id") ON DELETE SET NULL,
    "source" "text" NOT NULL,
    "tool_call_id" "text",
    "tool_name" "text" NOT NULL,
    "tool_kind" "text" NOT NULL DEFAULT 'function',
    "app_id" "text",
    "mcp_id" "text",
    "function_name" "text",
    "schema_snapshot" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "args_preview" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "args_artifact_id" "uuid" REFERENCES "public"."capture_artifacts"("id") ON DELETE SET NULL,
    "args_sha256" "text",
    "args_bytes" integer DEFAULT 0 NOT NULL,
    "result_preview" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "result_artifact_id" "uuid" REFERENCES "public"."capture_artifacts"("id") ON DELETE SET NULL,
    "result_sha256" "text",
    "result_bytes" integer DEFAULT 0 NOT NULL,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone,
    "duration_ms" integer,
    "status" "text" NOT NULL DEFAULT 'started',
    "error_type" "text",
    "error_message" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL
);

CREATE TABLE IF NOT EXISTS "public"."execution_failures" (
    "id" "uuid" DEFAULT "gen_random_uuid"() PRIMARY KEY,
    "failure_id" "text" NOT NULL UNIQUE,
    "trace_id" "uuid",
    "conversation_id" "text",
    "invocation_id" "text",
    "anon_user_id" "text" REFERENCES "public"."capture_subjects"("anon_user_id") ON DELETE SET NULL,
    "source" "text" NOT NULL,
    "phase" "text" NOT NULL,
    "failure_type" "text" NOT NULL,
    "severity" "text" NOT NULL DEFAULT 'error',
    "message" "text",
    "retryable" boolean,
    "aborted_by" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

CREATE TABLE IF NOT EXISTS "public"."training_annotations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() PRIMARY KEY,
    "target_type" "text" NOT NULL,
    "target_id" "text" NOT NULL,
    "conversation_id" "text",
    "message_id" "text",
    "llm_invocation_id" "text",
    "tool_invocation_id" "text",
    "artifact_id" "uuid" REFERENCES "public"."capture_artifacts"("id") ON DELETE SET NULL,
    "annotation_type" "text" NOT NULL,
    "label" "text" NOT NULL,
    "confidence" double precision,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "taxonomy_version" "text" NOT NULL DEFAULT 'v0',
    "classifier_model" "text",
    "classifier_version" "text",
    "status" "text" NOT NULL DEFAULT 'pending_review',
    "reviewed_by" "uuid",
    "reviewed_at" timestamp with time zone,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE "public"."llm_invocations"
  DROP CONSTRAINT IF EXISTS "llm_invocations_status_check";
ALTER TABLE "public"."llm_invocations"
  ADD CONSTRAINT "llm_invocations_status_check"
  CHECK ("status" = ANY (ARRAY['started'::"text", 'success'::"text", 'error'::"text", 'aborted'::"text", 'timeout'::"text"]));

ALTER TABLE "public"."tool_invocations"
  DROP CONSTRAINT IF EXISTS "tool_invocations_status_check";
ALTER TABLE "public"."tool_invocations"
  ADD CONSTRAINT "tool_invocations_status_check"
  CHECK ("status" = ANY (ARRAY['started'::"text", 'success'::"text", 'error'::"text", 'aborted'::"text", 'timeout'::"text"]));

CREATE INDEX IF NOT EXISTS "idx_llm_invocations_conversation_started" ON "public"."llm_invocations" ("conversation_id", "started_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_llm_invocations_anon_started" ON "public"."llm_invocations" ("anon_user_id", "started_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_llm_invocations_status_started" ON "public"."llm_invocations" ("status", "started_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_llm_context_snapshots_invocation" ON "public"."llm_context_snapshots" ("invocation_id");
CREATE INDEX IF NOT EXISTS "idx_tool_invocations_conversation_started" ON "public"."tool_invocations" ("conversation_id", "started_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_tool_invocations_parent_llm" ON "public"."tool_invocations" ("parent_llm_invocation_id");
CREATE INDEX IF NOT EXISTS "idx_tool_invocations_name_started" ON "public"."tool_invocations" ("tool_name", "started_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_execution_failures_conversation_created" ON "public"."execution_failures" ("conversation_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_execution_failures_type_created" ON "public"."execution_failures" ("failure_type", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_training_annotations_target" ON "public"."training_annotations" ("target_type", "target_id");
CREATE INDEX IF NOT EXISTS "idx_training_annotations_type_label" ON "public"."training_annotations" ("annotation_type", "label");

ALTER TABLE "public"."llm_invocations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."llm_context_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."tool_invocations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."execution_failures" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."training_annotations" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."llm_invocations" FROM "anon", "authenticated";
REVOKE ALL ON TABLE "public"."llm_context_snapshots" FROM "anon", "authenticated";
REVOKE ALL ON TABLE "public"."tool_invocations" FROM "anon", "authenticated";
REVOKE ALL ON TABLE "public"."execution_failures" FROM "anon", "authenticated";
REVOKE ALL ON TABLE "public"."training_annotations" FROM "anon", "authenticated";

GRANT ALL ON TABLE "public"."llm_invocations" TO "service_role";
GRANT ALL ON TABLE "public"."llm_context_snapshots" TO "service_role";
GRANT ALL ON TABLE "public"."tool_invocations" TO "service_role";
GRANT ALL ON TABLE "public"."execution_failures" TO "service_role";
GRANT ALL ON TABLE "public"."training_annotations" TO "service_role";
