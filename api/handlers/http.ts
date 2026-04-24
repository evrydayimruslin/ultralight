// HTTP Endpoints Handler
// Enables apps to receive HTTP requests from external services (webhooks, APIs, etc.)

import { error, json } from "./response.ts";
import { createAppsService } from "../services/apps.ts";
import { createAppDataService } from "../services/appdata.ts";
import { createAIService } from "../services/ai.ts";
import { checkAndIncrementWeeklyCalls } from "../services/weekly-calls.ts";
import { executeGpuFunction } from "../services/gpu/executor.ts";
import { acquireGpuSlot } from "../services/gpu/concurrency.ts";
import { buildGpuNotReadyMessage } from "../services/gpu/status.ts";
import { getUserTier } from "../services/tier-enforcement.ts";
import {
  buildCorsHeaders,
  buildCorsPreflightResponse,
} from "../services/cors.ts";
import {
  logExecutionResult,
  settleAndLogGpuExecution,
} from "../services/execution-settlement.ts";
import {
  buildMissingAppSecretsErrorDetails,
  buildMissingAppSecretsMessage,
  createAppD1Resources,
  fetchAppEntryCode,
  resolveAppRuntimeEnvVars,
  resolveAppSupabaseConfig,
  resolveManifestPermissions,
  SupabaseConfigMigrationRequiredError,
} from "../services/app-runtime-resources.ts";
import { buildGpuStatusDiagnostics } from "../services/gpu/status.ts";
import {
  callerHasAppAccess,
  callerHasFunctionAccess,
  callerHasRequiredScope,
  resolveRequestCallerContext,
} from "../services/request-caller-context.ts";

// ============================================
// PER-APP IP-BASED HTTP RATE LIMITING
// ============================================
// In-memory sliding window keyed by ip:appId.
// Protects against unauthenticated floods and webhook quota exhaustion.

const httpRateBuckets = new Map<string, { count: number; resetAt: number }>();

// Cleanup expired buckets lazily (CF Workers don't allow setInterval at module scope)
function cleanupHttpRateBuckets() {
  const now = Date.now();
  for (const [key, bucket] of httpRateBuckets) {
    if (bucket.resetAt < now) {
      httpRateBuckets.delete(key);
    }
  }
}

/**
 * Check per-app HTTP rate limit (IP-scoped).
 * Uses the app's http_rate_limit column (default 1000 req/min).
 */
function checkHttpRateLimit(
  ip: string,
  appId: string,
  limitPerMinute: number,
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
export async function handleHttpEndpoint(
  request: Request,
  appId: string,
  path: string,
): Promise<Response> {
  const startTime = Date.now();

  try {
    // Extract function name from path (first segment after appId)
    const pathParts = path.split("/").filter(Boolean);
    const functionName = pathParts[0] || "handler";
    const subPath = "/" + pathParts.slice(1).join("/");

    console.log(
      `[HTTP] ${request.method} /http/${appId}/${functionName}${subPath}`,
    );

    // Get app
    const appsService = createAppsService();
    const app = await appsService.findById(appId);

    if (!app) {
      return json({ error: "App not found" }, 404);
    }

    // Check if HTTP endpoints are enabled for this app
    const httpEnabled = app.http_enabled !== false;
    if (!httpEnabled) {
      return json({ error: "HTTP endpoints are disabled for this app" }, 403);
    }

    // Per-app IP-based rate limit (prevents unauthenticated flood / quota exhaustion)
    const clientIp =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      "unknown";
    const appRateLimit = app.http_rate_limit || 1000;
    const httpRateResult = checkHttpRateLimit(clientIp, appId, appRateLimit);

    if (!httpRateResult.allowed) {
      return new Response(
        JSON.stringify({ error: "Rate limit exceeded for this app" }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": String(
              Math.ceil((httpRateResult.resetAt.getTime() - Date.now()) / 1000),
            ),
            "X-RateLimit-Limit": String(appRateLimit),
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": String(
              Math.floor(httpRateResult.resetAt.getTime() / 1000),
            ),
          },
        },
      );
    }

    // Weekly call limit check (counts against app owner)
    const ownerTier = await getUserTier(app.owner_id);
    const weeklyResult = await checkAndIncrementWeeklyCalls(
      app.owner_id,
      ownerTier,
      {
        mode: "fail_closed",
        resource: "HTTP endpoint weekly call limit",
      },
    );
    if (!weeklyResult.allowed) {
      if (weeklyResult.reason === "service_unavailable") {
        return json({
          error:
            "Usage controls are temporarily unavailable for this app. Please try again shortly.",
        }, 503);
      }
      return json({
        error:
          "Weekly call limit exceeded for this app's owner. Try again next week.",
      }, 429);
    }

    const code = await fetchAppEntryCode(app);

    if (!code) {
      return json({ error: "App code not found" }, 404);
    }

    // Check if the function exists in exports
    const exports = app.exports || [];
    if (
      !exports.includes(functionName) && functionName !== "handler" &&
      functionName !== "default"
    ) {
      return json({
        error: `Function "${functionName}" not found`,
        available_functions: exports.filter((e) => !e.startsWith("_")),
      }, 404);
    }

    // Create app data service
    // For HTTP endpoints, use a special "http" user ID since there's no authenticated user
    const appDataService = createAppDataService(appId);

    const callerPromise = resolveRequestCallerContext(request, {
      authSourcePolicy: "bearer_only",
      allowAnonymous: true,
      invalidAuthPolicy: "ignore",
    });

    let envResolution;
    let supabaseConfig;
    let d1DataService;
    let caller;
    try {
      [envResolution, supabaseConfig, { d1DataService }, caller] = await Promise
        .all([
          callerPromise.then((resolvedCaller) =>
            resolveAppRuntimeEnvVars(app, resolvedCaller.userId)
          ),
          resolveAppSupabaseConfig(app),
          createAppD1Resources(app),
          callerPromise,
        ]);
    } catch (err) {
      if (err instanceof SupabaseConfigMigrationRequiredError) {
        return json({ error: err.message }, 409);
      }
      throw err;
    }
    const { envVars, missingRequiredSecrets } = envResolution;
    const { user, userApiKey } = caller;
    const requestUrl = new URL(request.url);

    if (missingRequiredSecrets.length > 0) {
      return json({
        error: buildMissingAppSecretsMessage(missingRequiredSecrets),
        details: buildMissingAppSecretsErrorDetails(app.id, missingRequiredSecrets),
      }, 400);
    }

    if (!callerHasAppAccess(caller, [app.id, app.slug, appId])) {
      return json({
        error: `Token not authorized for this app. Scoped to: ${
          (caller.tokenAppIds || []).join(", ")
        }`,
      }, 403);
    }

    if (!callerHasFunctionAccess(caller, [functionName])) {
      return json({
        error:
          `Token not authorized for function "${functionName}". Scoped to: ${
            (caller.tokenFunctionNames || []).join(", ")
          }`,
      }, 403);
    }

    if (
      caller.authState === "authenticated" &&
      !callerHasRequiredScope(caller, "apps:call")
    ) {
      return json({ error: "Token missing required scope: apps:call" }, 403);
    }

    // Create AI service
    let aiService;
    if (userApiKey && caller.userProfile?.byok_provider) {
      aiService = createAIService(caller.userProfile.byok_provider, userApiKey);
    } else {
      aiService = {
        call: async () => ({
          content: "",
          model: "none",
          usage: { input_tokens: 0, output_tokens: 0, cost_light: 0 },
          error: "BYOK not configured",
        }),
      };
    }

    // Build the UltralightRequest object to pass to the function
    // This is a simplified Request-like object with useful properties
    const ultralightRequest = {
      method: request.method,
      url: requestUrl.pathname + requestUrl.search,
      path: subPath || "/",
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
          return "";
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
    if (app.runtime === "gpu") {
      if (app.gpu_status !== "live") {
        return json(
          {
            error: "GPU function not ready",
            status: app.gpu_status,
            message: buildGpuNotReadyMessage(app.gpu_status),
            details: buildGpuStatusDiagnostics(app.gpu_status, {
              appId: app.id,
            }),
          },
          503,
        );
      }

      let gpuSlot;
      try {
        gpuSlot = await acquireGpuSlot(
          app.gpu_endpoint_id!,
          app.gpu_concurrency_limit || 5,
        );
      } catch {
        return json({ error: "GPU function at capacity" }, 429);
      }

      try {
        const gpuResult = await executeGpuFunction({
          app,
          functionName,
          args: { request: ultralightRequest },
          executionId: crypto.randomUUID(),
        });
        const gpuDurationMs = Date.now() - startTime;

        const settlementUserId = user?.id || app.owner_id;
        const { settlement } = await settleAndLogGpuExecution({
          userId: settlementUserId,
          user,
          app,
          functionName,
          inputArgs: { request: ultralightRequest },
          method: "http",
          gpuResult,
          durationMs: gpuDurationMs,
        });

        if (settlement?.insufficientBalance) {
          return json({ error: settlement.insufficientBalanceMessage }, 402);
        }

        console.log(
          `[HTTP-GPU] ${request.method} /http/${appId}/${functionName} - ${
            gpuResult.success ? "OK" : gpuResult.exitCode
          } - ${gpuDurationMs}ms`,
        );

        if (!gpuResult.success) {
          return json({
            error: gpuResult.error?.message || "GPU execution failed",
            type: gpuResult.error?.type,
            logs: gpuResult.logs,
          }, 500);
        }

        // Handle the response (same formatting as Deno path below)
        const gpuFnResult = gpuResult.result;

        if (gpuFnResult instanceof Response) {
          return gpuFnResult;
        }

        if (gpuFnResult && typeof gpuFnResult === "object") {
          const resConfig = gpuFnResult as Record<string, unknown>;
          if ("statusCode" in resConfig || "status" in resConfig) {
            const status =
              (resConfig.statusCode || resConfig.status || 200) as number;
            const headers = new Headers(
              resConfig.headers as Record<string, string> || {},
            );
            const body = resConfig.body;
            if (!headers.has("Content-Type")) {
              headers.set("Content-Type", "application/json");
            }
            return new Response(
              typeof body === "string" ? body : JSON.stringify(body),
              { status, headers },
            );
          }
        }

        return json(gpuFnResult);
      } finally {
        gpuSlot.release();
      }
    }

    // Execute the function in sandbox — AI-capable apps get 120s timeout
    const httpPermissions = resolveManifestPermissions(app, [
      "memory:read",
      "memory:write",
      "ai:call",
      "net:fetch",
    ]);
    // Dynamic Worker sandbox — avoids `new Function()` restriction on CF Workers
    const { executeInDynamicSandbox } = await import(
      "../runtime/dynamic-sandbox.ts"
    );
    const result = await executeInDynamicSandbox(
      {
        appId: app.id,
        userId: user?.id || "anonymous",
        ownerId: app.owner_id,
        executionId: crypto.randomUUID(),
        code,
        permissions: httpPermissions,
        userApiKey,
        user,
        appDataService,
        d1DataService,
        memoryService: null,
        aiService: aiService as {
          call: (
            request: import("../../shared/types/index.ts").AIRequest,
            apiKey: string,
          ) => Promise<import("../../shared/types/index.ts").AIResponse>;
        },
        envVars,
        supabase: supabaseConfig,
        timeoutMs: httpPermissions.includes("ai:call") ? 120_000 : 30_000,
      },
      functionName,
      [ultralightRequest],
    );

    const durationMs = Date.now() - startTime;

    logExecutionResult({
      userId: user?.id || app.owner_id,
      appId: app.id,
      appName: app.name || app.slug,
      functionName,
      method: "http",
      success: result.success,
      durationMs,
      errorMessage: result.success
        ? undefined
        : (result.error?.message || "Execution failed"),
      outputResult: result.success ? result.result : result.error,
      userTier: user?.tier,
      appVersion: app.current_version || undefined,
      aiCostLight: result.aiCostLight || 0,
    });

    console.log(
      `[HTTP] ${request.method} /http/${appId}/${functionName} - ${
        result.success ? "OK" : "ERROR"
      } - ${durationMs}ms`,
    );

    if (!result.success) {
      return json({
        error: result.error?.message || "Execution failed",
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
    if (fnResult && typeof fnResult === "object") {
      const resConfig = fnResult as Record<string, unknown>;

      // Check for explicit response format
      if ("statusCode" in resConfig || "status" in resConfig) {
        const status =
          (resConfig.statusCode || resConfig.status || 200) as number;
        const headers = new Headers(
          resConfig.headers as Record<string, string> || {},
        );
        const body = resConfig.body;

        if (!headers.has("Content-Type")) {
          headers.set("Content-Type", "application/json");
        }

        return new Response(
          typeof body === "string" ? body : JSON.stringify(body),
          { status, headers },
        );
      }
    }

    // Default: wrap result as JSON response with CORS headers
    return new Response(JSON.stringify(fnResult), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "X-Execution-Time": `${durationMs}ms`,
        ...buildCorsHeaders(request),
      },
    });
  } catch (err) {
    console.error("[HTTP] Error:", err);
    return json({
      error: "Internal server error",
      message: err instanceof Error ? err.message : String(err),
    }, 500);
  }
}

/**
 * Handle CORS preflight requests
 */
export function handleHttpOptions(request: Request, _appId: string): Response {
  return buildCorsPreflightResponse(request);
}
