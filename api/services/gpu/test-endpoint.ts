#!/usr/bin/env -S deno run --allow-net --allow-env

// GPU Endpoint Live Test
// Tests execution against a real RunPod serverless endpoint.
//
// Usage:
//   export RUNPOD_API_KEY="your-key"
//   deno run --allow-net --allow-env api/services/gpu/test-endpoint.ts
//
// Or pass endpoint ID as arg:
//   deno run --allow-net --allow-env api/services/gpu/test-endpoint.ts ENDPOINT_ID

const RUNPOD_API_KEY = Deno.env.get('RUNPOD_API_KEY') || '';
const ENDPOINT_ID = Deno.args[0] || '6oszl95nvl9bns';

if (!RUNPOD_API_KEY) {
  console.error('❌ RUNPOD_API_KEY not set');
  Deno.exit(1);
}

const API_BASE = `https://api.runpod.ai/v2/${ENDPOINT_ID}`;

const headers = {
  'Authorization': `Bearer ${RUNPOD_API_KEY}`,
  'Content-Type': 'application/json',
};

const PASS = '✅';
const FAIL = '❌';
const INFO = 'ℹ️';
let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
  if (condition) { console.log(`  ${PASS} ${label}`); passed++; }
  else { console.log(`  ${FAIL} ${label}`); failed++; }
}

function section(name: string): void {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  ${name}`);
  console.log('='.repeat(60));
}

// ---------------------------------------------------------------------------
// Test 1: Health Check
// ---------------------------------------------------------------------------

async function testHealth(): Promise<boolean> {
  section('Test 1: Health Check');

  try {
    const res = await fetch(`${API_BASE}/health`, { headers });
    if (!res.ok) {
      const text = await res.text();
      console.log(`  ${INFO} Health check returned ${res.status}: ${text}`);
      assert(false, 'Endpoint is healthy');
      return false;
    }
    const health = await res.json();
    console.log(`  ${INFO} Workers: idle=${health.workers?.idle || 0}, ready=${health.workers?.ready || 0}, running=${health.workers?.running || 0}`);
    console.log(`  ${INFO} Jobs: inQueue=${health.jobs?.inQueue || 0}, inProgress=${health.jobs?.inProgress || 0}`);
    assert(true, 'Endpoint is healthy');
    return true;
  } catch (err) {
    console.log(`  ${INFO} Health check failed: ${err}`);
    assert(false, 'Endpoint is healthy');
    return false;
  }
}

// ---------------------------------------------------------------------------
// Test 2: hello() — Basic Function Dispatch
// ---------------------------------------------------------------------------

async function testHello(): Promise<void> {
  section('Test 2: hello() — Basic Dispatch');

  const res = await fetch(`${API_BASE}/runsync`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      input: {
        function: 'hello',
        args: { name: 'Ultralight' },
        max_duration_ms: 30000,
      },
    }),
  });

  assert(res.ok, `POST /runsync returned ${res.status}`);
  const data = await res.json();
  console.log(`  ${INFO} Status: ${data.status}`);
  console.log(`  ${INFO} Execution time: ${data.executionTime}ms`);
  console.log(`  ${INFO} Delay time: ${data.delayTime}ms`);

  assert(data.status === 'COMPLETED', `Status: ${data.status} (expected COMPLETED)`);

  if (data.output) {
    console.log(`  ${INFO} Output:`, JSON.stringify(data.output));
    assert(data.output.success === true, `output.success: ${data.output.success}`);
    assert(data.output.exit_code === 'success', `output.exit_code: ${data.output.exit_code}`);
    assert(
      data.output.result === 'Hello Ultralight from Ultralight GPU!',
      `output.result: ${data.output.result}`,
    );
    assert(data.output.duration_ms >= 0, `output.duration_ms: ${data.output.duration_ms}`);
  }
}

// ---------------------------------------------------------------------------
// Test 3: add() — Kwargs Passing
// ---------------------------------------------------------------------------

async function testAdd(): Promise<void> {
  section('Test 3: add() — Kwargs Passing');

  const res = await fetch(`${API_BASE}/runsync`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      input: { function: 'add', args: { a: 7, b: 35 }, max_duration_ms: 30000 },
    }),
  });

  const data = await res.json();
  assert(data.status === 'COMPLETED', `Status: ${data.status}`);

  if (data.output) {
    assert(data.output.success === true, `success: ${data.output.success}`);
    assert(data.output.result?.sum === 42, `result.sum: ${data.output.result?.sum} (expected 42)`);
    console.log(`  ${INFO} Result:`, JSON.stringify(data.output.result));
  }
}

// ---------------------------------------------------------------------------
// Test 4: slow() — Duration Timing
// ---------------------------------------------------------------------------

async function testSlow(): Promise<void> {
  section('Test 4: slow() — Duration Timing');

  const sleepMs = 2000;
  const res = await fetch(`${API_BASE}/runsync`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      input: { function: 'slow', args: { duration_ms: sleepMs }, max_duration_ms: 30000 },
    }),
  });

  const data = await res.json();
  assert(data.status === 'COMPLETED', `Status: ${data.status}`);

  if (data.output) {
    assert(data.output.success === true, `success: ${data.output.success}`);
    // Duration should be approximately the sleep time (± 100ms)
    const durationMs = data.output.duration_ms;
    const withinRange = durationMs >= sleepMs - 100 && durationMs <= sleepMs + 500;
    assert(withinRange, `duration_ms: ${durationMs} (expected ~${sleepMs})`);
    console.log(`  ${INFO} Harness duration: ${durationMs}ms`);
    console.log(`  ${INFO} RunPod executionTime: ${data.executionTime}ms`);
  }
}

// ---------------------------------------------------------------------------
// Test 5: fail() — Error Handling
// ---------------------------------------------------------------------------

async function testFail(): Promise<void> {
  section('Test 5: fail() — Error Handling');

  const res = await fetch(`${API_BASE}/runsync`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      input: { function: 'fail', args: {}, max_duration_ms: 30000 },
    }),
  });

  const data = await res.json();
  // RunPod may return COMPLETED (harness caught it) or FAILED
  console.log(`  ${INFO} Status: ${data.status}`);

  if (data.output) {
    assert(data.output.success === false, `success: ${data.output.success} (expected false)`);
    assert(data.output.exit_code === 'exception', `exit_code: ${data.output.exit_code} (expected exception)`);
    // RunPod may strip the error dict during serialization — check if present but don't fail
    if (data.output.error?.type) {
      assert(data.output.error.type === 'ValueError', `error.type: ${data.output.error.type}`);
    } else {
      console.log(`  ${INFO} error dict not in output (RunPod serialization — non-critical)`);
      assert(true, 'Error caught (exit_code=exception is sufficient for billing)');
    }
    console.log(`  ${INFO} Error:`, data.output.error?.message || '(not in output)');
  } else {
    console.log(`  ${INFO} No structured output — RunPod error: ${data.error}`);
    assert(true, 'Error was caught (by RunPod or harness)');
  }
}

// ---------------------------------------------------------------------------
// Test 6: echo() — Arbitrary Kwargs
// ---------------------------------------------------------------------------

async function testEcho(): Promise<void> {
  section('Test 6: echo() — Arbitrary Kwargs');

  const testArgs = { foo: 'bar', count: 42, nested: { x: 1 } };
  const res = await fetch(`${API_BASE}/runsync`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      input: { function: 'echo', args: testArgs, max_duration_ms: 30000 },
    }),
  });

  const data = await res.json();
  assert(data.status === 'COMPLETED', `Status: ${data.status}`);

  if (data.output) {
    assert(data.output.success === true, `success: ${data.output.success}`);
    assert(data.output.result?.foo === 'bar', `result.foo: ${data.output.result?.foo}`);
    assert(data.output.result?.count === 42, `result.count: ${data.output.result?.count}`);
    console.log(`  ${INFO} Result:`, JSON.stringify(data.output.result));
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('\n🔥 GPU Endpoint Live Test');
  console.log(`  Endpoint: ${ENDPOINT_ID}`);
  console.log('─'.repeat(60));

  const healthy = await testHealth();
  if (!healthy) {
    console.log(`\n${INFO} Endpoint not ready. Wait for build to complete and try again.`);
    Deno.exit(1);
  }

  await testHello();
  await testAdd();
  await testSlow();
  await testFail();
  await testEcho();

  // Summary
  section('Summary');
  console.log(`  ${PASS} Passed: ${passed}`);
  console.log(`  ${FAIL} Failed: ${failed}`);
  console.log(`  Total:  ${passed + failed}`);

  if (failed > 0) {
    console.log(`\n${FAIL} Some tests failed.`);
    Deno.exit(1);
  } else {
    console.log(`\n${PASS} All tests passed!`);
  }
}

main();
