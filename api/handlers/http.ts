// HTTP Endpoints Handler
// Enables apps to receive HTTP requests from external services (webhooks, APIs, etc.)

import { json, error } from './app.ts';
import { createAppsService } from '../services/apps.ts';
import { createAppDataService } from '../services/appdata.ts';
import { createR2Service } from '../services/storage.ts';
import { createUserService } from '../services/user.ts';
import { createAIService } from '../services/ai.ts';
import { decryptEnvVars, decryptEnvVar } from '../services/envvars.ts';
import { isApiToken, validateToken } from '../services/tokens.ts';
import { executeInSandbox, type UserContext } from '../runtime/sandbox.ts';
import { checkAndIncrementWeeklyCalls } from '../services/weekly-calls.ts';
import { executeGpuFunction } from '../services/gpu/executor.ts';
import { acquireGpuSlot } from '../services/gpu/concurrency.ts';
import { settleGpuExecution } from '../services/gpu/billing.ts';
import { getUserTier } from '../services/tier-enforcement.ts';
import { createD1DataService } from '../services/d1-data.ts';
import { getD1DatabaseId } from '../services/d1-provisioning.ts';

// @ts-ignore - Deno is available in Deno Deploy
const Deno = globalThis.Deno;

// ============================================
// PER-APP IP-BASED HTTP RATE LIMITING
// ============================================
// In-memory sliding window keyed by ip:appId.
// Protects against unauthenticated floods and webhook quota exhaustion.

const httpRateBuckets = new Map<string, { count: number; resetAt: number }>();

// Cleanup expired buckets every 60 seconds
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of httpRateBuckets) {
    if (bucket.resetAt < now) {
      httpRateBuckets.delete(key);
    }
  }
}, 60_000);

/**
 * Check per-app HTTP rate limit (IP-scoped).
 * Uses the app's http_rate_limit column (default 1000 req/min).
 */
function checkHttpRateLimit(
  ip: string,
  appId: string,
  limitPerMinute: number
): { allowed: boolean; remaining: number; resetAt: Date } {
  const key = `${ip}:${appId}`;
  const now = Date.now();
  const windowMs = 60_000; // 1-minute window

  let bucket = httpRateBuckets.get(key);

  // Reset if window expired
  if (!bucket || bucket.resetAt < now) {
    bucket = { count: 0, resetAt: now + windowMs };
    httpRateBuckets.set(key, bucket);
  }

  bucket.count++;
  const allowed = bucket.count <= limitPerMinute;

  return {
    allowed,
    remaining: Math.max(0, limitPerMinute - bucket.count),
    resetAt: new Date(bucket.resetAt),
  };
}

/**
 * Handle HTTP endpoint requests to apps
 * Route: /http/:appId/:functionName
 *
 * Apps export functions that receive a Request object and return a Response.
 * Example app code:
 *
 * export async function webhook(request: UltralightRequest) {
 *   const body = await request.json();
 *   await ultralight.store('webhooks/' + Date.now(), body);
 *   return { received: true };
 * }
 */
export async function handleHttpEndpoint(request: Request, appId: string, path: string): Promise<Response> {
  const startTime = Date.now();

  try {
    // Extract function name from path (first segment after appId)
    const pathParts = path.split('/').filter(Boolean);
    const functionName = pathParts[0] || 'handler';
    const subPath = '/' + pathParts.slice(1).join('/');

    console.log(`[HTTP] ${request.method} /http/${appId}/${functionName}${subPath}`);

    // Get app
    const appsService = createAppsService();
    const app = await appsService.findById(appId);

    if (!app) {
      return json({ error: 'App not found' }, 404);
    }

    // Check if HTTP endpoints are enabled for this app
    const httpEnabled = (app as Record<string, unknown>).http_enabled !== false;
    if (!httpEnabled) {
      return json({ error: 'HTTP endpoints are disabled for this app' }, 403);
    }

    // Per-app IP-based rate limit (prevents unauthenticated flood / quota exhaustion)
    const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || request.headers.get('x-real-ip')
      || 'unknown';
    const appRateLimit = (app as Record<string, unknown>).http_rate_limit as number || 1000;
    const httpRateResult = checkHttpRateLimit(clientIp, appId, appRateLimit);

    if (!httpRateResult.allowed) {
      return new Response(
        JSON.stringify({ error: 'Rate limit exceeded for this app' }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': String(Math.ceil((httpRateResult.resetAt.getTime() - Date.now()) / 1000)),
            'X-RateLimit-Limit': String(appRateLimit),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(Math.floor(httpRateResult.resetAt.getTime() / 1000)),
          },
        }
      );
    }

    // Weekly call limit check (counts against app owner)
    const ownerTier = await getUserTier(app.owner_id);
    const weeklyResult = await checkAndIncrementWeeklyCalls(app.owner_id, ownerTier);
    if (!weeklyResult.allowed) {
      return json({
        error: 'Weekly call limit exceeded for this app\'s owner. Try again next week.',
      }, 429);
    }

    // Get app code from R2
    const r2Service = createR2Service();
    const storageKey = app.storage_key;
    let code: string | null = null;

    const entryFiles = ['index.tsx', 'index.ts', 'index.jsx', 'index.js'];
    for (const entryFile of entryFiles) {
      try {
        code = await r2Service.fetchTextFile(`${storageKey}${entryFile}`);
        break;
      } catch {
        // Try next
      }
    }

    if (!code) {
      return json({ error: 'App code not found' }, 404);
    }

    // Check if the function exists in exports
    const exports = app.exports || [];
    if (!exports.includes(functionName) && functionName !== 'handler' && functionName !== 'default') {
      return json({
        error: `Function "${functionName}" not found`,
        available_functions: exports.filter(e => !e.startsWith('_')),
      }, 404);
    }

    // Create app data service
    // For HTTP endpoints, use a special "http" user ID since there's no authenticated user
    const appDataService = createAppDataService(appId);

    // Decrypt environment variables
    const encryptedEnvVars = (app as Record<string, unknown>).env_vars as Record<string, string> || {};
    let envVars: Record<string, string> = {};
    try {
      envVars = await decryptEnvVars(encryptedEnvVars);
    } catch (err) {
      console.error('Failed to decrypt env vars:', err);
    }

    // Resolve Supabase config: prefer config_id, fall back to legacy app-level, then platform-level
    let supabaseConfig: { url: string; anonKey: string; serviceKey?: string } | undefined;

    if (app.supabase_config_id) {
      try {
        const { getDecryptedSupabaseConfig } = await import('./user.ts');
        const config = await getDecryptedSupabaseConfig(app.supabase_config_id);
        if (config) supabaseConfig = config;
      } catch (err) {
        console.error('Failed to get Supabase config by ID:', err);
      }
    }

    if (!supabaseConfig && app.supabase_enabled && app.supabase_url && app.supabase_anon_key_encrypted) {
      try {
        const anonKey = await decryptEnvVar(app.supabase_anon_key_encrypted as string);
        supabaseConfig = { url: app.supabase_url as string, anonKey };
        if (app.supabase_service_key_encrypted) {
          supabaseConfig.serviceKey = await decryptEnvVar(app.supabase_service_key_encrypted as string);
        }
      } catch (err) {
        console.error('Failed to decrypt legacy Supabase config:', err);
      }
    }

    if (!supabaseConfig && app.supabase_enabled) {
      try {
        const { getDecryptedPlatformSupabase } = await import('./user.ts');
        const platformConfig = await getDecryptedPlatformSupabase(app.owner_id);
        if (platformConfig) supabaseConfig = platformConfig;
      } catch (err) {
        console.error('Failed to get platform Supabase config:', err);
      }
    }

    // Extract user context from Authorization header or ?token= query param
    let user: UserContext | null = null;
    let userApiKey: string | null = null;
    const authHeader = request.headers.get('Authorization');
    const requestUrl = new URL(request.url);
    const queryToken = requestUrl.searchParams.get('token');

    // Determine auth token — prefer header, fall back to query param
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const authToken = bearerToken || queryToken;

    if (authToken && isApiToken(authToken)) {
      // ul_ API token — resolve via token service
      try {
        const validated = await validateToken(authToken);
        if (validated) {
          const userService = createUserService();
          const userData = await userService.getUser(validated.user_id);
          user = {
            id: validated.user_id,
            email: userData?.email || '',
            displayName: userData?.display_name || null,
            avatarUrl: userData?.avatar_url || null,
            tier: (userData?.tier as 'free' | 'pro' | 'scale' | 'enterprise') || 'free',
          };
          // Get BYOK API key for AI calls
          if (userData?.byok_enabled && userData.byok_provider) {
            try {
              userApiKey = await userService.getDecryptedApiKey(validated.user_id, userData.byok_provider);
            } catch {
              // Continue without BYOK
            }
          }
        }
      } catch {
        // Invalid API token, continue without user context
      }
    } else if (bearerToken) {
      // JWT token — decode for user info
      try {
        const parts = bearerToken.split('.');
        if (parts.length === 3) {
          const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
          if (payload.sub && payload.exp * 1000 > Date.now()) {
            user = {
              id: payload.sub,
              email: payload.email || '',
              displayName: payload.user_metadata?.full_name || payload.user_metadata?.name || null,
              avatarUrl: payload.user_metadata?.avatar_url || null,
              tier: 'free',
            };

            // Try to get BYOK API key for this user
            try {
              const userService = createUserService();
              const userData = await userService.getUser(payload.sub);
              if (userData?.byok_enabled && userData.byok_provider) {
                userApiKey = await userService.getDecryptedApiKey(payload.sub, userData.byok_provider);
              }
            } catch {
              // Continue without BYOK
            }
          }
        }
      } catch {
        // Invalid token, continue without user context
      }
    }

    // Create AI service
    let aiService;
    if (userApiKey) {
      const aiServiceInstance = createAIService();
      aiService = aiServiceInstance;
    } else {
      aiService = {
        call: async () => ({
          content: '',
          model: 'none',
          usage: { input_tokens: 0, output_tokens: 0, cost_light: 0 },
          error: 'BYOK not configured',
        }),
      };
    }

    // Build the UltralightRequest object to pass to the function
    // This is a simplified Request-like object with useful properties
    const ultralightRequest = {
      method: request.method,
      url: requestUrl.pathname + requestUrl.search,
      path: subPath || '/',
      query: Object.fromEntries(requestUrl.searchParams),
      headers: Object.fromEntries(request.headers),
      // Body helpers
      json: async () => {
        try {
          return await request.clone().json();
        } catch {
          return null;
        }
      },
      text: async () => {
        try {
          return await request.clone().text();
        } catch {
          return '';
        }
      },
      formData: async () => {
        try {
          return Object.fromEntries(await request.clone().formData());
        } catch {
          return {};
        }
      },
    };

    // ── GPU Runtime Branch ──
    if (app.runtime === 'gpu') {
      if (app.gpu_status !== 'live') {
        return json({ error: 'GPU function not ready', status: app.gpu_status }, 503);
      }

      let gpuSlot;
      try {
        gpuSlot = await acquireGpuSlot(app.gpu_endpoint_id!, app.gpu_concurrency_limit || 5);
      } catch {
        return json({ error: 'GPU function at capacity' }, 429);
      }

      try {
        const gpuResult = await executeGpuFunction({
          app,
          functionName,
          args: { request: ultralightRequest },
          executionId: crypto.randomUUID(),
        });
        const gpuDurationMs = Date.now() - startTime;

        // Settle billing (if authenticated caller !== owner)
        let gpuCallChargeLight = 0;
        if (user && user.id !== app.owner_id) {
          const settlement = await settleGpuExecution(
            user.id, app, functionName,
            { request: ultralightRequest },
            gpuResult,
          );
          if (settlement.insufficientBalance) {
            return json({ error: settlement.insufficientBalanceMessage }, 402);
          }
          gpuCallChargeLight = settlement.chargedLight;
        }

        // Log (fire-and-forget)
        const { logMcpCall: logHttpGpuCall } = await import('../services/call-logger.ts');
        logHttpGpuCall({
          userId: app.owner_id,
          appId: app.id,
          appName: app.name || app.slug,
          functionName,
          method: 'http',
          success: gpuResult.success,
          durationMs: gpuDurationMs,
          errorMessage: gpuResult.success ? undefined : (gpuResult.error?.message || 'GPU execution failed'),
          outputResult: gpuResult.success ? gpuResult.result : gpuResult.error,
          userTier: user?.tier,
          appVersion: app.current_version || undefined,
          // GPU telemetry
          gpuType: gpuResult.gpuType,
          gpuExitCode: gpuResult.exitCode,
          gpuDurationMs: gpuResult.durationMs,
          gpuCostLight: gpuResult.gpuCostLight,
          gpuPeakVramGb: gpuResult.peakVramGb,
        });

        console.log(`[HTTP-GPU] ${request.method} /http/${appId}/${functionName} - ${gpuResult.success ? 'OK' : gpuResult.exitCode} - ${gpuDurationMs}ms`);

        if (!gpuResult.success) {
          return json({
            error: gpuResult.error?.message || 'GPU execution failed',
            type: gpuResult.error?.type,
            logs: gpuResult.logs,
          }, 500);
        }

        // Handle the response (same formatting as Deno path below)
        const gpuFnResult = gpuResult.result;

        if (gpuFnResult instanceof Response) {
          return gpuFnResult;
        }

        if (gpuFnResult && typeof gpuFnResult === 'object') {
          const resConfig = gpuFnResult as Record<string, unknown>;
          if ('statusCode' in resConfig || 'status' in resConfig) {
            const status = (resConfig.statusCode || resConfig.status || 200) as number;
            const headers = new Headers(resConfig.headers as Record<string, string> || {});
            const body = resConfig.body;
            if (!headers.has('Content-Type')) {
              headers.set('Content-Type', 'application/json');
            }
            return new Response(
              typeof body === 'string' ? body : JSON.stringify(body),
              { status, headers },
            );
          }
        }

        return json(gpuFnResult);
      } finally {
        gpuSlot.release();
      }
    }

    // ── Deno Sandbox Path (existing, unchanged) ──
    // D1 Data Service (lazy-provisioned)
    const d1DatabaseId = (app as any).d1_database_id || await getD1DatabaseId(app.id);
    const d1DataService = createD1DataService(app.id, d1DatabaseId);

    // Execute the function in sandbox — AI-capable apps get 120s timeout
    const httpPermissions = ['memory:read', 'memory:write', 'ai:call', 'net:fetch'];
    const result = await executeInSandbox(
      {
        appId: app.id,
        userId: user?.id || 'anonymous',
        executionId: crypto.randomUUID(),
        code,
        permissions: httpPermissions,
        userApiKey,
        user,
        appDataService,
        d1DataService,
        memoryService: null,
        aiService: aiService as { call: (request: import('../../shared/types/index.ts').AIRequest, apiKey: string) => Promise<import('../../shared/types/index.ts').AIResponse> },
        envVars,
        supabase: supabaseConfig,
        timeoutMs: httpPermissions.includes('ai:call') ? 120_000 : 30_000,
      },
      functionName,
      [ultralightRequest]
    );

    const durationMs = Date.now() - startTime;

    // Log the call (fire-and-forget)
    const { logMcpCall } = await import('../services/call-logger.ts');
    logMcpCall({
      userId: app.owner_id,
      appId: app.id,
      appName: app.name || app.slug,
      functionName,
      method: 'http',
      success: result.success,
      durationMs,
      errorMessage: result.success ? undefined : (result.error?.message || 'Execution failed'),
      outputResult: result.success ? result.result : result.error,
      userTier: user?.tier,
      appVersion: app.current_version || undefined,
      aiCostLight: result.aiCostLight || 0,
    });

    console.log(`[HTTP] ${request.method} /http/${appId}/${functionName} - ${result.success ? 'OK' : 'ERROR'} - ${durationMs}ms`);

    if (!result.success) {
      return json({
        error: result.error?.message || 'Execution failed',
        type: result.error?.type,
        logs: result.logs,
      }, 500);
    }

    // Handle the response
    const fnResult = result.result;

    // If the result is already a Response object, return it
    if (fnResult instanceof Response) {
      return fnResult;
    }

    // If the result has statusCode/status and body, treat it as a response config
    if (fnResult && typeof fnResult === 'object') {
      const resConfig = fnResult as Record<string, unknown>;

      // Check for explicit response format
      if ('statusCode' in resConfig || 'status' in resConfig) {
        const status = (resConfig.statusCode || resConfig.status || 200) as number;
        const headers = new Headers(resConfig.headers as Record<string, string> || {});
        const body = resConfig.body;

        if (!headers.has('Content-Type')) {
          headers.set('Content-Type', 'application/json');
        }

        return new Response(
          typeof body === 'string' ? body : JSON.stringify(body),
          { status, headers }
        );
      }
    }

    // Default: wrap result as JSON response with CORS headers
    return new Response(JSON.stringify(fnResult), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
        'X-Execution-Time': `${durationMs}ms`,
      },
    });

  } catch (err) {
    console.error('[HTTP] Error:', err);
    return json({
      error: 'Internal server error',
      message: err instanceof Error ? err.message : String(err),
    }, 500);
  }
}

/**
 * Handle CORS preflight requests
 */
export function handleHttpOptions(appId: string): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
      'Access-Control-Max-Age': '86400',
    },
  });
}
