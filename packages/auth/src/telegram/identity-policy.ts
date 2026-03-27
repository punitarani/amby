export const canSafelyUnlinkTelegram = (accountCount: number) => accountCount > 1

export const getTelegramLinkConflict = (input: {
	existingLinkedUserId?: string | null
	currentUserId: string
	currentUserTelegramId?: string | null
	nextTelegramUserId: string
}) => {
	if (input.existingLinkedUserId && input.existingLinkedUserId !== input.currentUserId) {
		return "telegram-linked-to-other-user" as const
	}

	if (input.currentUserTelegramId && input.currentUserTelegramId !== input.nextTelegramUserId) {
		return "current-user-has-different-telegram" as const
	}

	return null
}
