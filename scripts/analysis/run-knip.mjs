import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  ensureNode20,
  getPackageDir,
  parseArgs,
  simplifyIssueEntries,
  toDisplayPath,
  writeOrCompareBaseline,
} from './_shared.mjs';

const packageConfigs = {
  api: {
    label: 'API unused-code analysis',
    baselinePath: 'analysis-unused-baseline.json',
    configPath: 'knip.json',
    updateCommand: 'npm run analyze:unused:update-baseline',
  },
  desktop: {
    label: 'Desktop unused-code analysis',
    baselinePath: 'analysis-unused-baseline.json',
    configPath: 'knip.json',
    updateCommand: 'corepack pnpm run analyze:unused:update-baseline',
  },
};

function normalizeKnipOutput(rawJson, packageDir) {
  const parsed = JSON.parse(rawJson);
  const issues = (parsed.issues ?? [])
    .map((issue) => {
      const normalized = {};
      const displayPath = toDisplayPath(issue.file, packageDir);
      if (displayPath) {
        normalized.file = displayPath;
      }

      for (const key of [
        'binaries',
        'catalog',
        'dependencies',
        'devDependencies',
        'duplicates',
        'enumMembers',
        'exports',
        'files',
        'namespaceMembers',
        'optionalPeerDependencies',
        'types',
        'unlisted',
        'unresolved',
      ]) {
        const values = simplifyIssueEntries(issue[key]);
        if (values.length > 0) {
          normalized[key] = values;
        }
      }

      return normalized;
    })
    .filter((issue) => Object.keys(issue).length > 1)
    .sort((left, right) => left.file.localeCompare(right.file));

  return { issues };
}

function summarizeKnipFindings(normalized) {
  const categoryCounts = new Map();
  for (const issue of normalized.issues) {
    for (const [key, values] of Object.entries(issue)) {
      if (key === 'file') {
        continue;
      }
      categoryCounts.set(key, (categoryCounts.get(key) ?? 0) + values.length);
    }
  }

  const summaryParts = [...categoryCounts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, count]) => `${count} ${key}`);

  return `${normalized.issues.length} file(s) with findings${summaryParts.length ? `: ${summaryParts.join(', ')}` : ''}`;
}

ensureNode20();

const args = parseArgs(process.argv.slice(2));
const packageName = args.get('--package');
const shouldWriteBaseline = args.has('--write-baseline');

if (typeof packageName !== 'string' || !(packageName in packageConfigs)) {
  console.error('Usage: node scripts/analysis/run-knip.mjs --package <api|desktop> [--write-baseline]');
  process.exit(1);
}

const packageConfig = packageConfigs[packageName];
const packageDir = getPackageDir(packageName);
const knipBin = resolve(packageDir, 'node_modules', '.bin', 'knip');
const configPath = resolve(packageDir, packageConfig.configPath);
const baselinePath = resolve(packageDir, packageConfig.baselinePath);

if (!existsSync(knipBin)) {
  console.error(`Knip is not installed for ${packageName}. Reinstall dependencies and retry.`);
  process.exit(1);
}

const result = spawnSync(knipBin, ['--config', configPath, '--reporter', 'json', '--no-progress'], {
  cwd: packageDir,
  encoding: 'utf8',
});

if (!result.stdout?.trim()) {
  console.error(result.stderr?.trim() || `${packageConfig.label} produced no output.`);
  process.exit(result.status || 1);
}

let normalized;
try {
  normalized = normalizeKnipOutput(result.stdout, packageDir);
} catch (error) {
  console.error(`${packageConfig.label} returned invalid JSON.`);
  console.error(result.stdout.trim());
  console.error(result.stderr?.trim() || (error instanceof Error ? error.message : String(error)));
  process.exit(1);
}

const summary = summarizeKnipFindings(normalized);

writeOrCompareBaseline({
  baselinePath,
  current: normalized,
  label: packageConfig.label,
  successMessage: `${packageConfig.label} matched baseline (${summary}).`,
  staleMessage: `${packageConfig.label} is now clean but the committed baseline is stale.`,
  changedMessage: `${packageConfig.label} findings changed from the committed baseline (${summary}).`,
  shouldWriteBaseline,
  updateCommand: packageConfig.updateCommand,
});
