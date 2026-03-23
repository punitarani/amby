import { Daytona, DaytonaError, DaytonaNotFoundError } from "@daytonaio/sdk"
import { COMPUTER_DOCKER_IMAGE, COMPUTER_SNAPSHOT } from "../computer-snapshot"
import { SANDBOX_RESOURCES } from "../config"

function isNotFoundError(cause: unknown): boolean {
	if (cause instanceof DaytonaNotFoundError) return true
	if (cause instanceof DaytonaError && cause.statusCode === 404) return true

	const message = cause instanceof Error ? cause.message : String(cause)
	return /not found/i.test(message)
}

function isAlreadyExistsError(cause: unknown): boolean {
	if (cause instanceof DaytonaError && cause.statusCode === 409) return true

	const message = cause instanceof Error ? cause.message : String(cause)
	return /already exists|conflict/i.test(message)
}

const apiKey = process.env.DAYTONA_API_KEY?.trim()

if (!apiKey) {
	console.error("DAYTONA_API_KEY is required to register the computer snapshot.")
	process.exit(1)
}

const daytona = new Daytona({
	apiKey,
	apiUrl: process.env.DAYTONA_API_URL ?? "https://app.daytona.io/api",
})

// Check if snapshot already exists (idempotent)
let snapshotExists = false
try {
	await daytona.snapshot.get(COMPUTER_SNAPSHOT)
	snapshotExists = true
} catch (cause) {
	if (!isNotFoundError(cause)) throw cause
}

if (snapshotExists) {
	console.log(`Snapshot '${COMPUTER_SNAPSHOT}' already exists — skipping creation.`)
	process.exit(0)
}

console.log(`Creating Daytona snapshot '${COMPUTER_SNAPSHOT}' from '${COMPUTER_DOCKER_IMAGE}'...`)
try {
	await daytona.snapshot.create(
		{
			name: COMPUTER_SNAPSHOT,
			image: COMPUTER_DOCKER_IMAGE,
			resources: SANDBOX_RESOURCES,
		},
		{ onLogs: (log: string) => process.stdout.write(log) },
	)
	console.log(`Done: snapshot '${COMPUTER_SNAPSHOT}' registered.`)
} catch (cause) {
	if (!isAlreadyExistsError(cause)) throw cause
	console.log(`Snapshot '${COMPUTER_SNAPSHOT}' was created concurrently — skipping.`)
}
