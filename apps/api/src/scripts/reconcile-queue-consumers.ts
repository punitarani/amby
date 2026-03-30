const CLOUDFLARE_API_BASE_URL = "https://api.cloudflare.com/client/v4"

type WranglerQueueConsumerConfig = {
	queue?: string
}

type WranglerTomlConfig = {
	name?: string
	queues?: {
		consumers?: WranglerQueueConsumerConfig | WranglerQueueConsumerConfig[]
	}
}

type CloudflareQueueConsumer = {
	consumer_id?: string
	script?: string
	script_name?: string
	type?: string
}

type CloudflareQueue = {
	queue_id?: string
	queue_name?: string
	consumers?: CloudflareQueueConsumer[]
}

type CloudflareApiEnvelope<T> = {
	success: boolean
	result: T
	errors?: Array<{ code?: number; message?: string }>
}

type CloudflareFetch = (input: string, init?: RequestInit) => Promise<Response>

export type QueueConsumerDrift = {
	queueId: string
	queueName: string
	consumerId: string
	scriptName: string
}

type ReconcileOptions = {
	apply?: boolean
	env?: Record<string, string | undefined>
	fetchFn?: CloudflareFetch
	log?: Pick<typeof console, "error" | "log">
	readTextFile?: (path: string) => Promise<string>
	wranglerTomlPath?: string
}

type QueueConsumerConfig = {
	scriptName: string
	consumerQueues: string[]
}

function normalizeNonEmpty(value: string | undefined): string | undefined {
	const normalized = value?.trim()
	return normalized ? normalized : undefined
}

function toArray<T>(value: T | T[] | undefined): T[] {
	if (!value) return []
	return Array.isArray(value) ? value : [value]
}

export function parseQueueConsumerConfig(tomlText: string): QueueConsumerConfig {
	const parsed = Bun.TOML.parse(tomlText) as WranglerTomlConfig
	const scriptName = normalizeNonEmpty(parsed.name)
	if (!scriptName) {
		throw new Error("wrangler.toml is missing a Worker name")
	}

	const consumerQueues = Array.from(
		new Set(
			toArray(parsed.queues?.consumers)
				.map((consumer) => normalizeNonEmpty(consumer.queue))
				.filter((queue): queue is string => Boolean(queue)),
		),
	)

	return { scriptName, consumerQueues }
}

function resolveConsumerScriptName(consumer: CloudflareQueueConsumer): string | undefined {
	return normalizeNonEmpty(consumer.script_name) ?? normalizeNonEmpty(consumer.script)
}

export function findStaleQueueConsumers(
	queues: CloudflareQueue[],
	scriptName: string,
	desiredConsumerQueues: ReadonlySet<string>,
): QueueConsumerDrift[] {
	const staleConsumers: QueueConsumerDrift[] = []

	for (const queue of queues) {
		const queueId = normalizeNonEmpty(queue.queue_id)
		const queueName = normalizeNonEmpty(queue.queue_name)
		if (!queueId || !queueName) continue

		for (const consumer of queue.consumers ?? []) {
			if (consumer.type && consumer.type !== "worker") continue

			const consumerScriptName = resolveConsumerScriptName(consumer)
			const consumerId = normalizeNonEmpty(consumer.consumer_id)
			if (!consumerScriptName || !consumerId) continue
			if (consumerScriptName !== scriptName) continue
			if (desiredConsumerQueues.has(queueName)) continue

			staleConsumers.push({
				queueId,
				queueName,
				consumerId,
				scriptName: consumerScriptName,
			})
		}
	}

	return staleConsumers
}

async function cloudflareRequest<T>(
	path: string,
	env: Record<string, string | undefined>,
	fetchFn: CloudflareFetch,
	init?: RequestInit,
): Promise<T> {
	const accountId = normalizeNonEmpty(env.CLOUDFLARE_ACCOUNT_ID)
	const apiToken = normalizeNonEmpty(env.CLOUDFLARE_API_TOKEN)

	if (!accountId) throw new Error("CLOUDFLARE_ACCOUNT_ID is required")
	if (!apiToken) throw new Error("CLOUDFLARE_API_TOKEN is required")

	const response = await fetchFn(`${CLOUDFLARE_API_BASE_URL}/accounts/${accountId}${path}`, {
		...init,
		headers: {
			Authorization: `Bearer ${apiToken}`,
			"Content-Type": "application/json",
			...(init?.headers ?? {}),
		},
	})

	const payload = (await response.json()) as CloudflareApiEnvelope<T>
	if (!response.ok || !payload.success) {
		const errorMessage =
			payload.errors
				?.map((error) => error.message)
				.filter(Boolean)
				.join("; ") || `${response.status} ${response.statusText}`
		throw new Error(`Cloudflare API request failed for ${path}: ${errorMessage}`)
	}

	return payload.result
}

export async function reconcileQueueConsumers(options: ReconcileOptions = {}) {
	const apply = options.apply ?? false
	const env = options.env ?? process.env
	const fetchFn = options.fetchFn ?? ((input, init) => fetch(input, init))
	const log = options.log ?? console
	const wranglerTomlPath = options.wranglerTomlPath ?? "wrangler.toml"
	const readTextFile =
		options.readTextFile ??
		(async (path: string) => {
			return await Bun.file(path).text()
		})

	const wranglerToml = await readTextFile(wranglerTomlPath)
	const config = parseQueueConsumerConfig(wranglerToml)
	const desiredConsumerQueues = new Set(config.consumerQueues)
	const queues = await cloudflareRequest<CloudflareQueue[]>("/queues", env, fetchFn)
	const staleConsumers = findStaleQueueConsumers(queues, config.scriptName, desiredConsumerQueues)

	if (staleConsumers.length === 0) {
		log.log(
			`No stale queue consumers found for ${config.scriptName}. Desired consumers: ${
				config.consumerQueues.length > 0 ? config.consumerQueues.join(", ") : "(none)"
			}.`,
		)
		return { ...config, staleConsumers }
	}

	log.error(
		`Found ${staleConsumers.length} stale queue consumer(s) for ${config.scriptName} not declared in ${wranglerTomlPath}:`,
	)
	for (const consumer of staleConsumers) {
		log.error(`- ${consumer.queueName} (${consumer.consumerId})`)
	}

	if (!apply) {
		throw new Error(
			[
				"Cloudflare still has stale queue consumers attached to this Worker.",
				"Deploying a bundle without a matching queue() handler will fail.",
				"Run this script again with --apply to delete the stale consumers, then rerun deploy.",
			].join(" "),
		)
	}

	for (const consumer of staleConsumers) {
		await cloudflareRequest(
			`/queues/${consumer.queueId}/consumers/${consumer.consumerId}`,
			env,
			fetchFn,
			{ method: "DELETE" },
		)
		log.log(`Deleted stale queue consumer ${consumer.consumerId} from ${consumer.queueName}.`)
	}

	return { ...config, staleConsumers }
}

if (import.meta.main) {
	const apply = Bun.argv.includes("--apply")

	try {
		await reconcileQueueConsumers({ apply })
	} catch (error) {
		console.error(
			error instanceof Error ? error.message : "Unknown error while reconciling queue consumers.",
		)
		process.exit(1)
	}
}
