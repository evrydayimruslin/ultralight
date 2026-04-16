// GPU Compute Runtime — Container Builder Service
// Orchestrates GPU container creation on RunPod.
// Called fire-and-forget from the upload handler.

import type { GpuConfig } from './types.ts';
import type { App } from '../../../shared/types/index.ts';
import { getGPUProvider } from './index.ts';
import { createAppsService } from '../apps.ts';
import { createR2Service } from '../storage.ts';
import { getEnv } from '../../lib/env.ts';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Trigger an async GPU container build.
 *
 * Called fire-and-forget from upload.ts after app record creation.
 * Creates RunPod endpoint, stores build artifacts to R2, updates
 * app record with endpoint ID. On failure, transitions to build_failed.
 */
export async function triggerGpuBuild(
  appId: string,
  version: string,
  files: Array<{ name: string; content: string }>,
  config: GpuConfig,
): Promise<void> {
  const appsService = createAppsService();
  const buildLogs: string[] = [];

  try {
    buildLogs.push(`[build] Starting GPU build for ${appId}@${version}`);
    buildLogs.push(`[build] GPU type: ${config.gpu_type}`);
    buildLogs.push(`[build] Python: ${config.python || '3.11'}`);
    buildLogs.push(`[build] Files: ${files.length}`);

    // Step 1: Create code bundle in R2 (downloaded by harness at container startup)
    const bundle = {
      files: Object.fromEntries(
        files.map((f) => {
          const fileName = f.name.split('/').pop() || f.name;
          return [fileName, f.content];
        }),
      ),
      version,
      created_at: new Date().toISOString(),
    };
    const r2 = createR2Service();
    const bundleKey = `apps/${appId}/${version}/_bundle.json`;
    const bundleBytes = new TextEncoder().encode(JSON.stringify(bundle));
    await r2.uploadFile(bundleKey, {
      name: '_bundle.json',
      content: bundleBytes,
      contentType: 'application/json',
    });
    buildLogs.push(`[build] Code bundle uploaded to R2: ${bundleKey} (${bundleBytes.length} bytes)`);

    // Step 2: Generate reference Dockerfile (stored for debugging)
    const hasRequirements = files.some((f) => {
      const fileName = f.name.split('/').pop() || f.name;
      return fileName === 'requirements.txt';
    });
    const dockerfile = generateDockerfile(config, hasRequirements);
    buildLogs.push('[build] Reference Dockerfile generated');

    // Step 3: Create RunPod template + endpoint via provider
    const provider = getGPUProvider();
    const buildResult = await provider.buildContainer({
      appId,
      version,
      codeFiles: files,
      config,
      requirements: files.find((f) => {
        const fileName = f.name.split('/').pop() || f.name;
        return fileName === 'requirements.txt';
      })?.content,
    });

    buildLogs.push(`[build] RunPod endpoint created: ${buildResult.endpointId}`);
    buildLogs.push(...buildResult.buildLogs);

    // Step 4: Store build artifacts to R2
    await storeBuildArtifacts(appId, version, dockerfile, buildLogs);
    buildLogs.push('[build] Build artifacts stored to R2');

    // Step 5: Update app record with endpoint ID
    await appsService.update(appId, {
      gpu_endpoint_id: buildResult.endpointId,
    } as Partial<App>);
    buildLogs.push('[build] App record updated with endpoint ID');

    // Step 6: Insert gpu_endpoints tracking row
    await insertGpuEndpoint(
      appId,
      version,
      buildResult.endpointId,
      config.gpu_type,
      buildLogs,
    );

    console.log(`[GPU-BUILD] Build complete for ${appId}, endpoint: ${buildResult.endpointId}`);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    buildLogs.push(`[build] ERROR: ${errorMsg}`);
    console.error(`[GPU-BUILD] Build failed for ${appId}:`, err);

    // Transition to build_failed
    try {
      await appsService.update(appId, {
        gpu_status: 'build_failed',
      } as Partial<App>);
    } catch (updateErr) {
      console.error(`[GPU-BUILD] Failed to update status for ${appId}:`, updateErr);
    }

    // Store build logs even on failure (for debugging)
    try {
      await storeBuildArtifacts(appId, version, '', buildLogs);
    } catch {
      // Swallow — logging failure shouldn't mask build failure
    }
  }
}

// ---------------------------------------------------------------------------
// Dockerfile Generation
// ---------------------------------------------------------------------------

/**
 * Generate a reference Dockerfile for a GPU function.
 *
 * This is stored to R2 for debugging and documentation. In MVP,
 * the actual container is built from a pre-existing RunPod template
 * (RUNPOD_TEMPLATE_ID) with developer code loaded at startup.
 *
 * Future phases will use this Dockerfile for actual builds.
 */
export function generateDockerfile(config: GpuConfig, hasRequirements: boolean): string {
  const pythonVersion = config.python || '3.11';

  const lines = [
    `# Ultralight GPU Container — auto-generated`,
    `# GPU: ${config.gpu_type} | Python: ${pythonVersion}`,
    `# Generated: ${new Date().toISOString()}`,
    ``,
    `FROM python:${pythonVersion}-slim-bookworm`,
    ``,
    `# Install CUDA runtime + RunPod SDK (base layer — cached)`,
    `RUN pip install --no-cache-dir runpod`,
    ``,
  ];

  if (hasRequirements) {
    lines.push(
      `# Install developer dependencies`,
      `COPY requirements.txt /app/requirements.txt`,
      `RUN pip install --no-cache-dir -r /app/requirements.txt`,
      ``,
    );
  }

  lines.push(
    `# Copy developer code`,
    `COPY . /app`,
    `WORKDIR /app`,
    ``,
    `# Copy platform harness (entry point)`,
    `COPY harness.py /app/harness.py`,
    ``,
    `CMD ["python", "-u", "/app/harness.py"]`,
  );

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Private: Build Artifacts Storage
// ---------------------------------------------------------------------------

/**
 * Store Dockerfile and build logs to R2 for debugging.
 * Path: apps/{appId}/{version}/_build/
 */
async function storeBuildArtifacts(
  appId: string,
  version: string,
  dockerfile: string,
  buildLogs: string[],
): Promise<void> {
  const r2 = createR2Service();
  const prefix = `apps/${appId}/${version}/_build/`;

  const artifacts: Array<{ name: string; content: Uint8Array; contentType: string }> = [];

  if (dockerfile) {
    artifacts.push({
      name: 'Dockerfile',
      content: new TextEncoder().encode(dockerfile),
      contentType: 'text/plain',
    });
  }

  artifacts.push({
    name: 'build.log',
    content: new TextEncoder().encode(buildLogs.join('\n')),
    contentType: 'text/plain',
  });

  await r2.uploadFiles(prefix, artifacts);
}

// ---------------------------------------------------------------------------
// Private: Supabase gpu_endpoints Insert
// ---------------------------------------------------------------------------

/**
 * Insert a tracking row into the gpu_endpoints table.
 * Follows the Supabase REST pattern from apps.ts.
 */
async function insertGpuEndpoint(
  appId: string,
  version: string,
  endpointId: string,
  gpuType: string,
  buildLogs: string[],
): Promise<void> {
  const supabaseUrl = getEnv('SUPABASE_URL');
  const supabaseKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !supabaseKey) {
    console.error('[GPU-BUILD] Supabase not configured, skipping gpu_endpoints insert');
    return;
  }

  const url = `${supabaseUrl}/rest/v1/gpu_endpoints`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${supabaseKey}`,
      'apikey': supabaseKey,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify({
      app_id: appId,
      version,
      provider: 'runpod',
      endpoint_id: endpointId,
      gpu_type: gpuType,
      status: 'building',
      build_logs: buildLogs,
      build_started_at: new Date().toISOString(),
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error(`[GPU-BUILD] Failed to insert gpu_endpoints row: ${errText}`);
  }
}
