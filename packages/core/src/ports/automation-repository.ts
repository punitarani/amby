import { Context, type Effect } from "effect"
import type { Automation, AutomationStatus } from "../domain/automation"
import type { CoreError } from "../errors/core-error"

export interface AutomationRepository {
	readonly create: (
		params: Omit<Automation, "id" | "createdAt" | "updatedAt">,
	) => Effect.Effect<Automation, CoreError>

	readonly findById: (id: string) => Effect.Effect<Automation | undefined, CoreError>

	readonly findByUser: (
		userId: string,
		options?: { status?: AutomationStatus },
	) => Effect.Effect<Automation[], CoreError>

	readonly findDue: (asOf: Date) => Effect.Effect<Automation[], CoreError>

	readonly updateStatus: (
		id: string,
		status: AutomationStatus,
		fields?: Partial<Pick<Automation, "lastRunAt" | "nextRunAt">>,
	) => Effect.Effect<void, CoreError>

	readonly delete: (id: string) => Effect.Effect<void, CoreError>
}

export class AutomationRepo extends Context.Tag("AutomationRepo")<
	AutomationRepo,
	AutomationRepository
>() {}
