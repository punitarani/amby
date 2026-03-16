import type { Sandbox } from "@daytonaio/sdk"
import { tool } from "ai"
import type { Context } from "effect"
import { Effect } from "effect"
import { z } from "zod"
import type { SandboxService } from "./sandbox"

type SandboxOps = Context.Tag.Service<typeof SandboxService>

interface CuaLock {
	channel: string
	task: string
	startedAt: string
	lastActivity: string
}

const LOCK_PATH = "/tmp/amby-cua.lock"
const STALE_MINUTES = 15

async function readLock(instance: Sandbox): Promise<CuaLock | null> {
	try {
		const buf = await instance.fs.downloadFile(LOCK_PATH)
		return JSON.parse(buf.toString("utf-8")) as CuaLock
	} catch {
		return null
	}
}

async function writeLock(instance: Sandbox, lock: CuaLock): Promise<void> {
	await instance.fs.uploadFile(Buffer.from(JSON.stringify(lock)), LOCK_PATH)
}

async function deleteLock(instance: Sandbox): Promise<void> {
	await instance.process.executeCommand(`rm -f ${LOCK_PATH}`)
}

async function requireLock(instance: Sandbox, channelId: string): Promise<string | null> {
	const lock = await readLock(instance)
	if (!lock) {
		return "No active CUA session. Call cua_start first."
	}

	const lastActivity = new Date(lock.lastActivity).getTime()
	const isStale = Date.now() - lastActivity > STALE_MINUTES * 60 * 1000

	if (lock.channel !== channelId) {
		if (isStale) {
			await deleteLock(instance)
			return "Previous CUA session was stale and has been released. Call cua_start to begin a new session."
		}
		return `CUA session is in use by another channel (task: "${lock.task}", started: ${lock.startedAt}). Wait for it to finish or ask the user in that channel to end it.`
	}

	lock.lastActivity = new Date().toISOString()
	await writeLock(instance, lock)
	return null
}

export function createCuaTools(
	sandbox: SandboxOps,
	userId: string,
	channelId: string,
	getSandbox: () => Sandbox | null,
) {
	let displaySize = { width: 1024, height: 768 }

	const ensureSandbox = Effect.gen(function* () {
		const existing = getSandbox()
		if (existing) return existing
		return yield* sandbox.ensure(userId)
	})

	const withSandbox = async <T>(fn: (instance: Sandbox) => Promise<T>): Promise<T | string> => {
		try {
			const instance = await Effect.runPromise(ensureSandbox)
			return await fn(instance)
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err)
			console.error(`[CUA] Error: ${message}`)
			if (message.includes("not configured")) {
				return "Computer access is not available — DAYTONA_API_KEY is not configured."
			}
			return `CUA error: ${message}. Try again in a moment.`
		}
	}

	const tools = {
		cua_start: tool({
			description:
				"Start a Computer Use Agent (CUA) session to interact with the desktop GUI. Must be called before any other CUA tool. Only one session can be active at a time.",
			inputSchema: z.object({
				task: z.string().describe("Brief description of what this CUA session is for"),
			}),
			execute: async ({ task }) =>
				withSandbox(async (instance) => {
					const existingLock = await readLock(instance)
					if (existingLock) {
						const lastActivity = new Date(existingLock.lastActivity).getTime()
						const isStale = Date.now() - lastActivity > STALE_MINUTES * 60 * 1000

						if (existingLock.channel === channelId) {
							existingLock.lastActivity = new Date().toISOString()
							existingLock.task = task
							await writeLock(instance, existingLock)
							return "CUA session already active in this channel. Resumed with updated task."
						}

						if (!isStale) {
							return `CUA session is in use by another channel (task: "${existingLock.task}", started: ${existingLock.startedAt}). Wait for it to finish.`
						}

						await deleteLock(instance)
					}

					const lock: CuaLock = {
						channel: channelId,
						task,
						startedAt: new Date().toISOString(),
						lastActivity: new Date().toISOString(),
					}
					await writeLock(instance, lock)

					const result = await instance.computerUse.start()

					const display = await instance.computerUse.display.getInfo()
					const displayInfo = display.displays?.[0]
					if (displayInfo?.width && displayInfo?.height) {
						displaySize = { width: displayInfo.width, height: displayInfo.height }
					}

					return {
						status: "started",
						message: result.message ?? "CUA session started",
						display: displayInfo ? { width: displayInfo.width, height: displayInfo.height } : null,
					}
				}),
		}),

		cua_end: tool({
			description: "End the current CUA session and release the lock.",
			inputSchema: z.object({}),
			execute: async () =>
				withSandbox(async (instance) => {
					const lock = await readLock(instance)
					if (!lock) {
						return "No active CUA session to end."
					}
					if (lock.channel !== channelId) {
						return `Cannot end session owned by another channel (task: "${lock.task}").`
					}

					await instance.computerUse.stop()
					await deleteLock(instance)
					return "CUA session ended."
				}),
		}),

		cua_screenshot: tool({
			description:
				"Take a screenshot of the current desktop. Use frequently to see the screen state after actions.",
			inputSchema: z.object({
				showCursor: z.boolean().optional().describe("Whether to show the cursor in the screenshot"),
			}),
			execute: async ({ showCursor }) =>
				withSandbox(async (instance) => {
					const lockErr = await requireLock(instance, channelId)
					if (lockErr) return lockErr

					const result = await instance.computerUse.screenshot.takeCompressed({
						format: "png",
						quality: 80,
						showCursor: showCursor ?? false,
					})

					if (!result.screenshot) return "Failed to capture screenshot."

					return {
						data: result.screenshot,
						width: displaySize.width,
						height: displaySize.height,
					}
				}),
			toModelOutput({ output }) {
				if (typeof output === "string") {
					return { type: "text" as const, value: output }
				}
				return {
					type: "content" as const,
					value: [
						{
							type: "image-data" as const,
							data: output.data,
							mediaType: "image/png",
						},
						{
							type: "text" as const,
							text: `Screenshot ${output.width}x${output.height}`,
						},
					],
				}
			},
		}),

		cua_click: tool({
			description: "Click at specific coordinates on the screen.",
			inputSchema: z.object({
				x: z.number().describe("X coordinate"),
				y: z.number().describe("Y coordinate"),
				button: z
					.enum(["left", "right", "middle"])
					.optional()
					.describe("Mouse button (default: left)"),
				double: z.boolean().optional().describe("Double click (default: false)"),
			}),
			execute: async ({ x, y, button, double }) =>
				withSandbox(async (instance) => {
					const lockErr = await requireLock(instance, channelId)
					if (lockErr) return lockErr

					const result = await instance.computerUse.mouse.click(x, y, button, double)
					return { clicked: true, x: result.x, y: result.y }
				}),
		}),

		cua_type: tool({
			description: "Type text using the keyboard.",
			inputSchema: z.object({
				text: z.string().describe("Text to type"),
				delay: z.number().optional().describe("Delay between keystrokes in ms"),
			}),
			execute: async ({ text, delay }) =>
				withSandbox(async (instance) => {
					const lockErr = await requireLock(instance, channelId)
					if (lockErr) return lockErr

					await instance.computerUse.keyboard.type(text, delay)
					return { typed: true, length: text.length }
				}),
		}),

		cua_key_press: tool({
			description:
				"Press a key or key combination (e.g., 'Return', 'Escape', 'Tab'). Use modifiers for combos like Ctrl+C.",
			inputSchema: z.object({
				key: z.string().describe("Key to press (e.g., 'Return', 'Escape', 'Tab', 'a', 'F5')"),
				modifiers: z
					.array(z.enum(["ctrl", "alt", "meta", "shift"]))
					.optional()
					.describe("Modifier keys to hold"),
			}),
			execute: async ({ key, modifiers }) =>
				withSandbox(async (instance) => {
					const lockErr = await requireLock(instance, channelId)
					if (lockErr) return lockErr

					await instance.computerUse.keyboard.press(key, modifiers)
					return {
						pressed: true,
						key,
						modifiers: modifiers ?? [],
					}
				}),
		}),

		cua_scroll: tool({
			description: "Scroll the screen at specific coordinates.",
			inputSchema: z.object({
				x: z.number().describe("X coordinate to scroll at"),
				y: z.number().describe("Y coordinate to scroll at"),
				direction: z.enum(["up", "down"]).describe("Scroll direction"),
				amount: z.number().optional().describe("Scroll amount (default: 3)"),
			}),
			execute: async ({ x, y, direction, amount }) =>
				withSandbox(async (instance) => {
					const lockErr = await requireLock(instance, channelId)
					if (lockErr) return lockErr

					await instance.computerUse.mouse.scroll(x, y, direction, amount)
					return { scrolled: true, direction, amount: amount ?? 3 }
				}),
		}),

		cua_cursor_position: tool({
			description: "Get the current cursor position, or move the cursor to specific coordinates.",
			inputSchema: z.object({
				x: z.number().optional().describe("X coordinate to move to (omit to just get position)"),
				y: z.number().optional().describe("Y coordinate to move to (omit to just get position)"),
			}),
			execute: async ({ x, y }) =>
				withSandbox(async (instance) => {
					const lockErr = await requireLock(instance, channelId)
					if (lockErr) return lockErr

					if (x !== undefined && y !== undefined) {
						const result = await instance.computerUse.mouse.move(x, y)
						return { moved: true, x: result.x, y: result.y }
					}
					const pos = await instance.computerUse.mouse.getPosition()
					return { x: pos.x, y: pos.y }
				}),
		}),
	}

	return { tools }
}
