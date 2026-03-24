import type { Sandbox } from "@daytonaio/sdk"
import { tool } from "ai"
import type { Context } from "effect"
import { Effect } from "effect"
import { z } from "zod"
import type { SandboxService } from "./service"
import { runWithEnsuredSandbox } from "./tool-run"

type SandboxOps = Context.Tag.Service<typeof SandboxService>

const READ_ONLY_BLOCKLIST = [
	/\b(?:rm|mv|cp|mkdir|touch|chmod|chown|truncate|dd|kill|pkill|nohup|ln)\b/,
	/\bsed\s+-i\b/,
	/\bgit\s+(?:add|commit|reset|checkout|restore|clean|merge|rebase|pull|push)\b/,
	/\b(?:npm|pnpm|yarn|bun)\s+(?:install|add|remove|update|upgrade)\b/,
	/(^|[^\w])>/,
	/\|\s*tee\b/,
	/\|\s*(?:sh|bash|zsh|dash)\b/,
	/\b(?:bash|sh|zsh)\s+-c\b/,
	/\beval\b/,
	/\bpython[23]?\s+-c\b/,
	/\b(?:node|ruby|perl|deno)\s+-e\b/,
	/\bdeno\s+eval\b/,
	/\bsudo\b/,
]

function assertReadOnlyCommand(command: string) {
	const trimmed = command.trim()
	if (!trimmed) {
		throw new Error("Command must not be empty.")
	}
	if (READ_ONLY_BLOCKLIST.some((pattern) => pattern.test(trimmed))) {
		throw new Error(`Command is not allowed in read-only mode: ${trimmed}`)
	}
}

export function createComputerTools(sandbox: SandboxOps, userId: string) {
	const state = { instance: null as Sandbox | null }

	const ensureSandbox = Effect.gen(function* () {
		if (state.instance) return state.instance
		state.instance = yield* sandbox.ensure(userId)
		return state.instance
	})

	const withSandbox = <T>(fn: (instance: Sandbox) => Promise<T>) =>
		runWithEnsuredSandbox(ensureSandbox, fn)

	const readTools = {
		execute_readonly_command: tool({
			description:
				"Execute a read-only shell command in the user's sandbox computer. Use for listing files, reading content, searching code, or other inspection-only operations.",
			inputSchema: z.object({
				command: z.string().describe("The read-only shell command to execute"),
				cwd: z.string().optional().describe("Working directory (defaults to home)"),
			}),
			execute: async ({ command, cwd }) => {
				assertReadOnlyCommand(command)
				return withSandbox(async (instance) => {
					const result = await Effect.runPromise(sandbox.exec(instance, command, cwd))
					return { stdout: result.stdout.slice(0, 4000), exitCode: result.exitCode }
				})
			},
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
	}

	const writeTools = {
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

	return {
		readTools,
		writeTools,
		tools: { ...readTools, ...writeTools },
		getSandbox: () => state.instance,
	}
}
