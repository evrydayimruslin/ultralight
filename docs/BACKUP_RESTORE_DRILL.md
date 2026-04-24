# Backup And Restore Drill

Last reviewed: `2026-04-21`

This document defines the Wave 6 backup-and-restore drill for Ultralight.

The goal is not to prove that backups exist. The goal is to prove that a real
restore can be executed into a safe target, validated against known data, and
measured with real operator timings and notes.

## Purpose

This drill exists to close the launch gap currently tracked in
[docs/LAUNCH_SCORECARD.md](LAUNCH_SCORECARD.md):

- backups configured and tested

“Configured” is not enough. This drill is only successful when the team can
show:

- what source backup or restore point was used
- where it was restored
- how long restore took
- what records were validated
- what surprises or gaps appeared during the exercise

## Scope

This drill covers the launch-critical Supabase database layer.

It does not try to cover:

- runtime secret re-provisioning outside the restored database
- desktop updater recovery
- Cloudflare Worker rollback

Those belong to other Wave 6 tranches.

## Safe Target Policy

Never run this drill against live production traffic.

Use an isolated restore target, such as:

- a temporary Supabase project created only for the drill
- a dedicated non-production recovery project that is not serving user traffic

Do not restore into:

- the live production project
- the shared staging project that active testers depend on
- any project currently wired to desktop, web, or public API traffic

The restore target must be disposable.

## Evidence Location

Use the Wave 6 evidence tree and keep restore artifacts inside the same release
candidate directory when the drill is part of a release cycle.

Recommended path:

```text
docs/_generated/launch/<target>/<candidate-id>/restore-drill/
```

Initialize that directory with:

```bash
source ~/.nvm/nvm.sh && nvm use
node scripts/ops/init-backup-restore-drill.mjs \
  --source-environment production \
  --restore-target "<isolated-supabase-project-ref-or-name>" \
  --output-dir "$UL_LAUNCH_EVIDENCE_DIR/restore-drill"
```

That helper creates:

- `metadata.json`
- `notes.md`
- `validation-queries.sql`

These are the minimum drill artifacts.

## Required Inputs Before You Start

Record all of the following before restore begins:

- operator name or redacted operator id
- source environment being tested
- restore target identifier
- release candidate SHA or tag if the drill is tied to a release
- backup reference or restore-point reference from Supabase/provider tooling
- intended drill start time

If any of those are unknown, stop and fill them in first. A drill without an
identifiable source or target is not valid evidence.

## Seed Dataset Rules

Use low-risk metadata rows for restore validation. Do not use secrets as the
primary proof set.

Minimum recommended seed set:

1. Two `apps` rows.
   Record:
   - `id`
   - `slug`
   - `visibility`
   - `current_version`

2. One `user_supabase_configs` row.
   Record:
   - `id`
   - `user_id`
   - `name`
   - `supabase_url`

3. Aggregate counts for:
   - `apps`
   - `user_supabase_configs`
   - `user_api_tokens`

If a chosen table is empty in the source environment, pick another low-risk
table and record the substitution in `notes.md`.

## Suggested Validation Queries

The scaffolded `validation-queries.sql` file created by the helper script
includes placeholders for the recommended checks. Use it as the operator
worksheet and replace the placeholders before running the drill.

Guidance:

- validate exact seed rows by primary key
- validate at least a few aggregate counts
- avoid dumping or comparing encrypted secret values unless absolutely needed
- prefer metadata validation over sensitive payload inspection

## Drill Procedure

### 1. Prepare The Drill Packet

Run:

```bash
source ~/.nvm/nvm.sh && nvm use
node scripts/ops/init-backup-restore-drill.mjs \
  --source-environment production \
  --restore-target "<isolated-supabase-project-ref-or-name>" \
  --output-dir "$UL_LAUNCH_EVIDENCE_DIR/restore-drill"
```

Then fill in:

- `metadata.json`
- the seed records section in `notes.md`
- the placeholders in `validation-queries.sql`

### 2. Capture The Source Reference

Record the exact backup or restore-point reference supplied by the provider.

Examples:

- restore timestamp
- snapshot id
- provider job id

Do not proceed until this is written into the drill notes.

### 3. Start The Restore

Use the provider’s restore path to restore the chosen source point into the
isolated target.

Record in `notes.md`:

- restore start time
- restore completion time
- any provider-side warnings or manual operator steps

### 4. Validate The Restored Target

Run the completed `validation-queries.sql` against the restored target using
your normal operator path.

Success means:

- the chosen seed rows exist and match expected metadata
- the aggregate counts are plausible for the restored point-in-time
- there are no obvious schema or permission errors preventing the checks

If the restore target is safely exposable to a temporary internal API path, you
may also run limited application-level smoke, but that is optional. The base
drill requirement is database-level validation.

### 5. Record Timings

Capture:

- backup reference time
- restore start time
- restore completed time
- validation completed time

From that, record:

- `RTO`: time from restore start to validation completion
- `RPO`: distance between the chosen restore point and the intended protected
  state

If you cannot calculate one of these, write down exactly why.

### 6. Record Gaps And Recovery Notes

In `notes.md`, record:

- unclear provider steps
- missing permissions
- schema surprises
- data mismatches
- anything that would slow down a real incident response

The drill is allowed to find problems. It is not allowed to hide them.

## Success Criteria

The drill is successful only if all of the following are true:

- a real restore was started and completed into an isolated target
- the source restore reference is recorded
- the validation queries were executed against the restored target
- the chosen seed records and counts were checked
- RTO and RPO were recorded, or the reason they could not be measured is
  explicitly documented
- operator notes are complete enough that the next person could repeat the
  drill

## Failure Conditions

Treat the drill as failed if:

- the restore target is not actually isolated
- the source restore point cannot be identified
- validation queries were never run
- results exist only in terminal scrollback and were not captured into the
  drill packet
- the restore succeeded technically but the team still cannot say whether the
  restored data is usable

## Follow-Through

After the drill:

1. update the release packet or Wave 6 evidence directory with the drill
   artifact paths
2. update
   [docs/LAUNCH_SCORECARD.md](LAUNCH_SCORECARD.md)
   from repo-only evidence to drill-backed evidence
3. note any missing permissions, provider steps, or validation gaps for the
   rollback tranche to incorporate

## Relationship To Other Wave 6 Work

- `PR6.2` defines where these artifacts live
- `PR6.6` provides the drill kit and operator scaffold
- `PR6.7` will handle rollback rehearsal and recovery decision trees

This drill is the evidence foundation for saying backup/restore is more than a
hope.
