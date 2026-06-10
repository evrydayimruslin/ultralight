#!/usr/bin/env sh
set -eu

DENO_BIN="${DENO_BIN:-$(command -v deno 2>/dev/null || printf '%s' "$HOME/.deno/bin/deno")}"

if ! command -v "$DENO_BIN" >/dev/null 2>&1; then
  echo "Deno not found: $DENO_BIN" >&2
  exit 127
fi

exec "$DENO_BIN" "$@"
