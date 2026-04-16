// Async Job Service
// Manages transparent async promotion for long-running sandbox executions.
// Jobs are created in 'running' state when execution exceeds the promotion threshold.
// The execution continues in-process; this service tracks state in Supabase.

import { getEnv } from '../lib/env.ts';

function supabaseHeaders() {
  return {
    'apikey': getEnv('SUPABASE_SERVICE_ROLE_KEY'),
    'Authorization': `Bearer ${getEnv('SUPABASE_SERVICE_ROLE_KEY')}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
  };
}

/** Max result size before offloading to R2 (1MB) */
const MAX_RESULT_SIZE = 1_000_000;

/** Max concurrent async jobs per server instance */
const MAX_CONCURRENT_JOBS = 20;

/** Stale job threshold — jobs running longer than this are considered dead (3 min) */
const STALE_JOB_MS = 180_000;

/** In-flight job counter for this instance */
let activeJobCount = 0;

export interface AsyncJob {
  id: string;
  app_id: string;
  user_id: string;
  owner_id: string;
  function_name: string;
  status: 'running' | 'completed' | 'failed';
  result: unknown;
  result_r2_key: string | null;
  error: unknown;
  logs: unknown[];
  duration_ms: number | null;
  ai_cost_light: number;
  execution_id: string;
  server_instance: string;
  completed_at: string | null;
  expires_at: string;
  meta: Record<string, unknown>;
  created_at: string;
}

/** Get a stable server instance identifier for crash detection */
export function getServerInstance(): string {
  // Use a combination of startup time + random suffix for uniqueness across restarts
  return serverInstance;
}

const serverInstance = `deno-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/** Check if we can accept another async job */
export function canAcceptAsyncJob(): boolean {
  return activeJobCount < MAX_CONCURRENT_JOBS;
}

/** Create a job record when promoting execution to async */
export async function createJob(params: {
  appId: string;
  userId: string;
  ownerId: string;
  functionName: string;
  executionId: string;
  meta?: Record<string, unknown>;
}): Promise<string> {
  const jobId = crypto.randomUUID();
  activeJobCount++;

  const res = await fetch(`${getEnv('SUPABASE_URL')}/rest/v1/async_jobs`, {
    method: 'POST',
    headers: supabaseHeaders(),
    body: JSON.stringify({
      id: jobId,
      app_id: params.appId,
      user_id: params.userId,
      owner_id: params.ownerId,
      function_name: params.functionName,
      status: 'running',
      execution_id: params.executionId,
      server_instance: serverInstance,
      meta: params.meta || {},
    }),
  });

  if (!res.ok) {
    activeJobCount--;
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`Failed to create async job: ${err}`);
  }

  return jobId;
}

/** Complete a job with its result */
export async function completeJob(jobId: string, result: {
  success: boolean;
  result: unknown;
  logs: unknown[];
  durationMs: number;
  aiCostLight: number;
}): Promise<void> {
  activeJobCount = Math.max(0, activeJobCount - 1);

  // Check result size — offload to R2 if too large
  let storedResult = result.success ? result.result : null;
  let resultR2Key: string | null = null;

  try {
    const serialized = JSON.stringify(storedResult);
    if (serialized && serialized.length > MAX_RESULT_SIZE) {
      // Store in R2 and save key
      resultR2Key = `async-jobs/${jobId}/result.json`;
      await storeResultInR2(resultR2Key, storedResult);
      storedResult = { _r2: true, key: resultR2Key, size: serialized.length };
    }
  } catch {
    storedResult = { _error: 'Result could not be serialized' };
  }

  const updatePayload: Record<string, unknown> = {
    status: 'completed',
    result: storedResult,
    result_r2_key: resultR2Key,
    error: result.success ? null : result.result,
    logs: (result.logs || []).slice(0, 100), // Cap log entries
    duration_ms: result.durationMs,
    ai_cost_light: result.aiCostLight,
    completed_at: new Date().toISOString(),
  };

  const res = await fetch(
    `${getEnv('SUPABASE_URL')}/rest/v1/async_jobs?id=eq.${jobId}`,
    {
      method: 'PATCH',
      headers: supabaseHeaders(),
      body: JSON.stringify(updatePayload),
    }
  );

  if (!res.ok) {
    console.error(`[ASYNC-JOBS] Failed to complete job ${jobId}:`, await res.text().catch(() => ''));
  }
}

/** Fail a job */
export async function failJob(jobId: string, error: {
  type: string;
  message: string;
}, durationMs: number): Promise<void> {
  activeJobCount = Math.max(0, activeJobCount - 1);

  const res = await fetch(
    `${getEnv('SUPABASE_URL')}/rest/v1/async_jobs?id=eq.${jobId}`,
    {
      method: 'PATCH',
      headers: supabaseHeaders(),
      body: JSON.stringify({
        status: 'failed',
        error,
        duration_ms: durationMs,
        completed_at: new Date().toISOString(),
      }),
    }
  );

  if (!res.ok) {
    console.error(`[ASYNC-JOBS] Failed to fail job ${jobId}:`, await res.text().catch(() => ''));
  }
}

/** Get a job by ID (user-scoped for security) */
export async function getJob(jobId: string, userId: string): Promise<AsyncJob | null> {
  const res = await fetch(
    `${getEnv('SUPABASE_URL')}/rest/v1/async_jobs?id=eq.${jobId}&user_id=eq.${userId}&select=*`,
    { headers: supabaseHeaders() }
  );

  if (!res.ok) return null;
  const rows = await res.json() as AsyncJob[];
  const job = rows[0];
  if (!job) return null;

  // If result was offloaded to R2, fetch it
  if (job.status === 'completed' && job.result_r2_key) {
    try {
      job.result = await loadResultFromR2(job.result_r2_key);
    } catch {
      job.result = { _error: 'Failed to load result from storage' };
    }
  }

  return job;
}

/** Fail stale running jobs (from crashed servers or expired) */
export async function cleanupStaleJobs(): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_JOB_MS).toISOString();

  // Fail jobs that are still 'running' but created before the cutoff
  const res = await fetch(
    `${getEnv('SUPABASE_URL')}/rest/v1/async_jobs?status=eq.running&created_at=lt.${cutoff}`,
    {
      method: 'PATCH',
      headers: { ...supabaseHeaders(), 'Prefer': 'return=headers-only' },
      body: JSON.stringify({
        status: 'failed',
        error: { type: 'ServerTimeout', message: 'Execution exceeded maximum duration or server restarted' },
        completed_at: new Date().toISOString(),
      }),
    }
  );

  if (!res.ok) return 0;
  // Parse content-range header to get count
  const range = res.headers.get('content-range');
  if (range) {
    const match = range.match(/\d+-\d+\/(\d+)/);
    return match ? parseInt(match[1]) : 0;
  }
  return 0;
}

/** R2 storage helpers for large results */
async function storeResultInR2(key: string, value: unknown): Promise<void> {
  const WORKER_URL = getEnv('WORKER_URL');
  if (!WORKER_URL) {
    console.error('[ASYNC-JOBS] No WORKER_URL configured for R2 storage');
    return;
  }

  await fetch(`${WORKER_URL}/r2/store`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, value }),
  });
}

async function loadResultFromR2(key: string): Promise<unknown> {
  const WORKER_URL = getEnv('WORKER_URL');
  if (!WORKER_URL) return null;

  const res = await fetch(`${WORKER_URL}/r2/load?key=${encodeURIComponent(key)}`);
  if (!res.ok) return null;
  return res.json();
}

/** Start the background cleanup processor */
export function startAsyncJobCleanupJob(): void {
  const INTERVAL_MS = 60_000;
  const STARTUP_DELAY_MS = 15_000;

  console.log('[ASYNC-JOBS] Starting cleanup processor (every 60s)');

  // On startup, clean up any stale jobs from previous crashes
  setTimeout(async () => {
    try {
      const count = await cleanupStaleJobs();
      if (count > 0) console.log(`[ASYNC-JOBS] Startup cleanup: failed ${count} stale jobs`);
    } catch (err) {
      console.error('[ASYNC-JOBS] Startup cleanup error:', err);
    }
  }, STARTUP_DELAY_MS);

  setInterval(async () => {
    try {
      const count = await cleanupStaleJobs();
      if (count > 0) console.log(`[ASYNC-JOBS] Cleaned up ${count} stale jobs`);
    } catch (err) {
      console.error('[ASYNC-JOBS] Cleanup error:', err);
    }
  }, INTERVAL_MS);
}
