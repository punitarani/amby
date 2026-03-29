import { Context } from "effect"
import type { ConversationMessagePart } from "../domain/attachment"

export type ReplyTarget = {
	readonly channel: "telegram"
	readonly chatId: number
}

export interface ReplySenderService {
	readonly startTyping: (target: ReplyTarget) => Promise<void>
	readonly postText: (target: ReplyTarget, text: string) => Promise<void>
	readonly sendParts: (
		target: ReplyTarget,
		parts: readonly ConversationMessagePart[],
	) => Promise<void>
}

export class ReplySender extends Context.Tag("ReplySender")<ReplySender, ReplySenderService>() {}
