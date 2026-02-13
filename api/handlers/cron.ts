// Cron API Handlers
// Endpoints for managing cron jobs via REST API
//
// Endpoints:
//   GET    /api/cron/jobs              - List all jobs (admin)
//   GET    /api/cron/apps/:appId/jobs  - List jobs for an app
//   POST   /api/cron/apps/:appId/jobs  - Create a job
//   GET    /api/cron/jobs/:jobId       - Get a job
//   PATCH  /api/cron/jobs/:jobId       - Update a job
//   DELETE /api/cron/jobs/:jobId       - Delete a job
//   POST   /api/cron/jobs/:jobId/run   - Manually trigger a job
//   GET    /api/cron/jobs/:jobId/logs  - Get job run logs

import { json, error } from './app.ts';
import { authenticate } from './auth.ts';
import { createAppsService } from '../services/apps.ts';
import {
  createCronJob,
  getCronJob,
  getAppCronJobs,
  updateCronJob,
  deleteCronJob,
  deleteAppCronJobs,
  loadCronJobs,
  triggerCronJob,
  getJobRunLogs,
  isValidCronExpression,
  describeCronExpression,
  CRON_PRESETS,
} from '../services/cron.ts';

/**
 * Get the base URL for the server (for job execution)
 */
function getBaseUrl(request: Request): string {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

/**
 * Main cron handler - routes to specific handlers
 */
export async function handleCron(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  try {
    // GET /api/cron/presets - Get cron expression presets
    if (path === '/api/cron/presets' && method === 'GET') {
      return json({
        presets: Object.entries(CRON_PRESETS).map(([name, expression]) => ({
          name,
          expression,
          description: describeCronExpression(expression),
        })),
      });
    }

    // POST /api/cron/validate - Validate a cron expression
    if (path === '/api/cron/validate' && method === 'POST') {
      let body;
      try {
        body = await request.json();
      } catch {
        return error('Invalid JSON body', 400);
      }
      const { expression } = body;

      if (!expression) {
        return error('Expression required', 400);
      }

      const valid = isValidCronExpression(expression);
      return json({
        expression,
        valid,
        description: valid ? describeCronExpression(expression) : null,
      });
    }

    // GET /api/cron/jobs - List all jobs (requires auth)
    if (path === '/api/cron/jobs' && method === 'GET') {
      const user = await authenticate(request);
      const jobs = await loadCronJobs();

      // Filter to only show jobs for apps owned by this user
      const appsService = createAppsService();
      const userApps = await appsService.listByOwner(user.id);
      const userAppIds = new Set(userApps.map((a: { id: string }) => a.id));

      const userJobs = jobs.filter(j => userAppIds.has(j.appId));

      return json({
        jobs: userJobs.map(j => ({
          ...j,
          scheduleDescription: describeCronExpression(j.schedule),
        })),
      });
    }

    // Routes with app ID: /api/cron/apps/:appId/jobs
    const appJobsMatch = path.match(/^\/api\/cron\/apps\/([^\/]+)\/jobs$/);
    if (appJobsMatch) {
      const appId = appJobsMatch[1];

      // Verify user owns the app
      const user = await authenticate(request);
      const appsService = createAppsService();
      const app = await appsService.findById(appId);

      if (!app) {
        return error('App not found', 404);
      }

      if (app.owner_id !== user.id) {
        return error('Unauthorized', 403);
      }

      // GET - List jobs for app
      if (method === 'GET') {
        const jobs = await getAppCronJobs(appId);
        return json({
          jobs: jobs.map(j => ({
            ...j,
            scheduleDescription: describeCronExpression(j.schedule),
          })),
        });
      }

      // POST - Create job for app
      if (method === 'POST') {
        let body;
        try {
          body = await request.json();
        } catch {
          return error('Invalid JSON body', 400);
        }
        const { name, schedule, handler } = body;

        if (!name || !schedule || !handler) {
          return error('name, schedule, and handler are required', 400);
        }

        try {
          const job = await createCronJob({
            appId,
            name,
            schedule,
            handler,
          });

          return json({
            job: {
              ...job,
              scheduleDescription: describeCronExpression(job.schedule),
            },
          }, 201);
        } catch (err) {
          return error(err instanceof Error ? err.message : 'Failed to create job', 400);
        }
      }

      return error('Method not allowed', 405);
    }

    // Routes with job ID: /api/cron/jobs/:jobId
    const jobMatch = path.match(/^\/api\/cron\/jobs\/([^\/]+)$/);
    if (jobMatch) {
      const jobId = decodeURIComponent(jobMatch[1]);

      // Get the job and verify ownership
      const job = await getCronJob(jobId);
      if (!job) {
        return error('Job not found', 404);
      }

      const user = await authenticate(request);
      const appsService = createAppsService();
      const app = await appsService.findById(job.appId);

      if (!app || app.owner_id !== user.id) {
        return error('Unauthorized', 403);
      }

      // GET - Get job details
      if (method === 'GET') {
        return json({
          job: {
            ...job,
            scheduleDescription: describeCronExpression(job.schedule),
          },
        });
      }

      // PATCH - Update job
      if (method === 'PATCH') {
        let body;
        try {
          body = await request.json();
        } catch {
          return error('Invalid JSON body', 400);
        }
        const { schedule, handler, enabled } = body;

        const updates: Partial<{ schedule: string; handler: string; enabled: boolean }> = {};
        if (schedule !== undefined) updates.schedule = schedule;
        if (handler !== undefined) updates.handler = handler;
        if (enabled !== undefined) updates.enabled = enabled;

        try {
          const updated = await updateCronJob(jobId, updates);
          return json({
            job: {
              ...updated,
              scheduleDescription: describeCronExpression(updated.schedule),
            },
          });
        } catch (err) {
          return error(err instanceof Error ? err.message : 'Failed to update job', 400);
        }
      }

      // DELETE - Delete job
      if (method === 'DELETE') {
        await deleteCronJob(jobId);
        return json({ success: true });
      }

      return error('Method not allowed', 405);
    }

    // POST /api/cron/jobs/:jobId/run - Manually trigger a job
    const runMatch = path.match(/^\/api\/cron\/jobs\/([^\/]+)\/run$/);
    if (runMatch && method === 'POST') {
      const jobId = decodeURIComponent(runMatch[1]);

      // Get the job and verify ownership
      const job = await getCronJob(jobId);
      if (!job) {
        return error('Job not found', 404);
      }

      const user = await authenticate(request);
      const appsService = createAppsService();
      const app = await appsService.findById(job.appId);

      if (!app || app.owner_id !== user.id) {
        return error('Unauthorized', 403);
      }

      try {
        const baseUrl = getBaseUrl(request);
        const log = await triggerCronJob(jobId, baseUrl);
        return json({ log });
      } catch (err) {
        return error(err instanceof Error ? err.message : 'Failed to trigger job', 500);
      }
    }

    // GET /api/cron/jobs/:jobId/logs - Get job run logs
    const logsMatch = path.match(/^\/api\/cron\/jobs\/([^\/]+)\/logs$/);
    if (logsMatch && method === 'GET') {
      const jobId = decodeURIComponent(logsMatch[1]);

      // Get the job and verify ownership
      const job = await getCronJob(jobId);
      if (!job) {
        return error('Job not found', 404);
      }

      const user = await authenticate(request);
      const appsService = createAppsService();
      const app = await appsService.findById(job.appId);

      if (!app || app.owner_id !== user.id) {
        return error('Unauthorized', 403);
      }

      const limit = parseInt(url.searchParams.get('limit') || '20', 10);
      const logs = await getJobRunLogs(jobId, Math.min(limit, 100));

      return json({ logs });
    }

    return error('Not found', 404);
  } catch (err) {
    if (err instanceof Error && err.message.includes('auth')) {
      return error('Unauthorized', 401);
    }
    console.error('[CRON API] Error:', err);
    return error(err instanceof Error ? err.message : 'Internal error', 500);
  }
}
