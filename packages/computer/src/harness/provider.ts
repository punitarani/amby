import type { Sandbox } from "@daytonaio/sdk"

export interface TaskConfig {
	taskId: string
	prompt: string
	authMode: "api_key" | "chatgpt_account"
	needsBrowser: boolean
	model?: string
	timeoutSeconds?: number
	instructions?: string
	/** Callback base URL (e.g. https://api.hiamby.com/internal/task-events). Omitted in local dev. */
	callbackUrl?: string
	callbackId?: string
	callbackSecret?: string
	conversationId?: string
}

export interface TaskResult {
	output: string
	summary: string
	stderr: string
}

export interface TaskProvider {
	readonly name: string
	/** Prepare task workspace and return the shell command to execute */
	prepareAndBuildCommand(sandbox: Sandbox, config: TaskConfig): Promise<string>
	/** Parse results from sandbox filesystem after execution */
	collectResult(sandbox: Sandbox, artifactRoot: string): Promise<TaskResult>
}
