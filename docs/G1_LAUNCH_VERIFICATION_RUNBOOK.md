# G1 — Launch Verification Runbook

The code is launch-complete. **G1 is the operational gate**: run the dry-runs against
live environments and capture the evidence the release packet requires. This runbook
turns that into a copy-paste sequence. Evidence lands under
`docs/_generated/launch/<target>/<candidate-id>/` (gitignored — local/operator only).

> Status going in: G2 (secrets) complete, **Stripe on TEST keys in prod** (intentional);
> G3/G4 clear. The only gate left is executing what's below.

---

## 0. Prerequisites & setup

You need:
- **Node 20**: `source ~/.nvm/nvm.sh && nvm use`
- A **smoke API token** (`ul_…`, `apps:call` scope) for a **dedicated smoke account** (not a real customer).
- The smoke account's **user UUID** and the **Supabase service-role key** (for the free-mode smoke's balance snapshot/restore).
- (Optional) an **async-capable agent id + function** for the durable-execution smoke.
- An **isolated Supabase project** to restore into (for the backup/restore drill).

Set up the candidate + evidence dir once:

```bash
source ~/.nvm/nvm.sh && nvm use
export TOK='ul_…'                       # smoke account API token
export UID='00000000-…'                 # smoke account user uuid
export SRK='…'                          # SUPABASE_SERVICE_ROLE_KEY
export TARGET=staging
export CID="$(date -u +%F)-main-$(git rev-parse --short=7 HEAD)"   # e.g. 2026-06-25-main-ef036a9
export DIR="docs/_generated/launch/$TARGET/$CID"
mkdir -p "$DIR"
echo "candidate: $CID  →  $DIR"
```

---

## 1. Secrets preflight (fast — catch a missing secret before the slow smoke)

```bash
node scripts/ops/verify-secrets.mjs --target staging --token "$TOK"
# repeat for production once it's deployed:
node scripts/ops/verify-secrets.mjs --target production --token "$TOK"
```
Critical probes must be **OK** (health, Supabase, models, auth). **Stripe is WARN-only** —
"responds" is enough; you're on test keys on purpose. A `FAIL` means a missing/wrong
Worker secret — fix before continuing.

## 2. Initialize the release packet (scaffolds the decision doc)

```bash
node scripts/ops/init-release-packet.mjs \
  --target "$TARGET" --commit-sha "$(git rev-parse HEAD)" --git-ref main \
  --operator "$USER" --output-dir "$DIR"
# writes $DIR/release-packet.md + $DIR/metadata.json (all results 'pending')
```

## 3. Run the staging smoke suite (one command, all smokes → one evidence dir)

```bash
node scripts/smoke/run-staging-smoke-suite.mjs \
  --target staging --token "$TOK" \
  --user-id "$UID" --service-role-key "$SRK" \
  # optional async spine: --durable-app <agentId> --durable-function <fn> \
  # optional real chat (costs credits): --exercise-chat \
  --output-dir "$DIR"
```
This runs, into `$DIR/smoke/`: **release-smoke** (guardrails / auth / API / CORS / chat),
**launch-web-pages**, **free-mode-e2e** (the gates with `FREE_MODE` on), **durable-exec**
(if you pass the agent), and **interface-deploy**. It writes `$DIR/g1-smoke-suite-summary.{json,md}`.
Exit 0 = every run smoke passed; a smoke with missing inputs is **skipped**, not failed.

**Stop-ship:** any smoke `failed`. The free-mode smoke is the new must-pass — it proves a
<$0.25 balance blocks paid + AI-without-BYOK and allows free, live.

> Not covered automatically (do manually, record in `$DIR/manual/`): the **payment top-up**
> flow (test-mode card → webhook → balance). It has unit tests + `docs/PAYMENTS_LAUNCH_QA.md`;
> run that checklist once on staging and note the result.

## 4. Backup / restore drill (never run — prove your data is recoverable)

```bash
node scripts/ops/init-backup-restore-drill.mjs \
  --source-environment production \
  --restore-target '<isolated-supabase-project-ref>' \
  --output-dir "$DIR/restore-drill"
# then: actually restore a real backup into the isolated target, run the
# validation queries, and fill $DIR/restore-drill/notes.md with:
#   source backup ref + timestamp, seed-row checks, start/finish times,
#   RTO + RPO, and any operator gaps.
```
**Pass** = restore completed into an isolated target, validation queries returned expected
seed rows/counts, and RTO/RPO are recorded. This is an ops exercise, not a test — it must
actually run once.

## 5. Rollback rehearsal (never run — tabletop the recovery paths)

```bash
node scripts/ops/init-rollback-rehearsal.mjs \
  --target production --candidate-id "$CID" \
  --output-dir "$DIR/rollback-rehearsal"
# then tabletop the 4 scenarios in notes.md and record for each: trigger,
# first safe action, comms point, recovery path, time-to-identify, gaps:
#   1) bad staging deploy  2) bad production API deploy
#   3) bad production DB migration  4) bad desktop release/updater (N/A if no desktop)
```
**Pass** = all four walked through, timings + gaps recorded, runbook updated if the
rehearsal exposed a gap.

## 6. Production smoke (after the production deploy)

A push of `b8ad5df`/`81d34c7` already deploys via `branches: [main]`. Once prod is live:
```bash
export TARGET=production
export CID="$(date -u +%F)-$(git describe --tags --abbrev=0 2>/dev/null || echo main)-$(git rev-parse --short=7 HEAD)"
export DIR="docs/_generated/launch/$TARGET/$CID"; mkdir -p "$DIR"
node scripts/ops/verify-secrets.mjs --target production --token "$TOK"
node scripts/smoke/run-staging-smoke-suite.mjs --target production --token "$TOK" \
  --user-id "$UID" --service-role-key "$SRK" --output-dir "$DIR"
```
**Stop-ship:** do **not** announce until the production smoke is green and attached.

## 7. Fill the release packet → sign off

Edit `$DIR/release-packet.md`:
- Fill every smoke / workflow / audit cell from the evidence under `$DIR/`.
- Name **release lead**, **rollback owner**, **comms owner** (missing rollback/comms owner = stop-ship).
- Set **decision**: `go` / `no-go` / `conditional`. Any exception → register it in
  `docs/ENVIRONMENT_ISOLATION_MATRIX.md` with owner + risk + follow-up.

### Stop-ship checklist (any TRUE = no-go) — from `docs/LAUNCH_SIGNOFF_POLICY.md`
- [ ] a required workflow / launch gate failed, missing, or pending
- [ ] staging smoke failed or missing for a prod promotion
- [ ] prod smoke failed or missing before announcement
- [ ] release packet incomplete
- [ ] a required operational item has no candidate evidence (e.g. restore drill / rollback rehearsal not run)
- [ ] a new staging↔prod coupling not in the isolation matrix
- [ ] rollback owner or comms owner missing

---

## Quick reference

| Thing | Command |
|---|---|
| Secrets preflight | `node scripts/ops/verify-secrets.mjs --target <t> --token $TOK` |
| Whole smoke suite | `node scripts/smoke/run-staging-smoke-suite.mjs --target <t> --token $TOK --user-id $UID --service-role-key $SRK --output-dir $DIR` |
| Free-mode only | `node scripts/smoke/free-mode-e2e-smoke.mjs --url <api> --token $TOK --user-id $UID --supabase-url <sb> --service-role-key $SRK --output-dir $DIR/smoke` |
| Release packet | `node scripts/ops/init-release-packet.mjs --target <t> --commit-sha $(git rev-parse HEAD) --git-ref main --operator $USER --output-dir $DIR` |
| Restore drill | `node scripts/ops/init-backup-restore-drill.mjs --source-environment production --restore-target <ref> --output-dir $DIR/restore-drill` |
| Rollback rehearsal | `node scripts/ops/init-rollback-rehearsal.mjs --target production --candidate-id $CID --output-dir $DIR/rollback-rehearsal` |

Evidence root: `docs/_generated/launch/<target>/<candidate-id>/` (gitignored).
Candidate-id: `YYYY-MM-DD-{main|vX.Y.Z}-{7-char-sha}`.
