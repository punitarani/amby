import type { Sandbox } from "@daytonaio/sdk"
import { tool } from "ai"
import type { Context } from "effect"
import { Effect } from "effect"
import { z } from "zod"
import type { SandboxService } from "./sandbox"

type SandboxOps = Context.Tag.Service<typeof SandboxService>

export function createComputerTools(sandbox: SandboxOps, userId: string) {
	const state = { instance: null as Sandbox | null }

	const ensureSandbox = Effect.gen(function* () {
		if (state.instance) return state.instance
		state.instance = yield* sandbox.ensure(userId)
		return state.instance
	})

	const withSandbox = async <T>(fn: (instance: Sandbox) => Promise<T>): Promise<T | string> => {
		try {
			const instance = await Effect.runPromise(ensureSandbox)
			return await fn(instance)
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err)
			const detail = err instanceof Error && err.cause ? ` | cause: ${err.cause}` : ""
			console.error(`[Sandbox] Error: ${message}${detail}`)
			if (err instanceof Error && err.stack) {
				console.error(`[Sandbox] Stack: ${err.stack}`)
			}
			if (message.includes("not configured")) {
				return "Computer access is not available — DAYTONA_API_KEY is not configured. Let the user know they can enable sandbox features by setting up a Daytona API key in their .env file (sign up at https://app.daytona.io)."
			}
			return `Sandbox error: ${message}. The sandbox may be temporarily unavailable. Try again in a moment.`
		}
	}

	const tools = {
		execute_command: tool({
			description:
				"Execute a shell command in the user's sandbox computer. Use for running scripts, installing packages, system operations, etc.",
			inputSchema: z.object({
				command: z.string().describe("The shell command to execute"),
				cwd: z.string().optional().describe("Working directory (defaults to home)"),
			}),
			execute: async ({ command, cwd }) =>
				withSandbox(async (instance) => {
					const result = await Effect.runPromise(sandbox.exec(instance, command, cwd))
					return { stdout: result.stdout.slice(0, 4000), exitCode: result.exitCode }
				}),
		}),

		read_file: tool({
			description: "Read the contents of a file from the user's sandbox computer.",
			inputSchema: z.object({
				path: z.string().describe("Absolute path to the file"),
			}),
			execute: async ({ path }) =>
				withSandbox(async (instance) => {
					const content = await Effect.runPromise(sandbox.readFile(instance, path))
					return { content: content.slice(0, 8000) }
				}),
		}),

		write_file: tool({
			description: "Write content to a file in the user's sandbox computer.",
			inputSchema: z.object({
				path: z.string().describe("Absolute path to the file"),
				content: z.string().describe("Content to write"),
			}),
			execute: async ({ path, content }) =>
				withSandbox(async (instance) => {
					await Effect.runPromise(sandbox.writeFile(instance, path, content))
					return { written: true, path }
				}),
		}),
	}

	return { tools, getSandbox: () => state.instance }
}
