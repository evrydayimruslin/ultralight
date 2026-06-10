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

function classifyApp(app, firstConfigByUser) {
  if (app.supabase_config_id) {
    return {
      state: 'saved_config',
      migration_required: false,
      recommended_action: 'none',
      recommended_config_id: app.supabase_config_id,
    };
  }

  if (!app.supabase_enabled) {
    return {
      state: 'disabled',
      migration_required: false,
      recommended_action: 'none',
      recommended_config_id: null,
    };
  }

  if (app.supabase_url && app.supabase_anon_key_encrypted) {
    return {
      state: 'legacy_app_config',
      migration_required: true,
      recommended_action: 'create_or_match_saved_config_then_assign',
      recommended_config_id: null,
    };
  }

  const defaultConfig = firstConfigByUser.get(app.owner_id) ?? null;
  return {
    state: defaultConfig ? 'platform_default' : 'unresolved',
    migration_required: true,
    recommended_action: defaultConfig ? 'assign_first_saved_config' : 'create_saved_config_then_assign',
    recommended_config_id: defaultConfig?.id ?? null,
  };
}

const appsResponse = await fetch(
  `${SUPABASE_URL}/rest/v1/apps?supabase_enabled=eq.true&select=id,name,slug,owner_id,supabase_enabled,supabase_config_id,supabase_url,supabase_anon_key_encrypted,supabase_service_key_encrypted&order=owner_id.asc,id.asc`,
  { headers: headers() },
);
if (!appsResponse.ok) {
  console.error(`Failed to fetch apps: ${await appsResponse.text()}`);
  process.exit(1);
}

const configsResponse = await fetch(
  `${SUPABASE_URL}/rest/v1/user_supabase_configs?select=id,user_id,name,supabase_url,created_at&order=user_id.asc,created_at.asc`,
  { headers: headers() },
);
if (!configsResponse.ok) {
  console.error(`Failed to fetch user_supabase_configs: ${await configsResponse.text()}`);
  process.exit(1);
}

const apps = await appsResponse.json();
const configs = await configsResponse.json();
const firstConfigByUser = new Map();

for (const config of configs) {
  if (!firstConfigByUser.has(config.user_id)) {
    firstConfigByUser.set(config.user_id, config);
  }
}

const rows = apps.map((app) => ({
  app_id: app.id,
  app_name: app.name ?? null,
  app_slug: app.slug,
  owner_id: app.owner_id,
  ...classifyApp(app, firstConfigByUser),
}));

const summary = rows.reduce((acc, row) => {
  acc.total += 1;
  acc.by_state[row.state] = (acc.by_state[row.state] ?? 0) + 1;
  if (row.migration_required) {
    acc.migration_required += 1;
  }
  return acc;
}, {
  total: 0,
  migration_required: 0,
  by_state: {},
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

console.log(`Audited ${summary.total} Supabase-enabled app(s).`);
console.log(`Migration required for ${summary.migration_required} app(s).`);
for (const [state, count] of Object.entries(summary.by_state)) {
  console.log(`- ${state}: ${count}`);
}
if (outputPath) {
  console.log(`Wrote audit report to ${outputPath}`);
}
