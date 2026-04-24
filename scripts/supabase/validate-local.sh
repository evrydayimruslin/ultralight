#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/supabase/_lib.sh
source "${SCRIPT_DIR}/_lib.sh"

ROOT="$(repo_root)"

require_docker_daemon

echo "[supabase] Starting local services"
supabase_cli start --workdir "${ROOT}"

echo "[supabase] Resetting local database from checked-in migrations"
supabase_cli db reset --workdir "${ROOT}" --yes

echo "[supabase] Linting local schema"
supabase_cli db lint --local --fail-on error --workdir "${ROOT}"

if has_database_tests; then
  echo "[supabase] Running pgTAP tests"
  supabase_cli test db --local --workdir "${ROOT}"
else
  echo "[supabase] No pgTAP SQL tests found under supabase/tests/database; skipping."
fi
