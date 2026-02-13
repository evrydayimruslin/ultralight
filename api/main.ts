// Main API Entry Point
// Deployed on DigitalOcean App Platform

const Deno = globalThis.Deno;

import { createApp } from './handlers/app.ts';
import { startCronScheduler } from './services/cron.ts';
import { startSubscriptionExpiryChecker } from './services/subscription-expiry.ts';

// Get port from environment or default to 8000
// @ts-ignore
const port = parseInt(Deno.env.get('PORT') || '8000');

// Get base URL for cron job execution
// @ts-ignore
const baseUrl = Deno.env.get('BASE_URL') || `http://localhost:${port}`;

console.log(`Starting Ultralight API on port ${port}...`);

// Start the cron scheduler for background jobs
console.log(`[CRON] Initializing scheduler with base URL: ${baseUrl}`);
startCronScheduler(baseUrl);

// Start subscription expiry checker (hourly)
startSubscriptionExpiryChecker();

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

// CORS headers
const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// Merge security + CORS for convenience
const standardHeaders = { ...securityHeaders, ...corsHeaders };

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
        headers: { 'Content-Type': 'application/json', ...standardHeaders },
      },
    );
  }

  // Handle preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: standardHeaders });
  }

  try {
    const app = createApp();
    const response = await app.handle(request);

    // Apply standard headers to all responses
    for (const [key, value] of Object.entries(standardHeaders)) {
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
});
