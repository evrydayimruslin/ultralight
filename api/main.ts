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

// Serve the API
Deno.serve({ port, hostname: '0.0.0.0' }, async (request: Request) => {
  const url = new URL(request.url);
  console.log(`[REQ] ${request.method} ${url.pathname}`);

  // CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  // Handle preflight
  if (request.method === 'OPTIONS') {
    console.log('[REQ] Preflight request');
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('[MAIN] Handling request:', request.method, request.url);
    const app = createApp();
    console.log('[MAIN] App created, handling...');
    const response = await app.handle(request);
    console.log('[MAIN] Response received:', response.status);

    // Add CORS to all responses
    Object.entries(corsHeaders).forEach(([key, value]) => {
      response.headers.set(key, value);
    });

    return response;
  } catch (error) {
    console.error('Unhandled error:', error);

    return new Response(
      JSON.stringify({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders,
        },
      },
    );
  }
});
