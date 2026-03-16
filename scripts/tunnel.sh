#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Validate prerequisites
if ! command -v ngrok &>/dev/null; then
  echo "Error: ngrok not found."
  echo "Install with: brew install ngrok"
  echo "Then authenticate: ngrok config add-authtoken <your-token>"
  exit 1
fi

if [ -z "${NGROK_DOMAIN:-}" ]; then
  echo "Error: NGROK_DOMAIN is not set"
  echo ""
  echo "To get a free static domain:"
  echo "  1. Go to https://dashboard.ngrok.com/domains"
  echo "  2. Claim your free static domain"
  echo "  3. Add NGROK_DOMAIN=your-domain.ngrok-free.app to Doppler"
  exit 1
fi

if [ -z "${TELEGRAM_BOT_TOKEN:-}" ]; then
  echo "Error: TELEGRAM_BOT_TOKEN is not set"
  exit 1
fi

LOCAL_PORT="${PORT:-8787}"
WEBHOOK_URL="https://${NGROK_DOMAIN}/telegram/webhook"

cleanup() {
  echo ""
  echo "Shutting down tunnel..."
  kill "$NGROK_PID" 2>/dev/null || true
  wait "$NGROK_PID" 2>/dev/null || true
  echo "Removing Telegram webhook..."
  bun -e "
    import { Bot } from 'grammy';
    const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN);
    await bot.api.deleteWebhook();
    console.log('Webhook removed.');
  " 2>/dev/null || echo "Warning: could not remove webhook"
  echo "Done."
}
trap cleanup EXIT

# Start ngrok in the background
echo "Starting ngrok tunnel to localhost:${LOCAL_PORT}..."
ngrok http "$LOCAL_PORT" --url "$NGROK_DOMAIN" --log=stdout --log-level=warn > /dev/null 2>&1 &
NGROK_PID=$!

# Wait for tunnel to be ready
echo "Waiting for tunnel..."
TUNNEL_READY=false
for i in $(seq 1 20); do
  if curl -s http://127.0.0.1:4040/api/tunnels 2>/dev/null | grep -q "public_url"; then
    TUNNEL_READY=true
    break
  fi
  sleep 0.5
done

if [ "$TUNNEL_READY" = false ]; then
  echo "Error: ngrok tunnel failed to start within 10 seconds."
  echo "Check your ngrok configuration and auth token."
  exit 1
fi

# Register Telegram webhook
echo "Registering Telegram webhook..."
bun run "$PROJECT_ROOT/apps/api/src/setup-webhook.ts" "$WEBHOOK_URL"

echo ""
echo "=== Tunnel active ==="
echo "Public URL:  https://$NGROK_DOMAIN"
echo "Webhook:     $WEBHOOK_URL"
echo "Local:       http://localhost:$LOCAL_PORT"
echo "ngrok UI:    http://127.0.0.1:4040"
echo ""
echo "Press Ctrl+C to stop."
wait "$NGROK_PID"
