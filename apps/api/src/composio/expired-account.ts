import { TelegramSender } from "@amby/channels"
import { getTelegramChatId } from "@amby/computer"
import { and, DbService, eq, inArray, schema } from "@amby/db"
import { ConnectorsService, getIntegrationExpiredMessage } from "@amby/plugins/integrations"
import { Effect } from "effect"

export const handleExpiredConnectedAccount = (connectedAccountId: string) =>
	Effect.gen(function* () {
		const connectors = yield* ConnectorsService
		const sender = yield* TelegramSender
		const { query } = yield* DbService
		const expiredAccount = yield* connectors.getConnectedAccountById(connectedAccountId).pipe(
			Effect.catchAll((error) =>
				Effect.sync(() => {
					console.error(
						`[Composio] Failed to resolve connected account ${connectedAccountId}:`,
						error,
					)
					return undefined
				}),
			),
		)

		const cleared = yield* connectors.clearPreferredAccountByConnectedAccountId(connectedAccountId)
		const affectedIntegrations = new Map<string, (typeof cleared)[number]>()

		if (expiredAccount) {
			affectedIntegrations.set(`${expiredAccount.userId}:${expiredAccount.toolkit}`, {
				userId: expiredAccount.userId,
				toolkit: expiredAccount.toolkit,
			})
		}

		for (const row of cleared) {
			affectedIntegrations.set(`${row.userId}:${row.toolkit}`, row)
		}

		if (affectedIntegrations.size === 0) {
			return {
				status: "ok" as const,
				cleared: cleared.length,
				notified: 0,
			}
		}

		const affectedRows = [...affectedIntegrations.values()]
		const userIds = [...new Set(affectedRows.map((row) => row.userId))]
		const telegramAccounts =
			userIds.length === 0
				? []
				: yield* query((database) =>
						database
							.select({
								userId: schema.accounts.userId,
								telegramChatId: schema.accounts.telegramChatId,
							})
							.from(schema.accounts)
							.where(
								and(
									eq(schema.accounts.providerId, "telegram"),
									inArray(schema.accounts.userId, userIds),
								),
							),
					)

		const chatIdByUserId = new Map<string, number>()
		for (const account of telegramAccounts) {
			const chatId = getTelegramChatId(account.telegramChatId)
			if (chatId !== undefined && !chatIdByUserId.has(account.userId)) {
				chatIdByUserId.set(account.userId, chatId)
			}
		}

		let notified = 0
		for (const row of affectedRows) {
			const chatId = chatIdByUserId.get(row.userId)
			if (chatId === undefined) continue

			yield* Effect.tryPromise(() =>
				sender.sendMessage(chatId, getIntegrationExpiredMessage(row.toolkit)),
			).pipe(
				Effect.tap(() =>
					Effect.sync(() => {
						notified += 1
					}),
				),
				Effect.catchAll((error) =>
					Effect.sync(() => {
						console.error(
							`[Composio] Failed to send reconnect notice to Telegram chat ${chatId}:`,
							error,
						)
					}),
				),
			)
		}

		return {
			status: "ok" as const,
			cleared: cleared.length,
			notified,
		}
	})
