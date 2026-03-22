import { CALLBACK_HEARTBEAT_INTERVAL_MS } from "../config"

/** Node.js signer + poster for task callbacks (runs inside sandbox). */
export function buildCallbackJsScript(): string {
	return `"use strict";
const crypto = require("crypto");
const { AMBY_CALLBACK_URL, AMBY_CALLBACK_ID, AMBY_CALLBACK_SECRET, AMBY_TASK_ID } = process.env;

function deterministicEventId(taskId, seq, eventType) {
  const h = crypto.createHash("sha256").update(String(taskId) + ":" + String(seq) + ":" + String(eventType)).digest();
  const hex = h.toString("hex").slice(0, 32);
  return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-" + hex.slice(12, 16) + "-" + hex.slice(16, 20) + "-" + hex.slice(20, 32);
}

async function sendWithRetry(url, secret, body, baseHeaders, retries) {
  for (let i = 0; i <= retries; i++) {
    try {
      const ts = String(Date.now());
      const hmac = crypto.createHmac("sha256", secret).update(ts + "." + body).digest("hex");
      const res = await fetch(url, {
        method: "POST",
        headers: { ...baseHeaders, "X-Amby-Timestamp": ts, "X-Amby-Signature": "sha256=" + hmac },
        body,
      });
      if (res.ok || res.status === 409) return;
      if (i === retries) console.error("[callback] failed, status:", res.status);
    } catch (e) {
      if (i === retries) console.error("[callback] failed:", e.message || e);
    }
    if (i < retries) await new Promise(r => setTimeout(r, 2000 * (i + 1)));
  }
}

async function main() {
  const eventType = process.argv[2] || "";
  const status = process.argv[3] || "";
  const message = process.argv[4] || "";
  const seq = process.argv[5] || "0";
  const exitCode = process.argv[6] || "";
  if (!AMBY_CALLBACK_URL || !AMBY_CALLBACK_SECRET || !AMBY_CALLBACK_ID || !AMBY_TASK_ID) return;
  const eventId = deterministicEventId(AMBY_TASK_ID, seq, eventType);
  const occurredAt = new Date().toISOString();
  const body = JSON.stringify({
    eventId,
    eventType,
    taskId: AMBY_TASK_ID,
    status: status || null,
    message: message || null,
    seq: Number(seq),
    exitCode: exitCode === "" ? null : Number(exitCode),
    sentAt: occurredAt,
  });
  const isTerminal = eventType === "task.completed" || eventType === "task.failed";
  const retries = isTerminal ? 3 : 0;
  await sendWithRetry(AMBY_CALLBACK_URL, AMBY_CALLBACK_SECRET, body, {
    "Content-Type": "application/json",
    Authorization: "Bearer " + AMBY_CALLBACK_SECRET,
    "X-Amby-Callback-Id": AMBY_CALLBACK_ID,
    "X-Amby-Seq": seq,
  }, retries);
}

main();
`
}

/** Codex notify hook: posts codex.notify supplemental events (Phase 2). */
export function buildNotifyJsScript(): string {
	return `"use strict";
const crypto = require("crypto");
const { AMBY_CALLBACK_URL, AMBY_CALLBACK_ID, AMBY_CALLBACK_SECRET, AMBY_TASK_ID } = process.env;

function eventIdFromPayload(payload) {
  const h = crypto.createHash("sha256").update(String(AMBY_TASK_ID) + ":notify:" + JSON.stringify(payload)).digest();
  const hex = h.toString("hex").slice(0, 32);
  return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-" + hex.slice(12, 16) + "-" + hex.slice(16, 20) + "-" + hex.slice(20, 32);
}

async function main() {
  const raw = process.argv[2] || "{}";
  if (!AMBY_CALLBACK_URL || !AMBY_CALLBACK_SECRET || !AMBY_CALLBACK_ID || !AMBY_TASK_ID) return;
  let notification;
  try {
    notification = JSON.parse(raw);
  } catch {
    return;
  }
  if (notification.type !== "agent-turn-complete") return;
  const eventId = eventIdFromPayload(notification);
  const occurredAt = new Date().toISOString();
  const body = JSON.stringify({
    eventId,
    eventType: "codex.notify",
    taskId: AMBY_TASK_ID,
    status: null,
    message: null,
    seq: null,
    exitCode: null,
    sentAt: occurredAt,
    payload: {
      notification,
    },
  });
  const ts = String(Date.now());
  const hmac = crypto.createHmac("sha256", AMBY_CALLBACK_SECRET).update(ts + "." + body).digest("hex");
  try {
    const res = await fetch(AMBY_CALLBACK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + AMBY_CALLBACK_SECRET,
        "X-Amby-Callback-Id": AMBY_CALLBACK_ID,
        "X-Amby-Timestamp": ts,
        "X-Amby-Seq": "0",
        "X-Amby-Signature": "sha256=" + hmac,
      },
      body,
    });
    if (!res.ok) console.error("[notify] callback failed with status", res.status);
  } catch (e) {
    console.error("[notify] callback error:", e.message || e);
  }
}

main();
`
}

/** Shell orchestrator: heartbeats, status.json, stdout/stderr capture. */
export function buildRunShScript(): string {
	const heartbeatSec = Math.max(1, Math.floor(CALLBACK_HEARTBEAT_INTERVAL_MS / 1000))
	return `#!/bin/sh
cd workspace || { echo "Failed to enter workspace" >&2; exit 1; }
set -a
. ../.env
set +a
rm -f ../.env || true
SEQ="\${AMBY_EVENT_SEQ_START:-1}"
ARTIFACTS="../artifacts"

send() {
  node ../callback.js "$1" "$2" "$3" "$SEQ" "$4" >>../artifacts/callback.log 2>&1 || true
  SEQ=$((SEQ + 1))
}

write_status() {
  node -e '
    var a=process.argv, s=a[1], x=a[2], m=a[3], q=a[4], t=a[5];
    var j=JSON.stringify({taskId:t,status:s,seq:Number(q),exitCode:x===""?null:Number(x),message:m,updatedAt:new Date().toISOString()});
    require("fs").writeFileSync(a[6]+"/status.json",j);
  ' "$1" "$2" "$3" "$SEQ" "$AMBY_TASK_ID" "$ARTIFACTS" >>../artifacts/callback.log 2>&1 || true
}

write_status "running" "" "preparing"
send "task.started" "running" "Task started" ""
prompt=$(cat prompt.txt) || { write_status "failed" "1" "Missing prompt.txt"; send "task.failed" "failed" "Missing prompt.txt" "1"; exit 1; }
codex exec --full-auto -o ../artifacts/result.md "$prompt" \\
  >../artifacts/stdout.log 2>../artifacts/stderr.log &
CODEX_PID=$!

while kill -0 $CODEX_PID 2>/dev/null; do
  sleep ${heartbeatSec}
  write_status "running" "" "heartbeat"
  send "task.heartbeat" "running" "still running" ""
done

wait $CODEX_PID
EXIT_CODE=$?

if [ "$EXIT_CODE" -eq 0 ]; then
  RESULT=$(head -c 2000 ../artifacts/result.md 2>/dev/null || echo "Task completed")
  write_status "succeeded" "$EXIT_CODE" "$RESULT"
  send "task.completed" "succeeded" "$RESULT" "$EXIT_CODE"
else
  ERR_TAIL=$(tail -c 1000 ../artifacts/stderr.log 2>/dev/null | head -c 500 || echo "Unknown error")
  write_status "failed" "$EXIT_CODE" "$ERR_TAIL"
  send "task.failed" "failed" "$ERR_TAIL" "$EXIT_CODE"
fi
`
}
