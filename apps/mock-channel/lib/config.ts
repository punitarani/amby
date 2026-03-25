import type { MockUserConfig } from "./telegram-types"

/** Default mock user for local development. */
export const DEFAULT_USER: MockUserConfig = {
	chatId: 100001,
	userId: 1,
	firstName: "Test",
	lastName: "User",
	username: "testuser",
}

/** Port the mock channel dev server runs on. */
export const MOCK_CHANNEL_PORT = 3100
