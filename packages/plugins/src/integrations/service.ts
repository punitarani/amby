import { and, DbService, eq, schema, sql } from "@amby/db"
import { EnvService } from "@amby/env"
import { Composio } from "@composio/core"
import { VercelProvider } from "@composio/vercel"
import type { ToolSet } from "ai"
import { Context, Effect, Layer } from "effect"
import {
	buildConnectLinkUrl,
	COMPOSIO_DESTRUCTIVE_TAG,
	getIntegrationLabel,
	getIntegrationSuccessMessage,
	normalizeAppUrl,
} from "./constants"
import { ConnectorsError } from "./errors"
import {
	SUPPORTED_INTEGRATION_TOOLKITS,
	type SupportedIntegrationToolkit,
	TOOLKIT_REGISTRY,
} from "./registry"

export type IntegrationAccountSummary = {
	id: string
	authConfigId: string
	status: string
	statusReason: string | null
	isDisabled: boolean
	createdAt: string
	updatedAt: string
	isPreferred: boolean
}

export type IntegrationSummary = {
	toolkit: SupportedIntegrationToolkit
	label: string
	connected: boolean
	preferredConnectedAccountId: string | null
	accounts: IntegrationAccountSummary[]
}

export type ConnectIntegrationResult = {
	toolkit: SupportedIntegrationToolkit
	label: string
	redirectUrl: string
	callbackUrl: string
	userMessages: string[]
}

export type DisconnectIntegrationResult =
	| {
			disconnected: true
			toolkit: SupportedIntegrationToolkit
			connectedAccountId: string
	  }
	| {
			disconnected: false
			toolkit: SupportedIntegrationToolkit
			error: "not_connected" | "connected_account_not_found" | "multiple_connected_accounts"
			preferredConnectedAccountId?: string | null
			accounts?: IntegrationAccountSummary[]
	  }

export type SetPreferredIntegrationAccountResult = {
	updated: true
	toolkit: SupportedIntegrationToolkit
	connectedAccountId: string
}

export type ClearedPreferredAccount = {
	userId: string
	toolkit: SupportedIntegrationToolkit
}

export type ConnectedAccountSummary = {
	id: string
	userId: string
	toolkit: SupportedIntegrationToolkit
	status: string
	isDisabled: boolean
}

export type VerifiedComposioWebhook = {
	version: string
	rawPayload: unknown
	payload: unknown
}

type IntegrationAccountPreferenceRow = {
	userId: string
	provider: string
	externalAccountId: string | null
}

type PendingAuthRow = {
	id: string
	userId: string
	provider: string
	metadataJson: Record<string, unknown> | null
}

/**
 * Composio API returns inconsistent casing across SDK versions and endpoints
 * (e.g. userId vs user_id, isDisabled vs is_disabled). Both forms are listed
 * so pickConnectedAccountUserId/pickConnectedAccountDisabled can extract the
 * value regardless of which casing the SDK provides at runtime.
 */
type ConnectedAccountRecord = {
	id: string
	userId?: string
	user_id?: string
	status: string
	statusReason?: string | null
	isDisabled: boolean
	is_disabled?: boolean
	createdAt: string | Date
	updatedAt: string | Date
	authConfig?: { id?: string | null } | null
	toolkit: { slug: string }
}

const toIsoString = (value: unknown): string =>
	value instanceof Date ? value.toISOString() : String(value ?? "")

const buildOptionalRecord = <T extends string>(
	entries: ReadonlyArray<readonly [T, string]>,
): Partial<Record<T, string>> =>
	Object.fromEntries(entries.filter(([, value]) => value)) as Partial<Record<T, string>>

const CONNECT_INTEGRATION_LINK_TTL_MS = 5 * 60 * 1000

const buildConnectIntegrationUserMessages = (label: string, redirectUrl: string) => [
	`Here's the link to connect ${label}: ${redirectUrl}`,
	"Telegram should reopen when you're done. If not, come back and send /start.",
]

const isPendingAuthReusable = (
	row: Pick<PendingAuthRow, "metadataJson">,
	now = new Date(),
): boolean => {
	const expiresAt = row.metadataJson?.expiresAt
	if (typeof expiresAt !== "string") return false
	return new Date(expiresAt).getTime() > now.getTime()
}

const pickConnectedAccountUserId = (account: Partial<ConnectedAccountRecord>) =>
	typeof account.userId === "string"
		? account.userId
		: typeof account.user_id === "string"
			? account.user_id
			: undefined

const pickConnectedAccountDisabled = (account: Partial<ConnectedAccountRecord>) =>
	typeof account.isDisabled === "boolean"
		? account.isDisabled
		: typeof account.is_disabled === "boolean"
			? account.is_disabled
			: false

const byUpdatedAtDesc = (left: string, right: string) =>
	new Date(right).getTime() - new Date(left).getTime()

const sortAccounts = (accounts: IntegrationAccountSummary[]) =>
	[...accounts].sort((left, right) => {
		if (left.isPreferred !== right.isPreferred) return left.isPreferred ? -1 : 1
		if ((left.status === "ACTIVE") !== (right.status === "ACTIVE")) {
			return left.status === "ACTIVE" ? -1 : 1
		}
		return byUpdatedAtDesc(left.updatedAt, right.updatedAt)
	})

export function buildComposioCallbackUrl(
	appUrl: string,
	toolkit: SupportedIntegrationToolkit,
): string {
	return `${normalizeAppUrl(appUrl)}/integrations/callback?toolkit=${encodeURIComponent(toolkit)}`
}

export function buildComposioSessionConfig(params?: {
	authConfigs?: Partial<Record<SupportedIntegrationToolkit, string>>
	connectedAccounts?: Partial<Record<SupportedIntegrationToolkit, string>>
}) {
	const authConfigs = params?.authConfigs ?? {}
	const connectedAccounts = params?.connectedAccounts ?? {}

	return {
		manageConnections: false as const,
		toolkits: { enable: [...SUPPORTED_INTEGRATION_TOOLKITS] },
		tools: Object.fromEntries(
			SUPPORTED_INTEGRATION_TOOLKITS.map((toolkit) => [
				toolkit,
				{ enable: [...TOOLKIT_REGISTRY[toolkit].safeTools] },
			]),
		),
		tags: { disable: [COMPOSIO_DESTRUCTIVE_TAG] },
		workbench: { enable: true, enableProxyExecution: false },
		...(Object.keys(authConfigs).length > 0 ? { authConfigs } : {}),
		...(Object.keys(connectedAccounts).length > 0 ? { connectedAccounts } : {}),
	}
}

export class ConnectorsService extends Context.Tag("ConnectorsService")<
	ConnectorsService,
	{
		readonly isEnabled: () => boolean
		readonly getAgentTools: (userId: string) => Effect.Effect<ToolSet | undefined, ConnectorsError>
		readonly listIntegrations: (
			userId: string,
		) => Effect.Effect<IntegrationSummary[], ConnectorsError>
		readonly connectIntegration: (
			userId: string,
			toolkit: SupportedIntegrationToolkit,
		) => Effect.Effect<ConnectIntegrationResult, ConnectorsError>
		readonly disconnectIntegration: (
			userId: string,
			toolkit: SupportedIntegrationToolkit,
			connectedAccountId?: string,
		) => Effect.Effect<DisconnectIntegrationResult, ConnectorsError>
		readonly setPreferredIntegrationAccount: (
			userId: string,
			toolkit: SupportedIntegrationToolkit,
			connectedAccountId: string,
		) => Effect.Effect<SetPreferredIntegrationAccountResult, ConnectorsError>
		readonly clearPreferredAccountByConnectedAccountId: (
			connectedAccountId: string,
		) => Effect.Effect<ClearedPreferredAccount[], ConnectorsError>
		readonly clearPendingIntegrationRequest: (
			userId: string,
			toolkit: SupportedIntegrationToolkit,
		) => Effect.Effect<void, ConnectorsError>
		readonly getConnectedAccountById: (
			connectedAccountId: string,
		) => Effect.Effect<ConnectedAccountSummary | undefined, ConnectorsError>
		readonly resolveConnectLink: (id: string) => Effect.Effect<string | undefined, ConnectorsError>
		readonly verifyWebhook: (
			payload: string,
			headers: {
				signature?: string
				webhookId?: string
				webhookTimestamp?: string
			},
		) => Effect.Effect<VerifiedComposioWebhook, ConnectorsError>
	}
>() {}

export const ConnectorsServiceLive = Layer.effect(
	ConnectorsService,
	Effect.gen(function* () {
		const env = yield* EnvService
		const { db, query } = yield* DbService

		const client = env.COMPOSIO_API_KEY
			? new Composio({
					apiKey: env.COMPOSIO_API_KEY,
					provider: new VercelProvider(),
				})
			: null

		const getAuthConfigOverrides = () =>
			buildOptionalRecord<SupportedIntegrationToolkit>(
				Object.entries(TOOLKIT_REGISTRY).map(([slug, entry]) => [
					slug as SupportedIntegrationToolkit,
					env[entry.envKey as keyof typeof env] as string,
				]),
			)

		const ensureClient = () =>
			client
				? Effect.succeed(client)
				: Effect.fail(
						new ConnectorsError({
							message: "composio_not_configured",
						}),
					)

		const mapDatabaseError =
			(message: string) =>
			(cause: unknown): ConnectorsError =>
				new ConnectorsError({
					message,
					cause,
				})

		const listPreferenceRows = (userId: string) =>
			query((database) =>
				database
					.select({
						userId: schema.integrationAccounts.userId,
						provider: schema.integrationAccounts.provider,
						externalAccountId: schema.integrationAccounts.externalAccountId,
					})
					.from(schema.integrationAccounts)
					.where(
						and(
							eq(schema.integrationAccounts.userId, userId),
							eq(schema.integrationAccounts.isPreferred, true),
						),
					),
			).pipe(Effect.mapError(mapDatabaseError("failed_to_list_integration_preferences")))

		const getPendingAuthRequest = (userId: string, toolkit: SupportedIntegrationToolkit) =>
			query((database) =>
				database
					.select({
						id: schema.integrationAccounts.id,
						userId: schema.integrationAccounts.userId,
						provider: schema.integrationAccounts.provider,
						metadataJson: schema.integrationAccounts.metadataJson,
					})
					.from(schema.integrationAccounts)
					.where(
						and(
							eq(schema.integrationAccounts.userId, userId),
							eq(schema.integrationAccounts.provider, toolkit),
							eq(schema.integrationAccounts.status, "pending"),
						),
					)
					.limit(1),
			).pipe(
				Effect.map((rows) => rows[0]),
				Effect.mapError(mapDatabaseError("failed_to_read_pending_auth_request")),
			)

		const upsertPendingAuthRequest = (
			userId: string,
			toolkit: SupportedIntegrationToolkit,
			redirectUrl: string,
			callbackUrl: string,
			expiresAt: Date,
		) =>
			Effect.tryPromise({
				try: () =>
					db.transaction(async (tx) => {
						await tx
							.delete(schema.integrationAccounts)
							.where(
								and(
									eq(schema.integrationAccounts.userId, userId),
									eq(schema.integrationAccounts.provider, toolkit),
									eq(schema.integrationAccounts.status, "pending"),
								),
							)
						const rows = await tx
							.insert(schema.integrationAccounts)
							.values({
								userId,
								provider: toolkit,
								status: "pending",
								metadataJson: {
									redirectUrl,
									callbackUrl,
									expiresAt: expiresAt.toISOString(),
								},
							})
							.returning({ id: schema.integrationAccounts.id })
						return rows
					}),
				catch: mapDatabaseError("failed_to_write_pending_auth_request"),
			}).pipe(
				Effect.flatMap((rows) =>
					rows[0]
						? Effect.succeed(rows[0].id)
						: Effect.fail(
								new ConnectorsError({
									message: "failed_to_write_pending_auth_request",
								}),
							),
				),
			)

		const clearPendingAuthRequest = (userId: string, toolkit: SupportedIntegrationToolkit) =>
			query((database) =>
				database
					.delete(schema.integrationAccounts)
					.where(
						and(
							eq(schema.integrationAccounts.userId, userId),
							eq(schema.integrationAccounts.provider, toolkit),
							eq(schema.integrationAccounts.status, "pending"),
						),
					),
			).pipe(
				Effect.asVoid,
				Effect.mapError(mapDatabaseError("failed_to_clear_pending_auth_request")),
			)

		/** Best-effort cleanup of expired pending auth rows. */
		const purgeExpiredAuthRequests = () =>
			query((database) =>
				database
					.delete(schema.integrationAccounts)
					.where(
						and(
							eq(schema.integrationAccounts.status, "pending"),
							sql`(${schema.integrationAccounts.metadataJson}->>'expiresAt')::timestamptz <= now()`,
						),
					),
			).pipe(
				Effect.asVoid,
				Effect.catchAll(() => Effect.void),
			)

		const listAccountsForUser = (userId: string, toolkit?: SupportedIntegrationToolkit) =>
			Effect.gen(function* () {
				const composio = yield* ensureClient()
				const response = yield* Effect.tryPromise({
					try: () =>
						composio.connectedAccounts.list({
							userIds: [userId],
							toolkitSlugs: toolkit ? [toolkit] : [...SUPPORTED_INTEGRATION_TOOLKITS],
							limit: 100,
							orderBy: "updated_at",
						}),
					catch: (cause) =>
						new ConnectorsError({
							message: "failed_to_list_connected_accounts",
							cause,
						}),
				})

				return (response.items as ConnectedAccountRecord[]).filter(
					(item) => item?.toolkit?.slug in TOOLKIT_REGISTRY,
				)
			})

		const getPreferredAccountMap = (rows: IntegrationAccountPreferenceRow[]) =>
			Object.fromEntries(
				rows
					.filter(
						(
							row,
						): row is IntegrationAccountPreferenceRow & {
							provider: SupportedIntegrationToolkit
							externalAccountId: string
						} => row.provider in TOOLKIT_REGISTRY && typeof row.externalAccountId === "string",
					)
					.map((row) => [row.provider, row.externalAccountId]),
			) as Partial<Record<SupportedIntegrationToolkit, string>>

		const summarizeAccount = (
			account: ConnectedAccountRecord,
			preferredConnectedAccountId?: string,
		): IntegrationAccountSummary => ({
			id: account.id,
			authConfigId: account.authConfig?.id ?? "",
			status: account.status,
			statusReason: account.statusReason ?? null,
			isDisabled: pickConnectedAccountDisabled(account),
			createdAt: toIsoString(account.createdAt),
			updatedAt: toIsoString(account.updatedAt),
			isPreferred: preferredConnectedAccountId === account.id,
		})

		const summarizeToolkitAccounts = (
			accounts: ConnectedAccountRecord[],
			toolkit: SupportedIntegrationToolkit,
			preferredConnectedAccountId?: string,
		) =>
			sortAccounts(
				accounts
					.filter((account) => account.toolkit.slug === toolkit)
					.map((account) => summarizeAccount(account, preferredConnectedAccountId)),
			)

		return {
			isEnabled: () => Boolean(client),

			getAgentTools: (userId) =>
				Effect.gen(function* () {
					if (!client) return undefined

					const preferredRows = yield* listPreferenceRows(userId)
					const session = yield* Effect.tryPromise({
						try: () =>
							client.create(
								userId,
								buildComposioSessionConfig({
									authConfigs: getAuthConfigOverrides(),
									connectedAccounts: getPreferredAccountMap(preferredRows),
								}),
							),
						catch: (cause) =>
							new ConnectorsError({
								message: "failed_to_create_composio_session",
								cause,
							}),
					})

					const sessionTools = yield* Effect.tryPromise({
						try: () => session.tools(),
						catch: (cause) =>
							new ConnectorsError({
								message: "failed_to_fetch_composio_tools",
								cause,
							}),
					})

					return sessionTools as ToolSet
				}),

			listIntegrations: (userId) =>
				Effect.gen(function* () {
					const preferredRows = yield* listPreferenceRows(userId)
					const preferredAccountMap = getPreferredAccountMap(preferredRows)
					const accounts = client ? yield* listAccountsForUser(userId) : []

					return SUPPORTED_INTEGRATION_TOOLKITS.map((toolkit) => {
						const preferredConnectedAccountId = preferredAccountMap[toolkit]
						const toolkitAccounts = summarizeToolkitAccounts(
							accounts,
							toolkit,
							preferredConnectedAccountId,
						)

						return {
							toolkit,
							label: getIntegrationLabel(toolkit),
							connected: toolkitAccounts.some(
								(account) => account.status === "ACTIVE" && !account.isDisabled,
							),
							preferredConnectedAccountId: preferredConnectedAccountId ?? null,
							accounts: toolkitAccounts,
						}
					})
				}),

			connectIntegration: (userId, toolkit) =>
				Effect.gen(function* () {
					const composio = yield* ensureClient()
					yield* purgeExpiredAuthRequests()
					const label = getIntegrationLabel(toolkit)
					const callbackUrl = buildComposioCallbackUrl(env.APP_URL, toolkit)
					const accounts = yield* listAccountsForUser(userId, toolkit)
					const isAlreadyConnected = accounts.some(
						(account) => account.status === "ACTIVE" && !account.isDisabled,
					)

					if (isAlreadyConnected) {
						yield* clearPendingAuthRequest(userId, toolkit)
						return {
							toolkit,
							label,
							redirectUrl: callbackUrl,
							callbackUrl,
							userMessages: [getIntegrationSuccessMessage(toolkit)],
						}
					}

					const existingRequest = yield* getPendingAuthRequest(userId, toolkit)

					if (existingRequest && isPendingAuthReusable(existingRequest)) {
						const meta = existingRequest.metadataJson as Record<string, unknown>
						const connectUrl = buildConnectLinkUrl(env.API_URL, existingRequest.id)
						return {
							toolkit,
							label,
							redirectUrl: connectUrl,
							callbackUrl: typeof meta.callbackUrl === "string" ? meta.callbackUrl : callbackUrl,
							userMessages: buildConnectIntegrationUserMessages(label, connectUrl),
						}
					}

					const session = yield* Effect.tryPromise({
						try: () =>
							composio.create(
								userId,
								buildComposioSessionConfig({
									authConfigs: getAuthConfigOverrides(),
								}),
							),
						catch: (cause) =>
							new ConnectorsError({
								message: "failed_to_create_composio_session",
								cause,
							}),
					})

					const request = yield* Effect.tryPromise({
						try: () => session.authorize(toolkit, { callbackUrl }),
						catch: (cause) =>
							new ConnectorsError({
								message: "failed_to_authorize_integration",
								cause,
							}),
					})
					const redirectUrl = request.redirectUrl
					if (!redirectUrl) {
						return yield* new ConnectorsError({
							message: "missing_authorization_redirect_url",
						})
					}

					const rowId = yield* upsertPendingAuthRequest(
						userId,
						toolkit,
						redirectUrl,
						callbackUrl,
						new Date(Date.now() + CONNECT_INTEGRATION_LINK_TTL_MS),
					)
					const connectUrl = buildConnectLinkUrl(env.API_URL, rowId)

					return {
						toolkit,
						label,
						redirectUrl: connectUrl,
						callbackUrl,
						userMessages: buildConnectIntegrationUserMessages(label, connectUrl),
					}
				}),

			disconnectIntegration: (userId, toolkit, connectedAccountId) =>
				Effect.gen(function* () {
					const composio = yield* ensureClient()
					const [preferredRows, accounts] = yield* Effect.all([
						listPreferenceRows(userId),
						listAccountsForUser(userId, toolkit),
					])
					const preferredConnectedAccountId = getPreferredAccountMap(preferredRows)[toolkit] ?? null

					const toolkitAccounts = summarizeToolkitAccounts(
						accounts,
						toolkit,
						preferredConnectedAccountId ?? undefined,
					)

					if (toolkitAccounts.length === 0) {
						return {
							disconnected: false,
							toolkit,
							error: "not_connected" as const,
						}
					}

					const selectedAccount =
						(connectedAccountId
							? toolkitAccounts.find((account) => account.id === connectedAccountId)
							: undefined) ??
						(preferredConnectedAccountId
							? toolkitAccounts.find((account) => account.id === preferredConnectedAccountId)
							: undefined) ??
						(toolkitAccounts.length === 1 ? toolkitAccounts[0] : undefined)

					if (connectedAccountId && !selectedAccount) {
						return {
							disconnected: false,
							toolkit,
							error: "connected_account_not_found" as const,
							preferredConnectedAccountId,
							accounts: toolkitAccounts,
						}
					}

					if (!selectedAccount) {
						return {
							disconnected: false,
							toolkit,
							error: "multiple_connected_accounts" as const,
							preferredConnectedAccountId,
							accounts: toolkitAccounts,
						}
					}

					yield* Effect.tryPromise({
						try: () => composio.connectedAccounts.delete(selectedAccount.id),
						catch: (cause) =>
							new ConnectorsError({
								message: "failed_to_disconnect_integration",
								cause,
							}),
					})

					yield* query((database) =>
						database
							.update(schema.integrationAccounts)
							.set({ isPreferred: false, updatedAt: new Date() })
							.where(
								and(
									eq(schema.integrationAccounts.externalAccountId, selectedAccount.id),
									eq(schema.integrationAccounts.isPreferred, true),
								),
							),
					).pipe(Effect.mapError(mapDatabaseError("failed_to_clear_preferred_connected_account")))

					return {
						disconnected: true,
						toolkit,
						connectedAccountId: selectedAccount.id,
					}
				}),

			setPreferredIntegrationAccount: (userId, toolkit, connectedAccountId) =>
				Effect.gen(function* () {
					const accounts = yield* listAccountsForUser(userId, toolkit)
					const matchingAccount = accounts.find(
						(account) => account.toolkit.slug === toolkit && account.id === connectedAccountId,
					)

					if (!matchingAccount) {
						return yield* new ConnectorsError({
							message: "connected_account_not_found",
						})
					}

					// Clear isPreferred for all accounts of this user+provider
					yield* Effect.tryPromise({
						try: () =>
							db
								.update(schema.integrationAccounts)
								.set({ isPreferred: false, updatedAt: new Date() })
								.where(
									and(
										eq(schema.integrationAccounts.userId, userId),
										eq(schema.integrationAccounts.provider, toolkit),
										eq(schema.integrationAccounts.isPreferred, true),
									),
								),
						catch: (cause) =>
							new ConnectorsError({
								message: "failed_to_update_preferred_connected_account",
								cause,
							}),
					})

					// Upsert the target account as preferred
					yield* Effect.tryPromise({
						try: () =>
							db
								.insert(schema.integrationAccounts)
								.values({
									userId,
									provider: toolkit,
									externalAccountId: connectedAccountId,
									status: "active",
									isPreferred: true,
								})
								.onConflictDoUpdate({
									target: [
										schema.integrationAccounts.userId,
										schema.integrationAccounts.provider,
										schema.integrationAccounts.externalAccountId,
									],
									set: {
										isPreferred: true,
										status: "active",
										updatedAt: new Date(),
									},
								}),
						catch: (cause) =>
							new ConnectorsError({
								message: "failed_to_update_preferred_connected_account",
								cause,
							}),
					})

					return {
						updated: true,
						toolkit,
						connectedAccountId,
					}
				}),

			clearPreferredAccountByConnectedAccountId: (connectedAccountId) =>
				query((database) =>
					database
						.update(schema.integrationAccounts)
						.set({ isPreferred: false, updatedAt: new Date() })
						.where(
							and(
								eq(schema.integrationAccounts.externalAccountId, connectedAccountId),
								eq(schema.integrationAccounts.isPreferred, true),
							),
						)
						.returning({
							userId: schema.integrationAccounts.userId,
							toolkit: schema.integrationAccounts.provider,
						}),
				).pipe(
					Effect.map((rows) =>
						rows.filter((row): row is ClearedPreferredAccount => row.toolkit in TOOLKIT_REGISTRY),
					),
					Effect.mapError(mapDatabaseError("failed_to_clear_preferred_connected_account")),
				),

			clearPendingIntegrationRequest: (userId, toolkit) => clearPendingAuthRequest(userId, toolkit),

			getConnectedAccountById: (connectedAccountId) =>
				Effect.gen(function* () {
					const composio = yield* ensureClient()
					const account = (yield* Effect.tryPromise({
						try: () => composio.connectedAccounts.get(connectedAccountId),
						catch: (cause) =>
							new ConnectorsError({
								message: "failed_to_get_connected_account",
								cause,
							}),
					})) as Partial<ConnectedAccountRecord>

					const toolkit = account.toolkit?.slug
					const userId = pickConnectedAccountUserId(account)

					if (!toolkit || !(toolkit in TOOLKIT_REGISTRY) || !userId) {
						return undefined
					}

					return {
						id: typeof account.id === "string" ? account.id : connectedAccountId,
						userId,
						toolkit: toolkit as SupportedIntegrationToolkit,
						status: typeof account.status === "string" ? account.status : "",
						isDisabled: pickConnectedAccountDisabled(account),
					}
				}),

			resolveConnectLink: (id) =>
				query((database) =>
					database
						.select({
							metadataJson: schema.integrationAccounts.metadataJson,
						})
						.from(schema.integrationAccounts)
						.where(
							and(
								eq(schema.integrationAccounts.id, id),
								eq(schema.integrationAccounts.status, "pending"),
							),
						)
						.limit(1),
				).pipe(
					Effect.map((rows) => {
						const row = rows[0]
						if (!row || !isPendingAuthReusable(row)) return undefined
						const redirectUrl = row.metadataJson?.redirectUrl
						return typeof redirectUrl === "string" ? redirectUrl : undefined
					}),
					Effect.mapError(mapDatabaseError("failed_to_resolve_connect_link")),
				),

			verifyWebhook: (payload, headers) =>
				Effect.gen(function* () {
					const composio = yield* ensureClient()

					if (!env.COMPOSIO_WEBHOOK_SECRET) {
						return yield* new ConnectorsError({
							message: "missing_webhook_secret",
						})
					}

					if (!headers.signature || !headers.webhookId || !headers.webhookTimestamp) {
						return yield* new ConnectorsError({
							message: "missing_webhook_headers",
						})
					}
					const signature = headers.signature
					const webhookId = headers.webhookId
					const webhookTimestamp = headers.webhookTimestamp

					const verified = yield* Effect.tryPromise({
						try: () =>
							composio.triggers.verifyWebhook({
								payload,
								id: webhookId,
								signature,
								timestamp: webhookTimestamp,
								secret: env.COMPOSIO_WEBHOOK_SECRET,
							}),
						catch: (cause) =>
							new ConnectorsError({
								message: "webhook_verification_failed",
								cause,
							}),
					})

					return {
						version: verified.version,
						payload: verified.payload,
						rawPayload: verified.rawPayload,
					}
				}),
		}
	}),
)
