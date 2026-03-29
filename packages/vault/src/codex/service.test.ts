import { describe, expect, it } from "bun:test"
import { EnvService } from "@amby/env"
import { Effect, Layer } from "effect"
import { VaultError } from "../errors"
import { VaultServiceLive } from "../service"
import {
	makeCodexAuthStoreLayer,
	makeMockCodexAuthStore,
	makeMockVaultStore,
	makeTestEnv,
	makeVaultStoreLayer,
} from "../test-fixtures"
import { CodexVaultService, CodexVaultServiceLive } from "./service"

const buildTestLayer = (
	mockStore: ReturnType<typeof makeMockVaultStore>,
	mockAuth: ReturnType<typeof makeMockCodexAuthStore>,
) => {
	const storeLayer = makeVaultStoreLayer(mockStore)
	const authLayer = makeCodexAuthStoreLayer(mockAuth)
	const envLayer = Layer.succeed(EnvService, makeTestEnv())
	const vaultLayer = VaultServiceLive.pipe(Layer.provide(Layer.merge(storeLayer, envLayer)))
	return CodexVaultServiceLive.pipe(
		Layer.provide(Layer.mergeAll(vaultLayer, storeLayer, authLayer)),
	)
}

const run = <A>(effect: Effect.Effect<A, VaultError, CodexVaultService>) =>
	Effect.runPromise(effect)

describe("CodexVaultService", () => {
	it("creates and resolves an API key credential", async () => {
		const store = makeMockVaultStore()
		const auth = makeMockCodexAuthStore()
		const layer = buildTestLayer(store, auth)

		const result = await run(
			Effect.gen(function* () {
				const svc = yield* CodexVaultService
				const { vaultItem } = yield* svc.createApiKeyCredential(
					"user-1",
					"sk-live-test-key-12345",
					"My API Key",
				)
				const payload = yield* svc.resolveCredential("user-1", vaultItem.id)
				return { vaultItem, payload }
			}).pipe(Effect.provide(layer)),
		)

		expect(result.vaultItem.kind).toBe("codex_api_key")
		expect(result.vaultItem.namespace).toBe("codex")
		expect(result.payload.method).toBe("api_key")
		if (result.payload.method === "api_key") {
			expect(result.payload.apiKey).toBe("sk-live-test-key-12345")
		}

		const authRow = auth.rows.get("user-1")
		expect(authRow).toBeTruthy()
		expect(authRow!.method).toBe("api_key")
		expect(authRow!.status).toBe("authenticated")
		expect(authRow!.apiKeyLast4).toBe("2345")
	})

	it("creates and resolves a ChatGPT bundle credential", async () => {
		const store = makeMockVaultStore()
		const auth = makeMockCodexAuthStore()
		const layer = buildTestLayer(store, auth)

		const result = await run(
			Effect.gen(function* () {
				const svc = yield* CodexVaultService
				const { vaultItem } = yield* svc.createChatgptBundleCredential(
					"user-1",
					btoa("fake-archive"),
					{ accountId: "acc-1", planType: "plus" },
				)
				const payload = yield* svc.resolveCredential("user-1", vaultItem.id)
				return { vaultItem, payload }
			}).pipe(Effect.provide(layer)),
		)

		expect(result.vaultItem.kind).toBe("codex_chatgpt_home")
		expect(result.payload.method).toBe("chatgpt")
		if (result.payload.method === "chatgpt") {
			expect(result.payload.archiveBase64).toBe(btoa("fake-archive"))
		}

		const authRow = auth.rows.get("user-1")
		expect(authRow!.method).toBe("chatgpt")
		expect(authRow!.accountId).toBe("acc-1")
		expect(authRow!.planType).toBe("plus")
	})

	it("revokes a credential and updates auth state", async () => {
		const store = makeMockVaultStore()
		const auth = makeMockCodexAuthStore()
		const layer = buildTestLayer(store, auth)

		await run(
			Effect.gen(function* () {
				const svc = yield* CodexVaultService
				const { vaultItem } = yield* svc.createApiKeyCredential(
					"user-1",
					"sk-live-revoke-me",
				)
				yield* svc.revokeCredential("user-1", vaultItem.id)
			}).pipe(Effect.provide(layer)),
		)

		const item = store.items.values().next().value!
		expect(item.status).toBe("revoked")
		expect(auth.rows.get("user-1")!.status).toBe("revoked")
	})

	it("upsert creates new version when same kind exists", async () => {
		const store = makeMockVaultStore()
		const auth = makeMockCodexAuthStore()
		const layer = buildTestLayer(store, auth)

		const result = await run(
			Effect.gen(function* () {
				const svc = yield* CodexVaultService
				const first = yield* svc.createApiKeyCredential("user-1", "sk-live-key-v1")
				const second = yield* svc.createApiKeyCredential("user-1", "sk-live-key-v2")
				return { first, second }
			}).pipe(Effect.provide(layer)),
		)

		expect(result.first.vaultItem.id).toBe(result.second.vaultItem.id)
		expect(result.second.vaultItem.currentVersion).toBe(2)
	})

	it("upsert revokes old item when kind changes", async () => {
		const store = makeMockVaultStore()
		const auth = makeMockCodexAuthStore()
		const layer = buildTestLayer(store, auth)

		const result = await run(
			Effect.gen(function* () {
				const svc = yield* CodexVaultService
				const first = yield* svc.createApiKeyCredential("user-1", "sk-live-key")
				const second = yield* svc.createChatgptBundleCredential(
					"user-1",
					btoa("archive"),
					{},
				)
				return { first, second }
			}).pipe(Effect.provide(layer)),
		)

		expect(result.first.vaultItem.id).not.toBe(result.second.vaultItem.id)
		const oldItem = store.items.get(result.first.vaultItem.id)
		expect(oldItem!.status).toBe("revoked")
	})

	it("getActiveCredential returns null when no credential exists", async () => {
		const store = makeMockVaultStore()
		const auth = makeMockCodexAuthStore()
		const layer = buildTestLayer(store, auth)

		const result = await run(
			Effect.gen(function* () {
				const svc = yield* CodexVaultService
				return yield* svc.getActiveCredential("user-1")
			}).pipe(Effect.provide(layer)),
		)

		expect(result).toBeNull()
	})

	it("getActiveCredential returns item and version for active credential", async () => {
		const store = makeMockVaultStore()
		const auth = makeMockCodexAuthStore()
		const layer = buildTestLayer(store, auth)

		const result = await run(
			Effect.gen(function* () {
				const svc = yield* CodexVaultService
				yield* svc.createApiKeyCredential("user-1", "sk-live-active-key")
				return yield* svc.getActiveCredential("user-1")
			}).pipe(Effect.provide(layer)),
		)

		expect(result).not.toBeNull()
		expect(result!.item.kind).toBe("codex_api_key")
		expect(result!.version).not.toBeNull()
		expect(result!.version.version).toBe(1)
	})
})
