// Cloudflare Workers Entry Point
// Replaces api/main.ts (Deno.serve) as the production entry point.
// Handles both HTTP requests (fetch) and background jobs (scheduled).

import type { Env } from '../lib/env.ts';
import { createApp } from '../handlers/app.ts';

// Import core job functions (extracted from setInterval wrappers)
import { processHostingBilling } from '../services/hosting-billing.ts';
import { runAutoHealing } from '../services/auto-healing.ts';
import { processHeldPayouts } from '../services/payout-processor.ts';
import { processNullEmbeddings } from '../services/embedding-processor.ts';
import { processGpuBuilds } from '../services/gpu/benchmark.ts';
import { runD1BillingCycle } from '../services/d1-billing.ts';
import { cleanupStaleJobs } from '../services/async-jobs.ts';
import { checkAndRunJobs as checkUserCronJobs } from '../services/cron.ts';
import { getEnv } from '../lib/env.ts';

// Export RPC entrypoints for Dynamic Worker bindings
// These are available via ctx.exports in the fetch handler
export { DatabaseBinding } from './bindings/database-binding.ts';
export { AppDataBinding } from './bindings/appdata-binding.ts';
export { AIBinding } from './bindings/ai-binding.ts';
export { MemoryBinding } from './bindings/memory-binding.ts';

// ============================================
// SECURITY & CORS HEADERS
// ============================================

const securityHeaders: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'X-XSS-Protection': '1; mode=block',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
};

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const standardHeaders = { ...securityHeaders, ...corsHeaders };

// ============================================
// WORKER EXPORT
// ============================================

export default {
  /**
   * HTTP request handler — replaces Deno.serve()
   */
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Make env available globally for all downstream code
    globalThis.__env = env;
    globalThis.__ctx = ctx;

    const url = new URL(request.url);
    console.log(`[REQ] ${request.method} ${url.pathname}`);

    // Reject oversized request bodies early (50 MB limit)
    const contentLength = request.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > 50 * 1024 * 1024) {
      return new Response(
        JSON.stringify({ error: 'Request body too large' }),
        {
          status: 413,
          headers: { 'Content-Type': 'application/json', ...standardHeaders },
        },
      );
    }

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: standardHeaders });
    }

    try {
      const app = createApp();
      const response = await app.handle(request);

      // Apply standard headers to all responses
      for (const [key, value] of Object.entries(standardHeaders)) {
        // Skip X-Frame-Options for embed mode (desktop app iframe)
        if (key === 'X-Frame-Options' && url.searchParams.get('embed') === '1') continue;
        response.headers.set(key, value);
      }

      return response;
    } catch (err) {
      console.error('Unhandled error:', err);

      // Never leak internal error messages to clients
      return new Response(
        JSON.stringify({ error: 'Internal server error' }),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            ...standardHeaders,
          },
        },
      );
    }
  },

  /**
   * Scheduled (cron) handler — replaces setInterval background jobs.
   * Each cron trigger routes to the appropriate job functions.
   * Uses ctx.waitUntil() to avoid blocking the scheduler.
   */
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    globalThis.__env = env;
    globalThis.__ctx = ctx;

    console.log(`[CRON] Triggered: ${event.cron} at ${new Date(event.scheduledTime).toISOString()}`);

    switch (event.cron) {
      // Every minute: high-frequency jobs
      case '* * * * *':
        ctx.waitUntil(runMinuteJobs());
        break;

      // Every 5 minutes: D1 billing cycle
      case '*/5 * * * *':
        ctx.waitUntil(
          runD1BillingCycle().catch(err => console.error('[CRON] D1 billing error:', err))
        );
        break;

      // Every hour: billing + payouts
      case '0 * * * *':
        ctx.waitUntil(runHourlyJobs());
        break;

      // Every 30 minutes: auto-healing
      case '*/30 * * * *':
        ctx.waitUntil(
          runAutoHealing().catch(err => console.error('[CRON] Auto-healing error:', err))
        );
        break;

      default:
        console.warn(`[CRON] Unknown cron trigger: ${event.cron}`);
    }
  },
};

// ============================================
// JOB GROUPINGS
// ============================================

/**
 * Jobs that run every minute.
 * All run concurrently via Promise.allSettled (failures don't block others).
 */
async function runMinuteJobs(): Promise<void> {
  const baseUrl = getEnv('BASE_URL');

  // TODO: Entity index rebuilds — run on the 5th minute for active users.
  // Requires a way to enumerate active user IDs (e.g., from recent chat sessions).
  // Once available, add: rebuildEntityIndex(userId) for each active user.
  // import { rebuildEntityIndex } from '../services/entity-index.ts';

  const results = await Promise.allSettled([
    cleanupStaleJobs(),
    processNullEmbeddings(),
    processGpuBuilds(),
    checkUserCronJobs(baseUrl),  // user-facing cron scheduler
  ]);

  // Log any failures
  for (const [i, result] of results.entries()) {
    if (result.status === 'rejected') {
      const names = ['asyncJobCleanup', 'embeddingProcessor', 'gpuBuildProcessor', 'userCronScheduler'];
      console.error(`[CRON] ${names[i]} failed:`, result.reason);
    }
  }
}

/**
 * Jobs that run every hour.
 */
async function runHourlyJobs(): Promise<void> {
  const results = await Promise.allSettled([
    processHostingBilling(),
    processHeldPayouts(),
  ]);

  for (const [i, result] of results.entries()) {
    if (result.status === 'rejected') {
      const names = ['hostingBilling', 'payoutProcessor'];
      console.error(`[CRON] ${names[i]} failed:`, result.reason);
    }
  }
}
