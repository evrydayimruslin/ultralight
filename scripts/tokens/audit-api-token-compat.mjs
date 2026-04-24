import { createHmac, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ensureNode20, parseArgs, repoRoot } from '../analysis/_shared.mjs';

ensureNode20();

const args = parseArgs(process.argv.slice(2));
const outputPath = typeof args.get('--write-json') === 'string'
  ? resolve(repoRoot, args.get('--write-json'))
  : null;
const applyBackfill = args.has('--apply-backfill');
const deleteUnrecoverable = args.has('--delete-unrecoverable');
const PAGE_SIZE = 1000;

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

function classifyRow(row) {
  if (row.token_salt) {
    return row.plaintext_token ? 'canonical' : 'canonical_missing_plaintext';
  }

  if (row.plaintext_token) {
    return 'legacy_backfillable_from_plaintext';
  }

  return 'legacy_unrecoverable';
}

function recommendedAction(state) {
  switch (state) {
    case 'canonical':
      return 'none';
    case 'canonical_missing_plaintext':
      return 'keep_or_regenerate_from_ui';
    case 'legacy_backfillable_from_plaintext':
      return 'backfill_token_salt';
    case 'legacy_unrecoverable':
      return 'revoke_and_reissue';
    default:
      return 'investigate';
  }
}

function buildBackfillUpdate(token) {
  const tokenSalt = randomBytes(16).toString('hex');
  const tokenHash = createHmac('sha256', tokenSalt).update(token).digest('hex');
  return {
    token_salt: tokenSalt,
    token_hash: tokenHash,
  };
}

async function fetchAllTokenRows() {
  const rows = [];
  let offset = 0;

  while (true) {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/user_api_tokens?select=id,user_id,name,token_prefix,token_hash,token_salt,plaintext_token,created_at,last_used_at,expires_at&order=created_at.asc,id.asc`,
      {
        headers: headers({
          Range: `${offset}-${offset + PAGE_SIZE - 1}`,
        }),
      },
    );

    if (!response.ok) {
      console.error(`Failed to fetch user_api_tokens: ${await response.text()}`);
      process.exit(1);
    }

    const page = await response.json();
    rows.push(...page);
    if (page.length < PAGE_SIZE) {
      break;
    }
    offset += PAGE_SIZE;
  }

  return rows;
}

async function patchTokenRow(tokenId, payload) {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/user_api_tokens?id=eq.${encodeURIComponent(tokenId)}`,
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

async function deleteTokenRow(tokenId) {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/user_api_tokens?id=eq.${encodeURIComponent(tokenId)}`,
    {
      method: 'DELETE',
      headers: headers({
        Prefer: 'return=minimal',
      }),
    },
  );

  if (!response.ok) {
    throw new Error(await response.text());
  }
}

const tokenRows = await fetchAllTokenRows();
const rows = [];
const remediation = {
  backfilled: [],
  deleted_unrecoverable: [],
  failures: [],
};

for (const row of tokenRows) {
  const state = classifyRow(row);
  const reportRow = {
    token_id: row.id,
    user_id: row.user_id,
    name: row.name,
    token_prefix: row.token_prefix,
    created_at: row.created_at,
    last_used_at: row.last_used_at,
    expires_at: row.expires_at,
    state,
    recommended_action: recommendedAction(state),
  };

  if (applyBackfill && state === 'legacy_backfillable_from_plaintext') {
    try {
      const update = buildBackfillUpdate(row.plaintext_token);
      await patchTokenRow(row.id, update);
      remediation.backfilled.push(row.id);
      reportRow.remediation = 'backfilled_token_salt';
    } catch (error) {
      remediation.failures.push({
        token_id: row.id,
        action: 'backfill_token_salt',
        error: error instanceof Error ? error.message : String(error),
      });
      reportRow.remediation = 'backfill_failed';
    }
  } else if (deleteUnrecoverable && state === 'legacy_unrecoverable') {
    try {
      await deleteTokenRow(row.id);
      remediation.deleted_unrecoverable.push(row.id);
      reportRow.remediation = 'deleted_unrecoverable';
    } catch (error) {
      remediation.failures.push({
        token_id: row.id,
        action: 'delete_unrecoverable',
        error: error instanceof Error ? error.message : String(error),
      });
      reportRow.remediation = 'delete_failed';
    }
  }

  rows.push(reportRow);
}

const summary = rows.reduce((acc, row) => {
  acc.total += 1;
  acc.by_state[row.state] = (acc.by_state[row.state] ?? 0) + 1;
  return acc;
}, {
  total: 0,
  by_state: {},
});

const report = {
  generated_at: new Date().toISOString(),
  actions: {
    apply_backfill: applyBackfill,
    delete_unrecoverable: deleteUnrecoverable,
  },
  summary,
  remediation,
  rows,
};

if (outputPath) {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

console.log(`Audited ${summary.total} API token row(s).`);
for (const [state, count] of Object.entries(summary.by_state)) {
  console.log(`- ${state}: ${count}`);
}
if (applyBackfill) {
  console.log(`Backfilled ${remediation.backfilled.length} legacy token row(s).`);
}
if (deleteUnrecoverable) {
  console.log(`Deleted ${remediation.deleted_unrecoverable.length} unrecoverable token row(s).`);
}
if (remediation.failures.length > 0) {
  console.log(`Remediation failures: ${remediation.failures.length}`);
}
if (outputPath) {
  console.log(`Wrote audit report to ${outputPath}`);
}
