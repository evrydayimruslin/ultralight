// Run Handler
// Executes user code in sandbox

import { error, json } from './app.ts';
import type { RunRequest, RunResponse } from '../../shared/types/index.ts';
import { executeInSandbox } from '../runtime/sandbox.ts';
import { createR2Service } from '../services/storage.ts';
import { createAppsService } from '../services/apps.ts';
import { createMemoryService } from '../services/memory.ts';

export async function handleRun(request: Request, appId: string): Promise<Response> {
  try {
    const body: RunRequest = await request.json();
    const { function: functionName, args = [] } = body;

    if (!functionName) {
      return error('Function name required');
    }

    const userId = '00000000-0000-0000-0000-000000000001';

    // Initialize services
    const appsService = createAppsService();
    const r2Service = createR2Service();
    const memoryService = createMemoryService();

    // Fetch app from database
    const app = await appsService.findById(appId);
    if (!app) {
      return error('App not found', 404);
    }
    
    if (app.visibility === 'private' && app.owner_id !== userId) {
      return error('Unauthorized', 403);
    }

    // Fetch code from R2
    // Try index.ts first, fall back to index.js
    const storageKey = app.storage_key;
    let code: string | null = null;
    let entryFileName = 'index.ts';

    try {
      code = await r2Service.fetchTextFile(`${storageKey}index.ts`);
    } catch {
      // index.ts not found, try index.js
      try {
        entryFileName = 'index.js';
        code = await r2Service.fetchTextFile(`${storageKey}index.js`);
      } catch {
        console.error('No entry file found in R2');
        return error('No entry file found (index.ts or index.js)', 404);
      }
    }

    // Execute in sandbox
    const result = await executeInSandbox(
      {
        appId,
        userId,
        executionId: crypto.randomUUID(),
        code,
        allowedDomains: ['api.openai.com', 'api.github.com', 'api.openrouter.ai'],
        permissions: ['memory:read', 'memory:write', 'ai:call', 'net:fetch'],
        userApiKey: null,
        memoryService: {
          remember: async (key: string, value: unknown) => {
            await memoryService.remember(userId, `app:${appId}`, key, value);
          },
          recall: async (key: string) => {
            return await memoryService.recall(userId, `app:${appId}`, key);
          },
        },
        aiService: {
          call: async (request, apiKey) => ({
            content: 'AI placeholder - configure BYOK',
            model: request.model || 'gpt-4',
            usage: { input_tokens: 0, output_tokens: 0, cost_cents: 0 },
          }),
        },
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
