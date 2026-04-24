// Main API Entry Point
// Deployed on DigitalOcean App Platform

const Deno = globalThis.Deno;

import { createApp } from './handlers/app.ts';
import { startHostingBillingJob } from './services/hosting-billing.ts';
import { startAutoHealingJob } from './services/auto-healing.ts';
import { startPayoutProcessorJob } from './services/payout-processor.ts';
import { startEmbeddingProcessorJob } from './services/embedding-processor.ts';
import { startGpuBuildProcessorJob } from './services/gpu/benchmark.ts';
import { startD1BillingJob } from './services/d1-billing.ts';
import { startAsyncJobCleanupJob } from './services/async-jobs.ts';
import { applyCorsHeaders, buildCorsPreflightResponse } from './services/cors.ts';

// Get port from environment or default to 8000
// @ts-ignore
const port = parseInt(Deno.env.get('PORT') || '8000');

console.log(`Starting Ultralight API on port ${port}...`);

// Security headers applied to every response
const securityHeaders: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'X-XSS-Protection': '1; mode=block',
  // HSTS — tells browsers to always use HTTPS (1 year, include subdomains)
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
};

const standardHeaders = securityHeaders;

// Start background jobs
startHostingBillingJob();
startAutoHealingJob();
startPayoutProcessorJob();
startEmbeddingProcessorJob();
startGpuBuildProcessorJob();
startD1BillingJob();
startAsyncJobCleanupJob();

// Serve the API
Deno.serve({ port, hostname: '0.0.0.0' }, async (request: Request) => {
  const url = new URL(request.url);
  console.log(`[REQ] ${request.method} ${url.pathname}`);

  // Reject oversized request bodies early (50 MB limit)
  const contentLength = request.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > 50 * 1024 * 1024) {
    return new Response(
      JSON.stringify({ error: 'Request body too large' }),
      {
        status: 413,
        headers: (() => {
          const headers = new Headers({
            'Content-Type': 'application/json',
            ...standardHeaders,
          });
          applyCorsHeaders(headers, request);
          return headers;
        })(),
      },
    );
  }

  // Handle preflight
  if (request.method === 'OPTIONS') {
    const response = buildCorsPreflightResponse(request);
    for (const [key, value] of Object.entries(standardHeaders)) {
      response.headers.set(key, value);
    }
    return response;
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
    applyCorsHeaders(response.headers, request);

    return response;
  } catch (err) {
    console.error('Unhandled error:', err);

    // Never leak internal error messages to clients
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      {
        status: 500,
        headers: (() => {
          const headers = new Headers({
            'Content-Type': 'application/json',
            ...standardHeaders,
          });
          applyCorsHeaders(headers, request);
          return headers;
        })(),
      },
    );
  }
});
