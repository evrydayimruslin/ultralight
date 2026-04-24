// Run Handler
// Executes user code in sandbox

import { error, json } from "./response.ts";
import type { AIRequest, AIResponse } from "../../shared/contracts/ai.ts";
import type {
  LogEntry,
  RunRequest,
  RunResponse,
} from "../../shared/types/index.ts";
import { createAppsService } from "../services/apps.ts";
import { createAppDataService } from "../services/appdata.ts";
import { createAIService } from "../services/ai.ts";
import { executeGpuFunction } from "../services/gpu/executor.ts";
import { acquireGpuSlot } from "../services/gpu/concurrency.ts";
import { buildGpuNotReadyMessage } from "../services/gpu/status.ts";
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
import {
  logExecutionResult,
  settleAndLogGpuExecution,
} from "../services/execution-settlement.ts";

function toLogEntries(lines: string[]): LogEntry[] {
  return lines.map((message) => ({
    time: new Date().toISOString(),
    level: "log",
    message,
  }));
}

export async function handleRun(
  request: Request,
  appId: string,
): Promise<Response> {
  try {
    const body: RunRequest = await request.json();
    const { function: functionName, args = [] } = body;

    if (!functionName) {
      return error("Function name required");
    }

    const caller = await resolveRequestCallerContext(request, {
      authSourcePolicy: "bearer_only",
      allowAnonymous: true,
      invalidAuthPolicy: "ignore",
    });
    const { userId, user } = caller;

    // Initialize services
    const appsService = createAppsService();
    // R2-based app data storage - zero config for users
    const appDataService = createAppDataService(appId);

    // Fetch app from database
    const app = await appsService.findById(appId);
    if (!app) {
      return error("App not found", 404);
    }

    // Check visibility permissions
    if (app.visibility === "private" && app.owner_id !== userId) {
      return error("Unauthorized", 403);
    }

    if (!callerHasAppAccess(caller, [app.id, app.slug, appId])) {
      return error(
        `Token not authorized for this app. Scoped to: ${
          (caller.tokenAppIds || []).join(", ")
        }`,
        403,
      );
    }

    if (!callerHasFunctionAccess(caller, [functionName])) {
      return error(
        `Token not authorized for function "${functionName}". Scoped to: ${
          (caller.tokenFunctionNames || []).join(", ")
        }`,
        403,
      );
    }

    if (
      caller.authState === "authenticated" &&
      !callerHasRequiredScope(caller, "apps:call")
    ) {
      return error("Token missing required scope: apps:call", 403);
    }

    // ── GPU Runtime Branch ──
    if (app.runtime === "gpu") {
      if (app.gpu_status !== "live") {
        return json(
          {
            success: false,
            result: null,
            logs: [],
            duration_ms: 0,
            error: {
              type: "GPU_NOT_READY",
              message: buildGpuNotReadyMessage(app.gpu_status),
              details: buildGpuStatusDiagnostics(app.gpu_status, {
                appId: app.id,
              }),
            },
          } as RunResponse,
          503,
        );
      }

      // Acquire concurrency slot (429 if full after 5s wait)
      let gpuSlot;
      try {
        gpuSlot = await acquireGpuSlot(
          app.gpu_endpoint_id!,
          app.gpu_concurrency_limit || 5,
        );
      } catch {
        return json(
          {
            success: false,
            error: { message: "GPU function at capacity. Try again shortly." },
          } as RunResponse,
          429,
        );
      }

      try {
        const gpuStartTime = Date.now();
        const gpuResult = await executeGpuFunction({
          app,
          functionName,
          args: typeof args === "object" && !Array.isArray(args)
            ? args as Record<string, unknown>
            : { _args: args },
          executionId: crypto.randomUUID(),
        });
        const gpuDurationMs = Date.now() - gpuStartTime;
        const gpuInputArgs = typeof args === "object" && !Array.isArray(args)
          ? args as Record<string, unknown>
          : {};
        const settlementUserId = caller.authState === "authenticated"
          ? userId
          : app.owner_id;
        const { settlement } = await settleAndLogGpuExecution({
          userId: settlementUserId,
          user,
          app,
          functionName,
          inputArgs: gpuInputArgs,
          method: "run",
          gpuResult,
          durationMs: gpuDurationMs,
        });
        if (settlement?.insufficientBalance) {
          return json(
            {
              success: false,
              error: { message: settlement.insufficientBalanceMessage! },
            } as RunResponse,
            402,
          );
        }

        const gpuResponse: RunResponse = {
          success: gpuResult.success,
          result: gpuResult.result,
          logs: toLogEntries(gpuResult.logs),
          duration_ms: gpuResult.durationMs,
          error: gpuResult.error,
        };
        return json(gpuResponse);
      } finally {
        gpuSlot.release();
      }
    }

    let code;
    let envResolution;
    let supabaseConfig;
    let d1DataService;
    try {
      [code, envResolution, supabaseConfig, { d1DataService }] = await Promise
        .all([
          fetchAppEntryCode(app),
          resolveAppRuntimeEnvVars(app, userId),
          resolveAppSupabaseConfig(app),
          createAppD1Resources(app),
        ]);
    } catch (err) {
      if (err instanceof SupabaseConfigMigrationRequiredError) {
        return error(err.message, 409);
      }
      throw err;
    }

    if (!code) {
      console.error("No entry file found in R2");
      return error(
        "No entry file found (index.tsx, index.ts, index.jsx, or index.js)",
        404,
      );
    }

    const { envVars, missingRequiredSecrets } = envResolution;
    if (missingRequiredSecrets.length > 0) {
      return json(
        {
          success: false,
          result: null,
          logs: [],
          duration_ms: 0,
          error: {
            type: "MISSING_SECRETS",
            message: buildMissingAppSecretsMessage(missingRequiredSecrets),
            details: buildMissingAppSecretsErrorDetails(
              app.id,
              missingRequiredSecrets,
            ),
          },
        } satisfies RunResponse,
        400,
      );
    }

    // ── Deno Sandbox Path (existing, unchanged) ──
    const permissions = resolveManifestPermissions(app, [
      "memory:read",
      "memory:write",
      "ai:call",
      "net:fetch",
    ]);

    // Execute in sandbox — AI-capable apps get 120s timeout
    // Dynamic Worker sandbox — avoids `new Function()` restriction on CF Workers
    const { executeInDynamicSandbox } = await import(
      "../runtime/dynamic-sandbox.ts"
    );
    const result = await executeInDynamicSandbox(
      {
        appId,
        userId,
        ownerId: app.owner_id,
        executionId: crypto.randomUUID(),
        code,
        permissions,
        userApiKey: null,
        user,
        appDataService,
        d1DataService,
        memoryService: null,
        aiService: {
          call: async (
            request: AIRequest,
            _apiKey: string,
          ): Promise<AIResponse> => {
            if (caller.userApiKey && caller.userProfile?.byok_provider) {
              return await createAIService(
                caller.userProfile.byok_provider,
                caller.userApiKey,
              ).call(request);
            }

            return {
              content: "",
              model: request.model || "none",
              usage: { input_tokens: 0, output_tokens: 0, cost_light: 0 },
              error:
                "BYOK not configured. Please add your API key in Settings.",
            };
          },
        },
        envVars,
        supabase: supabaseConfig,
        timeoutMs: permissions.includes("ai:call") ? 120_000 : 30_000,
      },
      functionName,
      args,
    );

    logExecutionResult({
      userId: user?.id || app.owner_id,
      appId: app.id,
      appName: app.name || app.slug,
      functionName,
      method: "run",
      success: result.success,
      durationMs: result.durationMs,
      errorMessage: result.success
        ? undefined
        : (result.error?.message || "Execution failed"),
      outputResult: result.success ? result.result : result.error,
      userTier: user?.tier,
      appVersion: app.current_version || undefined,
      aiCostLight: result.aiCostLight || 0,
      inputArgs: typeof args === "object" && !Array.isArray(args)
        ? args as Record<string, unknown>
        : undefined,
    });

    const response: RunResponse = {
      success: result.success,
      result: result.result,
      logs: result.logs,
      duration_ms: result.durationMs,
      error: result.error,
    };

    return json(response);
  } catch (err) {
    console.error("Run error:", err);
    return error(err instanceof Error ? err.message : "Execution failed", 500);
  }
}
