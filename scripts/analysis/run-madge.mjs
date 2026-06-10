import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ensureNode20, getPackageDir, parseArgs, toDisplayPath, writeOrCompareBaseline } from './_shared.mjs';

const packageConfigs = {
  api: {
    label: 'API dependency-cycle analysis',
    baselinePath: 'analysis-cycles-baseline.json',
    updateCommand: 'npm run analyze:deps:update-baseline',
    extensions: 'ts',
    tsconfig: 'tsconfig.json',
    entries: ['src', 'handlers', 'services', 'runtime', 'lib'],
    exclude: ['\\.test\\.ts$', 'main\\.ts\\.bak$', 'services/gpu/test-template/'],
  },
  desktop: {
    label: 'Desktop dependency-cycle analysis',
    baselinePath: 'analysis-cycles-baseline.json',
    updateCommand: 'corepack pnpm run analyze:deps:update-baseline',
    extensions: 'ts,tsx',
    tsconfig: 'tsconfig.json',
    entries: ['src'],
    exclude: ['\\.test\\.tsx?$', 'src/vite-env\\.d\\.ts$'],
  },
};

function canonicalizeCycle(cycle) {
  const variants = [];
  const forward = [...cycle];
  const reverse = [...cycle].reverse();

  for (const source of [forward, reverse]) {
    for (let index = 0; index < source.length; index += 1) {
      variants.push([...source.slice(index), ...source.slice(0, index)]);
    }
  }

  return variants.sort((left, right) => left.join('>').localeCompare(right.join('>')))[0];
}

function normalizeMadgeOutput(rawJson, packageDir) {
  const parsed = JSON.parse(rawJson);
  const cycles = (Array.isArray(parsed) ? parsed : [])
    .map((cycle) => cycle.map((entry) => toDisplayPath(entry, packageDir)))
    .map(canonicalizeCycle)
    .sort((left, right) => left.join('>').localeCompare(right.join('>')));

  return { cycles };
}

ensureNode20();

const args = parseArgs(process.argv.slice(2));
const packageName = args.get('--package');
const shouldWriteBaseline = args.has('--write-baseline');

if (typeof packageName !== 'string' || !(packageName in packageConfigs)) {
  console.error('Usage: node scripts/analysis/run-madge.mjs --package <api|desktop> [--write-baseline]');
  process.exit(1);
}

const packageConfig = packageConfigs[packageName];
const packageDir = getPackageDir(packageName);
const madgeBin = resolve(packageDir, 'node_modules', '.bin', 'madge');
const baselinePath = resolve(packageDir, packageConfig.baselinePath);
const tsconfigPath = resolve(packageDir, packageConfig.tsconfig);

if (!existsSync(madgeBin)) {
  console.error(`Madge is not installed for ${packageName}. Reinstall dependencies and retry.`);
  process.exit(1);
}

const madgeArgs = [
  '--circular',
  '--json',
  '--extensions',
  packageConfig.extensions,
  '--ts-config',
  tsconfigPath,
];

for (const pattern of packageConfig.exclude) {
  madgeArgs.push('--exclude', pattern);
}

madgeArgs.push(...packageConfig.entries);

const result = spawnSync(madgeBin, madgeArgs, {
  cwd: packageDir,
  encoding: 'utf8',
});

if (!result.stdout?.trim()) {
  console.error(result.stderr?.trim() || `${packageConfig.label} produced no output.`);
  process.exit(result.status || 1);
}

let normalized;
try {
  normalized = normalizeMadgeOutput(result.stdout, packageDir);
} catch (error) {
  console.error(`${packageConfig.label} returned invalid JSON.`);
  console.error(result.stdout.trim());
  console.error(result.stderr?.trim() || (error instanceof Error ? error.message : String(error)));
  process.exit(1);
}

const summary = `${normalized.cycles.length} circular dependency chain(s)`;

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
