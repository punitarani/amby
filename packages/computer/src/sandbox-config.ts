/**
 * Sandbox configuration constants and helpers shared with the provisioning workflow.
 * Separated from sandbox.ts to avoid pulling in heavy Effect/Daytona deps for simple config access.
 */
export {
	AGENT_USER,
	AUTO_ARCHIVE_MINUTES,
	AUTO_STOP_MINUTES,
	createDaytonaClient,
	SANDBOX_RESOURCES,
	sandboxImage,
	sandboxLabels,
	sandboxName,
} from "./sandbox"
