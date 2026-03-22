import type { CodexAuthSummary, TaskSupervisor } from "@amby/computer"
import { tool } from "ai"
import type { Context } from "effect"
import { Effect } from "effect"
import { z } from "zod"
import { buildCodexDeviceSignInUserMessages } from "./codex-sign-in-messages"

type Supervisor = Context.Tag.Service<typeof TaskSupervisor>

const withUserMessages = (summary: CodexAuthSummary) =>
	summary.status === "pending" && summary.pending?.type === "device_code"
		? {
				...summary,
				userMessages: buildCodexDeviceSignInUserMessages(summary.pending.userCode),
			}
		: summary

export function createCodexAuthTools(supervisor: Supervisor, userId: string) {
	return {
		get_codex_auth_status: tool({
			description:
				"Check whether the Codex background worker is connected, whether setup is incomplete, and whether the user should finish ChatGPT login or provide an API key.",
			inputSchema: z.object({}),
			execute: async () =>
				withUserMessages(await Effect.runPromise(supervisor.getCodexAuthStatus(userId))),
		}),

		set_codex_api_key: tool({
			description:
				"Configure Codex to use an OpenAI API key in the user's sandbox. Use this for automation-friendly setup.",
			inputSchema: z.object({
				apiKey: z.string().describe("The OpenAI API key to store for Codex"),
			}),
			execute: async ({ apiKey }) => Effect.runPromise(supervisor.setCodexApiKey(userId, apiKey)),
		}),

		start_codex_chatgpt_login: tool({
			description:
				"Start ChatGPT device-code login for Codex inside the user's sandbox. Prefer this for Telegram, remote, VM, or other headless flows.",
			inputSchema: z.object({}),
			execute: async () =>
				withUserMessages(await Effect.runPromise(supervisor.startCodexChatgptAuth(userId))),
		}),

		import_codex_chatgpt_auth_json: tool({
			description:
				"Import a trusted Codex auth.json created on another machine after `codex login`. Use this only as a fallback when device login is not feasible.",
			inputSchema: z.object({
				authJson: z.string().describe("The full contents of ~/.codex/auth.json"),
			}),
			execute: async ({ authJson }) =>
				Effect.runPromise(supervisor.importCodexChatgptAuth(userId, authJson)),
		}),

		clear_codex_auth: tool({
			description: "Disconnect Codex and remove any cached Codex credentials from the sandbox.",
			inputSchema: z.object({}),
			execute: async () => Effect.runPromise(supervisor.clearCodexAuth(userId)),
		}),
	}
}
