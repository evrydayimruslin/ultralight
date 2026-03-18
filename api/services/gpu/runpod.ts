// GPU Compute Runtime — RunPod Serverless Provider Implementation
// Implements GPUProvider for RunPod's Serverless GPU infrastructure.
// Uses RunPod REST API (rest.runpod.io) for endpoint management
// and RunPod Serverless API (api.runpod.ai) for job execution.

import type {
  GpuType,
  GpuExecutionResult,
  GpuExitCode,
} from './types.ts';
import { GPU_TYPES } from './types.ts';
import type {
  GPUProvider,
  BuildContainerParams,
  BuildContainerResult,
  ExecuteParams,
  EndpointStatus,
} from './provider.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** RunPod REST API for endpoint management (CRUD). */
const RUNPOD_REST_BASE = 'https://rest.runpod.io/v1';

/** RunPod GraphQL API for template management. */
const RUNPOD_GRAPHQL_BASE = 'https://api.runpod.io/graphql';

/** RunPod Serverless API for job execution. */
const RUNPOD_API_BASE = 'https://api.runpod.ai/v2';

/** Buffer added to maxDurationMs for cold start + network overhead. */
const COLD_START_BUFFER_MS = 30_000;

/** Max retries on 5xx from RunPod. */
const MAX_RETRIES = 1;

/** Delay between retries in ms. */
const RETRY_DELAY_MS = 2_000;

/**
 * Map our GpuType identifiers to RunPod's gpuTypeIds format.
 * RunPod uses full NVIDIA display names in their API.
 */
const GPU_TYPE_TO_RUNPOD: Record<GpuType, string> = {
  'A40':            'NVIDIA A40',
  'L40':            'NVIDIA L40',
  'L40S':           'NVIDIA L40S',
  'A100-80GB-PCIe': 'NVIDIA A100 80GB PCIe',
  'A100-80GB-SXM':  'NVIDIA A100-SXM4-80GB',
  'H100-PCIe':      'NVIDIA H100 80GB HBM3',
  'H100-SXM':       'NVIDIA H100 80GB HBM3',
  'H100-NVL':       'NVIDIA H100 NVL',
  'H200':           'NVIDIA H200',
  'B200':           'NVIDIA B200',
};

// ---------------------------------------------------------------------------
// RunPod API Types (response shapes from RunPod)
// ---------------------------------------------------------------------------

/** RunPod /runsync response. */
interface RunPodSyncResponse {
  id: string;
  status: 'COMPLETED' | 'FAILED' | 'TIMED_OUT' | 'CANCELLED' | 'IN_QUEUE' | 'IN_PROGRESS';
  /** Cold start / queue delay in milliseconds. */
  delayTime?: number;
  /** Actual execution time in milliseconds. */
  executionTime?: number;
  /** Output from the worker handler (our harness JSON). */
  output?: RunPodHarnessOutput | null;
  /** Error details if status is FAILED. */
  error?: string;
}

/** Shape returned by our Python container harness inside RunPod output. */
interface RunPodHarnessOutput {
  success: boolean;
  exit_code: GpuExitCode;
  result: unknown;
  duration_ms: number;
  peak_vram_gb: number;
  logs: string[];
  error?: {
    type: string;
    message: string;
    traceback?: string;
  };
}

/** RunPod endpoint object from REST API. */
interface RunPodEndpoint {
  id: string;
  name: string;
  workersMin: number;
  workersMax: number;
  idleTimeout: number;
  executionTimeoutMs: number;
  gpuTypeIds: string[];
  scalerType: string;
  scalerValue: number;
  workers?: Array<{ status?: string }>;
}

/** RunPod /health response (inferred from docs + community). */
interface RunPodHealthResponse {
  jobs: {
    completed: number;
    failed: number;
    inProgress: number;
    inQueue: number;
    retried: number;
  };
  workers: {
    idle: number;
    initializing: number;
    ready: number;
    running: number;
    throttled: number;
  };
}

// ---------------------------------------------------------------------------
// RunPod Provider Implementation
// ---------------------------------------------------------------------------

export class RunPodProvider implements GPUProvider {
  readonly name = 'runpod';
  private apiKey: string;

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error('RunPod API key is required');
    }
    this.apiKey = apiKey;
  }

  // -----------------------------------------------------------------------
  // buildContainer
  // -----------------------------------------------------------------------

  async buildContainer(params: BuildContainerParams): Promise<BuildContainerResult> {
    const { appId, version, config } = params;
    const buildLogs: string[] = [];

    const runpodGpuType = GPU_TYPE_TO_RUNPOD[config.gpu_type];
    if (!runpodGpuType) {
      throw new Error(`Unsupported GPU type for RunPod: ${config.gpu_type}`);
    }

    buildLogs.push(`[build] Starting container build for ${appId}@${version}`);
    buildLogs.push(`[build] GPU type: ${config.gpu_type} → RunPod: ${runpodGpuType}`);
    buildLogs.push(`[build] Python: ${config.python || '3.11'}`);

    // Phase 2 will handle actual Docker image building and template creation.
    // For Phase 1, we create the endpoint with a placeholder template.
    // The builder service (Phase 2) will:
    //   1. Generate Dockerfile from base image + developer code + harness
    //   2. Build and push to container registry
    //   3. Create RunPod template from the pushed image
    //   4. Create endpoint from the template
    //
    // For now, we validate the endpoint creation API flow.

    const templateId = await this.getOrCreateTemplate(params, buildLogs);

    // Create serverless endpoint
    const endpoint = await this.createEndpoint({
      name: `ul-${appId.slice(0, 8)}-${version}`,
      templateId,
      gpuTypeIds: [runpodGpuType],
      scalerType: 'QUEUE_DELAY',
      scalerValue: 4,
      workersMin: 0,
      workersMax: 5, // Default concurrency, configurable later
      idleTimeout: 5,
      executionTimeoutMs: (config.max_duration_ms || 60_000) + COLD_START_BUFFER_MS,
    });

    buildLogs.push(`[build] RunPod endpoint created: ${endpoint.id}`);
    buildLogs.push(`[build] Endpoint name: ${endpoint.name}`);

    return {
      endpointId: endpoint.id,
      buildLogs,
    };
  }

  // -----------------------------------------------------------------------
  // execute
  // -----------------------------------------------------------------------

  async execute(params: ExecuteParams): Promise<GpuExecutionResult> {
    const { endpointId, functionName, args, maxDurationMs } = params;

    const url = `${RUNPOD_API_BASE}/${endpointId}/runsync`;
    const timeoutMs = maxDurationMs + COLD_START_BUFFER_MS;

    const body = {
      input: {
        function: functionName,
        args,
        max_duration_ms: maxDurationMs,
      },
      policy: {
        executionTimeout: timeoutMs,
      },
    };

    const response = await this.fetchWithRetry<RunPodSyncResponse>(url, {
      method: 'POST',
      body: JSON.stringify(body),
      timeoutMs,
    });

    return this.mapRunPodResponse(response);
  }

  // -----------------------------------------------------------------------
  // getEndpointStatus
  // -----------------------------------------------------------------------

  async getEndpointStatus(endpointId: string): Promise<EndpointStatus> {
    // Try health endpoint first (gives worker/queue info)
    try {
      const health = await this.fetchRunPod<RunPodHealthResponse>(
        `${RUNPOD_API_BASE}/${endpointId}/health`,
        { method: 'GET' },
      );

      const totalWorkers =
        (health.workers?.ready || 0) +
        (health.workers?.running || 0) +
        (health.workers?.idle || 0);

      const queueDepth = health.jobs?.inQueue || 0;

      return {
        status: 'active',
        workers: totalWorkers,
        queueDepth,
      };
    } catch (err) {
      // If health check fails, try the REST API for endpoint info
      try {
        const endpoint = await this.fetchRunPod<RunPodEndpoint>(
          `${RUNPOD_REST_BASE}/endpoints/${endpointId}`,
          { method: 'GET' },
        );

        if (!endpoint || !endpoint.id) {
          return { status: 'not_found', workers: 0, queueDepth: 0 };
        }

        return {
          status: 'active',
          workers: endpoint.workers?.length || 0,
          queueDepth: 0,
        };
      } catch (innerErr) {
        // Both failed — endpoint probably doesn't exist
        const errMsg = innerErr instanceof Error ? innerErr.message : String(innerErr);
        if (errMsg.includes('404') || errMsg.includes('Not Found')) {
          return { status: 'not_found', workers: 0, queueDepth: 0 };
        }
        return { status: 'error', workers: 0, queueDepth: 0 };
      }
    }
  }

  // -----------------------------------------------------------------------
  // deleteEndpoint
  // -----------------------------------------------------------------------

  async deleteEndpoint(endpointId: string): Promise<void> {
    await this.fetchRunPod<void>(
      `${RUNPOD_REST_BASE}/endpoints/${endpointId}`,
      { method: 'DELETE' },
    );
  }

  // -----------------------------------------------------------------------
  // getSupportedGpuTypes
  // -----------------------------------------------------------------------

  getSupportedGpuTypes(): GpuType[] {
    return [...GPU_TYPES];
  }

  // -----------------------------------------------------------------------
  // Private: Template Management
  // -----------------------------------------------------------------------

  /**
   * Create a per-app RunPod template with env vars pointing to the app's code.
   *
   * Uses the shared base Docker image (RUNPOD_BASE_IMAGE) but creates a unique
   * template per app+version with environment variables that tell the harness
   * where to download the developer's code from R2.
   *
   * Falls back to RUNPOD_TEMPLATE_ID (shared template) if per-app creation fails.
   */
  private async getOrCreateTemplate(
    params: BuildContainerParams,
    buildLogs: string[],
  ): Promise<string> {
    const baseImage = globalThis.Deno?.env?.get('RUNPOD_BASE_IMAGE') || '';
    const platformUrl = globalThis.Deno?.env?.get('PLATFORM_URL') || globalThis.Deno?.env?.get('APP_URL') || '';
    const gpuSecret = globalThis.Deno?.env?.get('GPU_INTERNAL_SECRET') || '';

    // If we have the base image configured, create a per-app template
    if (baseImage && platformUrl) {
      try {
        const codeUrl = `${platformUrl}/internal/gpu/code/${params.appId}/${params.version}`;
        buildLogs.push(`[build] Creating per-app template for ${params.appId}@${params.version}`);
        buildLogs.push(`[build] Base image: ${baseImage}`);
        buildLogs.push(`[build] Code URL: ${codeUrl}`);

        const templateName = `ul-${params.appId.slice(0, 8)}-${params.version}`.slice(0, 191);
        const template = await this.createTemplate({
          name: templateName,
          imageName: baseImage,
          isServerless: true,
          env: {
            ULTRALIGHT_CODE_URL: codeUrl,
            ULTRALIGHT_PLATFORM_SECRET: gpuSecret,
            ULTRALIGHT_APP_ID: params.appId,
            ULTRALIGHT_VERSION: params.version,
          },
          containerDiskInGb: 20,
        });

        buildLogs.push(`[build] Per-app template created: ${template.id}`);
        return template.id;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        buildLogs.push(`[build] WARNING: Per-app template creation failed: ${msg}`);
        buildLogs.push('[build] Falling back to shared template...');
        // Fall through to shared template
      }
    }

    // Fallback: use shared RUNPOD_TEMPLATE_ID (Phase 1 behavior)
    const templateId = globalThis.Deno?.env?.get('RUNPOD_TEMPLATE_ID') || '';
    if (!templateId) {
      buildLogs.push('[build] ERROR: No RUNPOD_BASE_IMAGE or RUNPOD_TEMPLATE_ID configured.');
      throw new Error(
        'GPU build requires either RUNPOD_BASE_IMAGE (for per-app templates) ' +
        'or RUNPOD_TEMPLATE_ID (shared template fallback). Neither is set.',
      );
    }
    buildLogs.push(`[build] Using shared template (fallback): ${templateId}`);
    return templateId;
  }

  /**
   * Create a RunPod template via GraphQL API.
   *
   * Uses GraphQL instead of REST because RunPod's REST API has a bug where
   * serverless templates reject volumeInGb even when not specified (defaults to 20).
   * The GraphQL API requires explicit volumeInGb: 0 for serverless templates, which works.
   */
  private async createTemplate(config: {
    name: string;
    imageName: string;
    isServerless: boolean;
    env: Record<string, string>;
    containerDiskInGb: number;
  }): Promise<{ id: string; name: string }> {
    const envArray = Object.entries(config.env).map(([key, value]) =>
      `{key: "${key}", value: "${value.replace(/"/g, '\\"')}"}`
    ).join(', ');

    const mutation = `mutation {
      saveTemplate(input: {
        name: "${config.name.replace(/"/g, '\\"')}",
        imageName: "${config.imageName.replace(/"/g, '\\"')}",
        isServerless: ${config.isServerless},
        containerDiskInGb: ${config.containerDiskInGb},
        volumeInGb: 0,
        dockerArgs: "",
        env: [${envArray}]
      }) {
        id
        name
        imageName
        isServerless
      }
    }`;

    const response = await this.fetchGraphQL<{
      saveTemplate: { id: string; name: string; imageName: string; isServerless: boolean };
    }>(mutation);

    return response.saveTemplate;
  }

  /**
   * Delete a RunPod template via GraphQL API.
   * Template must not be in use by any endpoints.
   */
  async deleteTemplate(templateName: string): Promise<void> {
    const mutation = `mutation {
      deleteTemplate(templateName: "${templateName.replace(/"/g, '\\"')}")
    }`;
    await this.fetchGraphQL(mutation);
  }

  // -----------------------------------------------------------------------
  // Private: Endpoint Creation
  // -----------------------------------------------------------------------

  private async createEndpoint(config: {
    name: string;
    templateId: string;
    gpuTypeIds: string[];
    scalerType: string;
    scalerValue: number;
    workersMin: number;
    workersMax: number;
    idleTimeout: number;
    executionTimeoutMs: number;
  }): Promise<RunPodEndpoint> {
    return this.fetchRunPod<RunPodEndpoint>(
      `${RUNPOD_REST_BASE}/endpoints`,
      {
        method: 'POST',
        body: JSON.stringify(config),
      },
    );
  }

  // -----------------------------------------------------------------------
  // Private: Response Mapping
  // -----------------------------------------------------------------------

  /**
   * Map a RunPod /runsync response to our GpuExecutionResult.
   *
   * Key distinction: we use executionTime (actual GPU work) for billing,
   * NOT delayTime (cold start / queue wait). Cold starts are absorbed
   * by the platform.
   */
  private mapRunPodResponse(response: RunPodSyncResponse): GpuExecutionResult {
    // If harness output is present and structured, use it directly
    if (response.output && typeof response.output === 'object' && 'exit_code' in response.output) {
      const harness = response.output as RunPodHarnessOutput;
      return {
        success: harness.success,
        exit_code: harness.exit_code,
        result: harness.result,
        // Prefer harness-reported duration (excludes overhead),
        // fall back to RunPod's executionTime
        duration_ms: harness.duration_ms || response.executionTime || 0,
        peak_vram_gb: harness.peak_vram_gb || 0,
        logs: harness.logs || [],
        error: harness.error,
      };
    }

    // No harness output — map RunPod status to our exit codes
    switch (response.status) {
      case 'COMPLETED':
        return {
          success: true,
          exit_code: 'success',
          result: response.output,
          duration_ms: response.executionTime || 0,
          peak_vram_gb: 0,
          logs: [],
        };

      case 'TIMED_OUT':
        return {
          success: false,
          exit_code: 'timeout',
          result: null,
          duration_ms: response.executionTime || 0,
          peak_vram_gb: 0,
          logs: [],
          error: {
            type: 'TimeoutError',
            message: `Execution timed out after ${response.executionTime || 0}ms`,
          },
        };

      case 'FAILED':
        return {
          success: false,
          exit_code: this.classifyRunPodError(response.error),
          result: null,
          duration_ms: response.executionTime || 0,
          peak_vram_gb: 0,
          logs: [],
          error: {
            type: 'RunPodError',
            message: response.error || 'Unknown RunPod execution error',
          },
        };

      case 'CANCELLED':
        return {
          success: false,
          exit_code: 'infra_error',
          result: null,
          duration_ms: 0,
          peak_vram_gb: 0,
          logs: [],
          error: {
            type: 'CancelledError',
            message: 'Job was cancelled',
          },
        };

      default:
        // IN_QUEUE or IN_PROGRESS shouldn't reach here on /runsync,
        // but handle defensively
        return {
          success: false,
          exit_code: 'infra_error',
          result: null,
          duration_ms: 0,
          peak_vram_gb: 0,
          logs: [],
          error: {
            type: 'UnexpectedStatus',
            message: `Unexpected RunPod status: ${response.status}`,
          },
        };
    }
  }

  /**
   * Classify a RunPod error string into our exit code taxonomy.
   * OOM errors from RunPod/CUDA are distinguishable by error message patterns.
   */
  private classifyRunPodError(error?: string): GpuExitCode {
    if (!error) return 'exception';

    const lower = error.toLowerCase();
    // OOM: match CUDA memory errors specifically, not all CUDA errors
    if (
      lower.includes('out of memory') ||
      lower.includes('oom') ||
      (lower.includes('cuda') && (lower.includes('memory') || lower.includes('alloc')))
    ) {
      return 'oom';
    }
    if (lower.includes('timeout') || lower.includes('timed out')) {
      return 'timeout';
    }
    // CUDA non-memory errors are infrastructure issues (driver, init, etc.)
    if (
      lower.includes('cuda error') ||
      lower.includes('cuda driver') ||
      lower.includes('cuda init') ||
      lower.includes('container') ||
      lower.includes('worker') ||
      lower.includes('network') ||
      lower.includes('failed to start')
    ) {
      return 'infra_error';
    }
    return 'exception';
  }

  // -----------------------------------------------------------------------
  // Private: HTTP Helpers
  // -----------------------------------------------------------------------

  /**
   * Make an authenticated request to RunPod's GraphQL API.
   * Used for template management (create/delete).
   */
  private async fetchGraphQL<T>(query: string): Promise<T> {
    const url = `${RUNPOD_GRAPHQL_BASE}?api_key=${this.apiKey}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
        signal: controller.signal,
      });

      const json = await response.json();

      if (json.errors && json.errors.length > 0) {
        const messages = json.errors.map((e: { message: string }) => e.message).join('; ');
        throw new Error(`RunPod GraphQL error: ${messages}`);
      }

      return json.data as T;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Make an authenticated request to RunPod API.
   * Throws on non-2xx responses with descriptive error messages.
   */
  private async fetchRunPod<T>(
    url: string,
    options: {
      method: string;
      body?: string;
      timeoutMs?: number;
    },
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = options.timeoutMs || 30_000;
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        method: options.method,
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: options.body,
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage: string;

        try {
          const errorJson = JSON.parse(errorText);
          errorMessage = errorJson.error?.message || errorJson.message || errorText;
        } catch {
          errorMessage = errorText;
        }

        throw new Error(`RunPod API error (${response.status}): ${errorMessage}`);
      }

      // DELETE returns no body
      if (options.method === 'DELETE') {
        return undefined as unknown as T;
      }

      return await response.json() as T;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Fetch with retry on 5xx errors. No retry on 4xx (client errors).
   */
  private async fetchWithRetry<T>(
    url: string,
    options: {
      method: string;
      body?: string;
      timeoutMs?: number;
    },
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await this.fetchRunPod<T>(url, options);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        // Only retry on 5xx (match status codes like "(500)", "(502)", etc.)
        const is5xx = /\(5\d{2}\)/.test(lastError.message);
        if (!is5xx || attempt === MAX_RETRIES) {
          throw lastError;
        }

        // Wait before retry
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }

    throw lastError || new Error('RunPod request failed after retries');
  }
}
