import { type TaskStatus, TERMINAL_STATUSES } from "@amby/core"

export { TERMINAL_STATUSES }

export function isTerminal(status: TaskStatus): boolean {
	return TERMINAL_STATUSES.includes(status)
}

/**
 * Whether `from` → `to` is allowed for control-plane status updates.
 *
 * - `terminal → terminal` with same status: allowed (no-op).
 * - `terminal → anything else`: rejected.
 * - Non-terminal → terminal: allowed (completion paths from harness, supervisor, reconciler).
 * - `running` may follow `pending`, `awaiting_auth`, `preparing`, or `running`.
 * - `preparing` may follow only `pending` or `awaiting_auth`.
 */
export function isLegalTransition(from: TaskStatus, to: TaskStatus): boolean {
	if (from === to) return true
	if (isTerminal(from)) return false

	if (isTerminal(to)) {
		return true
	}

	switch (to) {
		case "running":
			return (
				from === "pending" || from === "awaiting_auth" || from === "preparing" || from === "running"
			)
		case "preparing":
			return from === "pending" || from === "awaiting_auth"
		case "awaiting_auth":
			return from === "pending" || from === "awaiting_auth"
		case "pending":
			return from === "pending"
		default:
			return false
	}
}
