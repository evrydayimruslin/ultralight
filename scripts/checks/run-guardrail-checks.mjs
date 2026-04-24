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
