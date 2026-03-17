#!/usr/bin/env bash
# Generates apps/api/.dev.vars from Doppler environment variables.
# Run via: bun run dev:vars  (which wraps this with `doppler run`)
#
# Keys are derived from the WorkerBindings interface in packages/env/src/workers.ts,
# excluding Cloudflare primitives (queues, DOs, workflows, Hyperdrive).

set -euo pipefail

OUTFILE="$(dirname "$0")/../apps/api/.dev.vars"

KEYS=(
  NODE_ENV
  OPENROUTER_API_KEY
  OPENAI_API_KEY
  CARTESIA_API_KEY
  DAYTONA_API_KEY
  DAYTONA_API_URL
  DAYTONA_TARGET
  TELEGRAM_BOT_TOKEN
  TELEGRAM_WEBHOOK_SECRET
  DATABASE_URL
  BETTER_AUTH_SECRET
  BETTER_AUTH_URL
  ENABLE_CUA
  POSTHOG_KEY
  POSTHOG_HOST
)

: > "$OUTFILE"

for key in "${KEYS[@]}"; do
  value="${!key:-}"
  if [ -n "$value" ]; then
    echo "${key}=${value}" >> "$OUTFILE"
  fi
done

echo "Generated $OUTFILE with $(wc -l < "$OUTFILE" | tr -d ' ') vars"
