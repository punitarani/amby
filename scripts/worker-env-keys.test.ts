import { describe, expect, it } from "bun:test"
import { resolve } from "node:path"

const repoRoot = resolve(import.meta.dir, "..")

const readKeyFile = async (relativePath: string) => {
	const text = await Bun.file(resolve(repoRoot, relativePath)).text()
	const keys = text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0 && !line.startsWith("#"))

	expect(new Set(keys).size).toBe(keys.length)
	return new Set(keys)
}

const readWorkerBindingKeys = async () => {
	const source = await Bun.file(resolve(repoRoot, "packages/env/src/workers.ts")).text()
	const interfaceMatch = source.match(/export interface WorkerBindings \{([\s\S]*?)\n\}/)

	expect(interfaceMatch).not.toBeNull()

	const keys = Array.from(interfaceMatch![1].matchAll(/^\s*([A-Z0-9_]+)\??:/gm), (match) => match[1])
	return new Set(keys)
}

const readWranglerVarKeys = async () => {
	const source = await Bun.file(resolve(repoRoot, "apps/api/wrangler.toml")).text()
	const config = Bun.TOML.parse(source) as { vars?: Record<string, string> }
	return new Set(Object.keys(config.vars ?? {}))
}

describe("worker env key lists", () => {
	it("keeps worker-env-keys aligned to WorkerBindings", async () => {
		const envKeys = await readKeyFile("scripts/worker-env-keys.txt")
		const workerBindingKeys = await readWorkerBindingKeys()
		const unknownKeys = [...envKeys].filter((key) => !workerBindingKeys.has(key))

		expect(unknownKeys).toEqual([])
	})

	it("keeps Cloudflare sync keys inside the runtime env key list", async () => {
		const envKeys = await readKeyFile("scripts/worker-env-keys.txt")
		const syncKeys = await readKeyFile("scripts/worker-cloudflare-sync-keys.txt")
		const unknownKeys = [...syncKeys].filter((key) => !envKeys.has(key))

		expect(unknownKeys).toEqual([])
	})

	it("prevents Wrangler vars from being uploaded as Cloudflare secrets", async () => {
		const syncKeys = await readKeyFile("scripts/worker-cloudflare-sync-keys.txt")
		const wranglerVarKeys = await readWranglerVarKeys()
		const overlap = [...syncKeys].filter((key) => wranglerVarKeys.has(key))

		expect(overlap).toEqual([])
	})
})
