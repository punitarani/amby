import { AuthService } from "@amby/auth"
import { Effect } from "effect"
import { requireFlag } from "./args"
import { makeVoiceBaseRuntime } from "./runtime"

const printUsage = () => {
	console.log(
		'Usage: bun run voice:create-user -- --name "Voice User" --email user@example.com --password secret123',
	)
}

const main = async () => {
	if (process.argv.includes("--help")) {
		printUsage()
		return
	}

	const name = requireFlag("--name")
	const email = requireFlag("--email")
	const password = requireFlag("--password")
	const runtime = makeVoiceBaseRuntime()

	try {
		const user = await runtime.runPromise(
			Effect.gen(function* () {
				const auth = yield* AuthService
				const result = yield* Effect.tryPromise({
					try: () => auth.api.createUser({ body: { name, email, password } }),
					catch: (cause) =>
						cause instanceof Error ? cause : new Error(`Failed to create user: ${String(cause)}`),
				})

				return result.user
			}),
		)

		console.log(JSON.stringify({ id: user.id, email: user.email, name: user.name }, null, 2))
	} finally {
		await runtime.dispose()
	}
}

void main().catch((error) => {
	console.error(error instanceof Error ? error.message : error)
	printUsage()
	process.exit(1)
})
