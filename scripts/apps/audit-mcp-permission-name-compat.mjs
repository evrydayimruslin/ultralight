import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ensureNode20, parseArgs, repoRoot } from '../analysis/_shared.mjs';

ensureNode20();

const PAGE_SIZE = 1000;
const args = parseArgs(process.argv.slice(2));
const outputPath = typeof args.get('--write-json') === 'string'
  ? resolve(repoRoot, args.get('--write-json'))
  : null;
const applyBackfill = args.has('--apply-backfill');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set before running this audit.');
  process.exit(1);
}

function headers(extra = {}) {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    ...extra,
  };
}

function toRawFunctionName(appSlug, identifier) {
  if (!appSlug || !identifier) return identifier;
  const prefix = `${appSlug}_`;
  return identifier.startsWith(prefix) ? identifier.slice(prefix.length) : identifier;
}

function parseManifestFunctionNames(manifest) {
  if (!manifest) return [];

  let parsed = manifest;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return [];
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return [];
  }

  const functions = parsed.functions;
  if (!functions || typeof functions !== 'object' || Array.isArray(functions)) {
    return [];
  }

  return Object.keys(functions);
}

async function fetchAllRows(table, select) {
  const rows = [];
  let offset = 0;

  while (true) {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/${table}?select=${encodeURIComponent(select)}&order=app_id.asc,id.asc`,
      {
        headers: headers({
          Range: `${offset}-${offset + PAGE_SIZE - 1}`,
        }),
      },
    );

    if (!response.ok) {
      console.error(`Failed to fetch ${table}: ${await response.text()}`);
      process.exit(1);
    }

    const page = await response.json();
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return rows;
}

async function patchRow(table, id, payload) {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: headers({
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      }),
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    throw new Error(await response.text());
  }
}

const apps = await fetchAllRows('apps', 'id,slug,exports,manifest');
const appLookup = new Map(
  apps.map((app) => {
    const exported = Array.isArray(app.exports) ? app.exports : [];
    const manifestFunctions = parseManifestFunctionNames(app.manifest);
    return [
      app.id,
      {
        slug: app.slug,
        knownFunctions: new Set([...exported, ...manifestFunctions]),
      },
    ];
  }),
);

const tables = [
  {
    name: 'user_app_permissions',
    select: 'id,app_id,function_name,allowed,granted_to_user_id,granted_by_user_id,created_at,updated_at',
  },
  {
    name: 'pending_permissions',
    select: 'id,app_id,function_name,allowed,invited_email,granted_by_user_id,created_at,updated_at',
  },
];

const rows = [];
const remediation = {
  backfilled: [],
  failures: [],
};

for (const table of tables) {
  const tableRows = await fetchAllRows(table.name, table.select);

  for (const row of tableRows) {
    const appMeta = appLookup.get(row.app_id);
    const reportRow = {
      table: table.name,
      row_id: row.id,
      app_id: row.app_id,
      function_name: row.function_name,
      allowed: row.allowed,
      created_at: row.created_at,
      updated_at: row.updated_at,
      state: 'canonical',
      recommended_action: 'none',
      canonical_function_name: row.function_name,
    };

    if (!appMeta?.slug) {
      reportRow.state = 'app_missing';
      reportRow.recommended_action = 'investigate_or_delete';
      rows.push(reportRow);
      continue;
    }

    const rawName = toRawFunctionName(appMeta.slug, row.function_name);
    reportRow.canonical_function_name = rawName;

    if (rawName === row.function_name) {
      rows.push(reportRow);
      continue;
    }

    if (appMeta.knownFunctions.has(rawName)) {
      reportRow.state = 'legacy_backfillable';
      reportRow.recommended_action = 'rewrite_to_canonical_raw_name';

      if (applyBackfill) {
        try {
          await patchRow(table.name, row.id, { function_name: rawName });
          remediation.backfilled.push({
            table: table.name,
            row_id: row.id,
            from: row.function_name,
            to: rawName,
          });
          reportRow.remediation = 'backfilled';
        } catch (error) {
          remediation.failures.push({
            table: table.name,
            row_id: row.id,
            error: error instanceof Error ? error.message : String(error),
          });
          reportRow.remediation = 'backfill_failed';
        }
      }
    } else if (appMeta.knownFunctions.size === 0) {
      reportRow.state = 'legacy_ambiguous_no_contracts';
      reportRow.recommended_action = 'investigate_app_contracts_before_backfill';
    } else {
      reportRow.state = 'legacy_ambiguous_unknown_function';
      reportRow.recommended_action = 'investigate_function_name_before_backfill';
    }

    rows.push(reportRow);
  }
}

const summary = rows.reduce((acc, row) => {
  acc.total += 1;
  acc.by_table[row.table] = (acc.by_table[row.table] ?? 0) + 1;
  acc.by_state[row.state] = (acc.by_state[row.state] ?? 0) + 1;
  return acc;
}, {
  total: 0,
  by_table: {},
  by_state: {},
});

const report = {
  generated_at: new Date().toISOString(),
  actions: {
    apply_backfill: applyBackfill,
  },
  summary,
  remediation,
  rows,
};

if (outputPath) {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

console.log(`Audited ${summary.total} permission row(s).`);
for (const [state, count] of Object.entries(summary.by_state)) {
  console.log(`- ${state}: ${count}`);
}
if (applyBackfill) {
  console.log(`Backfilled ${remediation.backfilled.length} legacy permission row(s).`);
}
if (remediation.failures.length > 0) {
  console.log(`Backfill failures: ${remediation.failures.length}`);
}
if (outputPath) {
  console.log(`Wrote audit report to ${outputPath}`);
}
