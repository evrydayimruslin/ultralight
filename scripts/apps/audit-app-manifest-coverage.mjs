import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ensureNode20, parseArgs, repoRoot } from '../analysis/_shared.mjs';

ensureNode20();

const args = parseArgs(process.argv.slice(2));
const outputPath = typeof args.get('--write-json') === 'string'
  ? resolve(repoRoot, args.get('--write-json'))
  : null;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set before running this audit.');
  process.exit(1);
}

function headers() {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  };
}

function parseJsonMaybe(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value && typeof value === 'object' ? value : null;
}

function getManifestFunctionCount(manifest) {
  const parsed = parseJsonMaybe(manifest);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return 0;
  }
  const functions = parsed.functions;
  return functions && typeof functions === 'object' && !Array.isArray(functions)
    ? Object.keys(functions).length
    : 0;
}

function getSkillsFunctionCount(skillsParsed) {
  const parsed = parseJsonMaybe(skillsParsed);
  if (Array.isArray(parsed)) {
    return parsed.filter((entry) => entry && typeof entry === 'object' && typeof entry.name === 'string').length;
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.functions)) {
    return 0;
  }
  return parsed.functions.filter((entry) => entry && typeof entry === 'object' && typeof entry.name === 'string').length;
}

function getExportCount(exportsList) {
  return Array.isArray(exportsList)
    ? exportsList.filter((value) => typeof value === 'string' && value.trim().length > 0).length
    : 0;
}

function classifyApp(app) {
  const manifestFunctionCount = getManifestFunctionCount(app.manifest);
  const skillsFunctionCount = getSkillsFunctionCount(app.skills_parsed);
  const exportCount = getExportCount(app.exports);

  if (manifestFunctionCount > 0) {
    return {
      source: 'manifest',
      manifest_backed: true,
      migration_required: false,
      function_count: manifestFunctionCount,
      recommended_action: 'none',
    };
  }

  if (skillsFunctionCount > 0) {
    return {
      source: 'skills_parsed',
      manifest_backed: false,
      migration_required: true,
      function_count: skillsFunctionCount,
      recommended_action: 'regenerate_or_publish_manifest_backed_version',
    };
  }

  if (app.runtime === 'gpu' && exportCount > 0) {
    return {
      source: 'gpu_exports',
      manifest_backed: false,
      migration_required: true,
      function_count: exportCount,
      recommended_action: 'publish_manifest_backed_gpu_contracts',
    };
  }

  if (exportCount > 0) {
    return {
      source: 'exports',
      manifest_backed: false,
      migration_required: true,
      function_count: exportCount,
      recommended_action: 'publish_manifest_backed_version',
    };
  }

  return {
    source: 'none',
    manifest_backed: false,
    migration_required: false,
    function_count: 0,
    recommended_action: 'none',
  };
}

const appsResponse = await fetch(
  `${SUPABASE_URL}/rest/v1/apps?deleted_at=is.null&select=id,name,slug,owner_id,app_type,runtime,visibility,current_version,updated_at,manifest,skills_parsed,exports&order=updated_at.desc`,
  { headers: headers() },
);
if (!appsResponse.ok) {
  console.error(`Failed to fetch apps: ${await appsResponse.text()}`);
  process.exit(1);
}

const apps = await appsResponse.json();
const rows = apps.map((app) => ({
  app_id: app.id,
  app_name: app.name ?? null,
  app_slug: app.slug,
  owner_id: app.owner_id,
  app_type: app.app_type ?? null,
  runtime: app.runtime ?? null,
  visibility: app.visibility ?? null,
  current_version: app.current_version ?? null,
  updated_at: app.updated_at ?? null,
  ...classifyApp(app),
}));

const summary = rows.reduce((acc, row) => {
  acc.total += 1;
  acc.by_source[row.source] = (acc.by_source[row.source] ?? 0) + 1;
  if (row.manifest_backed) {
    acc.manifest_backed += 1;
  }
  if (row.migration_required) {
    acc.migration_required += 1;
  }
  return acc;
}, {
  total: 0,
  manifest_backed: 0,
  migration_required: 0,
  by_source: {},
});

const report = {
  generated_at: new Date().toISOString(),
  summary,
  rows,
};

if (outputPath) {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

console.log(`Audited ${summary.total} app(s).`);
console.log(`Manifest-backed: ${summary.manifest_backed}`);
console.log(`Migration required: ${summary.migration_required}`);
for (const [source, count] of Object.entries(summary.by_source)) {
  console.log(`- ${source}: ${count}`);
}
if (outputPath) {
  console.log(`Wrote audit report to ${outputPath}`);
}
