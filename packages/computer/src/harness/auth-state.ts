export type CodexAuthMethod = "api_key" | "chatgpt"
export type CodexAuthStatus = "unauthenticated" | "pending" | "authenticated" | "invalid"

export interface CodexPendingDeviceAuth {
	type: "device_code"
	verificationUri: string
	userCode: string
	sessionId: string
	commandId: string
	startedAt: string
}

export interface CodexAuthCache {
	method: CodexAuthMethod
	accountId?: string
	workspaceId?: string
	planType?: string
	lastRefresh?: string
	updatedAt: string
}

export interface CodexAuthConfig {
	preferredMethod?: CodexAuthMethod
	status?: CodexAuthStatus
	apiKeyLast4?: string
	cache?: CodexAuthCache
	pending?: CodexPendingDeviceAuth
	lastError?: string
	updatedAt?: string
}

export interface HarnessAuthConfig {
	codex?: CodexAuthConfig
}

export interface CodexAuthSummary {
	method?: CodexAuthMethod
	status: CodexAuthStatus
	apiKeyLast4?: string
	accountId?: string
	workspaceId?: string
	planType?: string
	lastRefresh?: string
	error?: string
	pending?: Pick<CodexPendingDeviceAuth, "type" | "verificationUri" | "userCode" | "startedAt">
}

export const asRecord = (value: unknown): Record<string, unknown> =>
	typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {}

export const readHarnessAuthConfig = (value: unknown): HarnessAuthConfig => {
	const root = asRecord(value)
	const codex = asRecord(root.codex)
	return Object.keys(codex).length === 0 ? {} : { codex: codex as CodexAuthConfig }
}

const writeCodexConfig = (
	input: unknown,
	transform: (current: CodexAuthConfig) => CodexAuthConfig | undefined,
): HarnessAuthConfig => {
	const current = readHarnessAuthConfig(input)
	const next = transform(current.codex ?? {})
	if (!next) {
		const { codex: _codex, ...rest } = current
		return rest
	}
	return { ...current, codex: next }
}

const withTimestamp = (config: CodexAuthConfig): CodexAuthConfig => ({
	...config,
	updatedAt: new Date().toISOString(),
})

export const setCodexPendingDeviceAuth = (
	input: unknown,
	pending: CodexPendingDeviceAuth,
): HarnessAuthConfig =>
	writeCodexConfig(input, (current) =>
		withTimestamp({
			...current,
			preferredMethod: "chatgpt",
			status: "pending",
			apiKeyLast4: undefined,
			cache: undefined,
			pending,
			lastError: undefined,
		}),
	)

export const setCodexAuthenticated = (
	input: unknown,
	cache: CodexAuthCache,
	apiKeyLast4?: string,
): HarnessAuthConfig =>
	writeCodexConfig(input, (current) =>
		withTimestamp({
			...current,
			preferredMethod: cache.method,
			status: "authenticated",
			apiKeyLast4: cache.method === "api_key" ? (apiKeyLast4 ?? current.apiKeyLast4) : undefined,
			cache,
			pending: undefined,
			lastError: undefined,
		}),
	)

export const setCodexInvalid = (input: unknown, message: string): HarnessAuthConfig =>
	writeCodexConfig(input, (current) =>
		withTimestamp({
			...current,
			status: current.preferredMethod ? "invalid" : "unauthenticated",
			pending: undefined,
			lastError: message,
		}),
	)

export const clearCodexAuth = (input: unknown): HarnessAuthConfig =>
	writeCodexConfig(input, () => undefined)

export const summarizeCodexAuth = (input: unknown): CodexAuthSummary => {
	const codex = readHarnessAuthConfig(input).codex
	if (!codex) return { status: "unauthenticated" }

	return {
		method: codex.cache?.method ?? codex.preferredMethod,
		status: codex.status ?? "unauthenticated",
		apiKeyLast4: codex.apiKeyLast4,
		accountId: codex.cache?.accountId,
		workspaceId: codex.cache?.workspaceId,
		planType: codex.cache?.planType,
		lastRefresh: codex.cache?.lastRefresh,
		error: codex.lastError,
		pending: codex.pending
			? {
					type: codex.pending.type,
					verificationUri: codex.pending.verificationUri,
					userCode: codex.pending.userCode,
					startedAt: codex.pending.startedAt,
				}
			: undefined,
	}
}
