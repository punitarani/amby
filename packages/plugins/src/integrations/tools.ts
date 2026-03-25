import type { IntegrationProvider, IntegrationRepository } from "@amby/core"
import { tool } from "ai"
import { Effect } from "effect"
import { z } from "zod"

const SUPPORTED_PROVIDERS: IntegrationProvider[] = [
	"gmail",
	"googlecalendar",
	"notion",
	"slack",
	"googledrive",
]

const INTEGRATION_LABELS: Record<IntegrationProvider, string> = {
	gmail: "Gmail",
	googlecalendar: "Google Calendar",
	notion: "Notion",
	slack: "Slack",
	googledrive: "Google Drive",
}

const providerEnum = z.enum(["gmail", "googlecalendar", "notion", "slack", "googledrive"])

export interface IntegrationToolsConfig {
	readonly integrationRepo: IntegrationRepository
	readonly userId: string
	/**
	 * Callback to initiate an OAuth connection flow.
	 * The composition root provides this, typically backed by Composio.
	 */
	readonly connectProvider?: (
		userId: string,
		provider: IntegrationProvider,
	) => Promise<{ redirectUrl: string; messages: string[] }>
	/**
	 * Callback to disconnect an integration account.
	 */
	readonly disconnectProvider?: (
		userId: string,
		provider: IntegrationProvider,
		accountId?: string,
	) => Promise<{ disconnected: boolean }>
}

export function createIntegrationTools(config: IntegrationToolsConfig) {
	const { integrationRepo, userId, connectProvider, disconnectProvider } = config

	return {
		list_integrations: tool({
			description:
				"Inspect whether Gmail, Google Calendar, Notion, Slack, and Google Drive are connected for this user.",
			inputSchema: z.object({}),
			execute: async () => {
				const accounts = await Effect.runPromise(integrationRepo.findByUser(userId))
				return SUPPORTED_PROVIDERS.map((provider) => {
					const providerAccounts = accounts.filter((a) => a.provider === provider)
					return {
						provider,
						label: INTEGRATION_LABELS[provider],
						connected: providerAccounts.some((a) => a.status === "active"),
						accounts: providerAccounts.map((a) => ({
							id: a.id,
							status: a.status,
							isPreferred: a.isPreferred,
						})),
					}
				})
			},
		}),

		connect_integration: tool({
			description:
				"Start the secure OAuth flow for an integration. Use this when access is missing or expired.",
			inputSchema: z.object({
				provider: providerEnum.describe("The app to connect"),
			}),
			execute: async ({ provider }) => {
				if (!connectProvider) {
					return { error: "integration_connections_not_configured" }
				}
				return connectProvider(userId, provider as IntegrationProvider)
			},
		}),

		disconnect_integration: tool({
			description: "Disconnect a connected app account.",
			inputSchema: z.object({
				provider: providerEnum.describe("The app to disconnect"),
				accountId: z.string().optional().describe("Specific account ID to disconnect"),
			}),
			execute: async ({ provider, accountId }) => {
				if (!disconnectProvider) {
					return { error: "integration_disconnections_not_configured" }
				}
				return disconnectProvider(userId, provider as IntegrationProvider, accountId)
			},
		}),

		set_preferred_integration: tool({
			description: "Choose which connected account should be used by default for a given app.",
			inputSchema: z.object({
				provider: providerEnum.describe("The app whose default account should change"),
				accountId: z.string().describe("The account id to prefer"),
			}),
			execute: async ({ provider, accountId }) => {
				await Effect.runPromise(
					integrationRepo.setPreferred(userId, provider as IntegrationProvider, accountId),
				)
				return { updated: true, provider, accountId }
			},
		}),
	}
}
