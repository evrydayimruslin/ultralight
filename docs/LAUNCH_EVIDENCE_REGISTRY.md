# Launch Evidence Registry

Last reviewed: `2026-04-21`

This document defines what evidence a release candidate must produce, where
that evidence should live, what may be committed to git, and what must stay
local or external.

Wave 6 is not complete if operators are still collecting release proof from
terminal scrollback, browser tabs, or memory. This registry turns release
evidence into a repeatable artifact model.

## Purpose

The goals of the registry are:

- one predictable output layout for staging and production release evidence
- one clear answer for which artifacts are local-only versus commit-safe
- one redaction standard for tokens, cookies, share secrets, and user data
- one consistent handoff target for the future smoke wrapper and release packet

This registry does not replace
[docs/RELEASE_RUNBOOK.md](RELEASE_RUNBOOK.md)
or
[docs/SMOKE_CHECKLISTS.md](SMOKE_CHECKLISTS.md).
It defines the evidence layout those procedures should write into.

## Evidence Classes

### 1. Commit-Safe Reference Files

These are safe to keep in the repo because they define conventions, not
environment-specific release evidence.

Examples:

- this registry
- [docs/_generated/README.md](_generated/README.md)
- future redacted example packet structures

### 2. Local Release Evidence

These are generated for a real release candidate and should be treated as
local-only by default. They may contain operational details, workflow URLs,
user identifiers, or data that becomes sensitive once aggregated.

Examples:

- smoke logs
- audit JSON outputs
- manual smoke notes
- screenshots
- workflow run URLs bundled for a specific release candidate

These should live under `docs/_generated/launch/...` locally, but should not be
committed unless they are deliberately redacted and reviewed.

### 3. External Evidence

Some release evidence should remain external and only be referenced from the
release packet rather than copied into the repo.

Examples:

- GitHub Actions run URLs
- GitHub Release URLs
- provider dashboards
- Supabase restore logs
- Cloudflare deploy dashboards

The registry should record how to reference these, not duplicate them.

## Canonical Local Output Layout

Release evidence should be written under:

```text
docs/_generated/launch/<target>/<candidate-id>/
```

Where:

- `<target>` is `staging` or `production`
- `<candidate-id>` is a deterministic identifier such as:
  - `2026-04-21-main-abc1234`
  - `2026-04-21-v0.1.0-abc1234`

Recommended layout:

```text
docs/_generated/launch/
  staging/
    2026-04-21-main-abc1234/
      metadata.json
      release-packet.md
      workflow-runs.md
      smoke/
        guardrails.txt
        auth-redirect.log
        api-smoke.log
        cors-allowed.txt
        cors-blocked.txt
        summary.json
        summary.md
      audits/
        supabase-audit.json
        manifest-coverage-audit.json
        token-compat-audit.json
        secret-crypto-audit.json
      restore-drill/
        metadata.json
        notes.md
        validation-queries.sql
      rollback-rehearsal/
        metadata.json
        notes.md
      manual/
        desktop-smoke-notes.md
        screenshots/
  production/
    2026-04-21-v0.1.0-abc1234/
      metadata.json
      release-packet.md
      workflow-runs.md
      smoke/
      audits/
      restore-drill/
      rollback-rehearsal/
      manual/
```

This structure is intentionally future-proof for:

- `PR6.3` smoke wrapper output
- `PR6.6` backup/restore drill artifacts
- `PR6.7` rollback rehearsal notes
- `PR6.9` operator release packet assembly

## Candidate Metadata Convention

Every evidence directory should include a small `metadata.json` file with at
least:

```json
{
  "generated_at": "2026-04-21T23:15:00.000Z",
  "target": "staging",
  "candidate_id": "2026-04-21-main-abc1234",
  "git_ref": "main",
  "commit_sha": "abc1234",
  "version_tag": null,
  "operator": "local-user-or-redacted"
}
```

For production, `version_tag` should be the pushed release tag.

This metadata becomes the join point for smoke output, audit output, and the
final release packet.

## Required Artifact Set

### Staging Candidate

Required evidence:

- release packet with candidate decision state
- launch guardrail result
- auth redirect smoke output
- API smoke output
- allowed-origin CORS probe result
- disallowed-origin CORS probe result
- workflow run links for:
  - `API CI`
  - `Launch Guardrails`
  - `Supabase DB`
  - `API Deploy`
  - `Desktop Build`
- Wave 4 audit outputs when relevant to the release:
  - Supabase config audit
  - manifest coverage audit
  - token compatibility audit
  - secret crypto audit
- manual desktop smoke notes
- screenshots only if a manual issue or important state transition needs proof

### Production Candidate

Required evidence:

- release packet with candidate decision state
- workflow run links for:
  - `Supabase Production DB`
  - `API Deploy`
  - `Desktop Release`
- auth redirect smoke output
- API smoke output
- allowed-origin CORS probe result
- disallowed-origin CORS probe result
- manual desktop smoke notes
- updater smoke notes if updater validation is in scope
- release URL / GitHub Release link

## Redaction Rules

Never write these values to committed artifacts:

- bearer tokens
- refresh tokens
- auth cookies
- `X-Worker-Secret`
- Supabase service-role keys
- updater signing keys
- raw share tokens or bridge tokens
- unredacted user email addresses unless the evidence is explicitly local-only

When capturing logs or screenshots:

- replace sensitive headers with `[REDACTED]`
- replace tokens in URLs, fragments, or logs with `[REDACTED_TOKEN]`
- replace share secrets with `[REDACTED_SHARE_TOKEN]`
- prefer user identifiers like `user_1234` over real email addresses where
  practical

If an artifact cannot be safely redacted without destroying its value, keep it
local-only and reference it from the release packet instead of committing it.

## Commit Policy

Safe to commit:

- registry docs
- `docs/_generated/README.md`
- redacted example packet structures
- sanitized templates and empty directories if needed for tooling

Do not commit by default:

- real smoke logs
- real audit JSON from staging or production
- screenshots from real accounts
- workflow run exports tied to a specific live release
- any artifact containing secrets, user identifiers, or environment internals

## Existing Audit Commands Mapped To The Registry

These commands already support `--write-json`. For a staging candidate, write
them under the `audits/` directory for that candidate.

Example:

```bash
export UL_LAUNCH_EVIDENCE_DIR="docs/_generated/launch/staging/2026-04-21-main-abc1234"

source ~/.nvm/nvm.sh && nvm use
node scripts/supabase/audit-app-supabase-configs.mjs \
  --write-json "$UL_LAUNCH_EVIDENCE_DIR/audits/supabase-audit.json"

node scripts/apps/audit-app-manifest-coverage.mjs \
  --write-json "$UL_LAUNCH_EVIDENCE_DIR/audits/manifest-coverage-audit.json"

node scripts/tokens/audit-api-token-compat.mjs \
  --write-json "$UL_LAUNCH_EVIDENCE_DIR/audits/token-compat-audit.json"

node scripts/secrets/audit-secret-crypto-compat.mjs \
  --write-json "$UL_LAUNCH_EVIDENCE_DIR/audits/secret-crypto-audit.json"
```

The future smoke wrapper from `PR6.3` should write into the matching
`smoke/` directory for the same candidate.

## Workflow Link Convention

Workflow URLs should be recorded in a simple markdown file:

```text
workflow-runs.md
```

Recommended sections:

- candidate metadata
- staging or production workflow URLs
- timestamp of review
- operator initials or redacted operator id

This file should prefer links over pasted raw logs.

## Manual Notes Convention

Manual checks should be summarized in:

```text
manual/desktop-smoke-notes.md
```

Recommended structure:

- environment and build identifier
- operator
- checklist item
- pass / fail / needs follow-up
- short note
- screenshot reference only if needed

Keep manual notes concise. The release packet should summarize them, not repeat
them verbatim.

## Relationship To Later Wave 6 PRs

- `PR6.3` should write command-line smoke into this layout.
- `PR6.4` and `PR6.5` should link workflow results into this layout.
- `PR6.6` and `PR6.7` should use the same candidate directory for restore and
  rollback drill notes when those exercises happen during a release cycle.
- `PR6.9` should assemble the release packet from this registry instead of
  inventing another structure.
- `PR6.10` should require evidence from this registry before changing launch
  signoff state.
