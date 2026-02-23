// Auto-Healing Service
// Detects failing MCP functions, diagnoses root cause via AI,
// generates patches, tests them, and deploys fixes automatically.
// Runs periodically alongside the billing loop.

// @ts-ignore
const Deno = globalThis.Deno;

import { bundleCode } from './bundler.ts';
import { createAppsService } from './apps.ts';
import { createR2Service } from './storage.ts';
import { getCodeCache } from './codecache.ts';

// ============================================
// CONFIG
// ============================================

/** Minimum calls in the detection window before we consider error rate meaningful */
const MIN_CALLS_FOR_DETECTION = 5;

/** Error rate threshold to trigger healing (0.0-1.0). 50% = half of calls failing. */
const ERROR_RATE_THRESHOLD = 0.5;

/** Detection window: look at calls from the last N hours */
const DETECTION_WINDOW_HOURS = 2;

/** Cooldown: don't re-heal the same function within N hours */
const HEAL_COOLDOWN_HOURS = 6;

/** Max healing attempts per app per day */
const MAX_HEALS_PER_DAY = 3;

// ============================================
// TYPES
// ============================================

interface FailingFunction {
  app_id: string;
  function_name: string;
  total_calls: number;
  failed_calls: number;
  error_rate: number;
  common_error: string;
  error_samples: Array<{
    error_message: string;
    input_args: unknown;
    created_at: string;
  }>;
}

interface HealingResult {
  app_id: string;
  function_name: string;
  status: 'patched' | 'failed' | 'skipped' | 'cooldown';
  description?: string;
  new_version?: string;
  error?: string;
}

export interface AutoHealingReport {
  detected: number;
  healed: number;
  failed: number;
  skipped: number;
  results: HealingResult[];
  errors: string[];
}

// ============================================
// MAIN ENTRY
// ============================================

/**
 * Run the auto-healing detection and repair cycle.
 * Called periodically (every 30 min) by the job scheduler.
 */
export async function runAutoHealing(): Promise<AutoHealingReport> {
  const report: AutoHealingReport = {
    detected: 0,
    healed: 0,
    failed: 0,
    skipped: 0,
    results: [],
    errors: [],
  };

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY') || '';

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    report.errors.push('Missing Supabase config');
    return report;
  }

  if (!OPENROUTER_API_KEY) {
    report.errors.push('Missing OPENROUTER_API_KEY — AI diagnosis disabled');
    return report;
  }

  const headers = {
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  };

  try {
    // ── Step 1: Detect failing functions ──
    const failing = await detectFailingFunctions(SUPABASE_URL, headers);
    report.detected = failing.length;

    if (failing.length === 0) {
      console.log('[AUTO-HEAL] No failing functions detected.');
      return report;
    }

    console.log(`[AUTO-HEAL] Detected ${failing.length} failing function(s).`);

    // ── Step 2: Filter out cooldowns and rate limits ──
    const candidates = await filterCandidates(failing, SUPABASE_URL, headers);

    // ── Step 3: Attempt healing for each candidate ──
    for (const fn of candidates) {
      try {
        const result = await healFunction(fn, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENROUTER_API_KEY);
        report.results.push(result);

        if (result.status === 'patched') report.healed++;
        else if (result.status === 'failed') report.failed++;
        else if (result.status === 'skipped' || result.status === 'cooldown') report.skipped++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        report.errors.push(`Healing ${fn.app_id}/${fn.function_name}: ${msg}`);
        report.failed++;
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    report.errors.push(`Auto-healing cycle error: ${msg}`);
    console.error('[AUTO-HEAL] Cycle error:', err);
  }

  console.log(`[AUTO-HEAL] Complete: ${report.healed} healed, ${report.failed} failed, ${report.skipped} skipped out of ${report.detected} detected.`);
  return report;
}

// ============================================
// STEP 1: DETECT FAILING FUNCTIONS
// ============================================

async function detectFailingFunctions(
  supabaseUrl: string,
  headers: Record<string, string>,
): Promise<FailingFunction[]> {
  const cutoff = new Date(Date.now() - DETECTION_WINDOW_HOURS * 60 * 60 * 1000).toISOString();

  // Query recent failed calls grouped by app+function
  // We fetch individual failed calls and aggregate in JS (PostgREST doesn't support GROUP BY well)
  const res = await fetch(
    `${supabaseUrl}/rest/v1/mcp_call_logs?created_at=gte.${cutoff}&select=app_id,function_name,success,error_message,input_args,created_at&order=created_at.desc&limit=5000`,
    { headers }
  );

  if (!res.ok) {
    throw new Error(`Failed to query call logs: ${await res.text()}`);
  }

  const logs = await res.json() as Array<{
    app_id: string | null;
    function_name: string;
    success: boolean;
    error_message: string | null;
    input_args: unknown;
    created_at: string;
  }>;

  // Aggregate by app_id + function_name
  const agg = new Map<string, {
    app_id: string;
    function_name: string;
    total: number;
    failed: number;
    errors: Map<string, number>;
    samples: Array<{ error_message: string; input_args: unknown; created_at: string }>;
  }>();

  for (const log of logs) {
    if (!log.app_id) continue;
    const key = `${log.app_id}::${log.function_name}`;
    let entry = agg.get(key);
    if (!entry) {
      entry = {
        app_id: log.app_id,
        function_name: log.function_name,
        total: 0,
        failed: 0,
        errors: new Map(),
        samples: [],
      };
      agg.set(key, entry);
    }

    entry.total++;
    if (!log.success) {
      entry.failed++;
      const errMsg = log.error_message || 'Unknown error';
      entry.errors.set(errMsg, (entry.errors.get(errMsg) || 0) + 1);
      if (entry.samples.length < 3) {
        entry.samples.push({
          error_message: errMsg,
          input_args: log.input_args,
          created_at: log.created_at,
        });
      }
    }
  }

  // Filter to functions exceeding the error rate threshold
  const failing: FailingFunction[] = [];
  for (const entry of agg.values()) {
    if (entry.total < MIN_CALLS_FOR_DETECTION) continue;
    const errorRate = entry.failed / entry.total;
    if (errorRate < ERROR_RATE_THRESHOLD) continue;

    // Find most common error
    let commonError = 'Unknown error';
    let maxCount = 0;
    for (const [msg, count] of entry.errors) {
      if (count > maxCount) {
        commonError = msg;
        maxCount = count;
      }
    }

    failing.push({
      app_id: entry.app_id,
      function_name: entry.function_name,
      total_calls: entry.total,
      failed_calls: entry.failed,
      error_rate: errorRate,
      common_error: commonError,
      error_samples: entry.samples,
    });
  }

  // Sort by error rate descending (worst first)
  failing.sort((a, b) => b.error_rate - a.error_rate);

  return failing;
}

// ============================================
// STEP 2: FILTER CANDIDATES (cooldown + rate limits)
// ============================================

async function filterCandidates(
  failing: FailingFunction[],
  supabaseUrl: string,
  headers: Record<string, string>,
): Promise<FailingFunction[]> {
  const candidates: FailingFunction[] = [];

  for (const fn of failing) {
    // Check cooldown: any recent healing event for this app+function?
    const cooldownCutoff = new Date(Date.now() - HEAL_COOLDOWN_HOURS * 60 * 60 * 1000).toISOString();
    const cooldownRes = await fetch(
      `${supabaseUrl}/rest/v1/app_health_events?app_id=eq.${fn.app_id}&function_name=eq.${encodeURIComponent(fn.function_name)}&created_at=gte.${cooldownCutoff}&limit=1`,
      { headers }
    );

    if (cooldownRes.ok) {
      const events = await cooldownRes.json() as Array<unknown>;
      if (events.length > 0) {
        console.log(`[AUTO-HEAL] Skipping ${fn.function_name} on ${fn.app_id} — cooldown active`);
        continue;
      }
    }

    // Check daily rate limit
    const dayCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const dayRes = await fetch(
      `${supabaseUrl}/rest/v1/app_health_events?app_id=eq.${fn.app_id}&created_at=gte.${dayCutoff}`,
      { headers: { ...headers, 'Prefer': 'count=exact' } }
    );

    if (dayRes.ok) {
      const count = parseInt(dayRes.headers.get('content-range')?.split('/')[1] || '0', 10);
      if (count >= MAX_HEALS_PER_DAY) {
        console.log(`[AUTO-HEAL] Skipping ${fn.app_id} — daily limit reached (${count}/${MAX_HEALS_PER_DAY})`);
        continue;
      }
    }

    // Check if app has auto_heal_enabled
    const appRes = await fetch(
      `${supabaseUrl}/rest/v1/apps?id=eq.${fn.app_id}&select=auto_heal_enabled,owner_id&limit=1`,
      { headers }
    );

    if (appRes.ok) {
      const apps = await appRes.json() as Array<{ auto_heal_enabled: boolean; owner_id: string }>;
      if (apps.length > 0 && apps[0].auto_heal_enabled === false) {
        console.log(`[AUTO-HEAL] Skipping ${fn.app_id} — auto-heal disabled by owner`);
        continue;
      }
    }

    candidates.push(fn);
  }

  return candidates;
}

// ============================================
// STEP 3: HEAL A SINGLE FUNCTION
// ============================================

async function healFunction(
  fn: FailingFunction,
  supabaseUrl: string,
  supabaseKey: string,
  openRouterKey: string,
): Promise<HealingResult> {
  const headers = {
    'apikey': supabaseKey,
    'Authorization': `Bearer ${supabaseKey}`,
  };
  const writeHeaders = {
    ...headers,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
  };

  console.log(`[AUTO-HEAL] Healing ${fn.function_name} on app ${fn.app_id} (error rate: ${(fn.error_rate * 100).toFixed(0)}%)`);

  // Record the detection event
  const eventRes = await fetch(`${supabaseUrl}/rest/v1/app_health_events`, {
    method: 'POST',
    headers: writeHeaders,
    body: JSON.stringify({
      app_id: fn.app_id,
      function_name: fn.function_name,
      status: 'diagnosing',
      error_rate: fn.error_rate,
      total_calls: fn.total_calls,
      failed_calls: fn.failed_calls,
      common_error: fn.common_error.slice(0, 1000),
      error_sample: fn.error_samples.slice(0, 3),
    }),
  });

  let eventId: string | null = null;
  if (eventRes.ok) {
    const events = await eventRes.json() as Array<{ id: string }>;
    eventId = events[0]?.id || null;
  }

  // Helper to update event status
  async function updateEvent(status: string, extra: Record<string, unknown> = {}) {
    if (!eventId) return;
    await fetch(`${supabaseUrl}/rest/v1/app_health_events?id=eq.${eventId}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify({ status, updated_at: new Date().toISOString(), ...extra }),
    }).catch(() => {});
  }

  try {
    // 3a. Fetch app metadata and source code
    const appsService = createAppsService();
    const app = await appsService.findById(fn.app_id);
    if (!app) {
      await updateEvent('failed', { patch_description: 'App not found' });
      return { app_id: fn.app_id, function_name: fn.function_name, status: 'failed', error: 'App not found' };
    }

    const r2Service = createR2Service();
    const storageKey = app.storage_key || `apps/${fn.app_id}/${app.current_version || '1.0.0'}/`;

    // Try to fetch source code
    let sourceCode: string | null = null;
    let entryFileName = 'index.ts';
    const entryFiles = ['index.tsx', 'index.ts', 'index.jsx', 'index.js'];
    for (const entry of entryFiles) {
      try {
        sourceCode = await r2Service.fetchTextFile(`${storageKey}${entry}`);
        entryFileName = entry;
        break;
      } catch {
        // Try next
      }
    }

    if (!sourceCode) {
      await updateEvent('failed', { patch_description: 'Could not fetch source code' });
      return { app_id: fn.app_id, function_name: fn.function_name, status: 'failed', error: 'Source code not found' };
    }

    // 3b. Ask AI to diagnose and fix
    const patch = await diagnoseAndPatch(
      sourceCode,
      entryFileName,
      fn.function_name,
      fn.common_error,
      fn.error_samples,
      openRouterKey,
    );

    if (!patch.fixed_code) {
      await updateEvent('failed', { patch_description: patch.diagnosis || 'AI could not generate fix' });
      return {
        app_id: fn.app_id,
        function_name: fn.function_name,
        status: 'failed',
        error: 'AI diagnosis did not produce a fix',
        description: patch.diagnosis,
      };
    }

    await updateEvent('patched', { patch_description: patch.description });

    // 3c. Test the patch by bundling it
    console.log(`[AUTO-HEAL] Testing patch for ${fn.function_name}...`);
    await updateEvent('testing');

    const bundleResult = await bundleCode(
      [{ name: entryFileName, content: patch.fixed_code }],
      entryFileName,
    );

    if (!bundleResult.success) {
      const bundleErrors = bundleResult.errors.join('; ');
      await updateEvent('failed', { patch_description: `Bundle failed: ${bundleErrors}` });
      return {
        app_id: fn.app_id,
        function_name: fn.function_name,
        status: 'failed',
        error: `Patch doesn't compile: ${bundleErrors}`,
      };
    }

    // 3d. Deploy: upload as new version
    console.log(`[AUTO-HEAL] Deploying patch for ${fn.function_name}...`);
    const previousVersion = app.current_version || '1.0.0';
    const newVersion = incrementPatchVersion(previousVersion);
    const newStorageKey = `apps/${fn.app_id}/${newVersion}/`;

    // Upload source
    const encoder = new TextEncoder();
    await r2Service.uploadFile(`${newStorageKey}${entryFileName}`, {
      name: entryFileName,
      content: encoder.encode(patch.fixed_code),
      contentType: 'text/typescript',
    });

    // Upload bundle
    await r2Service.uploadFile(`${newStorageKey}bundle.js`, {
      name: 'bundle.js',
      content: encoder.encode(bundleResult.code),
      contentType: 'application/javascript',
    });

    // Update app record
    await appsService.update(fn.app_id, {
      storage_key: newStorageKey,
      current_version: newVersion,
      versions: [...(app.versions || []), newVersion],
      health_status: 'healing',
      last_healed_at: new Date().toISOString(),
    } as Record<string, unknown>);

    // Invalidate code cache
    getCodeCache().invalidate(fn.app_id);

    await updateEvent('deployed', {
      patch_version: newVersion,
      previous_version: previousVersion,
      resolved_at: new Date().toISOString(),
    });

    // Update app health status
    await appsService.update(fn.app_id, {
      health_status: 'healed',
    } as Record<string, unknown>);

    console.log(`[AUTO-HEAL] Deployed fix for ${fn.function_name} → v${newVersion}`);

    return {
      app_id: fn.app_id,
      function_name: fn.function_name,
      status: 'patched',
      description: patch.description,
      new_version: newVersion,
    };

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await updateEvent('failed', { patch_description: `Unexpected error: ${msg}` });
    return { app_id: fn.app_id, function_name: fn.function_name, status: 'failed', error: msg };
  }
}

// ============================================
// AI DIAGNOSIS & PATCHING
// ============================================

interface PatchResult {
  diagnosis: string;
  description: string;
  fixed_code: string | null;
}

async function diagnoseAndPatch(
  sourceCode: string,
  fileName: string,
  functionName: string,
  commonError: string,
  errorSamples: Array<{ error_message: string; input_args: unknown; created_at: string }>,
  openRouterKey: string,
): Promise<PatchResult> {
  const samplesText = errorSamples.map((s, i) =>
    `  ${i + 1}. Error: ${s.error_message}\n     Args: ${JSON.stringify(s.input_args)}`
  ).join('\n');

  const prompt = `You are an expert TypeScript developer debugging an Ultralight MCP function.

## Context
Ultralight functions are TypeScript exported functions that receive arguments as a single object parameter.
They run in a Deno sandbox with access to: fetch, crypto, ultralight.store/load/list/remove, lodash (_), dateFns, base64, hash.

## Failing Function
File: ${fileName}
Function: ${functionName}
Error rate: very high (majority of calls failing)

## Most Common Error
${commonError}

## Error Samples
${samplesText}

## Source Code
\`\`\`typescript
${sourceCode.slice(0, 12000)}
\`\`\`

## Instructions
1. Diagnose the root cause of the error in function \`${functionName}\`
2. Fix the code — make the MINIMAL change needed to resolve the error
3. Do NOT change the function signatures or overall logic
4. Common issues: missing null checks, incorrect parameter destructuring, unhandled edge cases, missing await, incorrect types

Respond in this exact JSON format:
{
  "diagnosis": "Brief explanation of the root cause",
  "description": "One-line description of the fix",
  "fixed_code": "The complete fixed source code (entire file, not just the function)"
}

If you cannot determine a fix with high confidence, set fixed_code to null.
Respond ONLY with the JSON object, no markdown fencing.`;

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openRouterKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://ultralight.dev',
        'X-Title': 'Ultralight Auto-Heal',
      },
      body: JSON.stringify({
        model: 'anthropic/claude-sonnet-4-20250514',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: 16000,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[AUTO-HEAL] AI call failed (${response.status}):`, errText);
      return { diagnosis: `AI call failed: ${response.status}`, description: '', fixed_code: null };
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const content = data.choices?.[0]?.message?.content || '';

    // Parse JSON response — strip markdown fencing if present
    const jsonStr = content.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();

    try {
      const parsed = JSON.parse(jsonStr) as PatchResult;
      return {
        diagnosis: parsed.diagnosis || 'Unknown',
        description: parsed.description || 'Auto-generated fix',
        fixed_code: parsed.fixed_code || null,
      };
    } catch (parseErr) {
      console.error('[AUTO-HEAL] Failed to parse AI response:', content.slice(0, 500));
      return { diagnosis: 'Failed to parse AI response', description: '', fixed_code: null };
    }

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[AUTO-HEAL] AI diagnosis error:', msg);
    return { diagnosis: `AI error: ${msg}`, description: '', fixed_code: null };
  }
}

// ============================================
// HELPERS
// ============================================

function incrementPatchVersion(version: string): string {
  const parts = version.split('.');
  if (parts.length !== 3) return `${version}.1`;
  const patch = parseInt(parts[2], 10) || 0;
  return `${parts[0]}.${parts[1]}.${patch + 1}`;
}

// ============================================
// JOB SCHEDULER
// ============================================

/**
 * Start the auto-healing job.
 * Runs after a startup delay, then every 30 minutes.
 */
export function startAutoHealingJob(): void {
  const INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

  console.log('[AUTO-HEAL] Starting auto-healing job (every 30 min)');

  // First run after 3 minutes (let server warm up)
  setTimeout(async () => {
    try {
      const report = await runAutoHealing();
      if (report.detected > 0) {
        console.log(`[AUTO-HEAL] First run: ${JSON.stringify(report)}`);
      }
    } catch (err) {
      console.error('[AUTO-HEAL] First run failed:', err);
    }
  }, 3 * 60 * 1000);

  // Then every 30 minutes
  setInterval(async () => {
    try {
      await runAutoHealing();
    } catch (err) {
      console.error('[AUTO-HEAL] Scheduled run failed:', err);
    }
  }, INTERVAL_MS);
}
