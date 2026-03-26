import { Cron } from "croner"
import type { CronNextRunFn } from "./tools"

/** Compute the next run time for a cron expression in the given timezone. */
export const computeNextCronRun: CronNextRunFn = (schedule, tz) => {
	try {
		const job = new Cron(schedule, { timezone: tz })
		return job.nextRun() ?? undefined
	} catch {
		return undefined
	}
}
