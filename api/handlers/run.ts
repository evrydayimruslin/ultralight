// Run Handler
// Executes user code in sandbox

import { error, json } from './app.ts';
import type { RunRequest, RunResponse } from '../../shared/types/index.ts';
import { executeInSandbox, type UserContext } from '../runtime/sandbox.ts';
import { createR2Service } from '../services/storage.ts';
import { createAppsService } from '../services/apps.ts';
import { createAppDataService } from '../services/appdata.ts';
import { decryptEnvVars, decryptEnvVar } from '../services/envvars.ts';

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

    // Decrypt Supabase config if enabled (app-level first, then user platform-level fallback)
    const appRecord = app as Record<string, unknown>;
    let supabaseConfig: { url: string; anonKey: string; serviceKey?: string } | undefined;
    if (appRecord.supabase_enabled && appRecord.supabase_url && appRecord.supabase_anon_key_encrypted) {
      try {
        const anonKey = await decryptEnvVar(appRecord.supabase_anon_key_encrypted as string);
        supabaseConfig = {
          url: appRecord.supabase_url as string,
          anonKey,
        };
        if (appRecord.supabase_service_key_encrypted) {
          supabaseConfig.serviceKey = await decryptEnvVar(appRecord.supabase_service_key_encrypted as string);
        }
      } catch (err) {
        console.error('Failed to decrypt Supabase config:', err);
      }
    }

    // Fallback to user's platform-level Supabase config
    if (!supabaseConfig && appRecord.supabase_enabled) {
      try {
        const { getDecryptedPlatformSupabase } = await import('./user.ts');
        const platformConfig = await getDecryptedPlatformSupabase(app.owner_id);
        if (platformConfig) {
          supabaseConfig = platformConfig;
        }
      } catch (err) {
        console.error('Failed to get platform Supabase config:', err);
      }
    }

    // Execute in sandbox
    const result = await executeInSandbox(
      {
        appId,
        userId,
        executionId: crypto.randomUUID(),
        code,
        permissions: ['memory:read', 'memory:write', 'ai:call', 'net:fetch', 'cron:read', 'cron:write'],
        userApiKey: null,
        // Authenticated user context (null if anonymous)
        user,
        // R2-based app data - works out of the box, no user config needed
        appDataService,
        // User memory service - null for now (requires Supabase auth)
        // Will be enabled when user is authenticated
        memoryService: null,
        aiService: {
          call: async (request, apiKey) => ({
            content: 'AI placeholder - configure BYOK',
            model: request.model || 'gpt-4',
            usage: { input_tokens: 0, output_tokens: 0, cost_cents: 0 },
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
