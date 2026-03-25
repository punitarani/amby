import { Context, type Effect } from "effect"
import type { IntegrationAccount, IntegrationProvider } from "../domain/integration"
import type { CoreError } from "../errors/core-error"

export interface IntegrationRepository {
	readonly create: (
		params: Omit<IntegrationAccount, "id" | "createdAt" | "updatedAt">,
	) => Effect.Effect<IntegrationAccount, CoreError>

	readonly findById: (id: string) => Effect.Effect<IntegrationAccount | undefined, CoreError>

	readonly findByUser: (
		userId: string,
		options?: { provider?: IntegrationProvider },
	) => Effect.Effect<IntegrationAccount[], CoreError>

	readonly findPreferred: (
		userId: string,
		provider: IntegrationProvider,
	) => Effect.Effect<IntegrationAccount | undefined, CoreError>

	readonly setPreferred: (
		userId: string,
		provider: IntegrationProvider,
		accountId: string,
	) => Effect.Effect<void, CoreError>

	readonly updateStatus: (
		id: string,
		status: IntegrationAccount["status"],
	) => Effect.Effect<void, CoreError>

	readonly delete: (id: string) => Effect.Effect<void, CoreError>
}

export class IntegrationRepo extends Context.Tag("IntegrationRepo")<
	IntegrationRepo,
	IntegrationRepository
>() {}
