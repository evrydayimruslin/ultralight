# Wave 6 Operations, Testing, And Launch Gates Roadmap

Last reviewed: `2026-04-21`

Wave 6 is the proof wave. Waves 1 through 5 made the platform safer, more
coherent, and more credible inside the repo. Wave 6 is about whether the team
can promote a release with repeatable evidence, recover from mistakes, and know
exactly when to stop the line.

This is not a generic “run smoke later” bucket. It is the operational closeout
for launch.

## Why Wave 6 Exists

The repo already has real release machinery:

- CI verification in
  [`.github/workflows/api-ci.yml`](../.github/workflows/api-ci.yml),
  [`.github/workflows/desktop-build.yml`](../.github/workflows/desktop-build.yml),
  and
  [`.github/workflows/launch-guardrails.yml`](../.github/workflows/launch-guardrails.yml)
- staging and production deploy workflows for the API and database in
  [`.github/workflows/api-deploy.yml`](../.github/workflows/api-deploy.yml),
  [`.github/workflows/supabase-db.yml`](../.github/workflows/supabase-db.yml),
  and
  [`.github/workflows/supabase-production-db.yml`](../.github/workflows/supabase-production-db.yml)
- signed desktop build and release workflows in
  [`.github/workflows/desktop-build.yml`](../.github/workflows/desktop-build.yml)
  and
  [`.github/workflows/desktop-release.yml`](../.github/workflows/desktop-release.yml)
- smoke scripts and checklists in
  [scripts/smoke-test.sh](../scripts/smoke-test.sh),
  [scripts/smoke/auth-redirect-smoke.sh](../scripts/smoke/auth-redirect-smoke.sh),
  and
  [docs/SMOKE_CHECKLISTS.md](SMOKE_CHECKLISTS.md)
- a release playbook in
  [docs/RELEASE_RUNBOOK.md](RELEASE_RUNBOOK.md)

That is a strong starting point, but the launch score is still blocked by
operational gaps:

- [docs/LAUNCH_SCORECARD.md](LAUNCH_SCORECARD.md)
  still says `Not ready`
- backup and restore is still `Unresolved`
- rollback guidance exists, but it is procedural and not rehearsed
- smoke exists, but evidence capture is still manual and ad hoc
- production promotion still depends on operator discipline more than explicit
  release gates
- staging desktop/runtime still shares production Cloudflare R2/KV bindings as
  an intentional interim exception, documented in
  [docs/DESKTOP_RELEASE_PIPELINE.md](DESKTOP_RELEASE_PIPELINE.md)

Wave 6 exists to turn those gaps into explicit, reviewable work instead of
tribal knowledge.

## Current Starting Point

| Surface | Current evidence | Gap Wave 6 must close |
| --- | --- | --- |
| API verification | `API CI` runs contract generation, guardrails, unused-code, dependency-cycle, typecheck, tests, and dry-run deploys | release promotion still depends on humans correlating separate workflow results |
| Database deploys | staging and production Supabase workflows are split correctly | there is still no tested restore drill or recovery evidence path |
| Desktop release | signed staging and production workflows exist and enforce version matching | staging runtime still shares production R2/KV, and updater/release evidence is not bundled into one launch packet |
| Smoke checks | auth redirect smoke, API smoke, and documented desktop/manual smoke exist | outputs are not captured in a standard evidence bundle, and stop-ship results still rely on operator memory |
| Runbooks | release flow, alias retirement, token audit, secret audit, and manifest/Supabase audits are documented | rollback and restore are still “read this and do the right thing,” not rehearsed operational motions |
| Launch scorecard | scorecard maps repo evidence to checklist items | it is still a snapshot, not the terminal signoff artifact for a given release candidate |

## Wave 6 Outcomes

- Every release candidate produces a consistent evidence bundle instead of
  scattered console output and screenshots.
- Staging-before-production becomes a concrete release gate, not just a norm.
- Restore and rollback procedures are documented in executable detail and
  rehearsed.
- All intentional staging/production resource sharing is either removed or
  explicitly recorded as a signed exception.
- Final launch signoff depends on evidence, not confidence.

## Non-Goals

Wave 6 does not:

- reopen Wave 1 through Wave 5 implementation work except where a release gate
  must reference it
- replace managed provider tooling with a bespoke deployment platform
- require full desktop/browser E2E automation before launch
- promise automated database rollback where the platform model is fundamentally
  additive/fix-forward
- treat every operational unknown as a code problem if the right answer is an
  explicit manual control with evidence

## Exit Criteria

Wave 6 is complete when all of the following are true:

- the release topology, environments, and promotion chain are documented in one
  place
- release evidence has a standard output location, naming convention, and
  required artifact list
- staging smoke can be run through one wrapper that captures machine-readable
  and human-readable evidence
- production release flow has an explicit gate that references required staging
  verification
- backup and restore has been drilled and documented with real timing and
  operator notes
- API, DB, and desktop rollback guidance has been rehearsed and reduced to a
  concrete operator sequence
- every intentional shared staging/production resource is listed with an owner,
  reason, and removal plan
- the launch scorecard is updated from release evidence, not just repo state
- the end-of-wave manual bundle is the only remaining human work

## Dependencies And Preconditions

- Waves 1 through 5 should remain the current local source of truth for auth,
  guardrails, platform architecture, compatibility cleanup, and product-facing
  behavior.
- The canonical release path remains:
  - API from
    [api/src/worker-entry.ts](../api/src/worker-entry.ts)
  - schema from
    [supabase/migrations](../supabase/migrations)
  - desktop builds from
    [docs/DESKTOP_RELEASE_PIPELINE.md](DESKTOP_RELEASE_PIPELINE.md)
- GitHub `staging` and `production` environments must continue to own their
  deploy secrets.
- Wave 4 audit scripts are already available and should be reused rather than
  rewritten:
  - [scripts/supabase/audit-app-supabase-configs.mjs](../scripts/supabase/audit-app-supabase-configs.mjs)
  - [scripts/apps/audit-app-manifest-coverage.mjs](../scripts/apps/audit-app-manifest-coverage.mjs)
  - [scripts/tokens/audit-api-token-compat.mjs](../scripts/tokens/audit-api-token-compat.mjs)
  - [scripts/secrets/audit-secret-crypto-compat.mjs](../scripts/secrets/audit-secret-crypto-compat.mjs)

## Manual Work Stays At The End

Wave 6 should keep the repo work and the operator work separate.

The code/docs/workflow PRs in this roadmap should land first. The real staging
drill, restore drill, rollback rehearsal, and production signoff should happen
only after the repo gives operators one coherent flow to run.

## Recommended Landing Order

1. `PR6.1` release topology and environment inventory
2. `PR6.2` launch evidence registry and artifact conventions
3. `PR6.3` smoke wrapper and artifact capture
4. `PR6.4` staging launch-gate workflow
5. `PR6.5` production promotion gate
6. `PR6.6` backup and restore drill kit
7. `PR6.7` rollback rehearsal kit
8. `PR6.8` environment isolation and shared-resource exceptions
9. `PR6.9` operator release packet and decision checklist
10. `PR6.10` scorecard closeout and launch signoff policy

Why this order:

- `PR6.1` and `PR6.2` define the system and the evidence we expect from it.
- `PR6.3` through `PR6.5` make the existing release path more enforceable
  before we ask humans to rehearse harder failure cases.
- `PR6.6` and `PR6.7` then turn restore and rollback into bounded exercises.
- `PR6.8` captures the last architecture-level operational exceptions after the
  rest of the release path is explicit.
- `PR6.9` and `PR6.10` close the loop by making signoff an evidence-backed
  decision rather than a loose checklist.

## Detailed PR Roadmap

### PR6.1 Release Topology And Environment Inventory

Status: `implemented locally`

Purpose:

- create one canonical map of how a release moves from pull request to staging
  to production across API, DB, and desktop

Expected files:

- [docs/RELEASE_TOPOLOGY.md](RELEASE_TOPOLOGY.md)
- [docs/RELEASE_RUNBOOK.md](RELEASE_RUNBOOK.md)
- [docs/DESKTOP_RELEASE_PIPELINE.md](DESKTOP_RELEASE_PIPELINE.md)

Acceptance:

- every release-relevant workflow is mapped with:
  - trigger
  - target environment
  - required secrets/environment
  - produced artifact
  - promotion dependency
- the canonical staging-to-production chain is explicit for:
  - API
  - database
  - desktop
- intentional cross-environment exceptions are called out directly rather than
  buried in prose

Verification:

- doc review against:
  - [`.github/workflows/api-ci.yml`](../.github/workflows/api-ci.yml)
  - [`.github/workflows/api-deploy.yml`](../.github/workflows/api-deploy.yml)
  - [`.github/workflows/supabase-db.yml`](../.github/workflows/supabase-db.yml)
  - [`.github/workflows/supabase-production-db.yml`](../.github/workflows/supabase-production-db.yml)
  - [`.github/workflows/desktop-build.yml`](../.github/workflows/desktop-build.yml)
  - [`.github/workflows/desktop-release.yml`](../.github/workflows/desktop-release.yml)

Risks:

- this can become a passive architecture note unless it is kept concrete and
  release-operator friendly

Implementation tasks:

1. map every release workflow into one promotion diagram or table
2. list every staging and production hostname, provider surface, and
   environment boundary
3. highlight any resource or secret that is shared intentionally between
   staging and production
4. make the topology doc the reference target from the runbook

Implemented in this tranche:

- added
  [docs/RELEASE_TOPOLOGY.md](RELEASE_TOPOLOGY.md)
  as the canonical release-topology source of truth, with:
  - a PR-to-staging-to-production promotion diagram
  - a release-critical workflow inventory
  - a staging/production environment matrix
  - a non-standard-surface section for the secondary data worker and direct
    Worker fallback origin
  - an explicit shared-resource exception table for the current R2/KV coupling
- updated
  [docs/RELEASE_RUNBOOK.md](RELEASE_RUNBOOK.md)
  to point operators at the topology doc first and to reference the topology as
  the home for shared-resource exceptions
- updated
  [docs/DESKTOP_RELEASE_PIPELINE.md](DESKTOP_RELEASE_PIPELINE.md)
  so the desktop release slice explicitly points back to the full release
  topology and keeps the shared R2/KV staging exception visible

### PR6.2 Launch Evidence Registry And Artifact Conventions

Status: `implemented locally`

Purpose:

- standardize what evidence a release candidate must produce and where it
  should live

Expected files:

- [docs/LAUNCH_EVIDENCE_REGISTRY.md](LAUNCH_EVIDENCE_REGISTRY.md)
- [docs/_generated/README.md](_generated/README.md)
- [docs/RELEASE_RUNBOOK.md](RELEASE_RUNBOOK.md)

Acceptance:

- a release candidate has a defined artifact set for:
  - guardrails
  - API smoke
  - auth redirect smoke
  - CORS checks
  - audit JSON outputs
  - staging workflow run URLs
  - production workflow run URLs
  - manual smoke notes/screenshots
- the docs say which artifacts can be committed, which should stay local, and
  which must be redacted
- output naming is deterministic by date, SHA, and version/tag

Verification:

- doc review plus a sample local artifact directory generated from a dry run

Risks:

- careless evidence capture can leak tokens, cookies, or personally identifying
  data if redaction rules are not explicit

Implementation tasks:

1. define a `docs/_generated/launch/` layout or equivalent local artifact
   convention
2. specify which audit scripts already write JSON there
3. document redaction rules for bearer tokens, share secrets, auth cookies, and
   user email addresses
4. add examples of a “good” evidence packet for staging and production

Implemented in this tranche:

- added
  [docs/LAUNCH_EVIDENCE_REGISTRY.md](LAUNCH_EVIDENCE_REGISTRY.md)
  as the canonical evidence policy, including:
  - local output layout for staging and production candidates
  - required artifact sets
  - metadata and workflow-link conventions
  - redaction and commit-safety rules
  - mapping of the existing Wave 4 audit scripts into the shared evidence tree
- added
  [docs/_generated/README.md](_generated/README.md)
  and
  [docs/_generated/.gitignore](_generated/.gitignore)
  so the repo has a safe default for generated release artifacts
- updated
  [docs/RELEASE_RUNBOOK.md](RELEASE_RUNBOOK.md)
  to:
  - reference the evidence registry directly
  - define `UL_LAUNCH_EVIDENCE_DIR` before audit collection
  - write the existing audit commands into candidate-scoped `audits/`
    directories instead of the old flat `docs/_generated/*.json` paths

### PR6.3 Smoke Wrapper And Artifact Capture

Status: `implemented locally`

Purpose:

- turn the current release smoke from separate commands into one operator entry
  point that captures artifacts and stop-ship failures

Expected files:

- [scripts/smoke/run-release-smoke.mjs](../scripts/smoke/run-release-smoke.mjs)
- [scripts/smoke-test.sh](../scripts/smoke-test.sh)
- [scripts/smoke/auth-redirect-smoke.sh](../scripts/smoke/auth-redirect-smoke.sh)
- [docs/SMOKE_CHECKLISTS.md](SMOKE_CHECKLISTS.md)

Acceptance:

- one wrapper can run:
  - launch guardrails
  - auth redirect smoke
  - broader API smoke
  - allowed/disallowed CORS probes
- outputs are written to the evidence location from `PR6.2`
- the wrapper supports at least `staging` and `production` targets
- failures are summarized clearly enough that an operator can treat them as
  stop-ship without reading raw logs first

Verification:

- local dry run with fake or omitted secrets to confirm fail-fast behavior
- local run against a real environment once Wave 6 manual closeout begins

Risks:

- it is easy to over-automate the manual desktop portion; this PR should only
  wrap the command-line smoke, not pretend desktop UI smoke is fully automated

Implementation tasks:

1. build a wrapper that shells out to the current smoke scripts instead of
   reimplementing their logic
2. capture stdout, stderr, exit code, and timestamps per step
3. emit a compact summary JSON and a human-readable markdown log
4. keep sensitive env vars out of written artifacts

Implemented in this tranche:

- added
  [scripts/smoke/run-release-smoke.mjs](../scripts/smoke/run-release-smoke.mjs)
  as the Wave 6 smoke wrapper that:
  - shells out to the existing launch guardrails, auth redirect smoke, and API
    smoke commands
  - runs allowed/disallowed CORS probes directly
  - writes candidate-scoped logs into the evidence tree
  - generates `smoke/summary.json` and `smoke/summary.md`
  - creates `metadata.json` and a stub `workflow-runs.md` if they do not
    already exist
  - redacts bearer tokens from recorded command lines
- updated
  [docs/SMOKE_CHECKLISTS.md](SMOKE_CHECKLISTS.md)
  so the wrapper is now the recommended automated entry point for staging and
  production smoke, while keeping the manual desktop steps explicit
- updated
  [docs/RELEASE_RUNBOOK.md](RELEASE_RUNBOOK.md)
  to point staging and production release operators at the new wrapper command

### PR6.4 Staging Launch-Gate Workflow

Status: `implemented locally`

Purpose:

- aggregate the existing staging-ready checks into one explicit launch gate for
  `main`

Expected files:

- [`.github/workflows/launch-gate-staging.yml`](../.github/workflows/launch-gate-staging.yml)
- [docs/RELEASE_RUNBOOK.md](RELEASE_RUNBOOK.md)
- [docs/SMOKE_CHECKLISTS.md](SMOKE_CHECKLISTS.md)

Acceptance:

- there is a single named staging gate that depends on or references:
  - `API CI`
  - `Launch Guardrails`
  - `Supabase DB` validation/deploy
  - `API Deploy` staging
  - `Desktop Build`
- the workflow makes it obvious which SHA is the current staging candidate
- the release runbook can point operators to one gating workflow instead of a
  list they must reconstruct manually

Verification:

- workflow lint/review
- trial run on a `main` push or manual dispatch

Risks:

- GitHub Actions fan-in can get brittle if this workflow tries to duplicate too
  much existing logic; it should orchestrate and report, not replace working
  jobs

Implementation tasks:

1. decide whether the gate is a dedicated workflow or a lightweight aggregator
   job in an existing workflow
2. include direct links or metadata for the relevant workflow runs
3. make the staging gate the runbook reference before any tag is created

Implemented in this tranche:

- added
  [`.github/workflows/launch-gate-staging.yml`](../.github/workflows/launch-gate-staging.yml)
  as a dedicated staging-gate workflow for `main` pushes and manual dispatch
- added
  [scripts/release/check-staging-launch-gate.mjs](../scripts/release/check-staging-launch-gate.mjs)
  to:
  - determine which release-critical workflows are expected from the candidate
    file set
  - poll GitHub Actions for the candidate SHA on `main`
  - fail if required workflows fail or never complete in time
  - emit a SHA-scoped JSON and markdown summary with run links
- updated
  [docs/RELEASE_TOPOLOGY.md](RELEASE_TOPOLOGY.md)
  to include the staging gate as a release-critical workflow
- updated
  [docs/RELEASE_RUNBOOK.md](RELEASE_RUNBOOK.md)
  so operators explicitly wait for `Staging Launch Gate` before treating `main`
  as the current staging candidate

### PR6.5 Production Promotion Gate

Status: `implemented locally`

Purpose:

- make production promotion reference a reviewed staging candidate instead of
  relying on “we already checked main”

Expected files:

- [`.github/workflows/launch-gate-production.yml`](../.github/workflows/launch-gate-production.yml)
- [`.github/workflows/api-deploy.yml`](../.github/workflows/api-deploy.yml)
- [`.github/workflows/desktop-release.yml`](../.github/workflows/desktop-release.yml)
- [docs/RELEASE_RUNBOOK.md](RELEASE_RUNBOOK.md)

Acceptance:

- production release docs point at one staging candidate SHA or tag
- the production gate requires evidence from staging smoke before launch is
  considered complete
- the gate makes it clear which production workflows must succeed before
  announcement

Verification:

- workflow dry review on a sample tag
- runbook walkthrough using a mock release candidate

Risks:

- the tag-driven release model should stay simple; this PR should tighten
  operator decisions without making production tagging impossible to use

Implementation tasks:

1. define the minimum production evidence set:
   - staging gate green
   - staging smoke packet present
   - version alignment confirmed
2. link production workflow outputs back into the evidence packet
3. make “announce release” conditional on the documented production gate

Implemented in this tranche:

- added
  [`.github/workflows/launch-gate-production.yml`](../.github/workflows/launch-gate-production.yml)
  as the tag-driven production gate and manual recheck entry point
- added
  [scripts/release/check-production-launch-gate.mjs](../scripts/release/check-production-launch-gate.mjs)
  to:
  - resolve the tagged commit SHA
  - require that the same SHA already passed `Staging Launch Gate`
  - poll `Supabase Production DB`, `API Deploy`, and `Desktop Release`
  - emit a tag-scoped JSON and markdown summary with run links
- updated
  [docs/RELEASE_TOPOLOGY.md](RELEASE_TOPOLOGY.md)
  so `Production Launch Gate` is part of the release-critical workflow map and
  production closeout criteria
- updated
  [docs/RELEASE_RUNBOOK.md](RELEASE_RUNBOOK.md)
  so operators explicitly wait for `Production Launch Gate` and use its summary
  as the cross-check between staging-candidate review and tag-triggered
  production workflows

### PR6.6 Backup And Restore Drill Kit

Status: `implemented locally`

Purpose:

- turn backup/restore from an unresolved scorecard item into a documented drill
  with measurable results

Expected files:

- [docs/BACKUP_RESTORE_DRILL.md](BACKUP_RESTORE_DRILL.md)
- [docs/RELEASE_RUNBOOK.md](RELEASE_RUNBOOK.md)
- optional helper scripts under
  [scripts/ops/](../scripts/ops)

Acceptance:

- the drill defines:
  - scope
  - owner
  - environment
  - preconditions
  - seed/check data
  - restore target
  - validation queries/checks
  - artifact outputs
  - RTO/RPO fields
- the runbook points at the drill rather than vague Supabase restore caution
- the scorecard can move “Backups configured and tested” based on real evidence

Verification:

- tabletop walkthrough before the real drill
- real staging drill during end-of-wave closeout

Risks:

- it is easy to write a backup drill that proves backups exist but not that a
  usable restore works; the validation steps must check application reality, not
  just provider success

Implementation tasks:

1. define a restore target that is safe and isolated from live production data
2. define a small seed dataset or known records to verify post-restore
3. specify evidence outputs and redaction rules
4. update the scorecard wording to reference the drill artifact rather than a
   generic assumption

Implemented in this tranche:

- added
  [docs/BACKUP_RESTORE_DRILL.md](BACKUP_RESTORE_DRILL.md)
  as the canonical drill procedure, including:
  - safe target policy
  - required inputs
  - seed dataset rules
  - validation expectations
  - RTO / RPO capture requirements
  - success and failure conditions
- added
  [scripts/ops/init-backup-restore-drill.mjs](../scripts/ops/init-backup-restore-drill.mjs)
  to scaffold a restore-drill packet inside the Wave 6 evidence tree with:
  - `metadata.json`
  - `notes.md`
  - `validation-queries.sql`
- updated
  [docs/LAUNCH_EVIDENCE_REGISTRY.md](LAUNCH_EVIDENCE_REGISTRY.md)
  so restore-drill artifacts have a concrete place in the evidence layout
- updated
  [docs/RELEASE_RUNBOOK.md](RELEASE_RUNBOOK.md)
  so operators now initialize and run the drill through the documented kit
- updated
  [docs/LAUNCH_SCORECARD.md](LAUNCH_SCORECARD.md)
  from `Unresolved` to `Partial`, because the drill is now documented and
  scaffolded locally even though real restore evidence is still pending

### PR6.7 Rollback Rehearsal Kit

Status: `implemented locally`

Purpose:

- reduce “rollback” from a concept into concrete operator actions for API,
  desktop, and database incidents

Expected files:

- [docs/ROLLBACK_REHEARSAL.md](ROLLBACK_REHEARSAL.md)
- [docs/RELEASE_RUNBOOK.md](RELEASE_RUNBOOK.md)
- [docs/DESKTOP_RELEASE_PIPELINE.md](DESKTOP_RELEASE_PIPELINE.md)

Acceptance:

- rollback guidance is split by incident type:
  - bad staging deploy
  - bad production API deploy
  - bad production DB migration
  - bad desktop release/update
- each path includes:
  - trigger condition
  - first safe action
  - communication point
  - preferred recovery path
  - “do not do this” cautions
- rehearsal notes have a place to record actual timings and surprises

Verification:

- tabletop walkthrough before real rehearsal
- end-of-wave rehearsal notes captured into the evidence packet

Risks:

- because the platform is intentionally fix-forward for many cases, a fake
  rollback promise would be worse than an honest recovery playbook

Implementation tasks:

1. separate “rollback” from “fix forward” explicitly
2. document desktop updater-specific recovery options
3. document DB migration incidents as manual recovery events when appropriate
4. make the operator decision tree terse enough for release-day use

Implemented in this tranche:

- added
  [docs/ROLLBACK_REHEARSAL.md](ROLLBACK_REHEARSAL.md)
  as the canonical recovery and rehearsal kit, with:
  - explicit definitions for fix-forward, rollback, and manual recovery
  - scenario playbooks for:
    - bad staging deploy
    - bad production API deploy
    - bad production DB migration
    - bad desktop release or updater
  - a recovery matrix with trigger, first safe action, communication point,
    preferred recovery path, and do-not-do warnings
- added
  [scripts/ops/init-rollback-rehearsal.mjs](../scripts/ops/init-rollback-rehearsal.mjs)
  to scaffold a rollback-rehearsal packet inside the Wave 6 evidence tree with:
  - `metadata.json`
  - `notes.md`
- updated
  [docs/LAUNCH_EVIDENCE_REGISTRY.md](LAUNCH_EVIDENCE_REGISTRY.md)
  so rollback-rehearsal artifacts have a concrete home beside restore-drill
  artifacts
- updated
  [docs/RELEASE_RUNBOOK.md](RELEASE_RUNBOOK.md)
  so the rollback section now points at the rehearsal kit and initializes a
  rehearsal packet
- updated
  [docs/DESKTOP_RELEASE_PIPELINE.md](DESKTOP_RELEASE_PIPELINE.md)
  with explicit desktop recovery notes for signed releases and updater issues
- updated
  [docs/LAUNCH_SCORECARD.md](LAUNCH_SCORECARD.md)
  so the rollback item reflects that a documented rehearsal kit now exists
  locally, even though the real tabletop evidence is still pending

### PR6.8 Environment Isolation And Shared-Resource Exceptions

Status: `implemented locally`

Purpose:

- make the remaining staging/production coupling explicit and time-bounded

Expected files:

- [docs/ENVIRONMENT_ISOLATION_MATRIX.md](ENVIRONMENT_ISOLATION_MATRIX.md)
- [docs/DESKTOP_RELEASE_PIPELINE.md](DESKTOP_RELEASE_PIPELINE.md)
- [docs/RELEASE_TOPOLOGY.md](RELEASE_TOPOLOGY.md)
- possibly workflow/config docs that mention shared bindings

Acceptance:

- every environment-bound dependency is listed:
  - API hostnames
  - Supabase projects
  - Cloudflare Worker envs
  - R2 buckets
  - KV namespaces
  - desktop channels
  - updater endpoint
- each shared resource has:
  - current owner
  - reason it is shared
  - risk description
  - target removal wave/date
- no intentional sharing remains undocumented

Verification:

- doc review against workflow env names and provider configs

Risks:

- this can expose uncomfortable interim architecture, but that is the point;
  hidden coupling is worse than documented coupling

Implementation tasks:

1. inventory all launch-relevant backing resources by environment
2. mark which ones are actually isolated today
3. call out the documented staging desktop R2/KV exception directly
4. decide which shared resources are acceptable launch exceptions and which are
   still stop-ship

Implemented in this tranche:

- added
  [docs/ENVIRONMENT_ISOLATION_MATRIX.md](ENVIRONMENT_ISOLATION_MATRIX.md)
  as the canonical release-side isolation inventory, with:
  - a control-plane and client-surface matrix
  - a data-plane matrix for R2, KV, and desktop staging coupling
  - a shared-resource exception register with owner, risk, guardrail, removal
    target, and launch disposition
  - explicit production-only and diagnostic exceptions for the secondary data
    worker and direct Worker fallback origin
  - concrete release decision rules for acceptable exceptions versus stop-ship
    candidates
- updated
  [docs/RELEASE_TOPOLOGY.md](RELEASE_TOPOLOGY.md)
  so the topology doc now points to the canonical isolation matrix for owner,
  risk, and removal details rather than carrying that nuance only in prose
- updated
  [docs/DESKTOP_RELEASE_PIPELINE.md](DESKTOP_RELEASE_PIPELINE.md)
  so the existing staging desktop R2/KV caveat now points at the canonical
  isolation matrix
- updated
  [docs/RELEASE_RUNBOOK.md](RELEASE_RUNBOOK.md)
  so operators are told when to consult the matrix during release work
- updated
  [docs/LAUNCH_SCORECARD.md](LAUNCH_SCORECARD.md)
  so the scorecard points at the new operational evidence source for
  staging/production coupling

### PR6.9 Operator Release Packet And Decision Checklist

Status: `implemented locally`

Purpose:

- consolidate operator-facing release work into one packet instead of asking
  people to remember half a dozen docs

Expected files:

- [docs/RELEASE_PACKET_TEMPLATE.md](RELEASE_PACKET_TEMPLATE.md)
- [docs/RELEASE_RUNBOOK.md](RELEASE_RUNBOOK.md)
- [docs/SMOKE_CHECKLISTS.md](SMOKE_CHECKLISTS.md)

Acceptance:

- there is one operator packet template with:
  - candidate SHA/tag
  - workflow links
  - evidence artifact paths
  - audit outputs
  - staging smoke result
  - production smoke result
  - rollback owner/contact
  - go/no-go decision
- the packet clearly separates:
  - automated proof
  - manual checks
  - unresolved exceptions

Verification:

- fill out the template once using a mock or dry-run candidate

Risks:

- too much prose makes the packet unusable; it should be a concise release-day
  document, not another long handbook

Implementation tasks:

1. define the minimum fields for a go/no-go decision
2. reference existing audit outputs instead of duplicating them
3. make operator ownership and signoff explicit

Implemented in this tranche:

- added
  [docs/RELEASE_PACKET_TEMPLATE.md](RELEASE_PACKET_TEMPLATE.md)
  as the canonical operator packet template, with:
  - candidate identity
  - decision summary
  - workflow / gate links
  - smoke artifact references
  - audit output references
  - manual check capture
  - unresolved exception capture
  - final go / no-go checklist
- added
  [scripts/ops/init-release-packet.mjs](../scripts/ops/init-release-packet.mjs)
  to scaffold `release-packet.md` directly into the current evidence
  directory, keeping the packet as a real artifact rather than a copy-paste
  exercise
- updated
  [docs/LAUNCH_EVIDENCE_REGISTRY.md](LAUNCH_EVIDENCE_REGISTRY.md)
  so `release-packet.md` is now part of the canonical evidence layout and
  required artifact set
- updated
  [docs/RELEASE_RUNBOOK.md](RELEASE_RUNBOOK.md)
  so operators initialize the packet early and treat it as the running release
  decision document
- updated
  [docs/SMOKE_CHECKLISTS.md](SMOKE_CHECKLISTS.md)
  so staging and production smoke explicitly feed the packet instead of living
  only in standalone logs

### PR6.10 Scorecard Closeout And Launch Signoff Policy

Status: `implemented locally`

Purpose:

- turn the scorecard into the final launch decision artifact rather than a
  static audit memo

Expected files:

- [docs/LAUNCH_SCORECARD.md](LAUNCH_SCORECARD.md)
- [docs/LAUNCH_SIGNOFF_POLICY.md](LAUNCH_SIGNOFF_POLICY.md)
- [docs/RELEASE_PACKET_TEMPLATE.md](RELEASE_PACKET_TEMPLATE.md)

Acceptance:

- the scorecard distinguishes:
  - repo-backed pass/fail items
  - operationally verified items
  - explicit launch exceptions
- launch signoff policy defines:
  - who can approve
  - what evidence is required
  - what counts as stop-ship
  - what can ship with an exception
- “Not ready” can only be lifted with referenced evidence, not a doc edit alone

Verification:

- walk through the signoff policy against a real release packet

Risks:

- if the policy is too soft, it adds ceremony without protection; if it is too
  rigid, the team will route around it

Implementation tasks:

1. split checklist items into repo-only, operational, and explicit-exception
   classes
2. tie each operational item to a concrete artifact or runbook exercise
3. make signoff failure paths as clear as signoff success paths

Implemented in this tranche:

- added
  [docs/LAUNCH_SIGNOFF_POLICY.md](LAUNCH_SIGNOFF_POLICY.md)
  as the canonical evidence-first approval policy, including:
  - signoff inputs
  - verification classes
  - role-based approvals
  - stop-ship conditions
  - allowed conditional-release rules
  - the explicit sequence required to lift `Not ready`
- updated
  [docs/LAUNCH_SCORECARD.md](LAUNCH_SCORECARD.md)
  so every checklist row now identifies whether it is `Repo-backed` or
  `Operational`, and the scorecard now carries an explicit `Active Launch
  Exceptions` section tied to the isolation matrix
- updated
  [docs/RELEASE_PACKET_TEMPLATE.md](RELEASE_PACKET_TEMPLATE.md)
  and
  [scripts/ops/init-release-packet.mjs](../scripts/ops/init-release-packet.mjs)
  so the release packet now includes scorecard review and policy-satisfaction
  sections instead of treating signoff as an implied final checkbox
- updated
  [docs/RELEASE_RUNBOOK.md](RELEASE_RUNBOOK.md)
  so the final production release step now points at the launch signoff policy

## End-Of-Wave Manual Closeout

These are the tasks intentionally deferred until the repo-side Wave 6 work is
landed.

1. Run the staging evidence pass.
   - run the release smoke wrapper against staging
   - complete the staging desktop manual smoke
   - attach workflow URLs and artifact paths to the release packet

2. Run the backup and restore drill.
   - execute the documented drill in a safe target environment
   - record RTO, validation results, and operator notes
   - update the scorecard from the actual drill evidence

3. Run the rollback rehearsal.
   - walk through API, DB, and desktop bad-release scenarios
   - record where the runbook was unclear or missing steps
   - update the docs and release packet if the rehearsal exposes gaps

4. Review environment exceptions.
   - confirm each shared staging/production resource is acceptable for launch
   - open explicit follow-up work for any accepted temporary exception

5. Run the production evidence pass on the chosen release.
   - push the release tag
   - collect workflow evidence
   - run production smoke
   - attach results to the release packet

6. Perform final signoff.
   - update
     [docs/LAUNCH_SCORECARD.md](LAUNCH_SCORECARD.md)
     from the release evidence
   - record the go/no-go outcome using the launch signoff policy

## What “Done” Looks Like

Wave 6 is not done when the docs merely exist. It is done when the team can
answer all of these questions quickly and with artifacts:

- What exact SHA is staged?
- What exact evidence says it is safe to tag?
- What breaks if staging and production diverge?
- How do we restore if a migration goes wrong?
- How do we recover if the desktop release is bad?
- Which unresolved exceptions are we knowingly accepting for launch?

If those answers still depend on memory, Slack, or “I think we checked that,”
Wave 6 is not done yet.
