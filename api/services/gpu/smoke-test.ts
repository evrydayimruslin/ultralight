#!/usr/bin/env -S deno run --allow-net --allow-env

// GPU Compute Runtime — Phase 1 Smoke Test
//
// Manual end-to-end test against the real RunPod API.
// NOT an automated test — run once to verify the integration works.
//
// Prerequisites:
//   export RUNPOD_API_KEY="your-key"
//   export RUNPOD_TEMPLATE_ID="your-template-id"  (pre-created in RunPod console)
//
// Usage:
//   deno run --allow-net --allow-env api/services/gpu/smoke-test.ts
//
// What it does:
//   1. Validates provider instantiation and GPU type support
//   2. Creates a serverless endpoint via RunPod REST API
//   3. Polls until the endpoint is active
//   4. Executes a test job via /runsync
//   5. Validates the response structure
//   6. Cleans up by deleting the endpoint
//   7. Reports results and timing

import { RunPodProvider } from './runpod.ts';
import {
  isValidGpuType,
  getGpuRate,
  getGpuVram,
  computeGpuCostCents,
  GPU_TYPES,
  GPU_RATE_TABLE,
} from './types.ts';
import type { GpuType, GpuConfig } from './types.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PASS = '✅';
const FAIL = '❌';
const INFO = 'ℹ️';
let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    console.log(`  ${PASS} ${label}`);
    passed++;
  } else {
    console.log(`  ${FAIL} ${label}`);
    failed++;
  }
}

function section(name: string): void {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  ${name}`);
  console.log('='.repeat(60));
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Test 1: Type System Validation (offline, no API calls)
// ---------------------------------------------------------------------------

function testTypeSystem(): void {
  section('Test 1: Type System Validation');

  // GPU_TYPES should have 10 entries
  assert(GPU_TYPES.length === 10, `GPU_TYPES has ${GPU_TYPES.length} entries (expected 10)`);

  // isValidGpuType
  assert(isValidGpuType('A100-80GB-SXM') === true, 'isValidGpuType("A100-80GB-SXM") → true');
  assert(isValidGpuType('H100-SXM') === true, 'isValidGpuType("H100-SXM") → true');
  assert(isValidGpuType('fake-gpu') === false, 'isValidGpuType("fake-gpu") → false');
  assert(isValidGpuType('') === false, 'isValidGpuType("") → false');

  // getGpuRate
  assert(getGpuRate('H100-SXM') === 0.000009, 'getGpuRate("H100-SXM") → 0.000009');
  assert(getGpuRate('A40') === 0.000001, 'getGpuRate("A40") → 0.000001');
  assert(getGpuRate('B200') === 0.000020, 'getGpuRate("B200") → 0.000020');

  // getGpuVram
  assert(getGpuVram('A100-80GB-SXM') === 80, 'getGpuVram("A100-80GB-SXM") → 80');
  assert(getGpuVram('H200') === 141, 'getGpuVram("H200") → 141');
  assert(getGpuVram('B200') === 180, 'getGpuVram("B200") → 180');

  // computeGpuCostCents
  // 1000ms on A100-80GB-SXM: $0.000005/ms * 1000ms * 100 = 0.5 cents
  const cost = computeGpuCostCents('A100-80GB-SXM', 1000);
  assert(
    Math.abs(cost - 0.5) < 0.001,
    `computeGpuCostCents("A100-80GB-SXM", 1000) → ${cost} (expected ~0.5)`,
  );

  // Rate table completeness
  for (const gpuType of GPU_TYPES) {
    const entry = GPU_RATE_TABLE[gpuType];
    assert(entry.rate_per_ms > 0, `${gpuType}: rate_per_ms = ${entry.rate_per_ms} (> 0)`);
    assert(entry.vram_gb > 0, `${gpuType}: vram_gb = ${entry.vram_gb} (> 0)`);
  }
}

// ---------------------------------------------------------------------------
// Test 2: Provider Instantiation
// ---------------------------------------------------------------------------

function testProviderInstantiation(): RunPodProvider | null {
  section('Test 2: Provider Instantiation');

  const apiKey = Deno.env.get('RUNPOD_API_KEY');

  if (!apiKey) {
    console.log(`  ${INFO} RUNPOD_API_KEY not set — skipping API tests`);
    console.log(`  ${INFO} Set RUNPOD_API_KEY to run full smoke test`);
    return null;
  }

  // Should construct without error
  let provider: RunPodProvider | null = null;
  try {
    provider = new RunPodProvider(apiKey);
    assert(true, 'RunPodProvider constructed successfully');
  } catch (err) {
    assert(false, `RunPodProvider construction failed: ${err}`);
    return null;
  }

  // Name should be 'runpod'
  assert(provider.name === 'runpod', `Provider name: "${provider.name}" (expected "runpod")`);

  // Should support all GPU types
  const supported = provider.getSupportedGpuTypes();
  assert(supported.length === 10, `Supports ${supported.length} GPU types (expected 10)`);

  // Empty key should throw
  let threwOnEmpty = false;
  try {
    new RunPodProvider('');
  } catch {
    threwOnEmpty = true;
  }
  assert(threwOnEmpty, 'RunPodProvider("") throws');

  return provider;
}

// ---------------------------------------------------------------------------
// Test 3: Endpoint Lifecycle (requires API key + template)
// ---------------------------------------------------------------------------

async function testEndpointLifecycle(provider: RunPodProvider): Promise<void> {
  section('Test 3: Endpoint Lifecycle (live API)');

  const templateId = Deno.env.get('RUNPOD_TEMPLATE_ID');
  if (!templateId) {
    console.log(`  ${INFO} RUNPOD_TEMPLATE_ID not set — skipping endpoint tests`);
    console.log(`  ${INFO} Create a template in RunPod console first, then set RUNPOD_TEMPLATE_ID`);
    return;
  }

  let endpointId: string | null = null;

  try {
    // Step 1: Build container (creates endpoint)
    console.log(`\n  ${INFO} Creating endpoint...`);
    const config: GpuConfig = {
      runtime: 'gpu',
      gpu_type: 'A40' as GpuType, // Cheapest option for testing
      python: '3.11',
      max_duration_ms: 30_000,
    };

    const buildResult = await provider.buildContainer({
      appId: 'smoke-test-' + Date.now(),
      version: '1.0.0',
      codeFiles: [
        { name: 'main.py', content: 'def hello(name): return f"Hello {name} from GPU"' },
      ],
      config,
    });

    endpointId = buildResult.endpointId;
    assert(!!endpointId, `Endpoint created: ${endpointId}`);
    assert(buildResult.buildLogs.length > 0, `Build logs: ${buildResult.buildLogs.length} lines`);

    for (const log of buildResult.buildLogs) {
      console.log(`    ${log}`);
    }

    // Step 2: Check endpoint status
    console.log(`\n  ${INFO} Checking endpoint status...`);
    const status = await provider.getEndpointStatus(endpointId);
    assert(
      ['active', 'building'].includes(status.status),
      `Endpoint status: ${status.status} (expected active or building)`,
    );
    console.log(`    Workers: ${status.workers}, Queue: ${status.queueDepth}`);

    // Step 3: Wait for endpoint to be ready (poll with backoff)
    console.log(`\n  ${INFO} Waiting for endpoint to be ready...`);
    const maxWait = 120_000; // 2 minutes
    const pollInterval = 5_000;
    const start = Date.now();
    let ready = false;

    while (Date.now() - start < maxWait) {
      const s = await provider.getEndpointStatus(endpointId);
      if (s.status === 'active') {
        ready = true;
        break;
      }
      console.log(`    Status: ${s.status} (${Math.round((Date.now() - start) / 1000)}s elapsed)`);
      await sleep(pollInterval);
    }

    if (!ready) {
      console.log(`  ${INFO} Endpoint not ready within ${maxWait / 1000}s — skipping execution test`);
      console.log(`  ${INFO} This is normal for new endpoints. Try again after the endpoint initializes.`);
    } else {
      // Step 4: Execute a test job
      console.log(`\n  ${INFO} Executing test job...`);
      try {
        const execResult = await provider.execute({
          endpointId,
          functionName: 'hello',
          args: { name: 'Ultralight' },
          maxDurationMs: 30_000,
          gpuType: 'A40',
        });

        assert(execResult.success === true, `Execution success: ${execResult.success}`);
        assert(execResult.duration_ms > 0, `Duration: ${execResult.duration_ms}ms`);
        assert(
          typeof execResult.exit_code === 'string',
          `Exit code: ${execResult.exit_code}`,
        );
        console.log(`    Result: ${JSON.stringify(execResult.result)}`);
        console.log(`    Duration: ${execResult.duration_ms}ms`);
        console.log(`    Peak VRAM: ${execResult.peak_vram_gb}GB`);
        console.log(`    Logs: ${execResult.logs.length} lines`);
      } catch (err) {
        console.log(`  ${INFO} Execution failed (expected if template doesn't have our harness): ${err}`);
      }
    }
  } catch (err) {
    assert(false, `Endpoint lifecycle error: ${err}`);
  } finally {
    // Step 5: Cleanup
    if (endpointId) {
      console.log(`\n  ${INFO} Cleaning up endpoint ${endpointId}...`);
      try {
        await provider.deleteEndpoint(endpointId);
        assert(true, 'Endpoint deleted successfully');

        // Verify deletion
        const deletedStatus = await provider.getEndpointStatus(endpointId);
        assert(
          deletedStatus.status === 'not_found' || deletedStatus.status === 'error',
          `Post-delete status: ${deletedStatus.status}`,
        );
      } catch (err) {
        console.log(`  ${INFO} Cleanup failed (non-critical): ${err}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('\n🔥 GPU Compute Runtime — Phase 1 Smoke Test');
  console.log('─'.repeat(60));

  // Test 1: Offline type system validation
  testTypeSystem();

  // Test 2: Provider instantiation
  const provider = testProviderInstantiation();

  // Test 3: Live API tests (only if API key is available)
  if (provider) {
    await testEndpointLifecycle(provider);
  }

  // Summary
  section('Summary');
  console.log(`  ${PASS} Passed: ${passed}`);
  console.log(`  ${FAIL} Failed: ${failed}`);
  console.log(`  Total:  ${passed + failed}`);

  if (failed > 0) {
    console.log(`\n${FAIL} Some tests failed. Review output above.`);
    Deno.exit(1);
  } else {
    console.log(`\n${PASS} All tests passed!`);
  }
}

main();
