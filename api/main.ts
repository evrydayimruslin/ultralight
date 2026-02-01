// Main API Entry Point
// Works on both Deno Deploy and DigitalOcean App Platform

// @ts-ignore - Deno is available in Deno Deploy
const Deno = globalThis.Deno;

import { createApp } from './handlers/app.ts';

// Get port from environment or default to 8000
// @ts-ignore
const port = parseInt(Deno.env.get('PORT') || '8000');

console.log(`Starting Ultralight API on port ${port}...`);

// Serve the API
Deno.serve({ port, hostname: '0.0.0.0' }, async (request: Request) => {
  // CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  // Handle preflight
  if (request.method === 'OPTIONS') {
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
