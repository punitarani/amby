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
  const ts = String(Date.now());
  const hmac = crypto.createHmac("sha256", AMBY_CALLBACK_SECRET).update(ts + "." + body).digest("hex");
  try {
    await fetch(AMBY_CALLBACK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + AMBY_CALLBACK_SECRET,
        "X-Amby-Callback-Id": AMBY_CALLBACK_ID,
        "X-Amby-Timestamp": ts,
        "X-Amby-Seq": seq,
        "X-Amby-Signature": "sha256=" + hmac,
      },
      body,
    });
  } catch (_) {}
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
    await fetch(AMBY_CALLBACK_URL, {
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
  } catch (_) {}
}

main();
`
}

/** Shell orchestrator: heartbeats, status.json, stdout/stderr capture. */
export function buildRunShScript(): string {
	const heartbeatSec = Math.max(1, Math.floor(CALLBACK_HEARTBEAT_INTERVAL_MS / 1000))
	return `#!/bin/sh
set -a
. ../.env
set +a
rm -f ../.env || true
SEQ="\${AMBY_EVENT_SEQ_START:-1}"
ARTIFACTS="../artifacts"

send() {
  node ../callback.js "$1" "$2" "$3" "$SEQ" "$4" 2>/dev/null || true
  SEQ=$((SEQ + 1))
}

write_status() {
  jq -n --arg st "$1" --arg exit "$2" --arg msg "$3" --arg seq "$SEQ" --arg tid "$AMBY_TASK_ID" \\
    '{taskId:$tid, status:$st, seq:($seq|tonumber), exitCode:(if $exit=="" then null else ($exit|tonumber) end), message:$msg, updatedAt:(now|todate)}' > "$ARTIFACTS/status.json"
}

write_status "running" "" "preparing"
send "task.started" "running" "Task started" ""

cd workspace
prompt=$(cat prompt.txt)
codex exec --full-auto --output-last-message -o ../artifacts/result.md "$prompt" \\
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
  write_status "succeeded" "$EXIT_CODE" "Task completed"
  send "task.completed" "succeeded" "Task completed" "$EXIT_CODE"
else
  write_status "failed" "$EXIT_CODE" "Task failed"
  send "task.failed" "failed" "Task failed" "$EXIT_CODE"
fi
`
}
