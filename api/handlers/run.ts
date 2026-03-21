// Run Handler
// Executes user code in sandbox

import { error, json } from './app.ts';
import type { RunRequest, RunResponse } from '../../shared/types/index.ts';
import { executeInSandbox, type UserContext } from '../runtime/sandbox.ts';
import { createR2Service } from '../services/storage.ts';
import { createAppsService } from '../services/apps.ts';
import { createAppDataService } from '../services/appdata.ts';
import { decryptEnvVars, decryptEnvVar } from '../services/envvars.ts';
import { executeGpuFunction } from '../services/gpu/executor.ts';
import { acquireGpuSlot } from '../services/gpu/concurrency.ts';
import { settleGpuExecution } from '../services/gpu/billing.ts';
import { createD1DataService } from '../services/d1-data.ts';
import { getD1DatabaseId } from '../services/d1-provisioning.ts';

// Decode JWT payload without verification (verification done by Supabase)
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    // Convert base64url to base64
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(base64));

    // Check expiration
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      return null; // Token expired
    }

    return payload;
  } catch {
    return null;
  }
}

// Extract user context from request Authorization header
function extractUserContext(request: Request): { userId: string; user: UserContext | null } {
  const authHeader = request.headers.get('Authorization');

  if (!authHeader?.startsWith('Bearer ')) {
    return {
      userId: '00000000-0000-0000-0000-000000000000', // Anonymous user ID
      user: null,
    };
  }

  const token = authHeader.slice(7);
  const payload = decodeJwtPayload(token);

  if (!payload) {
    return {
      userId: '00000000-0000-0000-0000-000000000000',
      user: null,
    };
  }

  // Extract user info from JWT
  const userId = payload.sub as string;
  const email = payload.email as string;
  const userMetadata = payload.user_metadata as Record<string, unknown> | undefined;

  const user: UserContext = {
    id: userId,
    email: email || '',
    displayName: (userMetadata?.full_name as string) ||
                 (userMetadata?.name as string) ||
                 email?.split('@')[0] ||
                 null,
    avatarUrl: (userMetadata?.avatar_url as string) ||
               (userMetadata?.picture as string) ||
               null,
    tier: 'free', // Default to free, could look up from database if needed
  };

  return { userId, user };
}

export async function handleRun(request: Request, appId: string): Promise<Response> {
  try {
    const body: RunRequest = await request.json();
    const { function: functionName, args = [] } = body;

    if (!functionName) {
      return error('Function name required');
    }

    // Extract user context from request
    const { userId, user } = extractUserContext(request);

    // Initialize services
    const appsService = createAppsService();
    const r2Service = createR2Service();
    // R2-based app data storage - zero config for users
    const appDataService = createAppDataService(appId);

    // Fetch app from database
    const app = await appsService.findById(appId);
    if (!app) {
      return error('App not found', 404);
    }

    // Check visibility permissions
    if (app.visibility === 'private' && app.owner_id !== userId) {
      return error('Unauthorized', 403);
    }

    // Fetch code from R2
    // Try different entry file extensions
    const storageKey = app.storage_key;
    let code: string | null = null;
    const entryFiles = ['index.tsx', 'index.ts', 'index.jsx', 'index.js'];

    for (const entryFile of entryFiles) {
      try {
        code = await r2Service.fetchTextFile(`${storageKey}${entryFile}`);
        break;
      } catch {
        // Try next extension
      }
    }

    if (!code) {
      console.error('No entry file found in R2');
      return error('No entry file found (index.tsx, index.ts, index.jsx, or index.js)', 404);
    }

    // Decrypt environment variables for the app
    const encryptedEnvVars = (app as Record<string, unknown>).env_vars as Record<string, string> || {};
    let envVars: Record<string, string> = {};
    try {
      envVars = await decryptEnvVars(encryptedEnvVars);
    } catch (err) {
      console.error('Failed to decrypt env vars:', err);
      // Continue with empty env vars
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

    // ── GPU Runtime Branch ──
    if (app.runtime === 'gpu') {
      if (app.gpu_status !== 'live') {
        return json(
          { success: false, error: { message: `GPU function not ready (status: ${app.gpu_status})` } } as RunResponse,
          503,
        );
      }

      // Acquire concurrency slot (429 if full after 5s wait)
      let gpuSlot;
      try {
        gpuSlot = await acquireGpuSlot(app.gpu_endpoint_id!, app.gpu_concurrency_limit || 5);
      } catch {
        return json(
          { success: false, error: { message: 'GPU function at capacity. Try again shortly.' } } as RunResponse,
          429,
        );
      }

      try {
        const gpuResult = await executeGpuFunction({
          app,
          functionName,
          args: typeof args === 'object' && !Array.isArray(args)
            ? args as Record<string, unknown>
            : { _args: args },
          executionId: crypto.randomUUID(),
        });

        // Settle billing (if caller !== owner)
        if (userId !== app.owner_id) {
          const settlement = await settleGpuExecution(
            userId, app, functionName,
            (typeof args === 'object' && !Array.isArray(args) ? args as Record<string, unknown> : {}),
            gpuResult,
          );
          if (settlement.insufficientBalance) {
            return json(
              { success: false, error: { message: settlement.insufficientBalanceMessage! } } as RunResponse,
              402,
            );
          }
        }

        const gpuResponse: RunResponse = {
          success: gpuResult.success,
          result: gpuResult.result,
          logs: gpuResult.logs,
          duration_ms: gpuResult.durationMs,
          error: gpuResult.error,
        };
        return json(gpuResponse);
      } finally {
        gpuSlot.release();
      }
    }

    // ── Deno Sandbox Path (existing, unchanged) ──
    // D1 Data Service (lazy-provisioned)
    const d1DatabaseId = (app as any).d1_database_id || await getD1DatabaseId(appId);
    const d1DataService = createD1DataService(appId, d1DatabaseId);

    // Execute in sandbox
    const result = await executeInSandbox(
      {
        appId,
        userId,
        executionId: crypto.randomUUID(),
        code,
        permissions: ['memory:read', 'memory:write', 'ai:call', 'net:fetch'],
        userApiKey: null,
        user,
        appDataService,
        d1DataService,
        memoryService: null,
        aiService: {
          call: async (request, apiKey) => ({
            content: 'AI placeholder - configure BYOK',
            model: request.model || 'gpt-4',
            usage: { input_tokens: 0, output_tokens: 0, cost_light: 0 },
          }),
        },
        envVars,
        supabase: supabaseConfig,
      },
      functionName,
      args,
    );

    const response: RunResponse = {
      success: result.success,
      result: result.result,
      logs: result.logs,
      duration_ms: result.durationMs,
      error: result.error,
    };

    return json(response);
  } catch (err) {
    console.error('Run error:', err);
    return error(err instanceof Error ? err.message : 'Execution failed', 500);
  }
}
