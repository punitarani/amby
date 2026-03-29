import { describe, expect, it } from "bun:test"
import { EnvService } from "@amby/env"
import { Effect, Layer } from "effect"
import { VaultError } from "./errors"
import { VaultService, VaultServiceLive } from "./service"
import { makeMockVaultStore, makeTestEnv, makeVaultStoreLayer } from "./test-fixtures"

const buildTestLayer = (mock: ReturnType<typeof makeMockVaultStore>) => {
	const storeLayer = makeVaultStoreLayer(mock)
	const envLayer = Layer.succeed(EnvService, makeTestEnv())
	return VaultServiceLive.pipe(Layer.provide(Layer.merge(storeLayer, envLayer)))
}

const run = <A>(effect: Effect.Effect<A, VaultError, VaultService>) =>
	Effect.runPromise(effect)

describe("VaultService", () => {
	it("createItem encrypts and stores a vault item", async () => {
		const mock = makeMockVaultStore()
		const layer = buildTestLayer(mock)
		const plaintext = new TextEncoder().encode("sk-live-abc123")

		const item = await run(
			Effect.gen(function* () {
				const svc = yield* VaultService
				return yield* svc.createItem({
					userId: "user-1",
					namespace: "codex",
					itemKey: "default",
					kind: "codex_api_key",
					plaintext,
				})
			}).pipe(Effect.provide(layer)),
		)

		expect(item.userId).toBe("user-1")
		expect(item.namespace).toBe("codex")
		expect(item.kind).toBe("codex_api_key")
		expect(item.currentVersion).toBe(1)
		expect(item.status).toBe("active")
		expect(mock.items.size).toBe(1)
		expect(mock.versions.size).toBe(1)
		expect(mock.accessLogs.length).toBe(1)
		expect(mock.accessLogs[0]!.action).toBe("create")
	})

	it("resolveSecret decrypts and returns original plaintext", async () => {
		const mock = makeMockVaultStore()
		const layer = buildTestLayer(mock)
		const plaintext = new TextEncoder().encode("sk-live-secret-xyz")

		const recovered = await run(
			Effect.gen(function* () {
				const svc = yield* VaultService
				const item = yield* svc.createItem({
					userId: "user-1",
					namespace: "codex",
					itemKey: "default",
					kind: "codex_api_key",
					plaintext,
				})
				return yield* svc.resolveSecret({
					userId: "user-1",
					vaultId: item.id,
				})
			}).pipe(Effect.provide(layer)),
		)

		expect(recovered).toEqual(plaintext)
		expect(mock.accessLogs.length).toBe(2)
		expect(mock.accessLogs[1]!.action).toBe("resolve")
	})

	it("createVersion adds a new version and increments currentVersion", async () => {
		const mock = makeMockVaultStore()
		const layer = buildTestLayer(mock)

		const version = await run(
			Effect.gen(function* () {
				const svc = yield* VaultService
				const item = yield* svc.createItem({
					userId: "user-1",
					namespace: "codex",
					itemKey: "default",
					kind: "codex_api_key",
					plaintext: new TextEncoder().encode("key-v1"),
				})
				return yield* svc.createVersion({
					userId: "user-1",
					vaultId: item.id,
					kind: "codex_api_key",
					plaintext: new TextEncoder().encode("key-v2"),
				})
			}).pipe(Effect.provide(layer)),
		)

		expect(version.version).toBe(2)
		const updatedItem = mock.items.values().next().value!
		expect(updatedItem.currentVersion).toBe(2)
	})

	it("revokeItem updates status to revoked", async () => {
		const mock = makeMockVaultStore()
		const layer = buildTestLayer(mock)

		await run(
			Effect.gen(function* () {
				const svc = yield* VaultService
				const item = yield* svc.createItem({
					userId: "user-1",
					namespace: "codex",
					itemKey: "default",
					kind: "codex_api_key",
					plaintext: new TextEncoder().encode("key"),
				})
				yield* svc.revokeItem("user-1", item.id)
			}).pipe(Effect.provide(layer)),
		)

		const item = mock.items.values().next().value!
		expect(item.status).toBe("revoked")
		const revokeLog = mock.accessLogs.find((l) => l.action === "revoke")
		expect(revokeLog).toBeTruthy()
	})

	it("getItem returns null for wrong userId", async () => {
		const mock = makeMockVaultStore()
		const layer = buildTestLayer(mock)

		const result = await run(
			Effect.gen(function* () {
				const svc = yield* VaultService
				const item = yield* svc.createItem({
					userId: "user-1",
					namespace: "codex",
					itemKey: "default",
					kind: "codex_api_key",
					plaintext: new TextEncoder().encode("key"),
				})
				return yield* svc.getItem("user-other", item.id)
			}).pipe(Effect.provide(layer)),
		)

		expect(result).toBeNull()
	})

	it("getItemByKey finds existing item", async () => {
		const mock = makeMockVaultStore()
		const layer = buildTestLayer(mock)

		const result = await run(
			Effect.gen(function* () {
				const svc = yield* VaultService
				yield* svc.createItem({
					userId: "user-1",
					namespace: "codex",
					itemKey: "default",
					kind: "codex_api_key",
					plaintext: new TextEncoder().encode("key"),
				})
				return yield* svc.getItemByKey("user-1", "codex", "default")
			}).pipe(Effect.provide(layer)),
		)

		expect(result).not.toBeNull()
		expect(result!.namespace).toBe("codex")
	})
})
