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

const extractInterfaceBody = (source: string, interfaceName: string) => {
	const declaration = `export interface ${interfaceName} `
	const declarationIndex = source.indexOf(declaration)

	expect(declarationIndex).toBeGreaterThanOrEqual(0)

	const bodyStart = source.indexOf("{", declarationIndex + declaration.length)
	expect(bodyStart).toBeGreaterThanOrEqual(0)

	let depth = 0
	for (let index = bodyStart; index < source.length; index += 1) {
		const char = source[index]
		if (char === "{") {
			depth += 1
			continue
		}
		if (char === "}") {
			depth -= 1
			if (depth === 0) {
				return source.slice(bodyStart + 1, index)
			}
		}
	}

	throw new Error(`Could not find the end of interface ${interfaceName}`)
}

const readWorkerBindingKeys = async () => {
	const source = await Bun.file(resolve(repoRoot, "packages/env/src/workers.ts")).text()
	const interfaceBody = extractInterfaceBody(source, "WorkerBindings")
	const keys = Array.from(interfaceBody.matchAll(/^\s*([A-Z0-9_]+)\??:/gm), (match) => match[1])
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
