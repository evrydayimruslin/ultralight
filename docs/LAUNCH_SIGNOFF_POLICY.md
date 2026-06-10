# Launch Signoff Policy

Last reviewed: `2026-04-21`

This document defines how Ultralight moves from `Not ready` to a releasable
candidate.

The policy is intentionally evidence-first. A launch is approved from a filled
release packet and the supporting artifacts behind it, not from confidence,
memory, or a doc-only status change.

## Purpose

This policy exists to answer four questions clearly:

1. Who is allowed to approve a launch?
2. What evidence must exist before approval?
3. What counts as stop-ship?
4. What can ship with an explicit exception?

Use this together with:

- [docs/LAUNCH_SCORECARD.md](LAUNCH_SCORECARD.md)
- [docs/RELEASE_PACKET_TEMPLATE.md](RELEASE_PACKET_TEMPLATE.md)
- [docs/RELEASE_RUNBOOK.md](RELEASE_RUNBOOK.md)
- [docs/ENVIRONMENT_ISOLATION_MATRIX.md](ENVIRONMENT_ISOLATION_MATRIX.md)

## Signoff Inputs

A launch decision is valid only when all of these exist for the candidate:

- a filled `release-packet.md`
- required workflow and launch-gate URLs
- required smoke artifacts and summaries
- required manual smoke notes
- required audit outputs for the candidate scope
- the current scorecard reviewed against the candidate evidence
- explicit launch-exception decisions where applicable

## Verification Classes

The scorecard uses three signoff classes.

### Repo-Backed

These items can move based on committed code, configuration, CI output, and
reviewed docs in the repo.

Examples:

- route validation coverage
- canonical migration storage
- direct-console guardrails
- generated contract and type guardrails

### Operational

These items require candidate-specific runtime evidence and must not move to
`Pass` from a doc or code edit alone.

Examples:

- staging and production smoke
- backup / restore drill
- rollback rehearsal
- environment-variable completeness
- SSL or DNS correctness at release time

### Launch Exception

These are known temporary exceptions that may ship only if they are explicitly
accepted for the candidate.

They must have:

- a named owner
- a documented risk
- an evidence reference
- a follow-up removal target
- an explicit acceptance entry in the release packet

The canonical registry for environment-level exceptions is
[docs/ENVIRONMENT_ISOLATION_MATRIX.md](ENVIRONMENT_ISOLATION_MATRIX.md).

## Approval Roles

Approvals are role-based. This policy does not require named individuals in the
repo, but the release packet must record who filled each role for the
candidate.

### Required For Every Candidate

- `Release lead`
  Owns the final packet, confirms that the evidence is complete, and declares
  `go`, `no-go`, or `conditional`.
- `Rollback owner`
  Owns the first safe action if production behavior is bad after promotion.
- `Communications owner`
  Owns user-facing or team-facing release communication if the release is
  delayed, blocked, or rolled forward.

### Required By Scope

- `Platform / API owner`
  Required when the candidate touches:
  - `api/**`
  - `worker/**`
  - Cloudflare bindings
  - auth, routing, execution, upload, or runtime cache behavior
- `Database owner`
  Required when the candidate touches:
  - `supabase/**`
  - migration deploy workflows
  - backup / restore evidence
  - Supabase credential or schema behavior
- `Desktop owner`
  Required when the candidate touches:
  - `desktop/**`
  - desktop release workflows
  - updater behavior
- `Exception owner`
  Required when a launch exception is accepted for the candidate

One person may fill more than one role, but the packet must still record the
role mapping explicitly.

## Stop-Ship Conditions

The candidate is `No-go` if any of the following is true:

- a required workflow or launch gate failed, is missing, or is still pending
- required staging smoke failed or is missing for a production promotion
- required production smoke failed or is missing before release announcement
- the release packet is incomplete enough that the decision cannot be audited
- a required operational item is still `Operational` in the scorecard without
  referenced candidate evidence
- any scorecard item that is still `Unresolved` remains relevant to the
  candidate scope
- a new staging/production coupling exists that is not registered in the
  isolation matrix
- the candidate touches the production-only secondary data worker without an
  explicit exception decision and validation plan
- rollback owner or communications owner is missing

## Allowed Conditional Releases

A candidate may ship `with explicit exception` only if all of the following are
true:

- the exception is documented in the release packet
- the exception is already registered in the isolation matrix or another named
  evidence source
- the packet records:
  - the risk
  - the owner
  - why the release still proceeds
  - the follow-up removal target
- no stop-ship condition is present

The current pre-registered launch exceptions are the shared-resource items in
[docs/ENVIRONMENT_ISOLATION_MATRIX.md](ENVIRONMENT_ISOLATION_MATRIX.md).

## How To Lift `Not Ready`

`Current launch status: Not ready` in the scorecard must not change based on a
doc edit alone.

It can be lifted only through this sequence:

1. Fill the candidate release packet.
2. Attach the required workflow, smoke, audit, and manual evidence.
3. Review the scorecard against that candidate evidence.
4. Mark any launch exceptions explicitly.
5. Record the required approval roles in the packet.
6. Make the final `go`, `no-go`, or `conditional` decision in the packet.

If a later packet shows new failures or regressions, the status falls back to
`Not ready` until the new candidate evidence is complete.

## Decision States

Use only these packet outcomes:

- `go`
  All required evidence exists, no stop-ship conditions remain, and any launch
  exceptions are explicitly accepted.
- `conditional`
  The candidate may ship only under the named accepted exceptions recorded in
  the packet.
- `no-go`
  A stop-ship condition remains or the evidence is incomplete.

Avoid softer labels like `probably good` or `looks fine`.

## Minimal Signoff Checklist

Every final signoff must confirm:

- repo-backed items relevant to the candidate were reviewed
- operational items relevant to the candidate have concrete evidence paths
- launch exceptions are explicitly accepted or cleared
- staging evidence exists before production promotion
- production evidence exists before release announcement
- rollback owner and communications owner are identified

## Failure Path

If signoff cannot be completed:

1. mark the packet `no-go`
2. name the exact blocker in `Decision Summary`
3. fix forward on a new candidate
4. reuse the packet structure, but not the old decision, for the next candidate
