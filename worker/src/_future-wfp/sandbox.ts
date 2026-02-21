// Worker Sandbox Execution Engine
// Ported from api/runtime/sandbox.ts → runs inside Cloudflare Workers V8 isolate
// Key differences from DO version:
//   - Native R2 bindings (no HTTP signing overhead)
//   - Workers runtime enforces 128MB memory + 30s CPU time limits
//   - No need for timer cleanup (isolate is destroyed after request)

import type {
  ExecuteRequest,
  ExecutionResult,
  LogEntry,
  UserContext,
  AppDataService,
  QueryOptions,
  AIRequest,
  AIResponse,
  UnsafeEval,
} from './types';
import { uuid, base64, hash, _, dateFns, schema, markdown, str, jwt, http } from './stdlib';
import { createAppDataService } from './appdata';
import { createSupabaseClient } from './supabase-client';

function formatLogItem(item: unknown): string {
  if (typeof item === 'string') return item;
  if (item === null) return 'null';
  if (item === undefined) return 'undefined';
  try {
    return JSON.stringify(item, null, 2);
  } catch {
    return String(item);
  }
}

export async function executeInWorkerSandbox(
  request: ExecuteRequest,
  bucket: R2Bucket,
  unsafeEval: UnsafeEval,
): Promise<ExecutionResult> {
  const startTime = Date.now();
  const logs: LogEntry[] = [];
  let aiCostCents = 0;

  const capturedConsole = {
    log: (...items: unknown[]) => {
      logs.push({ time: new Date().toISOString(), level: 'log', message: items.map(formatLogItem).join(' ') });
    },
    error: (...items: unknown[]) => {
      logs.push({ time: new Date().toISOString(), level: 'error', message: items.map(formatLogItem).join(' ') });
    },
    warn: (...items: unknown[]) => {
      logs.push({ time: new Date().toISOString(), level: 'warn', message: items.map(formatLogItem).join(' ') });
    },
    info: (...items: unknown[]) => {
      logs.push({ time: new Date().toISOString(), level: 'info', message: items.map(formatLogItem).join(' ') });
    },
  };

  try {
    // Fetch guards (same limits as DO version)
    const MAX_CONCURRENT_FETCHES = 20;
    const MAX_FETCH_RESPONSE_BYTES = 10 * 1024 * 1024; // 10 MB
    const FETCH_TIMEOUT_MS = 15_000;
    let activeFetchCount = 0;

    const openFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const parsedUrl = new URL(url);

      if (parsedUrl.protocol !== 'https:' && parsedUrl.hostname !== 'localhost') {
        throw new Error(`Only HTTPS URLs are allowed. Got: ${parsedUrl.protocol}`);
      }

      if (activeFetchCount >= MAX_CONCURRENT_FETCHES) {
        throw new Error(`Concurrent fetch limit exceeded (max ${MAX_CONCURRENT_FETCHES})`);
      }

      activeFetchCount++;
      try {
        const controller = new AbortController();
        const fetchTimeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

        const response = await fetch(input, {
          ...init,
          signal: init?.signal || controller.signal,
        });

        clearTimeout(fetchTimeout);

        const contentLength = response.headers.get('content-length');
        if (contentLength && parseInt(contentLength, 10) > MAX_FETCH_RESPONSE_BYTES) {
          throw new Error(`Response too large (${contentLength} bytes, max ${MAX_FETCH_RESPONSE_BYTES})`);
        }

        return response;
      } finally {
        activeFetchCount--;
      }
    };

    // Create native R2 AppDataService
    const appDataService = createAppDataService(bucket, request.appId, request.userId);

    // Build SDK
    const sdk: Record<string, unknown> = {
      env: Object.freeze({ ...request.envVars }),
      user: request.user,

      isAuthenticated: (): boolean => request.user !== null,
      requireAuth: (): UserContext => {
        if (!request.user) throw new Error('Authentication required. Please sign in to use this feature.');
        return request.user;
      },

      // APP DATA — native R2
      store: Object.assign(
        async (key: string, value: unknown) => {
          await appDataService.store(key, value);
          capturedConsole.log(`[SDK] store("${key}")`);
        },
        {
          set: async (key: string, value: unknown) => {
            await appDataService.store(key, value);
            capturedConsole.log(`[SDK] store.set("${key}")`);
          },
          get: async (key: string) => {
            const value = await appDataService.load(key);
            capturedConsole.log(`[SDK] store.get("${key}")`);
            return value;
          },
          remove: async (key: string) => {
            await appDataService.remove(key);
            capturedConsole.log(`[SDK] store.remove("${key}")`);
          },
          list: async (prefix?: string) => {
            const keys = await appDataService.list(prefix);
            capturedConsole.log(`[SDK] store.list(${prefix ? `"${prefix}"` : ''})`);
            return keys;
          },
        }
      ),
      load: async (key: string) => {
        const value = await appDataService.load(key);
        capturedConsole.log(`[SDK] load("${key}")`);
        return value;
      },
      remove: async (key: string) => {
        await appDataService.remove(key);
        capturedConsole.log(`[SDK] remove("${key}")`);
      },
      list: async (prefix?: string) => {
        const keys = await appDataService.list(prefix);
        capturedConsole.log(`[SDK] list(${prefix ? `"${prefix}"` : ''})`);
        return keys;
      },

      // QUERY HELPERS
      query: async (prefix: string, options?: QueryOptions) => {
        capturedConsole.log(`[SDK] query("${prefix}", ${JSON.stringify(options || {})})`);
        return await appDataService.query(prefix, options);
      },
      batchStore: async (items: Array<{ key: string; value: unknown }>) => {
        capturedConsole.log(`[SDK] batchStore(${items.length} items)`);
        return await appDataService.batchStore(items);
      },
      batchLoad: async (keys: string[]) => {
        capturedConsole.log(`[SDK] batchLoad(${keys.length} keys)`);
        return await appDataService.batchLoad(keys);
      },
      batchRemove: async (keys: string[]) => {
        capturedConsole.log(`[SDK] batchRemove(${keys.length} keys)`);
        return await appDataService.batchRemove(keys);
      },

      // USER MEMORY (placeholder — memory service not available in Worker yet)
      remember: async (_key: string, _value: unknown) => {
        throw new Error('memory:write not yet available in Worker sandbox. Use store() for app data.');
      },
      recall: async (_key: string) => {
        throw new Error('memory:read not yet available in Worker sandbox. Use load() for app data.');
      },

      // AI — pass-through (API key + provider resolved by DO control plane)
      ai: async (aiRequest: AIRequest): Promise<AIResponse> => {
        if (!request.permissions.includes('ai:call')) {
          throw new Error('ai:call permission required');
        }
        if (!request.userApiKey) {
          throw new Error('BYOK not configured. Please add your API key in Settings.');
        }
        capturedConsole.log(`[SDK] ai()`);
        // For now, proxy AI calls through OpenRouter (same as DO)
        // The userApiKey is the decrypted BYOK key passed from the control plane
        const response = await openFetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${request.userApiKey}`,
          },
          body: JSON.stringify({
            model: aiRequest.model || 'openai/gpt-4o-mini',
            messages: aiRequest.messages,
            temperature: aiRequest.temperature,
            max_tokens: aiRequest.max_tokens,
          }),
        });

        if (!response.ok) {
          const errText = await response.text().catch(() => response.statusText);
          throw new Error(`AI call failed (${response.status}): ${errText}`);
        }

        const data = await response.json() as any;
        const choice = data.choices?.[0];
        return {
          content: choice?.message?.content || '',
          model: data.model || aiRequest.model || 'unknown',
          usage: {
            input_tokens: data.usage?.prompt_tokens || 0,
            output_tokens: data.usage?.completion_tokens || 0,
            cost_cents: 0, // TODO: compute from model pricing
          },
        };
      },

      // CALL — inter-app function calls via MCP
      call: async (targetAppId: string, functionName: string, callArgs?: Record<string, unknown>): Promise<unknown> => {
        if (!request.permissions.includes('app:call')) {
          throw new Error('app:call permission required');
        }
        if (!request.baseUrl || !request.authToken) {
          throw new Error('Inter-app calls not available (missing baseUrl or authToken)');
        }
        capturedConsole.log(`[SDK] call("${targetAppId}", "${functionName}")`);

        const rpcRequest = {
          jsonrpc: '2.0',
          id: crypto.randomUUID(),
          method: 'tools/call',
          params: {
            name: functionName,
            arguments: callArgs || {},
          },
        };

        const response = await openFetch(`${request.baseUrl}/mcp/${targetAppId}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${request.authToken}`,
          },
          body: JSON.stringify(rpcRequest),
        });

        if (!response.ok) {
          const text = await response.text().catch(() => response.statusText);
          throw new Error(`ultralight.call failed (${response.status}): ${text}`);
        }

        const rpcResponse = await response.json() as any;
        if (rpcResponse.error) {
          throw new Error(`ultralight.call RPC error: ${rpcResponse.error.message || JSON.stringify(rpcResponse.error)}`);
        }

        const result = rpcResponse.result;
        if (result?.content && Array.isArray(result.content)) {
          const textBlock = result.content.find((c: { type: string }) => c.type === 'text');
          if (textBlock?.text) {
            try { return JSON.parse(textBlock.text); } catch { return textBlock.text; }
          }
        }
        return result;
      },
    };

    // Create Supabase client if configured
    let supabaseClient: unknown = null;
    if (request.supabase?.url && request.supabase?.anonKey) {
      supabaseClient = createSupabaseClient(
        request.supabase.url,
        request.supabase.anonKey,
        request.supabase.serviceKey,
        openFetch
      );
      capturedConsole.log('[SDK] Supabase client initialized');
    }

    // Mock React/ReactDOM (MCP functions don't need UI rendering)
    const mockReact = {
      createElement: () => null,
      useState: () => [null, () => {}],
      useEffect: () => {},
      useCallback: (fn: unknown) => fn,
      useMemo: (fn: () => unknown) => fn(),
      useRef: () => ({ current: null }),
      useContext: () => null,
      createContext: () => ({ Provider: () => null, Consumer: () => null }),
      Fragment: Symbol('Fragment'),
      StrictMode: Symbol('StrictMode'),
      jsx: () => null,
      jsxs: () => null,
      jsxDEV: () => null,
    };
    const mockReactDOM = {
      createRoot: () => ({ render: () => {}, unmount: () => {} }),
      render: () => {},
    };

    const sandboxRequire = (moduleName: string) => {
      if (moduleName === 'react' || moduleName.startsWith('https://esm.sh/react')) return mockReact;
      if (moduleName === 'react/jsx-runtime' || (moduleName.includes('react') && moduleName.includes('jsx-runtime'))) return mockReact;
      if (moduleName === 'react-dom' || moduleName === 'react-dom/client' || moduleName.startsWith('https://esm.sh/react-dom')) return mockReactDOM;
      throw new Error(`Module "${moduleName}" is not available in the MCP sandbox. Only backend functions are supported.`);
    };

    // Build execution context
    const context: Record<string, unknown> = {
      require: sandboxRequire,
      ultralight: sdk,
      console: capturedConsole,
      fetch: openFetch,
      setTimeout: setTimeout,
      clearTimeout: clearTimeout,
      setInterval: setInterval,
      clearInterval: clearInterval,
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
      RegExp,
      Map,
      Set,
      WeakMap,
      WeakSet,
      Symbol,
      BigInt,
      Uint8Array,
      Int8Array,
      Uint16Array,
      Int16Array,
      Uint32Array,
      Int32Array,
      Float32Array,
      Float64Array,
      ArrayBuffer,
      TextEncoder,
      TextDecoder,
      atob,
      btoa,
      crypto,

      // PRE-BUNDLED STDLIB
      _: _,
      uuid: uuid,
      base64: base64,
      hash: hash,
      dateFns: dateFns,
      schema: schema,
      markdown: markdown,
      str: str,
      jwt: jwt,
      http: http,

      // Supabase
      supabase: supabaseClient,
    };

    // Build sandboxGlobalThis
    const sandboxGlobalThis: Record<string, unknown> = {
      ultralight: sdk,
      uuid: uuid,
      _: _,
      console: capturedConsole,
      fetch: openFetch,
      setTimeout: setTimeout,
      clearTimeout: clearTimeout,
      setInterval: setInterval,
      clearInterval: clearInterval,
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
      RegExp,
      Map,
      Set,
      crypto,
      TextEncoder,
      TextDecoder,
      atob,
      btoa,
      require: sandboxRequire,
    };

    if (supabaseClient) {
      sandboxGlobalThis.supabase = supabaseClient;
    }

    context.globalThis = sandboxGlobalThis;

    // Compile and execute user code
    const functionName = request.functionName;
    let userFunc: Function;

    try {
      const contextKeys = Object.keys(context);
      const contextValues = Object.values(context);

      const wrapperCode = `
        "use strict";

        globalThis.ultralight = ultralight;
        globalThis.uuid = uuid;
        globalThis._ = _;
        globalThis.console = console;
        globalThis.fetch = fetch;
        globalThis.require = require;
        if (supabase !== null) {
          globalThis.supabase = supabase;
        }

        ${request.code}

        let __targetFn = null;
        if (typeof __exports !== 'undefined' && __exports !== null && typeof __exports["${functionName}"] === 'function') {
          __targetFn = __exports["${functionName}"];
        }
        else if (typeof ${functionName} === 'function') {
          __targetFn = ${functionName};
        }

        if (!__targetFn) {
          let available = [];
          if (typeof __exports !== 'undefined' && __exports !== null) {
            available = Object.keys(__exports).filter(k => typeof __exports[k] === 'function');
          }
          throw new Error('Function "${functionName}" not found. Available functions: ' + (available.length > 0 ? available.join(', ') : 'none'));
        }

        return __targetFn(...args);
      `;

      // Use Cloudflare's UnsafeEval binding (required — Workers blocks new Function() by default)
      const fn = unsafeEval.newAsyncFunction(wrapperCode, 'sandbox', 'args', ...contextKeys);
      userFunc = (callArgs: unknown[]) => fn(callArgs, ...contextValues);

    } catch (compileErr) {
      throw new Error(`Code compilation failed: ${compileErr instanceof Error ? compileErr.message : String(compileErr)}`);
    }

    // Execute — Workers runtime enforces CPU time limit (30s)
    // No need for Promise.race timeout; the isolate will be killed
    const result = await userFunc(request.args);

    const durationMs = Date.now() - startTime;

    // Guard against oversized results
    const MAX_RESULT_BYTES = 5 * 1024 * 1024; // 5 MB
    const serialized = JSON.stringify(result);
    if (serialized && serialized.length > MAX_RESULT_BYTES) {
      return {
        success: false,
        result: null,
        logs: logs,
        durationMs: durationMs,
        aiCostCents: aiCostCents,
        error: {
          type: 'ResultTooLarge',
          message: `Result size (${(serialized.length / 1024 / 1024).toFixed(1)} MB) exceeds limit (${MAX_RESULT_BYTES / 1024 / 1024} MB)`,
        },
      };
    }

    return {
      success: true,
      result: result,
      logs: logs,
      durationMs: durationMs,
      aiCostCents: aiCostCents,
    };

  } catch (error) {
    const durationMs = Date.now() - startTime;
    return {
      success: false,
      result: null,
      logs: logs,
      durationMs: durationMs,
      aiCostCents: aiCostCents,
      error: {
        type: error instanceof Error ? error.constructor.name : 'UnknownError',
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}
