# Development Tooling

This repo does not have a root JavaScript workspace package. The `api/` and
`desktop/` projects each own their own dependencies, but they share one runtime
policy and one analysis toolchain.

## Runtime Policy

- Node 20 is the supported local and CI runtime for JavaScript and TypeScript
  tooling.
- The repo root `.nvmrc` is the source of truth for the Node major version.
- `api/` uses `npm`.
- `api/package-lock.json` is the committed lockfile for API installs and CI.
- `desktop/` uses the `pnpm` version pinned in `desktop/package.json`.
- Do not use `npm` inside `desktop/`; that breaks the lockfile and can hide
  dependency drift.

## Fresh Environment Setup

1. From the repo root, load Node 20:
   `source ~/.nvm/nvm.sh && nvm use`
2. Ensure Corepack is enabled so the pinned desktop package manager is
   available:
   `corepack enable`
3. Install API dependencies:
   `(cd api && npm ci)`
4. Install desktop dependencies:
   `(cd desktop && corepack pnpm install --frozen-lockfile)`

If `pnpm` is not on `PATH`, use `corepack pnpm ...` for local desktop commands.
CI uses the same pinned version through `pnpm/action-setup`.

## Local Analysis Commands

### API

- Typecheck baseline: `(cd api && npm run typecheck)`
- Raw typecheck output: `(cd api && npm run typecheck:full)`
- Unused-code baseline: `(cd api && npm run analyze:unused)`
- Dependency-cycle baseline: `(cd api && npm run analyze:deps)`
- Refresh unused-code baseline after review:
  `(cd api && npm run analyze:unused:update-baseline)`
- Refresh dependency-cycle baseline after review:
  `(cd api && npm run analyze:deps:update-baseline)`

### Desktop

- Typecheck: `(cd desktop && corepack pnpm run typecheck)`
- Unused-code baseline:
  `(cd desktop && corepack pnpm run analyze:unused)`
- Dependency-cycle baseline:
  `(cd desktop && corepack pnpm run analyze:deps)`
- Refresh unused-code baseline after review:
  `(cd desktop && corepack pnpm run analyze:unused:update-baseline)`
- Refresh dependency-cycle baseline after review:
  `(cd desktop && corepack pnpm run analyze:deps:update-baseline)`

### Repo-wide Guardrails

- Guardrail baseline:
  `node scripts/checks/run-guardrail-checks.mjs`
- Refresh guardrail baseline after review:
  `node scripts/checks/run-guardrail-checks.mjs --write-baseline`

## What The Baselines Mean

- `typecheck-baseline.txt` in `api/` tracks known TypeScript errors while the
  Worker migration continues.
- `analysis-unused-baseline.json` tracks the current unused-code findings from
  Knip.
- `analysis-cycles-baseline.json` tracks the current circular dependencies from
  Madge.
- `scripts/checks/guardrail-baseline.json` tracks the current launch-risk
  matches for query-token auth, wildcard CORS, backup artifacts, and placeholder
  runtime strings.

The baseline-aware commands fail when findings change unexpectedly. That lets CI
catch drift immediately without pretending the repo is already clean.

When a cleanup PR intentionally removes or adds findings, rerun the matching
`*:update-baseline` command in the same PR after reviewing the diff.

## CI Mapping

- `.github/workflows/api-ci.yml` runs API unused-code, dependency-cycle, and
  typecheck baselines before tests and Worker dry-runs.
- `.github/workflows/desktop-build.yml` runs desktop typecheck plus unused-code
  and dependency-cycle baselines before the frontend build.
- `.github/workflows/launch-guardrails.yml` runs the repo-wide launch guardrail
  baseline without needing package installs.

Local commands and CI now call the same scripts, so there is no separate
"developer path" and "pipeline path" for analysis.
