export type ToolkitRegistryEntry = {
	label: string
	envKey: string
	safeTools: readonly string[]
	messages: {
		success: string
		expired: string
	}
}

export const TOOLKIT_REGISTRY = {
	gmail: {
		label: "Gmail",
		envKey: "COMPOSIO_AUTH_CONFIG_GMAIL",
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
		messages: {
			success:
				"Gmail is connected \u2014 I can read your mail, draft replies, and send messages whenever you need.",
			expired:
				"Your Gmail connection has expired. Just ask me to reconnect it and I'll send a fresh link.",
		},
	},
	googlecalendar: {
		label: "Google Calendar",
		envKey: "COMPOSIO_AUTH_CONFIG_GOOGLECALENDAR",
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
		messages: {
			success:
				"Google Calendar is connected \u2014 I can check your schedule, find free time, and manage events.",
			expired:
				"Your Google Calendar connection has expired. Just ask me to reconnect it and I'll send a fresh link.",
		},
	},
	notion: {
		label: "Notion",
		envKey: "COMPOSIO_AUTH_CONFIG_NOTION",
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
		messages: {
			success:
				"Notion is connected \u2014 I can search your pages, create notes, and update existing content.",
			expired:
				"Your Notion connection has expired. Just ask me to reconnect it and I'll send a fresh link.",
		},
	},
	slack: {
		label: "Slack",
		envKey: "COMPOSIO_AUTH_CONFIG_SLACK",
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
		messages: {
			success:
				"Slack is connected \u2014 I can read channels, follow threads, and post messages for you.",
			expired:
				"Your Slack connection has expired. Just ask me to reconnect it and I'll send a fresh link.",
		},
	},
	googledrive: {
		label: "Google Drive",
		envKey: "COMPOSIO_AUTH_CONFIG_GOOGLEDRIVE",
		safeTools: [
			"GOOGLEDRIVE_LIST_FILES",
			"GOOGLEDRIVE_FIND_FILE",
			"GOOGLEDRIVE_FIND_FOLDER",
			"GOOGLEDRIVE_GET_FILE_METADATA",
			"GOOGLEDRIVE_DOWNLOAD_FILE",
			"GOOGLEDRIVE_PARSE_FILE",
		],
		messages: {
			success:
				"Google Drive is connected \u2014 I can find files, open documents, and pull content.",
			expired:
				"Your Google Drive connection has expired. Just ask me to reconnect it and I'll send a fresh link.",
		},
	},
} as const satisfies Record<string, ToolkitRegistryEntry>

export type SupportedIntegrationToolkit = keyof typeof TOOLKIT_REGISTRY

export const SUPPORTED_INTEGRATION_TOOLKITS = Object.keys(TOOLKIT_REGISTRY) as [
	SupportedIntegrationToolkit,
	...SupportedIntegrationToolkit[],
]

export const INTEGRATION_LABELS = Object.fromEntries(
	Object.entries(TOOLKIT_REGISTRY).map(([slug, entry]) => [slug, entry.label]),
) as Record<SupportedIntegrationToolkit, string>
