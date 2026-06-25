#!/usr/bin/env node
// Free Mode E2E smoke — proves the Free Mode gates on a REAL deployment now that
// FREE_MODE is enabled (api/wrangler.toml). The unit suite covers the gate
// logic; this proves the live wiring end-to-end: a wallet under $0.25 must run
// free functions, block paid functions, and block inference functions when the
// caller has no BYOK key — at execution AND in discovery (tools/list filtering).
//
// It is SELF-CONTAINED (uploads scripts/smoke/fixtures/free-mode-fixture, prices
// the paid function via gx.set) and NON-DESTRUCTIVE (snapshots the smoke
// account's balance buckets and restores them in a finally — so always point it
// at a DEDICATED smoke account, never a real customer).
//
// Usage:
//   node scripts/smoke/free-mode-e2e-smoke.mjs \
//     --url https://ultralight-api-staging.rgn4jz429m.workers.dev \
//     --token <ul_ api token for the smoke account, apps:call scope> \
//     --user-id <the smoke account's user uuid> \
//     --supabase-url https://<project>.supabase.co \
//     --service-role-key <SUPABASE_SERVICE_ROLE_KEY> \
//     [--app-id <reuse a fixture app instead of creating one>] \
//     [--output-dir docs/_generated/launch/staging/<candidate>/smoke]
//
// Exit: 0 all checks passed · 1 a check failed · 2 setup/precondition error.

import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, readdirSync } from "node:fs";
import { parseArgs } from "../analysis/_shared.mjs";

const FREE_MODE_BALANCE_LIGHT = 25; // shared/contracts/ai.ts — < this = Free Mode
const LOW_BALANCE_LIGHT = 10; // any value < the threshold puts the account in Free Mode
const PAID_PRICE_LIGHT = 100; // $1.00 — the paid_ping price
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const args = parseArgs(process.argv.slice(2));
function req(flag, envName) {
  const v = String(args.get(flag) || (envName ? process.env[envName] : "") || "").trim();
  if (!v) {
    console.error(`free-mode-e2e-smoke requires ${flag}${envName ? ` (or $${envName})` : ""}`);
    process.exit(2);
  }
  return v;
}

const apiBase = req("--url", "ULTRALIGHT_API_URL").replace(/\/$/, "");
const token = req("--token", "ULTRALIGHT_TOKEN");
const userId = req("--user-id", "ULTRALIGHT_SMOKE_USER_ID");
const supabaseUrl = req("--supabase-url", "SUPABASE_URL").replace(/\/$/, "");
const serviceRoleKey = req("--service-role-key", "SUPABASE_SERVICE_ROLE_KEY");
let appId = String(args.get("--app-id") || process.env.ULTRALIGHT_FREEMODE_SMOKE_APP_ID || "").trim();
const outputDir = String(args.get("--output-dir") || "").trim();

const checks = [];
function check(step, cond, detail = "") {
  checks.push({ step, pass: !!cond, detail: cond ? "" : String(detail).slice(0, 400) });
  if (cond) console.log(`PASS [${step}]`);
  else console.error(`FAIL [${step}] ${String(detail).slice(0, 400)}`);
}
function setupFail(msg) {
  console.error(`SETUP ERROR: ${msg}`);
  writeEvidence("setup_error");
  process.exit(2);
}

// ── Supabase service-role helpers (read + set the balance buckets) ──
const sbHeaders = {
  apikey: serviceRoleKey,
  Authorization: `Bearer ${serviceRoleKey}`,
  "Content-Type": "application/json",
};
async function sbGetUser() {
  const url = `${supabaseUrl}/rest/v1/users?id=eq.${encodeURIComponent(userId)}` +
    `&select=deposit_balance_light,earned_balance_light,balance_light,byok_enabled,byok_provider`;
  const res = await fetch(url, { headers: sbHeaders });
  if (!res.ok) setupFail(`supabase user read ${res.status}: ${await res.text()}`);
  const rows = await res.json();
  if (!Array.isArray(rows) || rows.length === 0) setupFail(`no users row for ${userId}`);
  return rows[0];
}
// balance_light is trigger-maintained from the two buckets, so write the buckets.
async function sbSetBuckets(deposit, earned) {
  const res = await fetch(`${supabaseUrl}/rest/v1/users?id=eq.${encodeURIComponent(userId)}`, {
    method: "PATCH",
    headers: { ...sbHeaders, Prefer: "return=minimal" },
    body: JSON.stringify({ deposit_balance_light: deposit, earned_balance_light: earned }),
  });
  if (!res.ok) throw new Error(`supabase balance write ${res.status}: ${await res.text()}`);
}

// ── Platform MCP (gx.upload / gx.set) ──
async function callPlatformTool(name, toolArgs) {
  const res = await fetch(`${apiBase}/mcp/platform`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: toolArgs } }),
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { throw new Error(`HTTP ${res.status} non-JSON: ${text.slice(0, 300)}`); }
  if (body.error) throw new Error(body.error.message || JSON.stringify(body.error));
  const r = body.result;
  if (r?.isError) throw new Error(r.content?.[0]?.text || "tool error");
  if (r?.structuredContent !== undefined) return r.structuredContent;
  const txt = r?.content?.[0]?.text;
  try { return txt ? JSON.parse(txt) : r; } catch { return { text: txt }; }
}

// ── Per-app MCP (the execution chokepoint that runs the Free Mode gate) ──
async function appToolNames() {
  const res = await fetch(`${apiBase}/mcp/${encodeURIComponent(appId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  const body = await res.json();
  return (body?.result?.tools || []).map((t) => t.name);
}
// Resolve the advertised tool name for a raw fixture function (handles a
// slug-prefixed convention, e.g. "<slug>_paid_ping", or the bare name).
function resolveToolName(names, fn) {
  return names.find((n) => n === fn) || names.find((n) => n.endsWith(`_${fn}`)) || names.find((n) => n.endsWith(fn));
}
// Returns { ok: true } on success, or { ok: false, code, type } on a JSON-RPC error.
async function callAppFn(toolName, toolArgs = {}) {
  const res = await fetch(`${apiBase}/mcp/${encodeURIComponent(appId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: toolName, arguments: toolArgs } }),
  });
  const body = await res.json().catch(() => ({}));
  if (body?.error) {
    return { ok: false, code: body.error.code, type: body.error.data?.type || null, message: body.error.message };
  }
  const r = body?.result;
  if (r?.isError) return { ok: false, code: null, type: null, message: r.content?.[0]?.text || "tool error" };
  return { ok: true, result: r };
}

let snapshot = null;
function writeEvidence(status) {
  if (!outputDir) return;
  try {
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(
      join(outputDir, "free-mode-e2e.json"),
      JSON.stringify({
        smoke: "free-mode-e2e",
        status,
        api: apiBase,
        app_id: appId || null,
        free_mode_threshold_light: FREE_MODE_BALANCE_LIGHT,
        low_balance_light: LOW_BALANCE_LIGHT,
        balance_snapshot: snapshot,
        checks,
      }, null, 2),
    );
  } catch (err) {
    console.error(`(could not write evidence: ${String(err?.message || err)})`);
  }
}

// ── Collect the fixture files (source + manifest) ──
function collectFixture() {
  const dir = join(repoRoot, "scripts/smoke/fixtures/free-mode-fixture");
  const allowed = new Set([".ts", ".tsx", ".js", ".json", ".md"]);
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const ext = entry.name.slice(entry.name.lastIndexOf("."));
    if (allowed.has(ext)) files.push({ path: entry.name, content: readFileSync(join(dir, entry.name), "utf8") });
  }
  return files;
}

// ════════════════════════════════ run ════════════════════════════════
let exitCode = 0;
try {
  // 0. Preconditions: the smoke account must have NO BYOK (else the AI gate
  //    never fires and the test is invalid).
  const user = await sbGetUser();
  snapshot = {
    deposit_balance_light: Number(user.deposit_balance_light) || 0,
    earned_balance_light: Number(user.earned_balance_light) || 0,
    balance_light: Number(user.balance_light) || 0,
  };
  if (user.byok_enabled && user.byok_provider) {
    setupFail("smoke account has a BYOK key configured — the AI-without-BYOK gate cannot be tested. Use an account with no BYOK provider.");
  }

  // 1. Upload the fixture (private) + price the paid function.
  try {
    const uploadArgs = { files: collectFixture(), name: "Free Mode Smoke Fixture", visibility: "private" };
    if (appId) uploadArgs.app_id = appId;
    const up = await callPlatformTool("gx.upload", uploadArgs);
    appId = up?.app_id || up?.id || appId;
    if (!appId) setupFail(`gx.upload returned no app id: ${JSON.stringify(up).slice(0, 200)}`);
    console.log(`      fixture app ${appId}`);
    await callPlatformTool("gx.set", {
      app_id: appId,
      default_free_calls: 0,
      function_prices: { paid_ping: { price_light: PAID_PRICE_LIGHT, free_calls: 0 } },
    });
  } catch (err) {
    setupFail(`fixture upload/pricing failed: ${String(err?.message || err)}`);
  }

  // 2. Capture advertised tool names while NOT in Free Mode (all visible).
  const namesNormal = await appToolNames();
  const freeTool = resolveToolName(namesNormal, "free_ping");
  const paidTool = resolveToolName(namesNormal, "paid_ping");
  const aiTool = resolveToolName(namesNormal, "ai_ping");
  check("all 3 functions advertised when not in Free Mode",
    !!freeTool && !!paidTool && !!aiTool, `tools/list: ${namesNormal.join(", ")}`);
  if (!freeTool || !paidTool || !aiTool) {
    setupFail("could not resolve fixture tool names — cannot proceed");
  }

  // 3. Enter Free Mode: set balance < $0.25.
  await sbSetBuckets(LOW_BALANCE_LIGHT, 0);
  console.log(`      balance set to ${LOW_BALANCE_LIGHT} Light (< ${FREE_MODE_BALANCE_LIGHT}) → Free Mode active`);

  // 4. Discovery filter (Phase 2): paid + AI hidden, free still visible.
  const namesFree = await appToolNames();
  check("Free Mode hides the paid function from tools/list", !namesFree.includes(paidTool), `tools/list: ${namesFree.join(", ")}`);
  check("Free Mode hides the AI function from tools/list", !namesFree.includes(aiTool), `tools/list: ${namesFree.join(", ")}`);
  check("Free Mode keeps the free function visible", namesFree.includes(freeTool), `tools/list: ${namesFree.join(", ")}`);

  // 5. Execution gates.
  const freeRes = await callAppFn(freeTool);
  check("free function RUNS in Free Mode", freeRes.ok, `got ${JSON.stringify(freeRes).slice(0, 200)}`);

  const paidRes = await callAppFn(paidTool);
  check("paid function is BLOCKED (free_mode_paid_blocked)",
    !paidRes.ok && paidRes.type === "free_mode_paid_blocked",
    `expected free_mode_paid_blocked, got ${JSON.stringify(paidRes).slice(0, 200)}`);

  const aiRes = await callAppFn(aiTool, { prompt: "ping" });
  check("AI function is BLOCKED without BYOK (free_mode_ai_requires_byok)",
    !aiRes.ok && aiRes.type === "free_mode_ai_requires_byok",
    `expected free_mode_ai_requires_byok, got ${JSON.stringify(aiRes).slice(0, 200)}`);
} catch (err) {
  check("smoke ran without an unexpected error", false, String(err?.stack || err?.message || err));
} finally {
  // ALWAYS restore the account's original balance.
  if (snapshot) {
    try {
      await sbSetBuckets(snapshot.deposit_balance_light, snapshot.earned_balance_light);
      console.log(`      balance restored (deposit=${snapshot.deposit_balance_light}, earned=${snapshot.earned_balance_light})`);
    } catch (err) {
      console.error(`CRITICAL: failed to restore balance for ${userId}: ${String(err?.message || err)} — restore manually.`);
      exitCode = 2;
    }
  }
}

const failed = checks.filter((c) => !c.pass).length;
writeEvidence(failed === 0 && exitCode === 0 ? "passed" : "failed");
if (failed > 0) {
  console.error(`free-mode-e2e-smoke: ${failed} check(s) failed`);
  process.exit(1);
}
if (exitCode !== 0) process.exit(exitCode);
console.log(`free-mode-e2e-smoke: all checks passed (app ${appId})`);
