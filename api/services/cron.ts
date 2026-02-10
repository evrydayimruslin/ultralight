// Cron Service for Ultralight Apps
// Enables background scheduled tasks for apps
//
// Features:
// - Apps can register cron jobs with standard cron expressions
// - Jobs persist across server restarts (stored in R2)
// - Jobs execute by calling the app's exported functions
// - Built-in job history and error tracking
//
// Usage in apps:
//   await ultralight.cron.register('sync-data', '*/15 * * * *', 'syncHandler');
//   await ultralight.cron.unregister('sync-data');
//   const jobs = await ultralight.cron.list();

import { createR2Service } from './storage.ts';

// ============================================
// TYPES
// ============================================

export interface CronJob {
  id: string;
  appId: string;
  name: string;
  schedule: string; // cron expression: "*/15 * * * *" = every 15 min
  handler: string;  // exported function name to call
  enabled: boolean;
  lastRunAt: string | null;
  lastRunResult: 'success' | 'error' | null;
  lastRunError: string | null;
  lastRunDurationMs: number | null;
  runCount: number;
  errorCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CronJobCreateInput {
  appId: string;
  name: string;
  schedule: string;
  handler: string;
}

export interface CronRunLog {
  jobId: string;
  appId: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  success: boolean;
  error: string | null;
  result: unknown;
}

// ============================================
// CONSTANTS
// ============================================

const CRON_JOBS_KEY = 'system/cron/jobs.json';
const CRON_LOGS_PREFIX = 'system/cron/logs/';
const MAX_LOGS_PER_JOB = 100;

// Standard cron presets for convenience
export const CRON_PRESETS = {
  EVERY_MINUTE: '* * * * *',
  EVERY_5_MINUTES: '*/5 * * * *',
  EVERY_15_MINUTES: '*/15 * * * *',
  EVERY_30_MINUTES: '*/30 * * * *',
  EVERY_HOUR: '0 * * * *',
  EVERY_6_HOURS: '0 */6 * * *',
  EVERY_12_HOURS: '0 */12 * * *',
  DAILY_MIDNIGHT: '0 0 * * *',
  DAILY_9AM: '0 9 * * *',
  DAILY_6PM: '0 18 * * *',
  WEEKLY_SUNDAY: '0 0 * * 0',
  WEEKLY_MONDAY: '0 0 * * 1',
  MONTHLY_FIRST: '0 0 1 * *',
} as const;

// ============================================
// CRON EXPRESSION PARSER
// ============================================

interface CronParts {
  minute: number[];
  hour: number[];
  dayOfMonth: number[];
  month: number[];
  dayOfWeek: number[];
}

// Parse a cron expression into its component parts
// Supports: * (all), step values, ranges, and lists
function parseCronExpression(expression: string): CronParts | null {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return null;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  try {
    return {
      minute: parseField(minute, 0, 59),
      hour: parseField(hour, 0, 23),
      dayOfMonth: parseField(dayOfMonth, 1, 31),
      month: parseField(month, 1, 12),
      dayOfWeek: parseField(dayOfWeek, 0, 6),
    };
  } catch {
    return null;
  }
}

function parseField(field: string, min: number, max: number): number[] {
  const values: number[] = [];

  // Handle comma-separated values
  const segments = field.split(',');

  for (const segment of segments) {
    if (segment === '*') {
      // All values
      for (let i = min; i <= max; i++) values.push(i);
    } else if (segment.startsWith('*/')) {
      // Step values: */5 = every 5
      const step = parseInt(segment.slice(2), 10);
      if (isNaN(step) || step <= 0) throw new Error(`Invalid step: ${segment}`);
      for (let i = min; i <= max; i += step) values.push(i);
    } else if (segment.includes('-')) {
      // Range: 1-5
      const [start, end] = segment.split('-').map(s => parseInt(s, 10));
      if (isNaN(start) || isNaN(end)) throw new Error(`Invalid range: ${segment}`);
      for (let i = start; i <= end; i++) values.push(i);
    } else {
      // Single value
      const value = parseInt(segment, 10);
      if (isNaN(value)) throw new Error(`Invalid value: ${segment}`);
      values.push(value);
    }
  }

  // Remove duplicates and sort
  return [...new Set(values)].sort((a, b) => a - b);
}

/**
 * Check if a cron job should run at the given time
 */
export function shouldRunAt(schedule: string, date: Date): boolean {
  const parts = parseCronExpression(schedule);
  if (!parts) return false;

  const minute = date.getUTCMinutes();
  const hour = date.getUTCHours();
  const dayOfMonth = date.getUTCDate();
  const month = date.getUTCMonth() + 1; // 1-indexed
  const dayOfWeek = date.getUTCDay(); // 0 = Sunday

  return (
    parts.minute.includes(minute) &&
    parts.hour.includes(hour) &&
    parts.dayOfMonth.includes(dayOfMonth) &&
    parts.month.includes(month) &&
    parts.dayOfWeek.includes(dayOfWeek)
  );
}

/**
 * Validate a cron expression
 */
export function isValidCronExpression(expression: string): boolean {
  return parseCronExpression(expression) !== null;
}

/**
 * Get human-readable description of a cron expression
 */
export function describeCronExpression(expression: string): string {
  const parts = parseCronExpression(expression);
  if (!parts) return 'Invalid cron expression';

  // Check for common patterns
  if (expression === '* * * * *') return 'Every minute';
  if (expression === '*/5 * * * *') return 'Every 5 minutes';
  if (expression === '*/15 * * * *') return 'Every 15 minutes';
  if (expression === '*/30 * * * *') return 'Every 30 minutes';
  if (expression === '0 * * * *') return 'Every hour';
  if (expression === '0 */6 * * *') return 'Every 6 hours';
  if (expression === '0 */12 * * *') return 'Every 12 hours';
  if (expression === '0 0 * * *') return 'Daily at midnight (UTC)';
  if (expression === '0 9 * * *') return 'Daily at 9:00 AM (UTC)';
  if (expression === '0 0 * * 0') return 'Weekly on Sunday at midnight (UTC)';
  if (expression === '0 0 * * 1') return 'Weekly on Monday at midnight (UTC)';
  if (expression === '0 0 1 * *') return 'Monthly on the 1st at midnight (UTC)';

  // Generic description
  const minuteDesc = parts.minute.length === 60 ? 'every minute' : `at minute ${parts.minute.join(', ')}`;
  const hourDesc = parts.hour.length === 24 ? '' : ` of hour ${parts.hour.join(', ')}`;

  return `${minuteDesc}${hourDesc} (UTC)`;
}

// ============================================
// CRON JOB STORAGE
// ============================================

/**
 * Load all cron jobs from R2
 */
export async function loadCronJobs(): Promise<CronJob[]> {
  const r2 = createR2Service();
  try {
    const content = await r2.fetchTextFile(CRON_JOBS_KEY);
    return JSON.parse(content);
  } catch {
    // No jobs file yet
    return [];
  }
}

/**
 * Save all cron jobs to R2
 */
export async function saveCronJobs(jobs: CronJob[]): Promise<void> {
  const r2 = createR2Service();
  await r2.uploadFile(CRON_JOBS_KEY, {
    name: 'jobs.json',
    content: new TextEncoder().encode(JSON.stringify(jobs, null, 2)),
    contentType: 'application/json',
  });
}

/**
 * Get a single cron job by ID
 */
export async function getCronJob(jobId: string): Promise<CronJob | null> {
  const jobs = await loadCronJobs();
  return jobs.find(j => j.id === jobId) || null;
}

/**
 * Get all cron jobs for an app
 */
export async function getAppCronJobs(appId: string): Promise<CronJob[]> {
  const jobs = await loadCronJobs();
  return jobs.filter(j => j.appId === appId);
}

/**
 * Create a new cron job
 */
export async function createCronJob(input: CronJobCreateInput): Promise<CronJob> {
  // Validate cron expression
  if (!isValidCronExpression(input.schedule)) {
    throw new Error(`Invalid cron expression: ${input.schedule}`);
  }

  // Validate handler name (must be a valid JS identifier)
  if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(input.handler)) {
    throw new Error(`Invalid handler name: ${input.handler}`);
  }

  const jobs = await loadCronJobs();

  // Check for duplicate job name within the app
  const jobId = `${input.appId}:${input.name}`;
  const existing = jobs.find(j => j.id === jobId);
  if (existing) {
    throw new Error(`Job "${input.name}" already exists for this app`);
  }

  // Check job limits (max 10 jobs per app for free tier)
  const appJobs = jobs.filter(j => j.appId === input.appId);
  if (appJobs.length >= 10) {
    throw new Error('Maximum of 10 cron jobs per app');
  }

  const now = new Date().toISOString();
  const job: CronJob = {
    id: jobId,
    appId: input.appId,
    name: input.name,
    schedule: input.schedule,
    handler: input.handler,
    enabled: true,
    lastRunAt: null,
    lastRunResult: null,
    lastRunError: null,
    lastRunDurationMs: null,
    runCount: 0,
    errorCount: 0,
    createdAt: now,
    updatedAt: now,
  };

  jobs.push(job);
  await saveCronJobs(jobs);

  console.log(`[CRON] Created job: ${job.id} (${describeCronExpression(job.schedule)})`);
  return job;
}

/**
 * Update a cron job
 */
export async function updateCronJob(
  jobId: string,
  updates: Partial<Pick<CronJob, 'schedule' | 'handler' | 'enabled'>>
): Promise<CronJob> {
  const jobs = await loadCronJobs();
  const index = jobs.findIndex(j => j.id === jobId);

  if (index === -1) {
    throw new Error(`Job not found: ${jobId}`);
  }

  if (updates.schedule && !isValidCronExpression(updates.schedule)) {
    throw new Error(`Invalid cron expression: ${updates.schedule}`);
  }

  if (updates.handler && !/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(updates.handler)) {
    throw new Error(`Invalid handler name: ${updates.handler}`);
  }

  jobs[index] = {
    ...jobs[index],
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  await saveCronJobs(jobs);
  console.log(`[CRON] Updated job: ${jobId}`);
  return jobs[index];
}

/**
 * Delete a cron job
 */
export async function deleteCronJob(jobId: string): Promise<void> {
  const jobs = await loadCronJobs();
  const filtered = jobs.filter(j => j.id !== jobId);

  if (filtered.length === jobs.length) {
    throw new Error(`Job not found: ${jobId}`);
  }

  await saveCronJobs(filtered);
  console.log(`[CRON] Deleted job: ${jobId}`);
}

/**
 * Delete all cron jobs for an app
 */
export async function deleteAppCronJobs(appId: string): Promise<number> {
  const jobs = await loadCronJobs();
  const filtered = jobs.filter(j => j.appId !== appId);
  const deletedCount = jobs.length - filtered.length;

  if (deletedCount > 0) {
    await saveCronJobs(filtered);
    console.log(`[CRON] Deleted ${deletedCount} jobs for app: ${appId}`);
  }

  return deletedCount;
}

// ============================================
// CRON JOB EXECUTION
// ============================================

/**
 * Execute a cron job by calling the app's handler function
 */
export async function executeCronJob(job: CronJob, baseUrl: string): Promise<CronRunLog> {
  const startedAt = new Date().toISOString();
  const startTime = Date.now();

  console.log(`[CRON] Executing job: ${job.id} -> ${job.handler}()`);

  let success = false;
  let error: string | null = null;
  let result: unknown = null;

  try {
    // Call the app's handler function via the run API
    const response = await fetch(`${baseUrl}/api/run/${job.appId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Cron-Job-Id': job.id,
        'X-Cron-Job-Name': job.name,
      },
      body: JSON.stringify({
        function: job.handler,
        args: [{
          jobId: job.id,
          jobName: job.name,
          schedule: job.schedule,
          triggeredAt: startedAt,
        }],
      }),
    });

    const data = await response.json();

    if (data.success) {
      success = true;
      result = data.result;
      console.log(`[CRON] Job completed: ${job.id}`);
    } else {
      success = false;
      error = data.error?.message || 'Unknown error';
      console.error(`[CRON] Job failed: ${job.id} - ${error}`);
    }
  } catch (err) {
    success = false;
    error = err instanceof Error ? err.message : String(err);
    console.error(`[CRON] Job error: ${job.id} - ${error}`);
  }

  const endedAt = new Date().toISOString();
  const durationMs = Date.now() - startTime;

  // Update job stats
  const jobs = await loadCronJobs();
  const index = jobs.findIndex(j => j.id === job.id);
  if (index !== -1) {
    jobs[index].lastRunAt = startedAt;
    jobs[index].lastRunResult = success ? 'success' : 'error';
    jobs[index].lastRunError = error;
    jobs[index].lastRunDurationMs = durationMs;
    jobs[index].runCount += 1;
    if (!success) jobs[index].errorCount += 1;
    jobs[index].updatedAt = endedAt;
    await saveCronJobs(jobs);
  }

  // Create run log
  const log: CronRunLog = {
    jobId: job.id,
    appId: job.appId,
    startedAt,
    endedAt,
    durationMs,
    success,
    error,
    result,
  };

  // Store run log (async, don't wait)
  storeRunLog(log).catch(err => {
    console.error(`[CRON] Failed to store run log: ${err}`);
  });

  return log;
}

/**
 * Store a run log in R2
 */
async function storeRunLog(log: CronRunLog): Promise<void> {
  const r2 = createR2Service();
  const logKey = `${CRON_LOGS_PREFIX}${log.jobId}/${log.startedAt}.json`;

  await r2.uploadFile(logKey, {
    name: `${log.startedAt}.json`,
    content: new TextEncoder().encode(JSON.stringify(log, null, 2)),
    contentType: 'application/json',
  });

  // TODO: Implement log rotation to keep only last MAX_LOGS_PER_JOB
}

/**
 * Get run logs for a job
 */
export async function getJobRunLogs(jobId: string, limit = 20): Promise<CronRunLog[]> {
  const r2 = createR2Service();
  const prefix = `${CRON_LOGS_PREFIX}${jobId}/`;

  try {
    const files = await r2.listFiles(prefix);

    // Sort by filename (which is the timestamp) descending
    const sortedFiles = files
      .filter(f => f.endsWith('.json'))
      .sort((a, b) => b.localeCompare(a))
      .slice(0, limit);

    const logs: CronRunLog[] = [];
    for (const file of sortedFiles) {
      try {
        const content = await r2.fetchTextFile(file);
        logs.push(JSON.parse(content));
      } catch {
        // Skip invalid logs
      }
    }

    return logs;
  } catch {
    return [];
  }
}

// ============================================
// CRON SCHEDULER
// ============================================

let schedulerRunning = false;
let schedulerInterval: number | null = null;

/**
 * Start the cron scheduler
 * Checks every minute for jobs that need to run
 */
export function startCronScheduler(baseUrl: string): void {
  if (schedulerRunning) {
    console.log('[CRON] Scheduler already running');
    return;
  }

  console.log('[CRON] Starting scheduler...');
  schedulerRunning = true;

  // Check immediately on start
  checkAndRunJobs(baseUrl);

  // Then check every minute
  // We check at the start of each minute to align with cron timing
  const now = new Date();
  const msUntilNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds();

  // Wait until the start of the next minute, then run every 60 seconds
  setTimeout(() => {
    checkAndRunJobs(baseUrl);
    schedulerInterval = setInterval(() => {
      checkAndRunJobs(baseUrl);
    }, 60000) as unknown as number;
  }, msUntilNextMinute);

  console.log(`[CRON] Scheduler started, first check in ${Math.round(msUntilNextMinute / 1000)}s`);
}

/**
 * Stop the cron scheduler
 */
export function stopCronScheduler(): void {
  if (!schedulerRunning) return;

  console.log('[CRON] Stopping scheduler...');
  schedulerRunning = false;

  if (schedulerInterval !== null) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}

/**
 * Check all jobs and run any that are due
 */
async function checkAndRunJobs(baseUrl: string): Promise<void> {
  const now = new Date();
  console.log(`[CRON] Checking jobs at ${now.toISOString()}`);

  try {
    const jobs = await loadCronJobs();
    const enabledJobs = jobs.filter(j => j.enabled);

    if (enabledJobs.length === 0) {
      return;
    }

    console.log(`[CRON] ${enabledJobs.length} enabled jobs`);

    for (const job of enabledJobs) {
      if (shouldRunAt(job.schedule, now)) {
        // Run job in background (don't await)
        executeCronJob(job, baseUrl).catch(err => {
          console.error(`[CRON] Execution failed for ${job.id}:`, err);
        });
      }
    }
  } catch (err) {
    console.error('[CRON] Error checking jobs:', err);
  }
}

/**
 * Manually trigger a job (for testing or on-demand execution)
 */
export async function triggerCronJob(jobId: string, baseUrl: string): Promise<CronRunLog> {
  const job = await getCronJob(jobId);
  if (!job) {
    throw new Error(`Job not found: ${jobId}`);
  }

  console.log(`[CRON] Manual trigger: ${jobId}`);
  return executeCronJob(job, baseUrl);
}

// ============================================
// CRON SERVICE INTERFACE
// ============================================

export interface CronService {
  // Job management
  create(input: CronJobCreateInput): Promise<CronJob>;
  get(jobId: string): Promise<CronJob | null>;
  getForApp(appId: string): Promise<CronJob[]>;
  update(jobId: string, updates: Partial<Pick<CronJob, 'schedule' | 'handler' | 'enabled'>>): Promise<CronJob>;
  delete(jobId: string): Promise<void>;
  deleteForApp(appId: string): Promise<number>;

  // Execution
  trigger(jobId: string): Promise<CronRunLog>;
  getLogs(jobId: string, limit?: number): Promise<CronRunLog[]>;

  // Utilities
  validate(expression: string): boolean;
  describe(expression: string): string;
  presets: typeof CRON_PRESETS;
}

/**
 * Create a cron service instance
 */
export function createCronService(baseUrl: string): CronService {
  return {
    create: createCronJob,
    get: getCronJob,
    getForApp: getAppCronJobs,
    update: updateCronJob,
    delete: deleteCronJob,
    deleteForApp: deleteAppCronJobs,
    trigger: (jobId) => triggerCronJob(jobId, baseUrl),
    getLogs: getJobRunLogs,
    validate: isValidCronExpression,
    describe: describeCronExpression,
    presets: CRON_PRESETS,
  };
}
