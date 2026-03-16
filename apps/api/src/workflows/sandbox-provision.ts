import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers"
import {
	AGENT_USER,
	AUTO_ARCHIVE_MINUTES,
	AUTO_STOP_MINUTES,
	createDaytonaClient,
	SANDBOX_RESOURCES,
	sandboxImage,
	sandboxLabels,
	sandboxName,
} from "@amby/computer/sandbox-config"
import type { WorkerBindings } from "@amby/env/workers"

export interface SandboxProvisionParams {
	userId: string
}

export class SandboxProvisionWorkflow extends WorkflowEntrypoint<
	WorkerBindings,
	SandboxProvisionParams
> {
	async run(event: WorkflowEvent<SandboxProvisionParams>, step: WorkflowStep) {
		const { userId } = event.payload
		const isDev = this.env.NODE_ENV !== "production"
		const name = sandboxName(userId, isDev)

		// Fresh client per step — workflow steps may resume on different isolates
		const makeDaytona = () =>
			createDaytonaClient({
				apiKey: this.env.DAYTONA_API_KEY ?? "",
				apiUrl: this.env.DAYTONA_API_URL ?? "https://app.daytona.io/api",
				target: this.env.DAYTONA_TARGET ?? "us",
			})

		// Step 1: Check if sandbox already exists
		const exists = await step.do("check-existing", { timeout: "30 seconds" }, async () => {
			const daytona = makeDaytona()
			try {
				await daytona.get(name)
				return true
			} catch {
				return false
			}
		})

		if (exists) {
			console.log(`[SandboxProvision] Sandbox ${name} already exists, skipping`)
			return
		}

		// Step 2: Create the sandbox
		await step.do(
			"create-sandbox",
			{
				timeout: "5 minutes",
				retries: { limit: 2, delay: "10 seconds", backoff: "exponential" },
			},
			async () => {
				const daytona = makeDaytona()
				await daytona.create(
					{
						name,
						image: sandboxImage,
						resources: SANDBOX_RESOURCES,
						autoStopInterval: AUTO_STOP_MINUTES,
						autoArchiveInterval: AUTO_ARCHIVE_MINUTES,
						labels: sandboxLabels(userId, isDev),
						user: AGENT_USER,
					},
					{ timeout: 300 },
				)
			},
		)

		// Step 3: Stop and archive so it's ready to start later without rebuilding
		await step.do(
			"stop-and-archive",
			{
				timeout: "60 seconds",
				retries: { limit: 2, delay: "5 seconds", backoff: "exponential" },
			},
			async () => {
				const daytona = makeDaytona()
				const sandbox = await daytona.get(name)
				await sandbox.stop()
				await sandbox.archive()
			},
		)

		console.log(`[SandboxProvision] Successfully provisioned sandbox ${name}`)
	}
}
