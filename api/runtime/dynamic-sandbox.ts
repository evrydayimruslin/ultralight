// Ultralight Dynamic Worker Sandbox
// Uses Cloudflare Dynamic Workers (env.LOADER.load()) to execute app code
// in isolated V8 sandboxes. Replaces AsyncFunction which is blocked in CF Workers.
//
// Architecture:
//   setup.js  → runs FIRST, sets globalThis.ultralight with lazy getters
//   app.js    → the app's ESM bundle, captures globalThis.ultralight at init
//   wrapper.js → entry point, sets RPC env, imports app, calls target function
//
// ESM module evaluation order: imports are evaluated depth-first.
// wrapper.js imports setup.js (runs first) then app.js (runs second).
// By the time app.js captures globalThis.ultralight, the SDK is ready.

import type { RuntimeConfig, ExecutionResult } from './sandbox.ts';

export async function executeInDynamicSandbox(
  config: RuntimeConfig,
  functionName: string,
  args: unknown[],
): Promise<ExecutionResult> {
  const startTime = Date.now();
  const loader = (globalThis as any).__env?.LOADER;

  if (!loader) {
    return {
      success: false, result: null, logs: [],
      durationMs: Date.now() - startTime, aiCostLight: 0,
      error: { type: 'RuntimeError', message: 'Dynamic Worker LOADER binding not available' },
    };
  }

  try {
    // 1. Get ESM bundle from KV
    let esmCode = await globalThis.__env?.CODE_CACHE?.get(`esm:${config.appId}:latest`);
    if (!esmCode) {
      // No ESM bundle — app hasn't been rebuilt. Can't execute without it.
      return {
        success: false, result: null, logs: [],
        durationMs: Date.now() - startTime, aiCostLight: 0,
        error: { type: 'RuntimeError', message: `No ESM bundle found for app ${config.appId}. Run rebuild first.` },
      };
    }

    // 2. Build setup module — sets globalThis.ultralight with lazy getters
    // User context and env vars are baked in as literals (they're per-request constants)
    const userJson = config.user ? JSON.stringify(config.user) : 'null';
    const envVarsJson = JSON.stringify(config.envVars || {});

    const setupModule = `
// Setup module — runs before app.js, sets globalThis.ultralight
// RPC bindings (__rpcEnv) are set later by wrapper.js fetch() handler.
// Lazy getters defer RPC calls until function execution time.
globalThis.__rpcEnv = {};

globalThis.ultralight = {
  get db() {
    const e = globalThis.__rpcEnv;
    if (!e.DB) return {
      run() { throw new Error('D1 database not available. Ensure your app has a migrations/ folder.'); },
      all() { throw new Error('D1 database not available.'); },
      first() { throw new Error('D1 database not available.'); },
      batch() { throw new Error('D1 database not available.'); },
      exec() { throw new Error('ultralight.db.exec() is not available at runtime.'); },
    };
    return {
      run: (s, p) => e.DB.run(s, p),
      all: (s, p) => e.DB.all(s, p),
      first: (s, p) => e.DB.first(s, p),
      batch: (st) => e.DB.batch(st),
      exec() { throw new Error('ultralight.db.exec() is not available at runtime.'); },
    };
  },
  user: ${userJson},
  env: ${envVarsJson},
  isAuthenticated() { return ${config.user ? 'true' : 'false'}; },
  requireAuth() { ${config.user ? `return ${userJson};` : 'throw new Error("Authentication required.");'} },
  store(k, v) { const e = globalThis.__rpcEnv; return e.DATA ? e.DATA.store(k, v) : Promise.reject(new Error('Data not available')); },
  load(k) { const e = globalThis.__rpcEnv; return e.DATA ? e.DATA.load(k) : Promise.resolve(null); },
  remove(k) { const e = globalThis.__rpcEnv; return e.DATA ? e.DATA.remove(k) : Promise.reject(new Error('Data not available')); },
  list(p) { const e = globalThis.__rpcEnv; return e.DATA ? e.DATA.list(p) : Promise.resolve([]); },
  query(p, o) { const e = globalThis.__rpcEnv; return e.DATA?.query?.(p, o) || Promise.resolve([]); },
  remember(k, v) { const e = globalThis.__rpcEnv; return e.MEMORY ? e.MEMORY.remember(k, v) : Promise.resolve(); },
  recall(k) { const e = globalThis.__rpcEnv; return e.MEMORY ? e.MEMORY.recall(k) : Promise.resolve(null); },
  ai(r) { const e = globalThis.__rpcEnv; return e.AI ? e.AI.call(r) : Promise.resolve({ content: '', error: 'AI not available' }); },
  call() { throw new Error('ultralight.call() not available in sandbox. Use ul.call platform tool.'); },
};
`;

    // 3. Build wrapper module — entry point, sets RPC env, calls function
    const escapedFnName = JSON.stringify(functionName);
    const escapedArgs = JSON.stringify(args);

    const wrapperModule = `
import './setup.js';
import * as appModule from './app.js';

export default {
  async fetch(request, env) {
    // Set RPC bindings for lazy getters in ultralight SDK
    globalThis.__rpcEnv = env;

    const logs = [];
    const con = {
      log: (...a) => logs.push({ time: new Date().toISOString(), level: 'log', message: a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ') }),
      error: (...a) => logs.push({ time: new Date().toISOString(), level: 'error', message: a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ') }),
      warn: (...a) => logs.push({ time: new Date().toISOString(), level: 'warn', message: a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ') }),
      info: (...a) => logs.push({ time: new Date().toISOString(), level: 'info', message: a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ') }),
    };
    globalThis.console = con;

    try {
      const fnName = ${escapedFnName};
      const fnArgs = ${escapedArgs};

      let targetFn = appModule[fnName];
      if (!targetFn && appModule.default && typeof appModule.default === 'object') {
        targetFn = appModule.default[fnName];
      }

      if (!targetFn || typeof targetFn !== 'function') {
        const available = [];
        for (const k of Object.keys(appModule)) { if (typeof appModule[k] === 'function') available.push(k); }
        if (appModule.default && typeof appModule.default === 'object') {
          for (const k of Object.keys(appModule.default)) { if (typeof appModule.default[k] === 'function') available.push(k); }
        }
        return Response.json({
          success: false, result: null, logs,
          error: { type: 'FunctionNotFound', message: 'Function "' + fnName + '" not found. Available: ' + [...new Set(available)].join(', ') },
        });
      }

      const result = await targetFn(...fnArgs);
      return Response.json({ success: true, result, logs });
    } catch (err) {
      return Response.json({
        success: false, result: null, logs,
        error: { type: err.constructor?.name || 'Error', message: err.message || String(err) },
      });
    }
  }
};
`;

    // 4. Create RPC bindings
    const ctx = (globalThis as any).__ctx;
    const bindings: Record<string, unknown> = {};

    if (config.d1DataService) {
      const { getD1DatabaseId } = await import('../services/d1-provisioning.ts');
      const dbId = await getD1DatabaseId(config.appId);
      if (dbId && ctx?.exports?.DatabaseBinding) {
        bindings.DB = ctx.exports.DatabaseBinding({
          props: { databaseId: dbId, appId: config.appId, userId: config.userId },
        });
      }
    }

    if (ctx?.exports?.AppDataBinding) {
      bindings.DATA = ctx.exports.AppDataBinding({
        props: { appId: config.appId, userId: config.userId },
      });
    }

    if (config.memoryService && ctx?.exports?.MemoryBinding) {
      bindings.MEMORY = ctx.exports.MemoryBinding({
        props: { userId: config.userId },
      });
    }

    if (ctx?.exports?.AIBinding) {
      bindings.AI = ctx.exports.AIBinding({
        props: { userId: config.userId, apiKey: config.userApiKey, provider: 'openrouter' },
      });
    }

    // 5. Create Dynamic Worker
    const worker = loader.load({
      compatibilityDate: '2026-03-01',
      mainModule: 'wrapper.js',
      modules: {
        'wrapper.js': wrapperModule,
        'setup.js': setupModule,
        'app.js': esmCode,
      },
      env: bindings,
      globalOutbound: null,
    });

    // 6. Execute with timeout
    const timeoutMs = config.timeoutMs || 30_000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const entrypoint = worker.getEntrypoint();
    const response = await entrypoint.fetch(
      new Request('http://internal/execute'),
      { signal: controller.signal },
    );
    clearTimeout(timeoutId);

    const data = (await response.json()) as {
      success: boolean;
      result: unknown;
      logs: Array<{ time: string; level: string; message: string }>;
      error?: { type: string; message: string };
    };

    return {
      success: data.success,
      result: data.result,
      logs: data.logs || [],
      durationMs: Date.now() - startTime,
      aiCostLight: 0,
      ...(data.error ? { error: data.error } : {}),
    };
  } catch (err) {
    return {
      success: false, result: null, logs: [],
      durationMs: Date.now() - startTime, aiCostLight: 0,
      error: {
        type: err instanceof Error ? err.constructor.name : 'UnknownError',
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
}
