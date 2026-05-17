-- Durable routines foundation.
-- Stores user-approved routine instances, approved downstream capabilities,
-- run history, per-run steps, and Command dashboard bindings.

CREATE TABLE IF NOT EXISTS public.user_routines (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL,
  composer_app_id uuid,
  composer_app_slug text,
  template_id text NOT NULL,
  template_version text,
  name text NOT NULL,
  description text,
  intent text,
  handler_function text NOT NULL,
  status text DEFAULT 'paused'::text NOT NULL,
  schedule jsonb DEFAULT '{}'::jsonb NOT NULL,
  config jsonb DEFAULT '{}'::jsonb NOT NULL,
  budget_policy jsonb DEFAULT '{}'::jsonb NOT NULL,
  approval_policy jsonb DEFAULT '{}'::jsonb NOT NULL,
  max_concurrency integer DEFAULT 1 NOT NULL,
  next_run_at timestamp with time zone,
  last_run_at timestamp with time zone,
  last_success_at timestamp with time zone,
  last_error_at timestamp with time zone,
  failure_count integer DEFAULT 0 NOT NULL,
  created_by_trace_id uuid,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  deleted_at timestamp with time zone,
  CONSTRAINT user_routines_status_check CHECK (
    status = ANY (ARRAY[
      'active'::text,
      'paused'::text,
      'disabled'::text,
      'deleted'::text,
      'error'::text
    ])
  ),
  CONSTRAINT user_routines_concurrency_check CHECK (max_concurrency >= 1),
  CONSTRAINT user_routines_failure_count_check CHECK (failure_count >= 0)
);

ALTER TABLE public.user_routines OWNER TO postgres;

ALTER TABLE ONLY public.user_routines
  ADD CONSTRAINT user_routines_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.user_routines
  ADD CONSTRAINT user_routines_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_routines
  ADD CONSTRAINT user_routines_composer_app_id_fkey
  FOREIGN KEY (composer_app_id) REFERENCES public.apps(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_user_routines_user_status
  ON public.user_routines (user_id, status, updated_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_user_routines_due
  ON public.user_routines (status, next_run_at)
  WHERE deleted_at IS NULL AND status = 'active';

CREATE INDEX IF NOT EXISTS idx_user_routines_composer_template
  ON public.user_routines (composer_app_id, template_id)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.routine_capabilities (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  routine_id uuid NOT NULL,
  user_id uuid NOT NULL,
  app_id uuid,
  app_ref text NOT NULL,
  function_name text NOT NULL,
  access text DEFAULT 'read'::text NOT NULL,
  required boolean DEFAULT true NOT NULL,
  purpose text,
  approved boolean DEFAULT false NOT NULL,
  approved_at timestamp with time zone,
  approved_by_user_id uuid,
  pricing_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
  constraints jsonb DEFAULT '{}'::jsonb NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT routine_capabilities_access_check CHECK (
    access = ANY (ARRAY['read'::text, 'write'::text])
  )
);

ALTER TABLE public.routine_capabilities OWNER TO postgres;

ALTER TABLE ONLY public.routine_capabilities
  ADD CONSTRAINT routine_capabilities_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.routine_capabilities
  ADD CONSTRAINT routine_capabilities_routine_id_fkey
  FOREIGN KEY (routine_id) REFERENCES public.user_routines(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.routine_capabilities
  ADD CONSTRAINT routine_capabilities_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.routine_capabilities
  ADD CONSTRAINT routine_capabilities_app_id_fkey
  FOREIGN KEY (app_id) REFERENCES public.apps(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.routine_capabilities
  ADD CONSTRAINT routine_capabilities_approved_by_user_id_fkey
  FOREIGN KEY (approved_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_routine_capabilities_unique
  ON public.routine_capabilities (routine_id, app_ref, function_name, access);

CREATE INDEX IF NOT EXISTS idx_routine_capabilities_user
  ON public.routine_capabilities (user_id, routine_id);

CREATE INDEX IF NOT EXISTS idx_routine_capabilities_app
  ON public.routine_capabilities (app_ref, function_name);

CREATE TABLE IF NOT EXISTS public.routine_runs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  routine_id uuid NOT NULL,
  user_id uuid NOT NULL,
  status text DEFAULT 'queued'::text NOT NULL,
  trigger text DEFAULT 'scheduled'::text NOT NULL,
  trace_id uuid,
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  duration_ms integer,
  total_light double precision DEFAULT 0 NOT NULL,
  summary text,
  error jsonb,
  run_config jsonb DEFAULT '{}'::jsonb NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT routine_runs_status_check CHECK (
    status = ANY (ARRAY[
      'queued'::text,
      'running'::text,
      'succeeded'::text,
      'failed'::text,
      'cancelled'::text,
      'skipped'::text
    ])
  ),
  CONSTRAINT routine_runs_total_light_check CHECK (total_light >= 0)
);

ALTER TABLE public.routine_runs OWNER TO postgres;

ALTER TABLE ONLY public.routine_runs
  ADD CONSTRAINT routine_runs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.routine_runs
  ADD CONSTRAINT routine_runs_routine_id_fkey
  FOREIGN KEY (routine_id) REFERENCES public.user_routines(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.routine_runs
  ADD CONSTRAINT routine_runs_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_routine_runs_routine_created
  ON public.routine_runs (routine_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_routine_runs_user_created
  ON public.routine_runs (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_routine_runs_trace
  ON public.routine_runs (trace_id)
  WHERE trace_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.routine_run_steps (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  run_id uuid NOT NULL,
  routine_id uuid NOT NULL,
  user_id uuid NOT NULL,
  step_index integer NOT NULL,
  app_id uuid,
  app_ref text,
  function_name text NOT NULL,
  receipt_id text,
  tool_invocation_id uuid,
  status text DEFAULT 'started'::text NOT NULL,
  started_at timestamp with time zone DEFAULT now(),
  completed_at timestamp with time zone,
  duration_ms integer,
  cost_light double precision DEFAULT 0 NOT NULL,
  args_preview jsonb DEFAULT '{}'::jsonb NOT NULL,
  result_preview jsonb DEFAULT '{}'::jsonb NOT NULL,
  error jsonb,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT routine_run_steps_status_check CHECK (
    status = ANY (ARRAY[
      'started'::text,
      'succeeded'::text,
      'failed'::text,
      'skipped'::text
    ])
  ),
  CONSTRAINT routine_run_steps_step_index_check CHECK (step_index >= 0),
  CONSTRAINT routine_run_steps_cost_light_check CHECK (cost_light >= 0)
);

ALTER TABLE public.routine_run_steps OWNER TO postgres;

ALTER TABLE ONLY public.routine_run_steps
  ADD CONSTRAINT routine_run_steps_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.routine_run_steps
  ADD CONSTRAINT routine_run_steps_run_id_fkey
  FOREIGN KEY (run_id) REFERENCES public.routine_runs(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.routine_run_steps
  ADD CONSTRAINT routine_run_steps_routine_id_fkey
  FOREIGN KEY (routine_id) REFERENCES public.user_routines(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.routine_run_steps
  ADD CONSTRAINT routine_run_steps_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.routine_run_steps
  ADD CONSTRAINT routine_run_steps_app_id_fkey
  FOREIGN KEY (app_id) REFERENCES public.apps(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.routine_run_steps
  ADD CONSTRAINT routine_run_steps_tool_invocation_id_fkey
  FOREIGN KEY (tool_invocation_id) REFERENCES public.tool_invocations(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_routine_run_steps_unique
  ON public.routine_run_steps (run_id, step_index);

CREATE INDEX IF NOT EXISTS idx_routine_run_steps_routine_created
  ON public.routine_run_steps (routine_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_routine_run_steps_receipt
  ON public.routine_run_steps (receipt_id)
  WHERE receipt_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.routine_dashboard_bindings (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  routine_id uuid NOT NULL,
  user_id uuid NOT NULL,
  dashboard_key text DEFAULT 'command_home'::text NOT NULL,
  app_id uuid,
  app_ref text,
  widget_id text NOT NULL,
  card_id text,
  config jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.routine_dashboard_bindings OWNER TO postgres;

ALTER TABLE ONLY public.routine_dashboard_bindings
  ADD CONSTRAINT routine_dashboard_bindings_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.routine_dashboard_bindings
  ADD CONSTRAINT routine_dashboard_bindings_routine_id_fkey
  FOREIGN KEY (routine_id) REFERENCES public.user_routines(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.routine_dashboard_bindings
  ADD CONSTRAINT routine_dashboard_bindings_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.routine_dashboard_bindings
  ADD CONSTRAINT routine_dashboard_bindings_app_id_fkey
  FOREIGN KEY (app_id) REFERENCES public.apps(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_routine_dashboard_bindings_unique
  ON public.routine_dashboard_bindings (routine_id, dashboard_key, widget_id, COALESCE(card_id, ''));

CREATE INDEX IF NOT EXISTS idx_routine_dashboard_bindings_user
  ON public.routine_dashboard_bindings (user_id, dashboard_key);

ALTER TABLE public.user_routines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.routine_capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.routine_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.routine_run_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.routine_dashboard_bindings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_routines_own"
  ON public.user_routines
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "routine_capabilities_own"
  ON public.routine_capabilities
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "routine_runs_own"
  ON public.routine_runs
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "routine_run_steps_own"
  ON public.routine_run_steps
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "routine_dashboard_bindings_own"
  ON public.routine_dashboard_bindings
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

GRANT ALL ON TABLE public.user_routines TO anon;
GRANT ALL ON TABLE public.user_routines TO authenticated;
GRANT ALL ON TABLE public.user_routines TO service_role;

GRANT ALL ON TABLE public.routine_capabilities TO anon;
GRANT ALL ON TABLE public.routine_capabilities TO authenticated;
GRANT ALL ON TABLE public.routine_capabilities TO service_role;

GRANT ALL ON TABLE public.routine_runs TO anon;
GRANT ALL ON TABLE public.routine_runs TO authenticated;
GRANT ALL ON TABLE public.routine_runs TO service_role;

GRANT ALL ON TABLE public.routine_run_steps TO anon;
GRANT ALL ON TABLE public.routine_run_steps TO authenticated;
GRANT ALL ON TABLE public.routine_run_steps TO service_role;

GRANT ALL ON TABLE public.routine_dashboard_bindings TO anon;
GRANT ALL ON TABLE public.routine_dashboard_bindings TO authenticated;
GRANT ALL ON TABLE public.routine_dashboard_bindings TO service_role;
