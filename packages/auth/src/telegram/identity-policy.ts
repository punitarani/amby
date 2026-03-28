export const canSafelyUnlinkTelegram = (accountCount: number) => accountCount > 1

export const resolveTelegramSignInDisposition = (input: {
	hasExistingAccount: boolean
	hasIdentityBlock: boolean
}) => {
	if (input.hasExistingAccount) {
		return "existing-account" as const
	}

	if (input.hasIdentityBlock) {
		return "blocked" as const
	}

	return "create-user" as const
}

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
