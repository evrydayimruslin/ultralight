-- Durable async execution (PR3 of docs/DURABLE_EXECUTION_ROADMAP.md).
--
-- async_jobs becomes the source of truth for queue-executed jobs: a job is
-- created in status 'queued' at dispatch time (with everything the queue
-- consumer needs to reconstruct the execution), claimed 'queued' -> 'running'
-- by the consumer (the optimistic claim is the at-least-once idempotency
-- guard), and finished 'completed' / 'failed'. All additive.

-- The execution request, persisted so the queue message can carry only the
-- job id (Queues messages cap at 128KB; args can approach the body limit).
ALTER TABLE public.async_jobs
  ADD COLUMN IF NOT EXISTS args jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Cross-Agent attribution, mirrored from the dispatching call so the consumer
-- can rebuild the caller context (grant-cap spend, hop ceiling, receipts).
-- The user's bearer token is deliberately NOT persisted.
ALTER TABLE public.async_jobs
  ADD COLUMN IF NOT EXISTS caller_app_id uuid,
  ADD COLUMN IF NOT EXISTS caller_grant_id uuid,
  ADD COLUMN IF NOT EXISTS hop integer;

-- When the consumer actually began executing (claim time). The stale-job
-- sweeper keys off this — created_at would kill jobs that waited in a backlog.
ALTER TABLE public.async_jobs
  ADD COLUMN IF NOT EXISTS started_at timestamptz;

-- Consumer claim scan + sweeper support.
CREATE INDEX IF NOT EXISTS async_jobs_status_created_idx
  ON public.async_jobs (status, created_at);

-- Backfill: every pre-existing row was created directly in 'running' by the
-- old in-request promotion; treat its creation time as its start time.
UPDATE public.async_jobs SET started_at = created_at WHERE started_at IS NULL;
