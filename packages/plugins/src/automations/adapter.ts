import { type Automation, type AutomationRepository, CoreError } from "@amby/core"
import type { schema } from "@amby/db"
import type { Context } from "effect"
import { Effect } from "effect"
import type { AutomationService } from "./service"

type AutomationOps = Context.Tag.Service<typeof AutomationService>
type AutomationRow = typeof schema.automations.$inferSelect

const mapError = (e: unknown) =>
	new CoreError({
		message: e instanceof Error ? e.message : "Automation operation failed",
		cause: e,
	})

/** Convert a Drizzle row (null for missing) to a domain Automation (undefined for missing). */
function toDomain(row: AutomationRow): Automation {
	return {
		id: row.id,
		userId: row.userId,
		kind: row.kind,
		status: row.status,
		scheduleJson: row.scheduleJson ?? undefined,
		nextRunAt: row.nextRunAt ?? undefined,
		lastRunAt: row.lastRunAt ?? undefined,
		payloadJson: row.payloadJson ?? undefined,
		deliveryTargetJson: row.deliveryTargetJson ?? undefined,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	}
}

/**
 * Adapt AutomationService (the real DB-backed implementation) to the
 * AutomationRepository port defined in @amby/core.
 */
export function adaptAutomationService(service: AutomationOps): AutomationRepository {
	return {
		create: (params) =>
			service.create(params).pipe(Effect.map(toDomain), Effect.mapError(mapError)),

		findById: (id) =>
			service.findById(id).pipe(
				Effect.map((row) => (row ? toDomain(row) : undefined)),
				Effect.mapError(mapError),
			),

		findByUser: (userId, options) =>
			service.findByUser(userId, options).pipe(
				Effect.map((rows) => rows.map(toDomain)),
				Effect.mapError(mapError),
			),

		findDue: (asOf) =>
			service.findDue(asOf).pipe(
				Effect.map((rows) => rows.map(toDomain)),
				Effect.mapError(mapError),
			),

		updateStatus: (id, status, fields) =>
			service.updateStatus(id, status, fields).pipe(Effect.mapError(mapError)),

		delete: (id) => service.delete(id).pipe(Effect.mapError(mapError)),
	}
}
