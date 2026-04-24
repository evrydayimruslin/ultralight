#!/usr/bin/env node

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { ensureNode20, parseArgs, repoRoot } from '../analysis/_shared.mjs';

ensureNode20();

function printHelp() {
  console.log(`Usage: node scripts/ops/init-backup-restore-drill.mjs [options]

Options:
  --source-environment <name>   Source environment being protected (default: production)
  --restore-target <name>       Isolated restore target identifier (required)
  --output-dir <path>           Output directory (defaults to $UL_LAUNCH_EVIDENCE_DIR/restore-drill)
  --scenario <name>             Drill scenario label (default: supabase_managed_restore)
  --operator <name>             Operator name or redacted id (default: $USER)
  --force                       Overwrite existing scaffold files
  --help                        Show this help
`);
}

const args = parseArgs(process.argv.slice(2));

if (args.has('--help')) {
  printHelp();
  process.exit(0);
}

const sourceEnvironment = String(args.get('--source-environment') || 'production').trim();
const restoreTarget = String(args.get('--restore-target') || '').trim();
const scenario = String(args.get('--scenario') || 'supabase_managed_restore').trim();
const operator = String(args.get('--operator') || process.env.USER || 'unknown').trim();
const force = Boolean(args.has('--force'));

const configuredOutput = String(args.get('--output-dir') || '').trim();
const envOutput = process.env.UL_LAUNCH_EVIDENCE_DIR
  ? resolve(repoRoot, process.env.UL_LAUNCH_EVIDENCE_DIR, 'restore-drill')
  : '';
const outputDir = configuredOutput
  ? resolve(repoRoot, configuredOutput)
  : envOutput;

if (!restoreTarget || !outputDir) {
  printHelp();
  console.error('Both --restore-target and an output directory are required.');
  process.exit(1);
}

mkdirSync(outputDir, { recursive: true });

const candidateId = basename(outputDir) === 'restore-drill'
  ? basename(dirname(outputDir))
  : basename(outputDir);
const metadataPath = resolve(outputDir, 'metadata.json');
const notesPath = resolve(outputDir, 'notes.md');
const validationQueriesPath = resolve(outputDir, 'validation-queries.sql');

function writeIfAllowed(path, content) {
  if (existsSync(path) && !force) {
    console.log(`Skipped existing file: ${path}`);
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
  console.log(`Wrote ${path}`);
}

const metadata = {
  generated_at: new Date().toISOString(),
  drill_type: 'backup_restore',
  status: 'prepared',
  source_environment: sourceEnvironment,
  restore_target: restoreTarget,
  scenario,
  candidate_id: candidateId,
  operator,
  source_backup_reference: null,
  restore_started_at: null,
  restore_completed_at: null,
  validation_completed_at: null,
  rto_minutes: null,
  rpo_minutes: null,
  artifact_paths: {
    notes: 'notes.md',
    validation_queries: 'validation-queries.sql',
  },
};

const notes = `# Backup And Restore Drill Notes

- generated_at: ${metadata.generated_at}
- candidate_id: ${candidateId}
- source_environment: ${sourceEnvironment}
- restore_target: ${restoreTarget}
- scenario: ${scenario}
- operator: ${operator}

## Preconditions

- [ ] restore target is isolated from live traffic
- [ ] source backup / restore point reference is known
- [ ] candidate evidence directory is set
- [ ] validation seed rows chosen

## Source Reference

- backup / restore point id:
- provider job / snapshot reference:
- source timestamp:

## Seed Records

Record low-risk metadata rows here before restore:

- app row 1:
  - id:
  - slug:
  - visibility:
  - current_version:
- app row 2:
  - id:
  - slug:
  - visibility:
  - current_version:
- user_supabase_configs row:
  - id:
  - user_id:
  - name:
  - supabase_url:
- aggregate counts:
  - apps:
  - user_supabase_configs:
  - user_api_tokens:

## Timings

- restore started at:
- restore completed at:
- validation completed at:
- RTO (minutes):
- RPO (minutes):

## Validation Results

- [ ] seed rows restored correctly
- [ ] aggregate counts are plausible
- [ ] no schema errors blocked validation
- [ ] notes captured for any mismatch or operator issue

## Issues And Follow-Up

- issue 1:
- issue 2:

## Final Outcome

- outcome: pass / fail / partial
- release-scorecard impact:
- follow-up owner:
`;

const validationQueries = `-- Backup / restore validation queries
-- Replace placeholder values before running against the restored target.
-- Prefer metadata checks over secret-value inspection.

-- 1. Validate two representative app rows.
select id, slug, visibility, current_version
from public.apps
where id in ('<app-id-1>', '<app-id-2>')
order by id;

-- 2. Validate one saved Supabase config metadata row.
select id, user_id, name, supabase_url
from public.user_supabase_configs
where id = '<config-id>';

-- 3. Aggregate counts for key metadata tables.
select count(*) as apps_count from public.apps;
select count(*) as user_supabase_configs_count from public.user_supabase_configs;
select count(*) as user_api_tokens_count from public.user_api_tokens;

-- 4. Optional: validate the expected app slug set if ids are inconvenient.
-- select id, slug, visibility, current_version
-- from public.apps
-- where slug in ('<slug-1>', '<slug-2>')
-- order by slug;

-- 5. Optional: add any release-specific validation queries below.
`;

writeIfAllowed(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
writeIfAllowed(notesPath, notes);
writeIfAllowed(validationQueriesPath, validationQueries);
