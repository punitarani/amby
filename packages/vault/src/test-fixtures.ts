/**
 * Shared in-memory mocks and test helpers for vault tests.
 * Imported by service.test.ts and codex/service.test.ts.
 */
import { Effect, Layer } from "effect"
import type {
	CodexAuthStateRow,
	VaultAccessLogEntry,
	VaultItem,
	VaultStoreService,
	VaultVersion,
} from "./types"
import { CodexAuthStore, VaultStore } from "./types"

// ---------------------------------------------------------------------------
// In-memory mock VaultStore
// ---------------------------------------------------------------------------

export type MockVaultStore = VaultStoreService & {
	items: Map<string, VaultItem>
	versions: Map<string, VaultVersion[]>
	accessLogs: VaultAccessLogEntry[]
}

export const makeMockVaultStore = (): MockVaultStore => {
	const items = new Map<string, VaultItem>()
	const versions = new Map<string, VaultVersion[]>()
	const accessLogs: VaultAccessLogEntry[] = []

	return {
		items,
		versions,
		accessLogs,

		insertItem: (values) =>
			Effect.sync(() => {
				const item: VaultItem = { ...values, createdAt: new Date(), updatedAt: new Date() }
				items.set(values.id, item)
				return item
			}),

		updateItem: (id, set) =>
			Effect.sync(() => {
				const item = items.get(id)
				if (item) items.set(id, { ...item, ...set, updatedAt: new Date() })
			}),

		getItemById: (id) => Effect.sync(() => items.get(id) ?? null),

		getItemByKey: (userId, namespace, itemKey) =>
			Effect.sync(() => {
				for (const item of items.values()) {
					if (
						item.userId === userId &&
						item.namespace === namespace &&
						item.itemKey === itemKey
					) {
						return item
					}
				}
				return null
			}),

		insertVersion: (values) =>
			Effect.sync(() => {
				const version: VaultVersion = { ...values, createdAt: new Date() }
				const list = versions.get(values.vaultId) ?? []
				list.push(version)
				versions.set(values.vaultId, list)
				return version
			}),

		getVersion: (vaultId, version) =>
			Effect.sync(() => {
				const list = versions.get(vaultId) ?? []
				return list.find((v) => v.version === version) ?? null
			}),

		getLatestVersion: (vaultId) =>
			Effect.sync(() => {
				const list = versions.get(vaultId) ?? []
				return list.length > 0 ? list[list.length - 1]! : null
			}),

		insertAccessLog: (values) =>
			Effect.sync(() => {
				accessLogs.push(values)
			}),
	}
}

// ---------------------------------------------------------------------------
// In-memory mock CodexAuthStore
// ---------------------------------------------------------------------------

export type MockCodexAuthStore = {
	rows: Map<string, CodexAuthStateRow>
	getByUserId: (userId: string) => Effect.Effect<CodexAuthStateRow | null>
	upsert: (
		userId: string,
		values: Partial<Omit<CodexAuthStateRow, "id" | "userId" | "createdAt" | "updatedAt">>,
	) => Effect.Effect<CodexAuthStateRow>
}

export const makeMockCodexAuthStore = (): MockCodexAuthStore => {
	const rows = new Map<string, CodexAuthStateRow>()
	return {
		rows,
		getByUserId: (userId) => Effect.sync(() => rows.get(userId) ?? null),
		upsert: (userId, values) =>
			Effect.sync(() => {
				const existing = rows.get(userId)
				const now = new Date()
				const row: CodexAuthStateRow = {
					id: existing?.id ?? crypto.randomUUID(),
					userId,
					activeVaultId: null,
					activeVaultVersion: null,
					method: "api_key",
					status: "unauthenticated",
					apiKeyLast4: null,
					accountId: null,
					workspaceId: null,
					planType: null,
					lastRefresh: null,
					pendingDeviceAuth: null,
					lastError: null,
					lastMaterializedVersion: null,
					lastMaterializedAt: null,
					createdAt: existing?.createdAt ?? now,
					updatedAt: now,
					...existing,
					...values,
				}
				rows.set(userId, row)
				return row
			}),
	}
}

// ---------------------------------------------------------------------------
// Test env stub — only vault-relevant fields (VAULT_KEK) matter
// ---------------------------------------------------------------------------

const testKekRaw = crypto.getRandomValues(new Uint8Array(32))
const testKekBase64 = btoa(String.fromCharCode(...testKekRaw))

export const makeTestEnv = () =>
	({
		VAULT_KEK: testKekBase64,
		VAULT_KEK_VERSION: "1",
		NODE_ENV: "test",
		API_URL: "",
		APP_URL: "",
		CLOUDFLARE_AI_GATEWAY_BASE_URL: "",
		CLOUDFLARE_AI_GATEWAY_AUTH_TOKEN: "",
		OPENROUTER_API_KEY: "",
		OPENAI_API_KEY: "",
		CARTESIA_API_KEY: "",
		DAYTONA_API_KEY: "",
		DAYTONA_API_URL: "",
		DAYTONA_TARGET: "",
		TELEGRAM_BOT_TOKEN: "",
		TELEGRAM_BOT_USERNAME: "",
		TELEGRAM_WEBHOOK_SECRET: "",
		ATTACHMENTS_SIGNING_SECRET: "",
		TELEGRAM_LOGIN_WIDGET_ENABLED: false,
		TELEGRAM_MINI_APP_ENABLED: false,
		TELEGRAM_OIDC_CLIENT_ID: "",
		TELEGRAM_OIDC_CLIENT_SECRET: "",
		TELEGRAM_OIDC_REQUEST_PHONE: false,
		TELEGRAM_OIDC_REQUEST_BOT_ACCESS: false,
		TELEGRAM_MAX_AUTH_AGE_SECONDS: 86400,
		COMPOSIO_API_KEY: "",
		COMPOSIO_WEBHOOK_SECRET: "",
		COMPOSIO_AUTH_CONFIG_GMAIL: "",
		COMPOSIO_AUTH_CONFIG_GOOGLECALENDAR: "",
		COMPOSIO_AUTH_CONFIG_NOTION: "",
		COMPOSIO_AUTH_CONFIG_SLACK: "",
		COMPOSIO_AUTH_CONFIG_GOOGLEDRIVE: "",
		DATABASE_URL: "",
		BETTER_AUTH_SECRET: "",
		BETTER_AUTH_URL: "",
		ENABLE_CUA: false,
		BRAINTRUST_API_KEY: "",
		BRAINTRUST_PROJECT_ID: "",
		POSTHOG_KEY: "",
		POSTHOG_HOST: "",
	}) as never

// ---------------------------------------------------------------------------
// Layer builders
// ---------------------------------------------------------------------------

export const makeVaultStoreLayer = (mock: MockVaultStore) => Layer.succeed(VaultStore, mock)
export const makeCodexAuthStoreLayer = (mock: MockCodexAuthStore) =>
	Layer.succeed(CodexAuthStore, mock)
