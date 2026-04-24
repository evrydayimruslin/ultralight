#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/supabase/_lib.sh
source "${SCRIPT_DIR}/_lib.sh"

ROOT="$(repo_root)"

require_env "SUPABASE_ACCESS_TOKEN"
require_env "SUPABASE_PROJECT_ID"
require_env "SUPABASE_DB_PASSWORD"

ENV_NAME="${SUPABASE_ENV_NAME:-remote}"

if ! has_checked_in_migrations; then
  echo "[supabase] No checked-in migrations yet; skipping ${ENV_NAME} deploy."
  exit 0
fi

echo "[supabase] Linking ${ENV_NAME} project ${SUPABASE_PROJECT_ID}"
supabase_cli link \
  --project-ref "${SUPABASE_PROJECT_ID}" \
  -p "${SUPABASE_DB_PASSWORD}" \
  --workdir "${ROOT}" \
  --yes

echo "[supabase] Pushing migrations to ${ENV_NAME}"
supabase_cli db push \
  --linked \
  -p "${SUPABASE_DB_PASSWORD}" \
  --workdir "${ROOT}" \
  --yes

echo "[supabase] Migration history after ${ENV_NAME} deploy"
supabase_cli migration list \
  --linked \
  -p "${SUPABASE_DB_PASSWORD}" \
  --workdir "${ROOT}"
