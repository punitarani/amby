export type AutomationKind = "cron" | "scheduled" | "event"
export type AutomationStatus = "active" | "pending" | "running" | "completed" | "failed"

export interface Automation {
	readonly id: string
	readonly userId: string
	readonly kind: AutomationKind
	readonly status: AutomationStatus
	readonly scheduleJson?: Record<string, unknown>
	readonly nextRunAt?: Date
	readonly lastRunAt?: Date
	readonly payloadJson?: Record<string, unknown>
	readonly deliveryTargetJson?: Record<string, unknown>
	readonly createdAt: Date
	readonly updatedAt: Date
}
