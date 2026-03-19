import type { Sandbox } from "@daytonaio/sdk"

export interface TaskConfig {
	taskId: string
	prompt: string
	authMode: "api_key" | "chatgpt_account"
	needsBrowser: boolean
	model?: string
	timeoutSeconds?: number
	instructions?: string
}

export interface TaskResult {
	output: string
	summary: string
}

export interface TaskProvider {
	readonly name: string
	/** Prepare task workspace and return the shell command to execute */
	prepareAndBuildCommand(sandbox: Sandbox, config: TaskConfig): Promise<string>
	/** Parse results from sandbox filesystem after execution */
	collectResult(sandbox: Sandbox, artifactRoot: string): Promise<TaskResult>
}
