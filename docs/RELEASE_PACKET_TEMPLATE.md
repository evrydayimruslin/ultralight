# Release Packet Template

Last reviewed: `2026-04-21`

This template is the operator-facing release packet for a single candidate.

It is intentionally short. The packet should summarize the release decision and
link to evidence. It should not duplicate every smoke log, audit JSON file, or
workflow detail already captured elsewhere.

The canonical local location for a filled packet is:

```text
docs/_generated/launch/<target>/<candidate-id>/release-packet.md
```

Use
[docs/LAUNCH_EVIDENCE_REGISTRY.md](LAUNCH_EVIDENCE_REGISTRY.md)
for artifact conventions and
[docs/RELEASE_RUNBOOK.md](RELEASE_RUNBOOK.md)
for the actual promotion procedure.

## What The Packet Must Contain

Every filled packet must include:

- candidate SHA and target or tag
- links to the required workflow runs and launch gates
- paths to the local smoke and audit artifacts
- manual smoke outcomes
- unresolved exceptions or explicit launch exceptions
- rollback owner and communication owner
- final go/no-go decision

The packet must clearly separate:

- `Automated proof`
- `Manual checks`
- `Unresolved exceptions`

## Recommended Packet Shape

Use this structure verbatim or keep it very close:

```md
# Release Packet

- target:
- candidate_id:
- commit_sha:
- git_ref:
- version_tag:
- prepared_at:
- prepared_by:

## Decision Summary

- decision: go / no-go / conditional
- release lead:
- rollback owner:
- communications owner:
- stop-ship items present: yes / no
- release summary:

## Candidate Identity

| Field | Value |
| --- | --- |
| Target | |
| Candidate ID | |
| Commit SHA | |
| Git ref | |
| Version tag | |
| Evidence root | |
| Metadata file | `metadata.json` |

## Automated Proof

### Required workflow runs

| Workflow | Status | URL | Notes |
| --- | --- | --- | --- |
| API CI | | | |
| Launch Guardrails | | | |
| Supabase DB / Supabase Production DB | | | |
| API Deploy | | | |
| Desktop Build / Desktop Release | | | |
| Staging Launch Gate / Production Launch Gate | | | |

### Smoke artifacts

| Artifact | Path | Result | Notes |
| --- | --- | --- | --- |
| Guardrails | `smoke/guardrails.txt` | | |
| Auth redirect smoke | `smoke/auth-redirect.log` | | |
| API smoke | `smoke/api-smoke.log` | | |
| CORS allowed probe | `smoke/cors-allowed.*` | | |
| CORS blocked probe | `smoke/cors-blocked.*` | | |
| Smoke summary | `smoke/summary.md` | | |

### Audit outputs

List only the audits relevant to this candidate.

| Audit | Path | Result | Notes |
| --- | --- | --- | --- |
| Supabase config audit | `audits/supabase-audit.json` | | |
| Manifest coverage audit | `audits/manifest-coverage-audit.json` | | |
| Token compatibility audit | `audits/token-compat-audit.json` | | |
| Secret crypto audit | `audits/secret-crypto-audit.json` | | |

## Manual Checks

### Desktop and product checks

| Check | Result | Evidence | Notes |
| --- | --- | --- | --- |
| Desktop sign-in | | `manual/desktop-smoke-notes.md` | |
| First chat / core flow | | `manual/desktop-smoke-notes.md` | |
| Sign out | | `manual/desktop-smoke-notes.md` | |
| Embedded dashboard / widget flow | | `manual/desktop-smoke-notes.md` | |
| Shared-page / share-link flow | | `manual/desktop-smoke-notes.md` | |
| Updater smoke, if applicable | | `manual/desktop-smoke-notes.md` | |

### Recovery evidence

| Exercise | Result | Evidence | Notes |
| --- | --- | --- | --- |
| Backup / restore drill | | `restore-drill/notes.md` | |
| Rollback rehearsal | | `rollback-rehearsal/notes.md` | |

## Unresolved Exceptions

List only what is still relevant to this candidate.

| Exception | Class | Evidence | Decision |
| --- | --- | --- | --- |
| Shared R2 object store | launch exception | `docs/ENVIRONMENT_ISOLATION_MATRIX.md` | |
| Shared KV cache/index | launch exception | `docs/ENVIRONMENT_ISOLATION_MATRIX.md` | |
| Production-only secondary worker, if touched | explicit exception or stop-ship | `docs/ENVIRONMENT_ISOLATION_MATRIX.md` | |

## Scorecard Review

| Class | Result | Evidence | Notes |
| --- | --- | --- | --- |
| Repo-backed items reviewed | | `docs/LAUNCH_SCORECARD.md` | |
| Operational items backed by candidate evidence | | `docs/LAUNCH_SCORECARD.md` + local packet artifacts | |
| Launch exceptions explicitly accepted or cleared | | `docs/LAUNCH_SCORECARD.md` + `docs/ENVIRONMENT_ISOLATION_MATRIX.md` | |
| Signoff policy satisfied | | `docs/LAUNCH_SIGNOFF_POLICY.md` | |

## Go / No-Go Checklist

- [ ] required workflow runs succeeded
- [ ] required smoke passed
- [ ] manual desktop checks completed
- [ ] required audits reviewed
- [ ] restore / rollback evidence reviewed when in scope
- [ ] unresolved exceptions explicitly accepted or cleared
- [ ] scorecard reviewed per the launch signoff policy
- [ ] rollback owner is identified
- [ ] communications owner is identified

## Final Signoff

- decision time:
- approver:
- rollback owner:
- communications owner:
- announcement blocked until production smoke complete: yes / no
- follow-up issues opened:
```

## Operator Guidance

- Keep statuses terse: `pass`, `fail`, `blocked`, `not-run`, or `not-applicable`
  are enough.
- Prefer relative paths for local artifacts and full URLs for workflow runs.
- If a release is blocked, write the exact blocker in `Decision Summary` instead
  of burying it in a later section.
- If a launch exception is accepted, name it explicitly and point at
  [docs/ENVIRONMENT_ISOLATION_MATRIX.md](ENVIRONMENT_ISOLATION_MATRIX.md).
- If an item is out of scope for the candidate, mark it `not-applicable`
  instead of leaving it blank.
- Do not lift `Current launch status: Not ready` from the scorecard unless the
  packet satisfies
  [docs/LAUNCH_SIGNOFF_POLICY.md](LAUNCH_SIGNOFF_POLICY.md).
