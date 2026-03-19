#!/usr/bin/env bash
# Generates apps/api/.dev.vars from Doppler environment variables.
# Run via: bun run dev:vars  (which wraps this with `doppler run`)

set -euo pipefail

SCRIPT_DIR="$(dirname "$0")"
OUTFILE="$SCRIPT_DIR/../apps/api/.dev.vars"
KEYS_FILE="$SCRIPT_DIR/worker-env-keys.txt"

: > "$OUTFILE"

while IFS= read -r key || [ -n "$key" ]; do
  case "$key" in
    ""|\#*) continue ;;
  esac

  value="${!key:-}"
  if [ -n "$value" ]; then
    printf '%s=%s\n' "$key" "$value" >> "$OUTFILE"
  fi
done < "$KEYS_FILE"

echo "Generated $OUTFILE with $(wc -l < "$OUTFILE" | tr -d ' ') vars"
