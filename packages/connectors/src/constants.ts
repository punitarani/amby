export const SUPPORTED_INTEGRATION_TOOLKITS = [
	"gmail",
	"googlecalendar",
	"notion",
	"slack",
	"googledrive",
] as const

export type SupportedIntegrationToolkit = (typeof SUPPORTED_INTEGRATION_TOOLKITS)[number]

type IntegrationToolkitConfig = {
	label: string
	successMessage: string
	expiredMessage: string
	safeTools: string[]
}

export const INTEGRATION_TOOLKITS: Record<SupportedIntegrationToolkit, IntegrationToolkitConfig> = {
	gmail: {
		label: "Gmail",
		successMessage:
			"Gmail is connected. You can ask me to read recent mail, draft replies, or send an email.",
		expiredMessage:
			'Your Gmail connection expired. Send me a message like "reconnect gmail" and I’ll send a fresh link.',
		safeTools: [
			"GMAIL_FETCH_EMAILS",
			"GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID",
			"GMAIL_FETCH_MESSAGE_BY_THREAD_ID",
			"GMAIL_GET_ATTACHMENT",
			"GMAIL_GET_CONTACTS",
			"GMAIL_GET_DRAFT",
			"GMAIL_LIST_DRAFTS",
			"GMAIL_LIST_LABELS",
			"GMAIL_LIST_THREADS",
			"GMAIL_CREATE_EMAIL_DRAFT",
			"GMAIL_UPDATE_DRAFT",
			"GMAIL_SEND_DRAFT",
			"GMAIL_SEND_EMAIL",
			"GMAIL_REPLY_TO_THREAD",
		],
	},
	googlecalendar: {
		label: "Google Calendar",
		successMessage:
			"Google Calendar is connected. You can ask me to find free time, review upcoming events, or create and update meetings.",
		expiredMessage:
			'Your Google Calendar connection expired. Send me a message like "reconnect google calendar" and I’ll send a fresh link.',
		safeTools: [
			"GOOGLECALENDAR_EVENTS_LIST",
			"GOOGLECALENDAR_FIND_EVENT",
			"GOOGLECALENDAR_FIND_FREE_SLOTS",
			"GOOGLECALENDAR_FREE_BUSY_QUERY",
			"GOOGLECALENDAR_GET_CALENDAR",
			"GOOGLECALENDAR_GET_CURRENT_DATE_TIME",
			"GOOGLECALENDAR_LIST_CALENDARS",
			"GOOGLECALENDAR_CREATE_EVENT",
			"GOOGLECALENDAR_PATCH_EVENT",
			"GOOGLECALENDAR_UPDATE_EVENT",
		],
	},
	notion: {
		label: "Notion",
		successMessage:
			"Notion is connected. You can ask me to search pages, create notes, or update existing content.",
		expiredMessage:
			'Your Notion connection expired. Send me a message like "reconnect notion" and I’ll send a fresh link.',
		safeTools: [
			"NOTION_FETCH_DATA",
			"NOTION_FETCH_DATABASE",
			"NOTION_FETCH_NOTION_BLOCK",
			"NOTION_FETCH_NOTION_CHILD_BLOCK",
			"NOTION_FETCH_ROW",
			"NOTION_QUERY_DATABASE",
			"NOTION_SEARCH_NOTION_PAGE",
			"NOTION_CREATE_NOTION_PAGE",
			"NOTION_ADD_PAGE_CONTENT",
			"NOTION_APPEND_BLOCK_CHILDREN",
			"NOTION_INSERT_ROW_DATABASE",
			"NOTION_UPDATE_PAGE",
			"NOTION_UPDATE_ROW_DATABASE",
			"NOTION_NOTION_UPDATE_BLOCK",
		],
	},
	slack: {
		label: "Slack",
		successMessage:
			"Slack is connected. You can ask me to read channels, review threads, or post a message.",
		expiredMessage:
			'Your Slack connection expired. Send me a message like "reconnect slack" and I’ll send a fresh link.',
		safeTools: [
			"SLACK_FETCH_CONVERSATION_HISTORY",
			"SLACK_FETCH_MESSAGE_THREAD_FROM_A_CONVERSATION",
			"SLACK_FIND_CHANNELS",
			"SLACK_FIND_USERS",
			"SLACK_LIST_ALL_CHANNELS",
			"SLACK_LIST_CONVERSATIONS",
			"SLACK_RETRIEVE_CONVERSATION_INFORMATION",
			"SLACK_SEND_MESSAGE",
		],
	},
	googledrive: {
		label: "Google Drive",
		successMessage:
			"Google Drive is connected. You can ask me to find files, inspect documents, or pull file contents.",
		expiredMessage:
			'Your Google Drive connection expired. Send me a message like "reconnect google drive" and I’ll send a fresh link.',
		safeTools: [
			"GOOGLEDRIVE_LIST_FILES",
			"GOOGLEDRIVE_FIND_FILE",
			"GOOGLEDRIVE_FIND_FOLDER",
			"GOOGLEDRIVE_GET_FILE_METADATA",
			"GOOGLEDRIVE_DOWNLOAD_FILE",
			"GOOGLEDRIVE_PARSE_FILE",
		],
	},
}

export const COMPOSIO_DESTRUCTIVE_TAG = "destructiveHint" as const

export { DEFAULT_TELEGRAM_BOT_USERNAME } from "@amby/env"

export function isSupportedIntegrationToolkit(value: string): value is SupportedIntegrationToolkit {
	return SUPPORTED_INTEGRATION_TOOLKITS.includes(value as SupportedIntegrationToolkit)
}

export function getIntegrationLabel(toolkit: SupportedIntegrationToolkit): string {
	return INTEGRATION_TOOLKITS[toolkit].label
}

export function getIntegrationSuccessMessage(toolkit: SupportedIntegrationToolkit): string {
	return INTEGRATION_TOOLKITS[toolkit].successMessage
}

export function getIntegrationExpiredMessage(toolkit: SupportedIntegrationToolkit): string {
	return INTEGRATION_TOOLKITS[toolkit].expiredMessage
}

export function buildIntegrationStartPayload(toolkit: SupportedIntegrationToolkit): string {
	return `connect-${toolkit}`
}

export function parseIntegrationStartPayload(
	payload?: string | null,
): SupportedIntegrationToolkit | undefined {
	if (!payload) return undefined

	const match = /^connect-([a-z]+)$/i.exec(payload.trim())
	if (!match?.[1]) return undefined

	return isSupportedIntegrationToolkit(match[1]) ? match[1] : undefined
}
