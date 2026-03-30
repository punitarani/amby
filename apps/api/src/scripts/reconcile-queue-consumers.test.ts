import { describe, expect, it, vi } from "bun:test"
import {
	findStaleQueueConsumers,
	parseQueueConsumerConfig,
	reconcileQueueConsumers,
} from "./reconcile-queue-consumers"

describe("parseQueueConsumerConfig", () => {
	it("reads the worker name and queue consumers from wrangler.toml", () => {
		const config = parseQueueConsumerConfig(`
name = "amby-api"

[[queues.producers]]
binding = "TELEGRAM_QUEUE"
queue = "telegram-inbound"

[[queues.consumers]]
queue = "telegram-inbound"

[[queues.consumers]]
queue = "telegram-retries"
`)

		expect(config).toEqual({
			scriptName: "amby-api",
			consumerQueues: ["telegram-inbound", "telegram-retries"],
		})
	})

	it("returns an empty queue consumer list when no consumers are declared", () => {
		const config = parseQueueConsumerConfig(`
name = "amby-api"
compatibility_date = "2025-09-27"
`)

		expect(config).toEqual({
			scriptName: "amby-api",
			consumerQueues: [],
		})
	})
})

describe("findStaleQueueConsumers", () => {
	it("finds only worker consumers for the target script that are not declared", () => {
		const staleConsumers = findStaleQueueConsumers(
			[
				{
					queue_id: "queue-1",
					queue_name: "telegram-inbound",
					consumers: [
						{
							consumer_id: "consumer-1",
							script: "amby-api",
							type: "worker",
						},
					],
				},
				{
					queue_id: "queue-2",
					queue_name: "other-queue",
					consumers: [
						{
							consumer_id: "consumer-2",
							script_name: "amby-api",
							type: "worker",
						},
						{
							consumer_id: "consumer-3",
							script: "another-worker",
							type: "worker",
						},
					],
				},
			],
			"amby-api",
			new Set(["telegram-inbound"]),
		)

		expect(staleConsumers).toEqual([
			{
				queueId: "queue-2",
				queueName: "other-queue",
				consumerId: "consumer-2",
				scriptName: "amby-api",
			},
		])
	})
})

describe("reconcileQueueConsumers", () => {
	it("fails in read-only mode when stale consumers exist", async () => {
		const fetchFn = vi.fn(async () => {
			return new Response(
				JSON.stringify({
					success: true,
					result: [
						{
							queue_id: "queue-1",
							queue_name: "telegram-inbound",
							consumers: [
								{
									consumer_id: "consumer-1",
									script: "amby-api",
									type: "worker",
								},
							],
						},
					],
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			)
		})

		await expect(
			reconcileQueueConsumers({
				env: {
					CLOUDFLARE_ACCOUNT_ID: "account-1",
					CLOUDFLARE_API_TOKEN: "token-1",
				},
				fetchFn,
				log: { error() {}, log() {} },
				readTextFile: async () => 'name = "amby-api"',
			}),
		).rejects.toThrow("Cloudflare still has stale queue consumers attached to this Worker.")
	})

	it("deletes stale consumers when apply is enabled", async () => {
		const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input)
			if (!init?.method || init.method === "GET") {
				return new Response(
					JSON.stringify({
						success: true,
						result: [
							{
								queue_id: "queue-1",
								queue_name: "telegram-inbound",
								consumers: [
									{
										consumer_id: "consumer-1",
										script_name: "amby-api",
										type: "worker",
									},
								],
							},
						],
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				)
			}

			expect(url).toContain("/queues/queue-1/consumers/consumer-1")
			expect(init.method).toBe("DELETE")

			return new Response(JSON.stringify({ success: true, result: null }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			})
		})

		const result = await reconcileQueueConsumers({
			apply: true,
			env: {
				CLOUDFLARE_ACCOUNT_ID: "account-1",
				CLOUDFLARE_API_TOKEN: "token-1",
			},
			fetchFn,
			log: { error() {}, log() {} },
			readTextFile: async () => 'name = "amby-api"',
		})

		expect(result.staleConsumers).toHaveLength(1)
		expect(fetchFn).toHaveBeenCalledTimes(2)
	})
})
