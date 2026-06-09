-- Routine trace and billing rollups.
-- Connects MCP calls, invocation telemetry, and cloud usage back to durable
-- routine runs so Command can show a complete outcome trace.

ALTER TABLE public.mcp_call_logs
  ADD COLUMN IF NOT EXISTS routine_id uuid,
  ADD COLUMN IF NOT EXISTS routine_run_id uuid,
  ADD COLUMN IF NOT EXISTS trace_id uuid,
  ADD COLUMN IF NOT EXISTS tool_invocation_id uuid;

ALTER TABLE public.tool_invocations
  ADD COLUMN IF NOT EXISTS receipt_id text,
  ADD COLUMN IF NOT EXISTS routine_id uuid,
  ADD COLUMN IF NOT EXISTS routine_run_id uuid;

ALTER TABLE public.cloud_usage_holds
  ADD COLUMN IF NOT EXISTS routine_id uuid,
  ADD COLUMN IF NOT EXISTS routine_run_id uuid,
  ADD COLUMN IF NOT EXISTS trace_id uuid;

ALTER TABLE public.cloud_usage_events
  ADD COLUMN IF NOT EXISTS routine_id uuid,
  ADD COLUMN IF NOT EXISTS routine_run_id uuid,
  ADD COLUMN IF NOT EXISTS trace_id uuid;

CREATE INDEX IF NOT EXISTS idx_mcp_call_logs_routine_run
  ON public.mcp_call_logs (routine_run_id, created_at DESC)
  WHERE routine_run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mcp_call_logs_routine_created
  ON public.mcp_call_logs (routine_id, created_at DESC)
  WHERE routine_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mcp_call_logs_trace
  ON public.mcp_call_logs (trace_id)
  WHERE trace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mcp_call_logs_tool_invocation
  ON public.mcp_call_logs (tool_invocation_id)
  WHERE tool_invocation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tool_invocations_routine_run
  ON public.tool_invocations (routine_run_id, started_at DESC)
  WHERE routine_run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tool_invocations_receipt
  ON public.tool_invocations (receipt_id)
  WHERE receipt_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cloud_usage_events_routine_run
  ON public.cloud_usage_events (routine_run_id, created_at DESC)
  WHERE routine_run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cloud_usage_events_trace
  ON public.cloud_usage_events (trace_id)
  WHERE trace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cloud_usage_holds_routine_run
  ON public.cloud_usage_holds (routine_run_id, created_at DESC)
  WHERE routine_run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cloud_usage_holds_trace
  ON public.cloud_usage_holds (trace_id)
  WHERE trace_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'mcp_call_logs_routine_id_fkey'
      AND conrelid = 'public.mcp_call_logs'::regclass
  ) THEN
    ALTER TABLE public.mcp_call_logs
      ADD CONSTRAINT mcp_call_logs_routine_id_fkey
      FOREIGN KEY (routine_id) REFERENCES public.user_routines(id)
      ON DELETE SET NULL
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'mcp_call_logs_routine_run_id_fkey'
      AND conrelid = 'public.mcp_call_logs'::regclass
  ) THEN
    ALTER TABLE public.mcp_call_logs
      ADD CONSTRAINT mcp_call_logs_routine_run_id_fkey
      FOREIGN KEY (routine_run_id) REFERENCES public.routine_runs(id)
      ON DELETE SET NULL
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'mcp_call_logs_tool_invocation_id_fkey'
      AND conrelid = 'public.mcp_call_logs'::regclass
  ) THEN
    ALTER TABLE public.mcp_call_logs
      ADD CONSTRAINT mcp_call_logs_tool_invocation_id_fkey
      FOREIGN KEY (tool_invocation_id) REFERENCES public.tool_invocations(id)
      ON DELETE SET NULL
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tool_invocations_routine_id_fkey'
      AND conrelid = 'public.tool_invocations'::regclass
  ) THEN
    ALTER TABLE public.tool_invocations
      ADD CONSTRAINT tool_invocations_routine_id_fkey
      FOREIGN KEY (routine_id) REFERENCES public.user_routines(id)
      ON DELETE SET NULL
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tool_invocations_routine_run_id_fkey'
      AND conrelid = 'public.tool_invocations'::regclass
  ) THEN
    ALTER TABLE public.tool_invocations
      ADD CONSTRAINT tool_invocations_routine_run_id_fkey
      FOREIGN KEY (routine_run_id) REFERENCES public.routine_runs(id)
      ON DELETE SET NULL
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'cloud_usage_events_routine_id_fkey'
      AND conrelid = 'public.cloud_usage_events'::regclass
  ) THEN
    ALTER TABLE public.cloud_usage_events
      ADD CONSTRAINT cloud_usage_events_routine_id_fkey
      FOREIGN KEY (routine_id) REFERENCES public.user_routines(id)
      ON DELETE SET NULL
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'cloud_usage_events_routine_run_id_fkey'
      AND conrelid = 'public.cloud_usage_events'::regclass
  ) THEN
    ALTER TABLE public.cloud_usage_events
      ADD CONSTRAINT cloud_usage_events_routine_run_id_fkey
      FOREIGN KEY (routine_run_id) REFERENCES public.routine_runs(id)
      ON DELETE SET NULL
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'cloud_usage_holds_routine_id_fkey'
      AND conrelid = 'public.cloud_usage_holds'::regclass
  ) THEN
    ALTER TABLE public.cloud_usage_holds
      ADD CONSTRAINT cloud_usage_holds_routine_id_fkey
      FOREIGN KEY (routine_id) REFERENCES public.user_routines(id)
      ON DELETE SET NULL
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'cloud_usage_holds_routine_run_id_fkey'
      AND conrelid = 'public.cloud_usage_holds'::regclass
  ) THEN
    ALTER TABLE public.cloud_usage_holds
      ADD CONSTRAINT cloud_usage_holds_routine_run_id_fkey
      FOREIGN KEY (routine_run_id) REFERENCES public.routine_runs(id)
      ON DELETE SET NULL
      NOT VALID;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.apply_routine_trace_metadata()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_uuid_regex text := '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
  v_routine_id text;
  v_routine_run_id text;
  v_trace_id text;
BEGIN
  NEW.metadata := COALESCE(NEW.metadata, '{}'::jsonb);
  v_routine_id := NULLIF(NEW.metadata ->> 'routine_id', '');
  v_routine_run_id := NULLIF(NEW.metadata ->> 'routine_run_id', '');
  v_trace_id := NULLIF(NEW.metadata ->> 'trace_id', '');

  IF NEW.routine_id IS NULL AND v_routine_id ~* v_uuid_regex THEN
    NEW.routine_id := v_routine_id::uuid;
  END IF;

  IF NEW.routine_run_id IS NULL AND v_routine_run_id ~* v_uuid_regex THEN
    NEW.routine_run_id := v_routine_run_id::uuid;
  END IF;

  IF NEW.trace_id IS NULL AND v_trace_id ~* v_uuid_regex THEN
    NEW.trace_id := v_trace_id::uuid;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS apply_routine_trace_metadata_on_cloud_usage_events
  ON public.cloud_usage_events;
CREATE TRIGGER apply_routine_trace_metadata_on_cloud_usage_events
  BEFORE INSERT OR UPDATE OF metadata
  ON public.cloud_usage_events
  FOR EACH ROW
  EXECUTE FUNCTION public.apply_routine_trace_metadata();

DROP TRIGGER IF EXISTS apply_routine_trace_metadata_on_cloud_usage_holds
  ON public.cloud_usage_holds;
CREATE TRIGGER apply_routine_trace_metadata_on_cloud_usage_holds
  BEFORE INSERT OR UPDATE OF metadata
  ON public.cloud_usage_holds
  FOR EACH ROW
  EXECUTE FUNCTION public.apply_routine_trace_metadata();

CREATE OR REPLACE FUNCTION public.record_routine_call_contribution(
  p_routine_id uuid,
  p_routine_run_id uuid,
  p_user_id uuid,
  p_app_id uuid DEFAULT NULL::uuid,
  p_app_ref text DEFAULT NULL::text,
  p_function_name text DEFAULT NULL::text,
  p_receipt_id text DEFAULT NULL::text,
  p_tool_invocation_id uuid DEFAULT NULL::uuid,
  p_status text DEFAULT 'succeeded'::text,
  p_duration_ms integer DEFAULT NULL::integer,
  p_cost_light double precision DEFAULT 0,
  p_args_preview jsonb DEFAULT '{}'::jsonb,
  p_result_preview jsonb DEFAULT '{}'::jsonb,
  p_error jsonb DEFAULT NULL::jsonb,
  p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS TABLE(
  step_id uuid,
  step_index integer,
  total_light double precision
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, extensions
AS $$
DECLARE
  v_status text := COALESCE(NULLIF(p_status, ''), 'succeeded');
  v_step_id uuid;
  v_step_index integer;
  v_total_light double precision;
  v_direct_light double precision := GREATEST(COALESCE(p_cost_light, 0), 0);
  v_cloud_light double precision := 0;
  v_cost_light double precision;
  v_receipt_id text := NULLIF(p_receipt_id, '');
BEGIN
  IF p_routine_id IS NULL THEN
    RAISE EXCEPTION 'Routine id is required';
  END IF;

  IF p_routine_run_id IS NULL THEN
    RAISE EXCEPTION 'Routine run id is required';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'User id is required';
  END IF;

  IF v_status NOT IN ('started', 'succeeded', 'failed', 'skipped') THEN
    RAISE EXCEPTION 'Invalid routine step status: %', v_status;
  END IF;

  IF p_duration_ms IS NOT NULL AND p_duration_ms < 0 THEN
    RAISE EXCEPTION 'Routine step duration must be non-negative';
  END IF;

  PERFORM 1
  FROM public.routine_runs
  WHERE id = p_routine_run_id
    AND routine_id = p_routine_id
    AND user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Routine run not found for user';
  END IF;

  IF v_receipt_id IS NOT NULL THEN
    SELECT COALESCE(SUM(amount_light), 0)
    INTO v_cloud_light
    FROM public.cloud_usage_events
    WHERE receipt_id = v_receipt_id;
  END IF;

  v_cost_light := v_direct_light + v_cloud_light;

  SELECT COALESCE(MAX(s.step_index), -1) + 1
  INTO v_step_index
  FROM public.routine_run_steps s
  WHERE s.run_id = p_routine_run_id;

  INSERT INTO public.routine_run_steps (
    run_id,
    routine_id,
    user_id,
    step_index,
    app_id,
    app_ref,
    function_name,
    receipt_id,
    tool_invocation_id,
    status,
    completed_at,
    duration_ms,
    cost_light,
    args_preview,
    result_preview,
    error,
    metadata
  ) VALUES (
    p_routine_run_id,
    p_routine_id,
    p_user_id,
    v_step_index,
    p_app_id,
    NULLIF(p_app_ref, ''),
    COALESCE(NULLIF(p_function_name, ''), 'unknown'),
    v_receipt_id,
    p_tool_invocation_id,
    v_status,
    CASE WHEN v_status IN ('succeeded', 'failed', 'skipped') THEN now() ELSE NULL END,
    p_duration_ms,
    v_cost_light,
    COALESCE(p_args_preview, '{}'::jsonb),
    COALESCE(p_result_preview, '{}'::jsonb),
    p_error,
    COALESCE(p_metadata, '{}'::jsonb)
      || jsonb_build_object(
        'direct_light', v_direct_light,
        'cloud_usage_light', v_cloud_light
      )
  )
  RETURNING id INTO v_step_id;

  UPDATE public.routine_runs AS runs
  SET
    total_light = COALESCE(runs.total_light, 0) + v_cost_light,
    metadata = COALESCE(runs.metadata, '{}'::jsonb)
      || jsonb_strip_nulls(jsonb_build_object(
        'last_receipt_id', v_receipt_id,
        'last_tool_invocation_id', p_tool_invocation_id,
        'last_contribution_step_id', v_step_id,
        'last_contribution_at', now()
      ))
  WHERE runs.id = p_routine_run_id
  RETURNING runs.total_light INTO v_total_light;

  RETURN QUERY SELECT v_step_id, v_step_index, v_total_light;
END;
$$;

REVOKE ALL ON FUNCTION public.record_routine_call_contribution(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  uuid,
  text,
  integer,
  double precision,
  jsonb,
  jsonb,
  jsonb,
  jsonb
) FROM anon, authenticated;

GRANT ALL ON FUNCTION public.record_routine_call_contribution(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  uuid,
  text,
  integer,
  double precision,
  jsonb,
  jsonb,
  jsonb,
  jsonb
) TO service_role;
