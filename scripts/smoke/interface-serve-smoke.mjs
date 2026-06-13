#!/usr/bin/env node
// Interface-serving smoke (Interfaces PR3): proves the sandbox worker's
// security posture on a REAL deployment — strict path allowlist (the only
// route is /i/{uuid}/{sha256}, so bundle source can never be reached),
// method gating, uncached 404s, cookieless responses, and (when a live
// artifact is supplied) the full CSP `sandbox` header suite with immutable
// content-addressed caching.
//
// Usage:
//   node scripts/smoke/interface-serve-smoke.mjs \
//     --url https://ultralight-interfaces-staging.rgn4jz429m.workers.dev \
//     [--app <appId> --hash <sha256>]   # a deployed interface artifact
//
// Without --app/--hash it still verifies the negative-path posture; with
// them it also asserts every header on a served interface.

import { parseArgs } from '../analysis/_shared.mjs';

const args = parseArgs(process.argv.slice(2));

function required(flag) {
  const value = String(args.get(flag) || '').trim();
  if (!value) {
    console.error(`interface-serve-smoke requires ${flag}`);
    process.exit(1);
  }
  return value;
}

const baseUrl = required('--url').replace(/\/$/, '');
const appId = String(args.get('--app') || '').trim();
const hash = String(args.get('--hash') || '').trim();
if ((appId && !hash) || (!appId && hash)) {
  console.error('interface-serve-smoke needs BOTH --app and --hash (or neither)');
  process.exit(1);
}

let failures = 0;
function check(step, condition, detail) {
  if (condition) {
    console.log(`PASS [${step}]`);
  } else {
    failures += 1;
    console.error(`FAIL [${step}] ${detail}`);
  }
}

function assertNoCookie(step, res) {
  check(`${step}: no Set-Cookie`, res.headers.get('set-cookie') === null, 'response set a cookie');
}

// Valid route shape, but the hash of the empty string reversed — no real
// artifact can live here (and seeded smoke fixtures must not use it).
const MISSING_PATH = `/i/${'f'.repeat(8)}-${'f'.repeat(4)}-${'f'.repeat(4)}-${'f'.repeat(4)}-${'f'.repeat(12)}/${'f'.repeat(64)}`;

// 1. Valid-shaped but nonexistent artifact → uncached 404.
{
  const res = await fetch(`${baseUrl}${MISSING_PATH}`);
  check('missing artifact 404', res.status === 404, `status ${res.status}`);
  check(
    'missing artifact uncached',
    res.headers.get('cache-control') === 'no-store',
    `cache-control: ${res.headers.get('cache-control')}`,
  );
  check(
    'missing artifact nosniff',
    res.headers.get('x-content-type-options') === 'nosniff',
    'missing nosniff',
  );
  assertNoCookie('missing artifact', res);
}

// 2. Invalid shapes (bundle path, raw key shape, junk) → 404.
for (const path of ['/apps/x/1.0.0/index.ts', '/interfaces/x/y.html', '/i/not-a-uuid/nothash']) {
  const res = await fetch(`${baseUrl}${path}`);
  check(`invalid path 404 (${path})`, res.status === 404, `status ${res.status}`);
}

// 3. Method gating.
{
  const res = await fetch(`${baseUrl}${MISSING_PATH}`, { method: 'POST' });
  check('POST 405', res.status === 405, `status ${res.status}`);
  check('405 Allow header', res.headers.get('allow') === 'GET, HEAD', `allow: ${res.headers.get('allow')}`);
}

// 4. Root liveness.
{
  const res = await fetch(`${baseUrl}/`);
  check('root 204', res.status === 204, `status ${res.status}`);
  assertNoCookie('root', res);
}

// 5. Live artifact (optional): full positive-path header suite.
if (appId && hash) {
  const res = await fetch(`${baseUrl}/i/${appId}/${hash}`);
  check('artifact 200', res.status === 200, `status ${res.status}`);
  check(
    'artifact content-type html',
    (res.headers.get('content-type') || '').startsWith('text/html'),
    `content-type: ${res.headers.get('content-type')}`,
  );
  check(
    'artifact immutable cache',
    res.headers.get('cache-control') === 'public, max-age=31536000, immutable',
    `cache-control: ${res.headers.get('cache-control')}`,
  );
  const csp = res.headers.get('content-security-policy') || '';
  check('artifact CSP sandbox', csp.includes('sandbox allow-scripts allow-forms'), `csp: ${csp}`);
  check('artifact CSP default-src none', csp.includes("default-src 'none'"), `csp: ${csp}`);
  check('artifact CSP frame-ancestors', csp.includes('frame-ancestors '), `csp: ${csp}`);
  check(
    'artifact nosniff',
    res.headers.get('x-content-type-options') === 'nosniff',
    'missing nosniff',
  );
  check(
    'artifact referrer-policy',
    res.headers.get('referrer-policy') === 'no-referrer',
    `referrer-policy: ${res.headers.get('referrer-policy')}`,
  );
  assertNoCookie('artifact', res);

  const head = await fetch(`${baseUrl}/i/${appId}/${hash}`, { method: 'HEAD' });
  check('artifact HEAD 200', head.status === 200, `status ${head.status}`);
} else {
  console.log('SKIP [live artifact checks] pass --app and --hash to enable');
}

if (failures > 0) {
  console.error(`interface-serve-smoke: ${failures} check(s) failed`);
  process.exit(1);
}
console.log('interface-serve-smoke: all checks passed');
