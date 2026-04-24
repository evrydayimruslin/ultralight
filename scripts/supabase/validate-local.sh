#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/supabase/_lib.sh
source "${SCRIPT_DIR}/_lib.sh"

ROOT="$(repo_root)"

require_docker_daemon

retry_command() {
  local label="$1"
  shift

  local attempt=1
  local max_attempts=3
  until "$@"; do
    if (( attempt >= max_attempts )); then
      echo "[supabase] ${label} failed after ${attempt} attempt(s)." >&2
      return 1
    fi

    echo "[supabase] ${label} failed; retrying in $((attempt * 5))s..."
    sleep $((attempt * 5))
    attempt=$((attempt + 1))
  done
}

echo "[supabase] Starting local database"
retry_command "local database start" supabase_cli db start --workdir "${ROOT}"

echo "[supabase] Resetting local database from checked-in migrations"
retry_command "local database reset" supabase_cli db reset --workdir "${ROOT}" --yes

echo "[supabase] Linting local schema"
supabase_cli db lint --local --fail-on error --workdir "${ROOT}"

if has_database_tests; then
  echo "[supabase] Running pgTAP tests"
  supabase_cli test db --local --workdir "${ROOT}"
else
  echo "[supabase] No pgTAP SQL tests found under supabase/tests/database; skipping."
fi
