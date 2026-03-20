#!/usr/bin/env bash
# Generates apps/api/.dev.vars from Doppler environment variables.
# Run via: bun run dev:vars  (which wraps this with `doppler run`)

set -euo pipefail

SCRIPT_DIR="$(dirname "$0")"
OUTFILE="$SCRIPT_DIR/../apps/api/.dev.vars"
KEYS_FILE="$SCRIPT_DIR/worker-env-keys.txt"

# Read keys from shared list, skipping comments and blank lines
: > "$OUTFILE"

while IFS= read -r key || [ -n "$key" ]; do
  value="${!key:-}"
  if [ -n "$value" ]; then
    echo "${key}=${value}" >> "$OUTFILE"
  fi
done < <(grep -v '^#' "$KEYS_FILE" | grep -v '^$')

echo "Generated $OUTFILE with $(wc -l < "$OUTFILE" | tr -d ' ') vars"
