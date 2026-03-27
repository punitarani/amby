export type ConversationResponseChannel = "default" | "telegram"

export function resolveConversationResponseChannel(
	requestMetadata?: Record<string, unknown>,
): ConversationResponseChannel {
	if (requestMetadata && Object.hasOwn(requestMetadata, "telegram")) {
		return "telegram"
	}

	return "default"
}
