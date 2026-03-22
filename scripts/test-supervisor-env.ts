/**
 * Tests that the supervisor's Effect EnvService layer can read the Braintrust harness vars.
 * Simulates exactly what the supervisor does at startup.
 *
 * Run with: doppler run -- bun run scripts/test-supervisor-env.ts
 */

import { Effect, ManagedRuntime } from "effect"
import { EnvServiceLive } from "../packages/env/src/local"
import { EnvService } from "../packages/env/src/shared"

const runtime = ManagedRuntime.make(EnvServiceLive)

const result = await runtime.runPromise(
	Effect.gen(function* () {
		const env = yield* EnvService
		return {
			BRAINTRUST_HARNESS_API_KEY: env.BRAINTRUST_HARNESS_API_KEY
				? `set (last 4: ...${env.BRAINTRUST_HARNESS_API_KEY.slice(-4)})`
				: "EMPTY — key creation will be skipped!",
			BRAINTRUST_HARNESS_PROJECT_ID: env.BRAINTRUST_HARNESS_PROJECT_ID || "(empty)",
			BRAINTRUST_HARNESS_ORG_NAME: env.BRAINTRUST_HARNESS_ORG_NAME || "(empty)",
			NODE_ENV: env.NODE_ENV,
		}
	}),
)

await runtime.dispose()

console.log("EnvService values as seen by the supervisor layer:\n")
for (const [k, v] of Object.entries(result)) {
	const ok = !String(v).includes("EMPTY")
	console.log(`  ${ok ? "✅" : "❌"} ${k}: ${v}`)
}

if (result.BRAINTRUST_HARNESS_API_KEY.includes("EMPTY")) {
	console.log(
		"\n⚠️  BRAINTRUST_HARNESS_API_KEY is empty in the Effect layer — restart the API after setting it.",
	)
}
