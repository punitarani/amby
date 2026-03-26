export type IntegrationProvider = "gmail" | "googlecalendar" | "notion" | "slack" | "googledrive"

export type IntegrationAccountStatus = "active" | "pending" | "expired" | "revoked"

export interface IntegrationAccount {
	readonly id: string
	readonly userId: string
	readonly provider: IntegrationProvider
	readonly externalAccountId?: string
	readonly status: IntegrationAccountStatus
	readonly isPreferred: boolean
	readonly metadataJson?: Record<string, unknown>
	readonly createdAt: Date
	readonly updatedAt: Date
}
