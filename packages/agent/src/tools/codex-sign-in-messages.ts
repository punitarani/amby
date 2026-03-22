import { CODEX_DEVICE_AUTH_SETTINGS_URL, CODEX_DEVICE_AUTH_URL } from "@amby/computer"

/**
 * Plain text only (Telegram default parse mode is not Markdown — avoid **bold**).
 * Single message so the full flow (especially Security settings) is never dropped when split across bubbles.
 */
export function buildCodexDeviceSignInUserMessages(userCode: string): string[] {
	const text = [
		`Link your ChatGPT account so I can run background tasks (one-time):`,
		``,
		`1) Enable device code authorization for Codex in ChatGPT`,
		`   Open: ${CODEX_DEVICE_AUTH_SETTINGS_URL}`,
		`   Turn ON "Enable device code authorization for Codex" (Settings → Security).`,
		``,
		`2) Open this link and sign in with your ChatGPT account:`,
		`   ${CODEX_DEVICE_AUTH_URL}`,
		``,
		`3) Enter this code when the site asks for it (copy the line below):`,
		userCode,
	].join("\n")

	return [text]
}
