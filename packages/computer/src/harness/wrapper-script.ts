/**
 * Shell wrapper for Codex task execution: callbacks (optional), heartbeats, status.json.
 * Requires: curl, jq, openssl (Ubuntu image). Does not use xxd.
 */
export function buildWrapperScript(): string {
	return `#!/bin/sh
set -a
. ./.env
set +a
SEQ="\${AMBY_EVENT_SEQ_START:-1}"
ARTIFACTS="../artifacts"
mkdir -p "$ARTIFACTS"

iso_now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

send_event() {
	[ -z "$AMBY_CALLBACK_URL" ] && return 0
	_type="$1"
	_status="$2"
	_msg="$3"
	_exit="$4"
	_ts=$(date +%s)000
	_sent=$(iso_now)
	BODY=$(jq -n \\
		--arg et "$_type" --arg tid "$AMBY_TASK_ID" --arg st "$_status" \\
		--arg msg "$_msg" --argjson seq "$SEQ" --arg ts "$_ts" --arg sent "$_sent" \\
		--arg exit "$_exit" \\
		'{
			eventType: $et,
			taskId: $tid,
			status: $st,
			message: $msg,
			seq: ($seq | tonumber),
			exitCode: (if $exit == "" then null else ($exit | tonumber) end),
			sentAt: $sent
		}')
	HMAC=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$AMBY_CALLBACK_SECRET" | awk '{print $NF}')
	curl -sf -X POST "$AMBY_CALLBACK_URL" \\
		-H "Content-Type: application/json" \\
		-H "Authorization: Bearer $AMBY_CALLBACK_SECRET" \\
		-H "X-Amby-Task-Id: $AMBY_TASK_ID" \\
		-H "X-Amby-Timestamp: $_ts" \\
		-H "X-Amby-Seq: $SEQ" \\
		-H "X-Amby-Signature: sha256=$HMAC" \\
		-d "$BODY" 2>/dev/null || true
	SEQ=$((SEQ + 1))
}

write_status() {
	_st="$1"
	_exit="$2"
	_msg="$3"
	_upd=$(iso_now)
	jq -n \\
		--arg tid "$AMBY_TASK_ID" --arg st "$_st" --arg exit "$_exit" \\
		--argjson seq "$SEQ" --arg msg "$_msg" --arg upd "$_upd" \\
		'{
			taskId: $tid,
			status: $st,
			seq: ($seq | tonumber),
			exitCode: (if $exit == "" then null else ($exit | tonumber) end),
			message: $msg,
			updatedAt: $upd
		}' > "$ARTIFACTS/status.json"
}

write_status "running" "" "preparing"
send_event "task.started" "running" "Task started" ""

cd workspace
prompt=$(cat prompt.txt)
codex exec --full-auto --output-last-message -o ../artifacts/result.md "$prompt" \\
	2>../artifacts/stderr.log &
CODEX_PID=$!

while kill -0 $CODEX_PID 2>/dev/null; do
	sleep 30
	write_status "running" "" "heartbeat"
	send_event "task.heartbeat" "running" "still running" ""
done

wait $CODEX_PID
EXIT_CODE=$?

if [ "$EXIT_CODE" -eq 0 ]; then
	write_status "succeeded" "$EXIT_CODE" "Task completed"
	send_event "task.completed" "succeeded" "Task completed" "$EXIT_CODE"
else
	write_status "failed" "$EXIT_CODE" "Task failed"
	send_event "task.failed" "failed" "Task failed" "$EXIT_CODE"
fi
`
}
