#!/usr/bin/env bash
#
# Drift gate: verify that a linked Supabase project's LIVE schema still matches
# the checked-in migrations under supabase/migrations/. Used three ways:
#   - after the staging deploy (supabase-db.yml)
#   - after a manual production deploy (supabase-production-db.yml)
#   - as a standalone nightly check against production (supabase-prod-drift.yml)
#
# A non-empty diff means someone changed the schema out-of-band (e.g. in the
# Supabase SQL editor) without writing a migration — capture it as one.
#
# Required env: SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_ID, SUPABASE_DB_PASSWORD
# Optional env: SUPABASE_ENV_NAME (label only, default "remote")
#
# Exit codes:
#   0  - schema matches (or db diff could not run; we never block on a CLI hiccup)
#   1  - real schema drift detected

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/supabase/_lib.sh
source "${SCRIPT_DIR}/_lib.sh"
set +e # _lib.sh enables `set -e`; we handle errors explicitly below.

ROOT="$(repo_root)"

require_env "SUPABASE_ACCESS_TOKEN"
require_env "SUPABASE_PROJECT_ID"
require_env "SUPABASE_DB_PASSWORD"

ENV_NAME="${SUPABASE_ENV_NAME:-remote}"

# Ensure the project is linked. Idempotent: the deploy jobs have already linked
# in the same workspace; the standalone nightly job has not.
echo "[supabase] Linking ${ENV_NAME} project ${SUPABASE_PROJECT_ID} for drift check"
supabase_cli link \
  --project-ref "${SUPABASE_PROJECT_ID}" \
  -p "${SUPABASE_DB_PASSWORD}" \
  --workdir "${ROOT}" \
  --yes >/dev/null
if [[ $? -ne 0 ]]; then
  echo "[supabase] ::warning::Could not link ${ENV_NAME}; skipping drift check this run." >&2
  exit 0
fi

echo "[supabase] Checking ${ENV_NAME} schema drift (public schema)"
# NOTE: `db diff` reads the password from SUPABASE_DB_PASSWORD; unlike `db push`
# it does NOT accept a -p flag.
DRIFT_ERR="$(mktemp)"
DIFF="$(supabase_cli db diff --linked --schema public --workdir "${ROOT}" 2>"${DRIFT_ERR}")"
if [[ $? -ne 0 ]]; then
  echo "[supabase] ::warning::Drift check could not run for ${ENV_NAME} (db diff failed); skipping gate." >&2
  sed 's/^/[db diff] /' "${DRIFT_ERR}" >&2 || true
  rm -f "${DRIFT_ERR}"
  exit 0
fi
rm -f "${DRIFT_ERR}"

# Treat "no schema changes found" or an all-whitespace result as clean.
if printf '%s' "${DIFF}" | grep -qiE 'no schema changes found' || [[ -z "${DIFF//[$'\n\t ']/}" ]]; then
  echo "[supabase] No ${ENV_NAME} schema drift."
  exit 0
fi

echo "::error::${ENV_NAME} schema drift detected — capture it as a migration in supabase/migrations/." >&2
printf '%s\n' "${DIFF}"
exit 1
