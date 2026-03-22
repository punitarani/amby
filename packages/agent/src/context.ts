import { and, desc, eq, inArray, ne, schema } from "@amby/db"
import { Effect } from "effect"
import { messageThreadFilter } from "./router"
import { formatToolAnnotation } from "./traces"

const THREAD_TAIL_LIMIT = 20
const ARTIFACT_MSG_LIMIT = 5
const OTHER_THREAD_CAP = 5
const RECENT_WITH_TOOLS = 4
const ARTIFACT_TRUNCATE = 400

export { THREAD_TAIL_LIMIT }

type QueryFn = <T>(
	fn: (db: import("@amby/db").Database) => Promise<T>,
) => Effect.Effect<T, import("@amby/db").DbError>

export function buildReplayMessages(
	rows: Array<{
		role: string
		content: string
		traceAnnotation?: string
	}>,
): Array<{ role: "user" | "assistant"; content: string }> {
	const filtered = rows.filter(
		(
			r,
		): r is {
			role: "user" | "assistant"
			content: string
			traceAnnotation?: string
		} => r.role === "user" || r.role === "assistant",
	)
	const recentStart = Math.max(0, filtered.length - RECENT_WITH_TOOLS)
	return filtered.map((row, i) => {
		if (i < recentStart || row.role !== "assistant" || !row.traceAnnotation) {
			return { role: row.role, content: row.content }
		}
		return {
			role: row.role,
			content: `${row.content}\n\n${row.traceAnnotation}`,
		}
	})
}

export function formatArtifactRecap(
	rows: ReadonlyArray<{ traceAnnotation?: string; content: string }>,
	threadLabel: string | null,
): string {
	const bullets: string[] = []
	for (const row of rows) {
		if (row.traceAnnotation?.trim()) {
			const s =
				row.traceAnnotation.length > ARTIFACT_TRUNCATE
					? `${row.traceAnnotation.slice(0, ARTIFACT_TRUNCATE)}…`
					: row.traceAnnotation
			// Split multi-line annotations into separate bullets
			for (const line of s.trim().split("\n")) {
				if (line.trim()) bullets.push(line.trim())
			}
		}
	}
	if (bullets.length === 0) return ""
	const title = threadLabel?.trim() || "this topic"
	return `## Thread context (${title})\n${bullets.map((b) => `- ${b}`).join("\n")}`
}

export function loadThreadTail(
	query: QueryFn,
	conversationId: string,
	threadId: string,
	limit = THREAD_TAIL_LIMIT,
) {
	return Effect.gen(function* () {
		// Load messages
		const msgRows = yield* query((d) =>
			d
				.select({
					id: schema.messages.id,
					role: schema.messages.role,
					content: schema.messages.content,
				})
				.from(schema.messages)
				.where(messageThreadFilter(conversationId, threadId))
				.orderBy(desc(schema.messages.createdAt))
				.limit(limit),
		)

		const reversed = msgRows.reverse()

		// For recent messages, load trace annotations
		const recentStart = Math.max(0, reversed.length - RECENT_WITH_TOOLS)
		const recentMessageIds = reversed
			.slice(recentStart)
			.filter((r) => r.role === "assistant")
			.map((r) => r.id)

		const annotationMap = new Map<string, string>()
		if (recentMessageIds.length > 0) {
			// Load trace events for recent assistant messages
			const traceRows = yield* query((d) =>
				d
					.select({
						messageId: schema.traces.messageId,
						kind: schema.traceEvents.kind,
						payload: schema.traceEvents.payload,
					})
					.from(schema.traceEvents)
					.innerJoin(schema.traces, eq(schema.traceEvents.traceId, schema.traces.id))
					.where(
						and(
							eq(schema.traces.conversationId, conversationId),
							eq(schema.traceEvents.kind, "tool_result"),
							inArray(schema.traces.messageId, recentMessageIds),
						),
					),
			)

			// Group tool results by messageId
			const toolResultsByMessage = new Map<string, unknown[]>()
			for (const row of traceRows) {
				if (!row.messageId) continue
				const existing = toolResultsByMessage.get(row.messageId) ?? []
				existing.push({
					toolName: (row.payload as Record<string, unknown>).toolName,
					output: (row.payload as Record<string, unknown>).output,
				})
				toolResultsByMessage.set(row.messageId, existing)
			}

			for (const [msgId, results] of toolResultsByMessage) {
				const annotation = formatToolAnnotation(results)
				if (annotation) annotationMap.set(msgId, annotation)
			}
		}

		return buildReplayMessages(
			reversed.map((row) => ({
				role: row.role,
				content: row.content,
				traceAnnotation: annotationMap.get(row.id),
			})),
		)
	})
}

export function loadOtherThreadSummaries(
	query: QueryFn,
	conversationId: string,
	excludeThreadId: string,
) {
	return query((d) =>
		d
			.select({
				label: schema.conversationThreads.label,
				synopsis: schema.conversationThreads.synopsis,
			})
			.from(schema.conversationThreads)
			.where(
				and(
					eq(schema.conversationThreads.conversationId, conversationId),
					eq(schema.conversationThreads.status, "open"),
					ne(schema.conversationThreads.id, excludeThreadId),
				),
			)
			.orderBy(desc(schema.conversationThreads.lastActiveAt))
			.limit(OTHER_THREAD_CAP),
	).pipe(
		Effect.map((rows) => {
			const lines = rows
				.map((r) => {
					const label = r.label?.trim() || "Untitled"
					const syn = r.synopsis?.trim() || "(no summary yet)"
					return `- **${label}**: ${syn}`
				})
				.join("\n")
			return lines.length ? `## Other active threads\n${lines}` : ""
		}),
	)
}

export function loadThreadArtifacts(query: QueryFn, conversationId: string, threadId: string) {
	return Effect.gen(function* () {
		// Load recent assistant messages in thread
		const msgRows = yield* query((d) =>
			d
				.select({
					id: schema.messages.id,
					content: schema.messages.content,
				})
				.from(schema.messages)
				.where(
					and(messageThreadFilter(conversationId, threadId), eq(schema.messages.role, "assistant")),
				)
				.orderBy(desc(schema.messages.createdAt))
				.limit(ARTIFACT_MSG_LIMIT),
		)

		if (msgRows.length === 0) return []

		// Load tool_result trace events for these messages
		const traceRows = yield* query((d) =>
			d
				.select({
					messageId: schema.traces.messageId,
					payload: schema.traceEvents.payload,
				})
				.from(schema.traceEvents)
				.innerJoin(schema.traces, eq(schema.traceEvents.traceId, schema.traces.id))
				.where(
					and(
						eq(schema.traces.conversationId, conversationId),
						eq(schema.traceEvents.kind, "tool_result"),
						inArray(
							schema.traces.messageId,
							msgRows.map((r) => r.id),
						),
					),
				),
		)

		const annotationsByMessage = new Map<string, string>()

		for (const row of traceRows) {
			if (!row.messageId) continue
			const payload = row.payload as Record<string, unknown>
			const output = payload.output
			let summary = ""
			if (
				typeof output === "object" &&
				output !== null &&
				"summary" in output &&
				typeof output.summary === "string" &&
				output.summary.trim()
			) {
				summary = output.summary.trim()
			} else if (typeof output === "string" && output.trim()) {
				summary =
					output.length > ARTIFACT_TRUNCATE
						? `${output.slice(0, ARTIFACT_TRUNCATE)}…`
						: output.trim()
			}
			if (summary) {
				const existing = annotationsByMessage.get(row.messageId)
				annotationsByMessage.set(row.messageId, existing ? `${existing}\n${summary}` : summary)
			}
		}

		return msgRows.map((row) => ({
			content: row.content,
			traceAnnotation: annotationsByMessage.get(row.id),
		}))
	})
}
