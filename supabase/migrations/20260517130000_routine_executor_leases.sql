-- Durable routine executor leasing and retry state.
-- These columns let scheduled Workers claim routines/runs atomically through
-- PostgREST filters without exposing long-lived user credentials to MCP code.

ALTER TABLE public.user_routines
  ADD COLUMN IF NOT EXISTS lease_id text,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamp with time zone;

ALTER TABLE public.routine_runs
  ADD COLUMN IF NOT EXISTS lease_id text,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS attempt_count integer DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS max_attempts integer DEFAULT 3 NOT NULL,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamp with time zone;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'routine_runs_attempt_count_check'
      AND conrelid = 'public.routine_runs'::regclass
  ) THEN
    ALTER TABLE public.routine_runs
      ADD CONSTRAINT routine_runs_attempt_count_check CHECK (attempt_count >= 0) NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'routine_runs_max_attempts_check'
      AND conrelid = 'public.routine_runs'::regclass
  ) THEN
    ALTER TABLE public.routine_runs
      ADD CONSTRAINT routine_runs_max_attempts_check CHECK (max_attempts >= 1) NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_user_routines_due_unleased
  ON public.user_routines (status, next_run_at, lease_expires_at)
  WHERE deleted_at IS NULL AND status = 'active';

CREATE INDEX IF NOT EXISTS idx_routine_runs_queued_unleased
  ON public.routine_runs (status, next_attempt_at, lease_expires_at, created_at)
  WHERE status = 'queued';

CREATE INDEX IF NOT EXISTS idx_routine_runs_active_by_routine
  ON public.routine_runs (routine_id, status, created_at)
  WHERE status IN ('queued', 'running');
