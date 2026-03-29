import { describe, expect, it } from "bun:test"
import {
	AGENT_LOOP_STEP_OPTIONS,
	createTelegramDeliveryController,
	type TelegramDeliveryAdapter,
} from "./telegram-delivery"

function makeAdapter() {
	const adapter: TelegramDeliveryAdapter = {
		async deleteMessage(chatId: string, messageId: string) {
			owner.deletes.push({ chatId, messageId })
		},
		async editMessage(chatId: string, messageId: string, text: string) {
			owner.edits.push({ chatId, messageId, text })
		},
		async postMessage(chatId: string, text: string) {
			owner.posts.push({ chatId, text })
			return { id: `msg-${owner.posts.length}` }
		},
		async startTyping(chatId: string) {
			owner.typing.push(chatId)
		},
	}
	const owner = {
		adapter,
		deletes: [] as Array<{ chatId: string; messageId: string }>,
		edits: [] as Array<{ chatId: string; messageId: string; text: string }>,
		posts: [] as Array<{ chatId: string; text: string }>,
		typing: [] as string[],
	}

	return owner
}

describe("createTelegramDeliveryController", () => {
	it("claims first outbound on the first progress message", async () => {
		const adapter = makeAdapter()
		const claimCalls: string[] = []
		const controller = createTelegramDeliveryController({
			adapter: adapter.adapter,
			chatId: "123",
			claimFirstOutbound: async () => {
				claimCalls.push("claim")
				return { allowed: true, reason: "ok" }
			},
		})

		await controller.sendProgress("Working on it")

		expect(claimCalls).toEqual(["claim"])
		expect(adapter.posts).toEqual([{ chatId: "123", text: "Working on it" }])
		expect(controller.getState()).toEqual({
			firstOutboundClaimed: true,
			visibleOutputSent: true,
			suppressed: false,
		})
	})

	it("suppresses relink-required output when the execution was superseded", async () => {
		const adapter = makeAdapter()
		const controller = createTelegramDeliveryController({
			adapter: adapter.adapter,
			chatId: "123",
			claimFirstOutbound: async () => ({ allowed: false, reason: "superseded" }),
		})

		const sent = await controller.sendRelinkRequired()

		expect(sent).toBe(false)
		expect(adapter.posts).toEqual([])
		expect(controller.getState().suppressed).toBe(true)
	})

	it("claims once for the first stream post and edits thereafter", async () => {
		const adapter = makeAdapter()
		let claimCount = 0
		const controller = createTelegramDeliveryController({
			adapter: adapter.adapter,
			chatId: "123",
			claimFirstOutbound: async () => {
				claimCount += 1
				return { allowed: true, reason: "ok" }
			},
		})

		const streamMessageId = await controller.flushStreamText("hello", null)
		const sameMessageId = await controller.flushStreamText("hello world", streamMessageId)

		expect(claimCount).toBe(1)
		expect(streamMessageId).toBe("msg-1")
		expect(sameMessageId).toBe("msg-1")
		expect(adapter.posts).toEqual([{ chatId: "123", text: "hello" }])
		expect(adapter.edits).toEqual([{ chatId: "123", messageId: "msg-1", text: "hello world" }])
	})

	it("claims first outbound before posting a final response when no draft exists", async () => {
		const adapter = makeAdapter()
		let claimCount = 0
		const controller = createTelegramDeliveryController({
			adapter: adapter.adapter,
			chatId: "123",
			claimFirstOutbound: async () => {
				claimCount += 1
				return { allowed: true, reason: "ok" }
			},
		})

		await controller.finalizeResponse("Final response", null)

		expect(claimCount).toBe(1)
		expect(adapter.posts).toEqual([{ chatId: "123", text: "Final response" }])
	})

	it("does not send a generic error after visible output already exists", async () => {
		const adapter = makeAdapter()
		const controller = createTelegramDeliveryController({
			adapter: adapter.adapter,
			chatId: "123",
			claimFirstOutbound: async () => ({ allowed: true, reason: "ok" }),
		})

		await controller.sendProgress("Working on it")
		const sent = await controller.sendErrorReply("Sorry, something went wrong. Please try again.")

		expect(sent).toBe(false)
		expect(adapter.posts).toEqual([{ chatId: "123", text: "Working on it" }])
	})

	it("suppresses direct final delivery when the first outbound claim is stale", async () => {
		const adapter = makeAdapter()
		const controller = createTelegramDeliveryController({
			adapter: adapter.adapter,
			chatId: "123",
			claimFirstOutbound: async () => ({ allowed: false, reason: "stale" }),
		})

		await controller.finalizeResponse("Final response", null)

		expect(adapter.posts).toEqual([])
		expect(controller.getState().suppressed).toBe(true)
	})
})

describe("agent execution workflow step options", () => {
	it("keeps retries off the user-visible agent loop step", () => {
		expect(AGENT_LOOP_STEP_OPTIONS).toEqual({ timeout: "5 minutes" })
		expect("retries" in AGENT_LOOP_STEP_OPTIONS).toBe(false)
	})
})
