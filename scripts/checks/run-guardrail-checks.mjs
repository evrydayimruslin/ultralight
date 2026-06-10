import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { relative, resolve, extname } from 'node:path';
import { ensureNode20, parseArgs, repoRoot, writeOrCompareBaseline } from '../analysis/_shared.mjs';

const codeRoots = ['api', 'desktop', 'web', 'shared', 'sdk'];
const codeExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.html']);
const skipDirectories = new Set([
  '.git',
  '.next',
  '.wrangler',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'target',
]);
const guardedZeroConsoleFiles = [
  'api/src/worker-entry.ts',
  'api/handlers/chat.ts',
  'api/handlers/upload.ts',
  'desktop/src/components/ChatView.tsx',
  'desktop/src/hooks/useWidgetInbox.ts',
  'desktop/src/lib/agentRunner.ts',
  'desktop/src/App.tsx',
  'desktop/src/hooks/useDesktopUpdater.ts',
  'desktop/src/main.tsx',
  'desktop/src/lib/api.ts',
  'desktop/src/lib/storage.ts',
  'web/layout.ts',
];

const approvedEconomicSqlMutationFiles = new Set([
  'supabase/migrations/20260418155845_ultralight_prod_baseline.sql',
  'supabase/migrations/20260428120000_marketplace_light_ledger.sql',
  'supabase/migrations/20260430120000_platform_billing_config.sql',
  'supabase/migrations/20260430130000_light_balance_earnings_buckets.sql',
  'supabase/migrations/20260430140000_internal_light_movement_context.sql',
  'supabase/migrations/20260430150000_stripe_event_deposit_ledger.sql',
  'supabase/migrations/20260430160000_monthly_payout_policy.sql',
  'supabase/migrations/20260430170000_payout_reconciliation.sql',
  'supabase/migrations/20260504120000_app_storage_delta_accounting.sql',
  'supabase/migrations/20260505130000_cloud_usage_ledger.sql',
  'supabase/migrations/20260505160000_payout_net_economics.sql',
  'supabase/migrations/20260508130000_earnings_balance_conversion.sql',
  'supabase/migrations/20260518150000_apply_fee_waivers_to_settlements.sql',
  'supabase/migrations/20260518160000_fee_waiver_credit_admin_and_leaderboard.sql',
  'supabase/migrations/20260608120000_permanent_customer_attribution_and_skill_pulls.sql',
  'supabase/migrations/20260608130000_internal_tax_and_embedding_charge_foundation.sql',
  'supabase/migrations/20260608140000_economic_operation_idempotency.sql',
]);

const approvedEconomicDirectRestFiles = new Set([
  'api/services/chat-billing.ts',
  'api/services/gpu/billing.ts',
  'api/services/gpu/builder.ts',
  'api/services/hosting-billing.ts',
  'api/services/skill-pulls.ts',
]);

const approvedEconomicDirectRpcFiles = new Set([
  'api/handlers/admin.ts',
  'api/handlers/app.ts',
  'api/handlers/platform-mcp.ts',
  'api/handlers/user.ts',
  'api/runtime/sandbox.ts',
  'api/services/chat-billing.ts',
  'api/services/cloud-usage.ts',
  'api/services/embedding-billing.ts',
  'api/services/execution-settlement.ts',
  'api/services/gpu/billing.ts',
  'api/services/gpu/builder.ts',
  'api/services/skill-pulls.ts',
]);

const guardrails = [
  {
    id: 'query-token-auth',
    label: 'URL Token Transport',
    description: 'Protects against introducing new tokenized URL transport or bootstrap flows while Wave 1 removes the remaining debt.',
    matchLine(line) {
      return /\?token=|\[#&\]token=|(?:searchParams|qs)\.get\((['"])token['"]\)|(?:searchParams|qs)\.set\((['"])token['"]\)|url\.searchParams\.get\((['"])token['"]\)|url\.searchParams\.set\((['"])token['"]\)|replace\(\/\[\?&\]token=/.test(line);
    },
  },
  {
    id: 'wildcard-cors',
    label: 'Wildcard CORS',
    description: 'Protects against adding new wildcard or reflective Access-Control-Allow-Origin behavior in production code.',
    matchLine(line) {
      return /Access-Control-Allow-Origin['"]?\s*[:=].*['"]\*['"]|origin\s*\|\|\s*['"]\*['"]/.test(line);
    },
  },
  {
    id: 'placeholder-runtime-strings',
    label: 'Placeholder Runtime Strings',
    description: 'Protects product paths from shipping new runtime strings that advertise unfinished implementation.',
    matchLine(line) {
      return /(['"`])[^'"`]*(AI placeholder|not yet implemented)[^'"`]*\1/.test(line);
    },
  },
];
const directConsoleRegex = /console\.(log|warn|error|info|debug)\(/;
const economicSqlMutationRegex =
  /\bUPDATE\s+(?:"public"\.)?"?users"?\b|\bINSERT\s+INTO\s+(?:"public"\.)?"?(billing_transactions|transfers|cloud_usage_events|cloud_usage_holds|skill_pull_receipts|embedding_generation_charges|light_ledger_entries)"?\b/i;
const economicDirectRestRegex =
  /\/rest\/v1\/(billing_transactions|transfers|cloud_usage_events|cloud_usage_holds|skill_pull_receipts|embedding_generation_charges|light_ledger_entries)\b/;
const mutatingRestMethodRegex =
  /method\s*:\s*['"](POST|PATCH|PUT|DELETE)['"]|\.(insert|update|delete)\(/;
const economicDirectRpcRegex =
  /(?:\/rest\/v1\/rpc\/|\.rpc\(\s*['"])(credit_balance|credit_deposit_light|debit_light|debit_spendable_light|transfer_balance|transfer_light|convert_earnings_to_deposit|debit_cloud_usage|create_cloud_usage_hold|settle_cloud_usage_hold|release_cloud_usage_hold|record_skill_pull_receipt|record_embedding_generation_charge)\b/;

function isCommentOnly(line) {
  const trimmed = line.trim();
  return (
    trimmed.length === 0 ||
    trimmed.startsWith('//') ||
    trimmed.startsWith('/*') ||
    trimmed.startsWith('*') ||
    trimmed.startsWith('<!--')
  );
}

function walkFiles(rootDir, results = []) {
  for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
    if (skipDirectories.has(entry.name)) {
      continue;
    }

    const fullPath = resolve(rootDir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fullPath, results);
      continue;
    }

    results.push(fullPath);
  }

  return results;
}

function toRepoPath(filePath) {
  return relative(repoRoot, filePath).replaceAll('\\', '/');
}

function isTestArtifact(repoPath) {
  return /(?:^|\/)__tests__\/|\.test\.[cm]?[jt]sx?$|\.spec\.[cm]?[jt]sx?$/.test(repoPath);
}

function scanCodeGuardrail(guardrail) {
  const matches = [];

  for (const root of codeRoots) {
    const rootDir = resolve(repoRoot, root);
    if (!existsSync(rootDir)) {
      continue;
    }

    for (const filePath of walkFiles(rootDir)) {
      if (!codeExtensions.has(extname(filePath))) {
        continue;
      }

      const repoPath = toRepoPath(filePath);
      if (isTestArtifact(repoPath)) {
        continue;
      }

      const content = readFileSync(filePath, 'utf8');
      const lines = content.split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        if (isCommentOnly(line)) {
          continue;
        }

        if (!guardrail.matchLine(line)) {
          continue;
        }

        matches.push({
          file: repoPath,
          line: index + 1,
          snippet: line.trim(),
        });
      }
    }
  }

  return matches.sort((left, right) => {
    if (left.file !== right.file) {
      return left.file.localeCompare(right.file);
    }
    return left.line - right.line;
  });
}

function scanZeroConsoleGuardrail() {
  const matches = [];

  for (const repoPath of guardedZeroConsoleFiles) {
    const filePath = resolve(repoRoot, repoPath);
    if (!existsSync(filePath)) {
      continue;
    }

    const content = readFileSync(filePath, 'utf8');
    const lines = content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (isCommentOnly(line)) {
        continue;
      }
      if (!directConsoleRegex.test(line)) {
        continue;
      }

      matches.push({
        file: repoPath,
        line: index + 1,
        snippet: line.trim(),
      });
    }
  }

  return matches.sort((left, right) => {
    if (left.file !== right.file) {
      return left.file.localeCompare(right.file);
    }
    return left.line - right.line;
  });
}

function scanBackupSourceFiles() {
  const matches = [];
  for (const filePath of walkFiles(repoRoot)) {
    const repoPath = toRepoPath(filePath);
    if (repoPath.startsWith('.git/')) {
      continue;
    }

    if (/\.bak$/i.test(repoPath) || /preview.*\.html$/i.test(repoPath)) {
      matches.push({ file: repoPath });
    }
  }

  return matches.sort((left, right) => left.file.localeCompare(right.file));
}

function scanRootMigrationFiles() {
  const matches = [];
  for (const entry of readdirSync(repoRoot, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }

    if (!/^migration-.*\.sql$/i.test(entry.name)) {
      continue;
    }

    matches.push({ file: entry.name });
  }

  return matches.sort((left, right) => left.file.localeCompare(right.file));
}

function scanEconomicSqlMutations() {
  const matches = [];
  const migrationDir = resolve(repoRoot, 'supabase', 'migrations');
  if (!existsSync(migrationDir)) {
    return matches;
  }

  for (const filePath of walkFiles(migrationDir)) {
    if (extname(filePath) !== '.sql') {
      continue;
    }

    const repoPath = toRepoPath(filePath);
    if (approvedEconomicSqlMutationFiles.has(repoPath)) {
      continue;
    }

    const content = readFileSync(filePath, 'utf8');
    const lines = content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (isCommentOnly(line) || !economicSqlMutationRegex.test(line)) {
        continue;
      }
      matches.push({
        file: repoPath,
        line: index + 1,
        snippet: line.trim(),
      });
    }
  }

  return sortMatches(matches);
}

function scanEconomicDirectRestMutations() {
  const matches = [];
  for (const root of ['api', 'worker', 'shared', 'sdk', 'apps']) {
    const rootDir = resolve(repoRoot, root);
    if (!existsSync(rootDir)) {
      continue;
    }

    for (const filePath of walkFiles(rootDir)) {
      if (!codeExtensions.has(extname(filePath))) {
        continue;
      }

      const repoPath = toRepoPath(filePath);
      if (
        isTestArtifact(repoPath) ||
        approvedEconomicDirectRestFiles.has(repoPath)
      ) {
        continue;
      }

      const content = readFileSync(filePath, 'utf8');
      const lines = content.split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        if (isCommentOnly(line) || !economicDirectRestRegex.test(line)) {
          continue;
        }

        const nearbyLines = lines.slice(index, index + 12).join('\n');
        if (line.includes('?') && !mutatingRestMethodRegex.test(nearbyLines)) {
          continue;
        }

        matches.push({
          file: repoPath,
          line: index + 1,
          snippet: line.trim(),
        });
      }
    }
  }

  return sortMatches(matches);
}

function scanEconomicDirectRpcMutations() {
  const matches = [];
  for (const root of ['api', 'worker', 'shared', 'sdk', 'apps']) {
    const rootDir = resolve(repoRoot, root);
    if (!existsSync(rootDir)) {
      continue;
    }

    for (const filePath of walkFiles(rootDir)) {
      if (!codeExtensions.has(extname(filePath))) {
        continue;
      }

      const repoPath = toRepoPath(filePath);
      if (
        isTestArtifact(repoPath) ||
        approvedEconomicDirectRpcFiles.has(repoPath)
      ) {
        continue;
      }

      const content = readFileSync(filePath, 'utf8');
      const lines = content.split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        if (isCommentOnly(line) || !economicDirectRpcRegex.test(line)) {
          continue;
        }
        matches.push({
          file: repoPath,
          line: index + 1,
          snippet: line.trim(),
        });
      }
    }
  }

  return sortMatches(matches);
}

function sortMatches(matches) {
  return matches.sort((left, right) => {
    if (left.file !== right.file) {
      return left.file.localeCompare(right.file);
    }
    return left.line - right.line;
  });
}

function collectGuardrailFindings() {
  const checks = {};
  for (const guardrail of guardrails) {
    checks[guardrail.id] = {
      description: guardrail.description,
      matches: scanCodeGuardrail(guardrail),
    };
  }

  checks['backup-source-files'] = {
    description: 'Protects live trees from shipping .bak copies and preview-only HTML artifacts by accident.',
    matches: scanBackupSourceFiles(),
  };
  checks['guarded-direct-console'] = {
    description: 'Protects the Wave 5 logging-conversion surfaces from regressing back to raw console.* calls in product code.',
    matches: scanZeroConsoleGuardrail(),
  };
  checks['root-migration-files'] = {
    description: 'Protects the canonical Supabase migration flow by rejecting new root-level migration-*.sql files.',
    matches: scanRootMigrationFiles(),
  };
  checks['economic-sql-mutations'] = {
    description: 'Protects Light-moving database state by requiring new direct SQL mutations to be reviewed in the economic mutation allowlist.',
    matches: scanEconomicSqlMutations(),
  };
  checks['economic-direct-rest-mutations'] = {
    description: 'Protects Light-moving tables from new direct REST writes outside approved secondary ledger/receipt writers.',
    matches: scanEconomicDirectRestMutations(),
  };
  checks['economic-direct-rpc-mutations'] = {
    description: 'Protects Light-moving RPC call sites from spreading outside approved service boundaries.',
    matches: scanEconomicDirectRpcMutations(),
  };

  return { checks };
}

function summarizeFindings(current) {
  return Object.entries(current.checks)
    .map(([id, entry]) => `${id}: ${entry.matches.length}`)
    .join(', ');
}

ensureNode20();

const args = parseArgs(process.argv.slice(2));
const shouldWriteBaseline = args.has('--write-baseline');
const baselinePath = resolve(repoRoot, 'scripts', 'checks', 'guardrail-baseline.json');
const current = collectGuardrailFindings();
const summary = summarizeFindings(current);

writeOrCompareBaseline({
  baselinePath,
  current,
  label: 'Launch guardrails',
  successMessage: `Launch guardrails matched baseline (${summary}).`,
  staleMessage: 'Launch guardrails are now clean but the committed baseline is stale.',
  changedMessage: `Launch guardrail findings changed from the committed baseline (${summary}).`,
  shouldWriteBaseline,
  updateCommand: 'node scripts/checks/run-guardrail-checks.mjs --write-baseline',
});
