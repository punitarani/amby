import type { Database } from "@amby/db"
import { eq, schema } from "@amby/db"
import { tool } from "ai"
import { z } from "zod"

export function createTimezoneTools(db: Database, userId: string) {
	return {
		set_timezone: tool({
			description:
				"Set the user's timezone. Use IANA timezone format (e.g., America/New_York, Europe/London).",
			inputSchema: z.object({
				timezone: z.string().describe("IANA timezone identifier"),
			}),
			execute: async ({ timezone }) => {
				try {
					Intl.DateTimeFormat(undefined, { timeZone: timezone })
				} catch {
					return { updated: false, error: `Invalid IANA timezone identifier: ${timezone}` }
				}
				await db
					.update(schema.users)
					.set({ timezone, updatedAt: new Date() })
					.where(eq(schema.users.id, userId))
				return { updated: true, timezone }
			},
		}),
	}
}
