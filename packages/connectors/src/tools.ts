import { tool } from "ai"
import type { Context } from "effect"
import { Effect } from "effect"
import { z } from "zod"
import { SUPPORTED_INTEGRATION_TOOLKITS } from "./constants"
import type { ConnectorsService } from "./service"

type ConnectorService = Context.Tag.Service<typeof ConnectorsService>

const toolkitEnum = z.enum(SUPPORTED_INTEGRATION_TOOLKITS)

export function createConnectorManagementTools(connectors: ConnectorService, userId: string) {
	return {
		list_integrations: tool({
			description:
				"Inspect whether Gmail, Google Calendar, Notion, Slack, and Google Drive are connected for this user, including connected account ids and which account is preferred.",
			inputSchema: z.object({}),
			execute: async () => Effect.runPromise(connectors.listIntegrations(userId)),
		}),

		connect_integration: tool({
			description:
				"Start the secure OAuth flow for Gmail, Google Calendar, Notion, Slack, or Google Drive. Use this when access is missing or expired. Never ask the user for raw credentials.",
			inputSchema: z.object({
				toolkit: toolkitEnum.describe("The app to connect"),
			}),
			execute: async ({ toolkit }) =>
				Effect.runPromise(connectors.connectIntegration(userId, toolkit)),
		}),

		disconnect_integration: tool({
			description:
				"Disconnect a connected app account. Provide `connectedAccountId` when the user wants to remove a specific account; otherwise the preferred account is removed when possible.",
			inputSchema: z.object({
				toolkit: toolkitEnum.describe("The app to disconnect"),
				connectedAccountId: z
					.string()
					.optional()
					.describe("Optional connected account id when the user wants a specific account removed"),
			}),
			execute: async ({ toolkit, connectedAccountId }) =>
				Effect.runPromise(
					connectors.disconnectIntegration(userId, toolkit, connectedAccountId),
				),
		}),

		set_preferred_integration_account: tool({
			description:
				"Choose which connected account should be used by default for a given app when the user has more than one account connected.",
			inputSchema: z.object({
				toolkit: toolkitEnum.describe("The app whose default account should change"),
				connectedAccountId: z
					.string()
					.describe("The connected account id that should become the default"),
			}),
			execute: async ({ toolkit, connectedAccountId }) =>
				Effect.runPromise(
					connectors.setPreferredIntegrationAccount(userId, toolkit, connectedAccountId),
				),
		}),
	}
}
