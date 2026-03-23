import type { JsonValue } from "./persistence"

export type SettingsTaskInput =
	| { kind: "timezone"; timezone: string }
	| { kind: "schedule"; description: string; schedule: JsonValue }
	| {
			kind: "codex_auth"
			action: "status" | "start_chatgpt" | "set_api_key" | "import_auth" | "clear"
			apiKey?: string
			authJson?: string
	  }
