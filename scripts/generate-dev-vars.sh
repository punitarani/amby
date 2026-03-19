#!/usr/bin/env bash
# Generates apps/api/.dev.vars from Doppler environment variables.
# Run via: bun run dev:vars  (which wraps this with `doppler run`)

set -euo pipefail

SCRIPT_DIR="$(dirname "$0")"
OUTFILE="$SCRIPT_DIR/../apps/api/.dev.vars"
KEYS_FILE="$SCRIPT_DIR/worker-env-keys.txt"

# Read keys from shared list, skipping comments and blank lines
mapfile -t KEYS < <(grep -v '^#' "$KEYS_FILE" | grep -v '^$')

: > "$OUTFILE"

for key in "${KEYS[@]}"; do
  value="${!key:-}"
  if [ -n "$value" ]; then
    echo "${key}=${value}" >> "$OUTFILE"
  fi
done

echo "Generated $OUTFILE with $(wc -l < "$OUTFILE" | tr -d ' ') vars"
