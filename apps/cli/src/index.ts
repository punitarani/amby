import {
	AgentService,
	JobRunnerService,
	JobRunnerServiceLive,
	makeAgentServiceLive,
} from "@amby/agent"
import { CLIChannel } from "@amby/channels"
import { SandboxService, SandboxServiceLive } from "@amby/computer"
import { DbService, DbServiceLive, eq, schema } from "@amby/db"
import { EnvServiceLive } from "@amby/env/local"
import { MemoryServiceLive } from "@amby/memory"
import { ModelServiceLive } from "@amby/models"
import { Effect, Layer } from "effect"

const userId: string = (() => {
	const flag = process.argv.indexOf("--user")
	if (flag !== -1) {
		const val = process.argv[flag + 1]
		if (val) return val
	}
	return "demo"
})()

const verifyUser = Effect.gen(function* () {
	const { query } = yield* DbService

	const rows = yield* query((db) =>
		db
			.select({ id: schema.users.id, name: schema.users.name, timezone: schema.users.timezone })
			.from(schema.users)
			.where(eq(schema.users.id, userId)),
	)

	const user = rows[0]
	if (!user) {
		console.error(`User "${userId}" not found. Run \`bun run seed\` first.`)
		process.exit(1)
	}

	// Auto-detect system timezone and update if user is still on the default
	const systemTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone
	if (user.timezone === "UTC" && systemTimezone && systemTimezone !== "UTC") {
		yield* query((db) =>
			db
				.update(schema.users)
				.set({ timezone: systemTimezone, updatedAt: new Date() })
				.where(eq(schema.users.id, userId)),
		)
		console.log(`Timezone auto-detected: ${systemTimezone}`)
	}

	return user
})

const program = Effect.gen(function* () {
	console.log("Starting Amby...\n")

	const user = yield* verifyUser
	console.log(`Database connected — logged in as ${user.name} (${user.id})`)

	const agent = yield* AgentService
	const jobRunner = yield* JobRunnerService
	const sandbox = yield* SandboxService
	console.log("Agent initialized (Claude Haiku 4.5 via OpenRouter)")
	console.log(
		`Sandbox: ${sandbox.enabled ? "Daytona connected (on-demand)" : "disabled (no DAYTONA_API_KEY)"}`,
	)

	const conversationId = yield* agent.ensureConversation("cli")

	yield* jobRunner.start((job) =>
		Effect.gen(function* () {
			const description = (job.payload as { description?: string })?.description ?? "Scheduled task"
			console.log(`\n[Job] Running: ${description}`)
			const response = yield* agent.handleMessage(conversationId, `[Scheduled Task] ${description}`)
			console.log(`\n${response}\n`)
		}),
	)
	console.log("Job runner started")

	const channel = new CLIChannel()
	channel.onMessage(async (msg) =>
		Effect.runPromise(agent.handleMessage(conversationId, msg.content)),
	)
	channel.onStreamingMessage(async (msg, onPart) =>
		Effect.runPromise(agent.streamMessage(conversationId, msg.content, onPart)),
	)

	console.log("\nAmby is ready. Type a message or /quit to exit.\n")
	yield* channel.start()

	yield* jobRunner.stop()
	yield* agent.shutdown()
})

const AppLive = Layer.mergeAll(makeAgentServiceLive(userId), JobRunnerServiceLive).pipe(
	Layer.provideMerge(Layer.mergeAll(MemoryServiceLive, SandboxServiceLive, ModelServiceLive)),
	Layer.provideMerge(DbServiceLive),
	Layer.provideMerge(EnvServiceLive),
)

Effect.runPromise(program.pipe(Effect.provide(AppLive)))
	.then(() => process.exit(0))
	.catch((err) => {
		console.error("Fatal error:", err)
		process.exit(1)
	})
