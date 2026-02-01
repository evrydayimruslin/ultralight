// Ultralight Deno Runtime
// Sandboxed execution - using Function constructor with fallbacks

import type {
  AIRequest,
  AIResponse,
  LogEntry,
} from '../../shared/types/index.ts';

export interface RuntimeConfig {
  appId: string;
  userId: string;
  executionId: string;
  code: string;
  allowedDomains: string[];
  permissions: string[];
  userApiKey: string | null;
  // App data storage (R2-based, zero config)
  appDataService: AppDataService;
  // User memory (for unified Memory.md - optional, can be null)
  memoryService: MemoryService | null;
  aiService: AIService;
}

export interface AppDataService {
  store(key: string, value: unknown): Promise<void>;
  load(key: string): Promise<unknown>;
  remove(key: string): Promise<void>;
  list(prefix?: string): Promise<string[]>;
}

export interface MemoryService {
  remember(key: string, value: unknown): Promise<void>;
  recall(key: string): Promise<unknown>;
}

export interface AIService {
  call(request: AIRequest, apiKey: string): Promise<AIResponse>;
}

export interface ExecutionResult {
  success: boolean;
  result: unknown;
  logs: LogEntry[];
  durationMs: number;
  aiCostCents: number;
  error?: {
    type: string;
    message: string;
    stack?: string;
  };
}

/**
 * Executes user code with soft isolation
 * Tries multiple approaches for Deno Deploy compatibility
 */
export async function executeInSandbox(
  config: RuntimeConfig,
  functionName: string,
  args: unknown[],
): Promise<ExecutionResult> {
  const startTime = Date.now();
  const logs: LogEntry[] = [];
  let aiCostCents = 0;

  const capturedConsole = {
    log: (...items: unknown[]) => {
      const message = items.map(formatLogItem).join(' ');
      logs.push({ time: new Date().toISOString(), level: 'log', message });
    },
    error: (...items: unknown[]) => {
      const message = items.map(formatLogItem).join(' ');
      logs.push({ time: new Date().toISOString(), level: 'error', message });
    },
    warn: (...items: unknown[]) => {
      const message = items.map(formatLogItem).join(' ');
      logs.push({ time: new Date().toISOString(), level: 'warn', message });
    },
    info: (...items: unknown[]) => {
      const message = items.map(formatLogItem).join(' ');
      logs.push({ time: new Date().toISOString(), level: 'info', message });
    },
  };

  try {
    // Create SDK with both app data (R2) and user memory (Supabase)
    const sdk = {
      // ========================================
      // APP DATA - R2-based, zero config
      // For storing app-specific data
      // ========================================
      store: async (key: string, value: unknown) => {
        await config.appDataService.store(key, value);
        capturedConsole.log(`[SDK] store("${key}")`);
      },

      load: async (key: string) => {
        const value = await config.appDataService.load(key);
        capturedConsole.log(`[SDK] load("${key}")`);
        return value;
      },

      remove: async (key: string) => {
        await config.appDataService.remove(key);
        capturedConsole.log(`[SDK] remove("${key}")`);
      },

      list: async (prefix?: string) => {
        const keys = await config.appDataService.list(prefix);
        capturedConsole.log(`[SDK] list(${prefix ? `"${prefix}"` : ''})`);
        return keys;
      },

      // ========================================
      // USER MEMORY - For unified Memory.md
      // Requires Supabase (optional, future feature)
      // ========================================
      remember: async (key: string, value: unknown) => {
        if (!config.permissions.includes('memory:write')) {
          throw new Error('memory:write permission required');
        }
        if (!config.memoryService) {
          throw new Error('User memory not available - use store() for app data');
        }
        await config.memoryService.remember(key, value);
        capturedConsole.log(`[SDK] remember("${key}")`);
      },

      recall: async (key: string) => {
        if (!config.permissions.includes('memory:read')) {
          throw new Error('memory:read permission required');
        }
        if (!config.memoryService) {
          throw new Error('User memory not available - use load() for app data');
        }
        const value = await config.memoryService.recall(key);
        capturedConsole.log(`[SDK] recall("${key}")`);
        return value;
      },

      // ========================================
      // AI - Requires BYOK or platform credits
      // ========================================
      ai: async (request: AIRequest): Promise<AIResponse> => {
        if (!config.permissions.includes('ai:call')) {
          throw new Error('ai:call permission required');
        }
        if (!config.userApiKey) {
          throw new Error('No API key configured - add your OpenRouter key in settings');
        }
        capturedConsole.log(`[SDK] ai()`);
        return await config.aiService.call(request, config.userApiKey);
      },
    };

    // Create restricted fetch
    const restrictedFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const parsedUrl = new URL(url);

      const isAllowed = config.allowedDomains.some((domain) => {
        return parsedUrl.hostname === domain || parsedUrl.hostname.endsWith(`.${domain}`);
      });

      if (!isAllowed) {
        throw new Error(`Network access to "${parsedUrl.hostname}" not allowed`);
      }

      return await fetch(input, init);
    };

    // Build execution context
    const context = {
      ultralight: sdk,
      console: capturedConsole,
      fetch: restrictedFetch,
      setTimeout: (fn: () => void, ms: number) => setTimeout(fn, Math.min(ms, 30000)),
      clearTimeout,
      URL,
      URLSearchParams,
      JSON,
      Math,
      Date,
      Array,
      Object,
      String,
      Number,
      Boolean,
      Promise,
      Error,
    };

    // Try to execute using Function constructor
    let userFunc: Function;

    try {
      // Create a function that wraps the user code
      const contextKeys = Object.keys(context);
      const contextValues = Object.values(context);

      const wrapperCode = `
        "use strict";
        ${config.code}

        if (typeof ${functionName} !== 'function') {
          throw new Error('Function "${functionName}" not found');
        }

        return ${functionName}(...args);
      `;

      // Use AsyncFunction to allow async user code
      const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
      const fn = new AsyncFunction('args', ...contextKeys, wrapperCode);

      // Create bound function
      userFunc = (...callArgs: unknown[]) => fn(callArgs, ...contextValues);

    } catch (compileErr) {
      // If Function constructor fails, return clear error
      throw new Error(`Code compilation failed: ${compileErr instanceof Error ? compileErr.message : String(compileErr)}`);
    }

    // Execute
    const result = await userFunc(args);

    const durationMs = Date.now() - startTime;

    return {
      success: true,
      result,
      logs,
      durationMs,
      aiCostCents,
    };

  } catch (error) {
    const durationMs = Date.now() - startTime;

    return {
      success: false,
      result: null,
      logs,
      durationMs,
      aiCostCents,
      error: {
        type: error instanceof Error ? error.constructor.name : 'UnknownError',
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
    };
  }
}

function formatLogItem(item: unknown): string {
  if (typeof item === 'string') return item;
  if (item === null) return 'null';
  if (item === undefined) return 'undefined';
  if (typeof item === 'object') {
    try {
      return JSON.stringify(item);
    } catch {
      return '[Object]';
    }
  }
  return String(item);
}
