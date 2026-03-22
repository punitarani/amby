/**
 * Check recent tasks to see if OTEL key IDs are stored in metadata.
 * Run with: bun run scripts/check-task-otel.ts [taskId]
 *
 * With no args, shows the 5 most recent tasks.
 */

import postgres from "../packages/db/node_modules/postgres/src/index.js"

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
	console.error("❌ DATABASE_URL is not set.")
	process.exit(1)
}

const sql = postgres(DATABASE_URL, { max: 1 })

const taskId = process.argv[2]

if (taskId) {
	const rows = await sql`
		SELECT id, status, created_at, metadata, sandbox_id
		FROM tasks
		WHERE id = ${taskId}
		LIMIT 1
	`
	if (!rows[0]) {
		console.log(`No task found with id ${taskId}`)
	} else {
		const t = rows[0]
		console.log(`Task: ${t.id}`)
		console.log(`  Status:     ${t.status}`)
		console.log(`  Created:    ${t.created_at}`)
		console.log(`  Sandbox:    ${t.sandbox_id}`)
		console.log(`  Metadata:   ${JSON.stringify(t.metadata)}`)
		if (t.metadata?.otelKeyId) {
			console.log(`  ✅ otelKeyId: ${t.metadata.otelKeyId}`)
		} else {
			console.log(`  ❌ No otelKeyId in metadata — OTEL key was NOT created for this task`)
		}
	}
} else {
	const rows = await sql`
		SELECT id, status, created_at, metadata, sandbox_id
		FROM tasks
		ORDER BY created_at DESC
		LIMIT 10
	`
	console.log(`Last ${rows.length} tasks:\n`)
	for (const t of rows) {
		const hasOtel = t.metadata?.otelKeyId ? "✅ otel" : "❌ no-otel"
		console.log(`  ${t.id}  ${t.status.padEnd(12)} ${hasOtel}  created=${t.created_at.toISOString().slice(0, 19)}`)
	}
}

await sql.end()
