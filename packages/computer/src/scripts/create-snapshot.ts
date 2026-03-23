import { readFileSync } from "node:fs"
import { join } from "node:path"
import { Daytona } from "@daytonaio/sdk"
import { SANDBOX_RESOURCES } from "../config"

const version = readFileSync(
	join(import.meta.dir, "../../../../docker/computer/VERSION"),
	"utf-8",
).trim()

const snapshotName = `amby/computer:${version}`
const dockerImage = `docker.io/punitarani/amby:computer-${version}`

const daytona = new Daytona({
	apiKey: process.env.DAYTONA_API_KEY ?? "",
	apiUrl: process.env.DAYTONA_API_URL ?? "https://app.daytona.io/api",
})

// Check if snapshot already exists (idempotent)
try {
	await daytona.snapshot.get(snapshotName)
	console.log(`Snapshot '${snapshotName}' already exists — skipping creation.`)
	process.exit(0)
} catch {
	// Not found — proceed to create
}

console.log(`Creating Daytona snapshot '${snapshotName}' from '${dockerImage}'...`)
await daytona.snapshot.create(
	{ name: snapshotName, image: dockerImage, resources: SANDBOX_RESOURCES },
	{ onLogs: (log: string) => process.stdout.write(log) },
)
console.log(`Done: snapshot '${snapshotName}' registered.`)
