export interface CodexApiKeyPayload {
	schemaVersion: 1
	method: "api_key"
	apiKey: string
}

export interface CodexChatgptHomePayload {
	schemaVersion: 1
	method: "chatgpt"
	archiveFormat: "json" | "tar.gz"
	archiveBase64: string
	capturedAt: string // ISO timestamp
}

export type CodexCredentialPayload = CodexApiKeyPayload | CodexChatgptHomePayload
