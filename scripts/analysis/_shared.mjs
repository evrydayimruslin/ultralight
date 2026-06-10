import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(scriptDir, '..', '..');

function normalizePath(value, packageDir) {
  const normalized = value.replaceAll('\\', '/');
  if (normalized.startsWith(`${repoRoot.replaceAll('\\', '/')}/`)) {
    return relative(packageDir, value).replaceAll('\\', '/');
  }
  return normalized;
}

function sortObject(value) {
  if (Array.isArray(value)) {
    return value.map(sortObject);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortObject(item)]),
    );
  }

  return value;
}

export function ensureNode20() {
  const major = Number.parseInt(process.versions.node.split('.')[0] ?? '', 10);
  if (Number.isNaN(major) || major < 20) {
    console.error('Analysis tooling requires Node 20 or newer.');
    console.error('Run `source ~/.nvm/nvm.sh && nvm use` from the repo root before rerunning this command.');
    process.exit(1);
  }
}

export function isEmptyBaselineValue(current) {
  if (Array.isArray(current.issues)) {
    return current.issues.length === 0;
  }

  if (Array.isArray(current.cycles)) {
    return current.cycles.length === 0;
  }

  return Object.keys(current).length === 0;
}

export function parseArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      continue;
    }

    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args.set(token, true);
      continue;
    }

    args.set(token, next);
    index += 1;
  }
  return args;
}

export function getPackageDir(packageName) {
  return resolve(repoRoot, packageName);
}

export function toDisplayPath(path, packageDir) {
  return normalizePath(path, packageDir);
}

export function simplifyIssueEntries(entries = []) {
  return [...entries]
    .map((entry) => {
      if (typeof entry === 'string') {
        return entry;
      }

      if (!entry || typeof entry !== 'object') {
        return String(entry);
      }

      if (typeof entry.name === 'string') {
        return entry.name;
      }

      const sanitized = Object.fromEntries(
        Object.entries(entry).filter(([key]) => !['line', 'col', 'pos'].includes(key)),
      );
      return JSON.stringify(sortObject(sanitized));
    })
    .sort((left, right) => left.localeCompare(right));
}

export function writeOrCompareBaseline({
  baselinePath,
  current,
  label,
  successMessage,
  staleMessage,
  changedMessage,
  shouldWriteBaseline,
  updateCommand,
}) {
  const normalizedCurrent = `${JSON.stringify(sortObject(current), null, 2)}\n`;
  const baselineExists = existsSync(baselinePath);
  const baseline = baselineExists ? readFileSync(baselinePath, 'utf8') : '';
  const hasFindings = !isEmptyBaselineValue(current);

  if (shouldWriteBaseline) {
    mkdirSync(dirname(baselinePath), { recursive: true });
    writeFileSync(baselinePath, normalizedCurrent, 'utf8');
    console.log(`Updated ${label} baseline at ${baselinePath}.`);
    process.exit(0);
  }

  if (!hasFindings) {
    if (baselineExists && baseline.trim() && baseline !== normalizedCurrent) {
      console.error(staleMessage);
      console.error(`Run \`${updateCommand}\` to clear the committed baseline.`);
      process.exit(1);
    }

    console.log(successMessage);
    process.exit(0);
  }

  if (normalizedCurrent === baseline) {
    console.log(successMessage);
    process.exit(0);
  }

  console.error(changedMessage);
  console.error(`Run \`${updateCommand}\` to refresh the baseline after review.`);
  process.exit(1);
}
