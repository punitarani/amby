import { sql } from "drizzle-orm"
import {
	boolean,
	foreignKey,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	unique,
	uniqueIndex,
	uuid,
	vector,
} from "drizzle-orm/pg-core"

export const computeInstances = pgTable(
	"compute_instances",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		userId: text("user_id").notNull(),
		volumeId: uuid("volume_id").notNull(),
		externalInstanceId: text("external_instance_id"),
		role: text().default("main").notNull(),
		status: text().default("volume_creating").notNull(),
		snapshot: text(),
		lastActivityAt: timestamp("last_activity_at", { withTimezone: true, mode: "string" })
			.defaultNow()
			.notNull(),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		uniqueIndex("compute_instances_user_main_idx")
			.using(
				"btree",
				table.userId.asc().nullsLast().op("text_ops"),
				table.role.asc().nullsLast().op("text_ops"),
			)
			.where(sql`((role = 'main'::text) AND (status <> 'deleted'::text))`),
		foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "compute_instances_user_id_users_id_fk",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.volumeId],
			foreignColumns: [computeVolumes.id],
			name: "compute_instances_volume_id_compute_volumes_id_fk",
		}).onDelete("restrict"),
	],
)

export const computeVolumes = pgTable(
	"compute_volumes",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		userId: text("user_id").notNull(),
		externalVolumeId: text("external_volume_id").notNull(),
		status: text().default("creating").notNull(),
		authConfig: jsonb("auth_config"),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "compute_volumes_user_id_users_id_fk",
		}).onDelete("cascade"),
		unique("compute_volumes_user_id_unique").on(table.userId),
		unique("compute_volumes_external_volume_id_unique").on(table.externalVolumeId),
	],
)

export const connectorAuthRequests = pgTable(
	"connector_auth_requests",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		userId: text("user_id").notNull(),
		toolkit: text().notNull(),
		redirectUrl: text("redirect_url").notNull(),
		callbackUrl: text("callback_url").notNull(),
		expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		index("connector_auth_requests_expires_at_idx").using(
			"btree",
			table.expiresAt.asc().nullsLast().op("timestamptz_ops"),
		),
		uniqueIndex("connector_auth_requests_user_toolkit_idx").using(
			"btree",
			table.userId.asc().nullsLast().op("text_ops"),
			table.toolkit.asc().nullsLast().op("text_ops"),
		),
		foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "connector_auth_requests_user_id_users_id_fk",
		}).onDelete("cascade"),
	],
)

export const connectorPreferences = pgTable(
	"connector_preferences",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		userId: text("user_id").notNull(),
		toolkit: text().notNull(),
		preferredConnectedAccountId: text("preferred_connected_account_id").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		index("connector_preferences_connected_account_idx").using(
			"btree",
			table.preferredConnectedAccountId.asc().nullsLast().op("text_ops"),
		),
		uniqueIndex("connector_preferences_user_toolkit_idx").using(
			"btree",
			table.userId.asc().nullsLast().op("text_ops"),
			table.toolkit.asc().nullsLast().op("text_ops"),
		),
		foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "connector_preferences_user_id_users_id_fk",
		}).onDelete("cascade"),
	],
)

export const conversations = pgTable(
	"conversations",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		userId: text("user_id").notNull(),
		platform: text().notNull(),
		workspaceKey: text("workspace_key").default("").notNull(),
		externalConversationKey: text("external_conversation_key").notNull(),
		title: text(),
		metadata: jsonb(),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		uniqueIndex("conversations_platform_key_idx").using(
			"btree",
			table.userId.asc().nullsLast().op("text_ops"),
			table.platform.asc().nullsLast().op("text_ops"),
			table.workspaceKey.asc().nullsLast().op("text_ops"),
			table.externalConversationKey.asc().nullsLast().op("text_ops"),
		),
		index("conversations_user_idx").using("btree", table.userId.asc().nullsLast().op("text_ops")),
		foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "conversations_user_id_users_id_fk",
		}).onDelete("cascade"),
	],
)

export const messages = pgTable(
	"messages",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		conversationId: uuid("conversation_id").notNull(),
		threadId: uuid("thread_id"),
		role: text().notNull(),
		content: text().notNull(),
		metadata: jsonb(),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		index("messages_conversation_created_idx").using(
			"btree",
			table.conversationId.asc().nullsLast().op("timestamptz_ops"),
			table.createdAt.asc().nullsLast().op("uuid_ops"),
		),
		index("messages_thread_idx").using(
			"btree",
			table.threadId.asc().nullsLast().op("timestamptz_ops"),
			table.createdAt.asc().nullsLast().op("timestamptz_ops"),
		),
		foreignKey({
			columns: [table.conversationId],
			foreignColumns: [conversations.id],
			name: "messages_conversation_id_conversations_id_fk",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.threadId],
			foreignColumns: [conversationThreads.id],
			name: "messages_thread_id_conversation_threads_id_fk",
		}).onDelete("set null"),
	],
)

export const traces = pgTable(
	"traces",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		conversationId: uuid("conversation_id").notNull(),
		threadId: uuid("thread_id"),
		messageId: uuid("message_id"),
		parentTraceId: uuid("parent_trace_id"),
		rootTraceId: uuid("root_trace_id"),
		taskId: uuid("task_id"),
		specialist: text(),
		runnerKind: text("runner_kind"),
		mode: text(),
		depth: integer(),
		status: text().default("running").notNull(),
		startedAt: timestamp("started_at", { withTimezone: true, mode: "string" })
			.defaultNow()
			.notNull(),
		completedAt: timestamp("completed_at", { withTimezone: true, mode: "string" }),
		durationMs: integer("duration_ms"),
		metadata: jsonb(),
	},
	(table) => [
		index("traces_conversation_idx").using(
			"btree",
			table.conversationId.asc().nullsLast().op("uuid_ops"),
		),
		index("traces_message_id_idx").using("btree", table.messageId.asc().nullsLast().op("uuid_ops")),
		index("traces_mode_idx").using("btree", table.mode.asc().nullsLast().op("text_ops")),
		index("traces_parent_trace_id_idx").using(
			"btree",
			table.parentTraceId.asc().nullsLast().op("uuid_ops"),
		),
		index("traces_root_trace_id_idx").using(
			"btree",
			table.rootTraceId.asc().nullsLast().op("uuid_ops"),
		),
		index("traces_runner_kind_idx").using(
			"btree",
			table.runnerKind.asc().nullsLast().op("text_ops"),
		),
		index("traces_specialist_idx").using(
			"btree",
			table.specialist.asc().nullsLast().op("text_ops"),
		),
		index("traces_task_id_idx").using("btree", table.taskId.asc().nullsLast().op("uuid_ops")),
		index("traces_thread_idx").using("btree", table.threadId.asc().nullsLast().op("uuid_ops")),
		foreignKey({
			columns: [table.conversationId],
			foreignColumns: [conversations.id],
			name: "traces_conversation_id_conversations_id_fk",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.threadId],
			foreignColumns: [conversationThreads.id],
			name: "traces_thread_id_conversation_threads_id_fk",
		}).onDelete("set null"),
		foreignKey({
			columns: [table.messageId],
			foreignColumns: [messages.id],
			name: "traces_message_id_messages_id_fk",
		}).onDelete("set null"),
	],
)

export const traceEvents = pgTable(
	"trace_events",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		traceId: uuid("trace_id").notNull(),
		seq: integer().notNull(),
		kind: text().notNull(),
		payload: jsonb().notNull(),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		index("trace_events_trace_seq_idx").using(
			"btree",
			table.traceId.asc().nullsLast().op("int4_ops"),
			table.seq.asc().nullsLast().op("int4_ops"),
		),
		foreignKey({
			columns: [table.traceId],
			foreignColumns: [traces.id],
			name: "trace_events_trace_id_traces_id_fk",
		}).onDelete("cascade"),
	],
)

export const automations = pgTable(
	"automations",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		userId: text("user_id").notNull(),
		kind: text().notNull(),
		status: text().default("active").notNull(),
		scheduleJson: jsonb("schedule_json"),
		nextRunAt: timestamp("next_run_at", { withTimezone: true, mode: "string" }),
		lastRunAt: timestamp("last_run_at", { withTimezone: true, mode: "string" }),
		payloadJson: jsonb("payload_json"),
		deliveryTargetJson: jsonb("delivery_target_json"),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		index("automations_status_next_run_idx").using(
			"btree",
			table.status.asc().nullsLast().op("text_ops"),
			table.nextRunAt.asc().nullsLast().op("text_ops"),
		),
		index("automations_user_idx").using("btree", table.userId.asc().nullsLast().op("text_ops")),
		foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "automations_user_id_users_id_fk",
		}).onDelete("cascade"),
	],
)

export const runs = pgTable(
	"runs",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		conversationId: uuid("conversation_id").notNull(),
		threadId: uuid("thread_id").notNull(),
		triggerMessageId: uuid("trigger_message_id"),
		status: text().default("running").notNull(),
		mode: text().default("direct").notNull(),
		modelId: text("model_id").notNull(),
		summary: text(),
		requestJson: jsonb("request_json"),
		responseJson: jsonb("response_json"),
		startedAt: timestamp("started_at", { withTimezone: true, mode: "string" })
			.defaultNow()
			.notNull(),
		completedAt: timestamp("completed_at", { withTimezone: true, mode: "string" }),
	},
	(table) => [
		index("runs_conversation_idx").using(
			"btree",
			table.conversationId.asc().nullsLast().op("uuid_ops"),
		),
		index("runs_started_at_idx").using(
			"btree",
			table.startedAt.asc().nullsLast().op("timestamptz_ops"),
		),
		index("runs_status_idx").using("btree", table.status.asc().nullsLast().op("text_ops")),
		index("runs_thread_idx").using("btree", table.threadId.asc().nullsLast().op("uuid_ops")),
		foreignKey({
			columns: [table.conversationId],
			foreignColumns: [conversations.id],
			name: "runs_conversation_id_conversations_id_fk",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.threadId],
			foreignColumns: [conversationThreads.id],
			name: "runs_thread_id_conversation_threads_id_fk",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.triggerMessageId],
			foreignColumns: [messages.id],
			name: "runs_trigger_message_id_messages_id_fk",
		}).onDelete("set null"),
	],
)

export const tasks = pgTable(
	"tasks",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		userId: text("user_id").notNull(),
		runtime: text().notNull(),
		provider: text().notNull(),
		status: text().default("pending").notNull(),
		threadId: uuid("thread_id"),
		traceId: uuid("trace_id"),
		parentTaskId: uuid("parent_task_id"),
		rootTaskId: uuid("root_task_id"),
		specialist: text(),
		runnerKind: text("runner_kind"),
		input: jsonb(),
		output: jsonb(),
		artifacts: jsonb(),
		confirmationState: text("confirmation_state"),
		prompt: text().notNull(),
		requiresBrowser: boolean("requires_browser").default(false).notNull(),
		runtimeData: jsonb("runtime_data"),
		outputSummary: text("output_summary"),
		error: text(),
		exitCode: integer("exit_code"),
		startedAt: timestamp("started_at", { withTimezone: true, mode: "string" }),
		heartbeatAt: timestamp("heartbeat_at", { withTimezone: true, mode: "string" }),
		completedAt: timestamp("completed_at", { withTimezone: true, mode: "string" }),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
			.defaultNow()
			.notNull(),
		metadata: jsonb(),
		conversationId: uuid("conversation_id"),
		replyTarget: jsonb("reply_target"),
		callbackId: uuid("callback_id"),
		callbackSecretHash: text("callback_secret_hash"),
		lastEventSeq: integer("last_event_seq").default(0).notNull(),
		lastEventAt: timestamp("last_event_at", { withTimezone: true, mode: "string" }),
		lastProbeAt: timestamp("last_probe_at", { withTimezone: true, mode: "string" }),
		notifiedStatus: text("notified_status"),
		lastNotificationAt: timestamp("last_notification_at", { withTimezone: true, mode: "string" }),
	},
	(table) => [
		index("tasks_callback_id_idx").using(
			"btree",
			table.callbackId.asc().nullsLast().op("uuid_ops"),
		),
		index("tasks_parent_task_id_idx").using(
			"btree",
			table.parentTaskId.asc().nullsLast().op("uuid_ops"),
		),
		index("tasks_root_task_id_idx").using(
			"btree",
			table.rootTaskId.asc().nullsLast().op("uuid_ops"),
		),
		index("tasks_runner_kind_idx").using(
			"btree",
			table.runnerKind.asc().nullsLast().op("text_ops"),
		),
		index("tasks_runtime_status_heartbeat_idx").using(
			"btree",
			table.runtime.asc().nullsLast().op("timestamptz_ops"),
			table.status.asc().nullsLast().op("text_ops"),
			table.heartbeatAt.asc().nullsLast().op("timestamptz_ops"),
		),
		index("tasks_specialist_idx").using("btree", table.specialist.asc().nullsLast().op("text_ops")),
		index("tasks_status_heartbeat_idx").using(
			"btree",
			table.status.asc().nullsLast().op("timestamptz_ops"),
			table.heartbeatAt.asc().nullsLast().op("text_ops"),
		),
		index("tasks_thread_idx").using("btree", table.threadId.asc().nullsLast().op("uuid_ops")),
		index("tasks_trace_id_idx").using("btree", table.traceId.asc().nullsLast().op("uuid_ops")),
		index("tasks_user_status_idx").using(
			"btree",
			table.userId.asc().nullsLast().op("text_ops"),
			table.status.asc().nullsLast().op("text_ops"),
		),
		foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "tasks_user_id_users_id_fk",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.threadId],
			foreignColumns: [conversationThreads.id],
			name: "tasks_thread_id_conversation_threads_id_fk",
		}).onDelete("set null"),
		foreignKey({
			columns: [table.conversationId],
			foreignColumns: [conversations.id],
			name: "tasks_conversation_id_conversations_id_fk",
		}).onDelete("set null"),
		foreignKey({
			columns: [table.parentTaskId],
			foreignColumns: [table.id],
			name: "tasks_parent_task_id_fkey",
		}),
		foreignKey({
			columns: [table.rootTaskId],
			foreignColumns: [table.id],
			name: "tasks_root_task_id_fkey",
		}),
	],
)

export const taskEvents = pgTable(
	"task_events",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		taskId: uuid("task_id").notNull(),
		eventId: uuid("event_id").notNull(),
		source: text().notNull(),
		kind: text().notNull(),
		seq: integer(),
		payload: jsonb(),
		occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "string" }).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		uniqueIndex("task_events_task_event_id_idx").using(
			"btree",
			table.taskId.asc().nullsLast().op("uuid_ops"),
			table.eventId.asc().nullsLast().op("uuid_ops"),
		),
		index("task_events_task_id_idx").using("btree", table.taskId.asc().nullsLast().op("uuid_ops")),
		index("task_events_task_occurred_idx").using(
			"btree",
			table.taskId.asc().nullsLast().op("timestamptz_ops"),
			table.occurredAt.asc().nullsLast().op("uuid_ops"),
		),
		index("task_events_task_seq_idx").using(
			"btree",
			table.taskId.asc().nullsLast().op("uuid_ops"),
			table.seq.asc().nullsLast().op("int4_ops"),
		),
		foreignKey({
			columns: [table.taskId],
			foreignColumns: [tasks.id],
			name: "task_events_task_id_tasks_id_fk",
		}).onDelete("cascade"),
	],
)

export const accounts = pgTable(
	"accounts",
	{
		id: text().primaryKey().notNull(),
		userId: text("user_id").notNull(),
		accountId: text("account_id").notNull(),
		providerId: text("provider_id").notNull(),
		accessToken: text("access_token"),
		refreshToken: text("refresh_token"),
		accessTokenExpiresAt: timestamp("access_token_expires_at", {
			withTimezone: true,
			mode: "string",
		}),
		refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
			withTimezone: true,
			mode: "string",
		}),
		scope: text(),
		idToken: text("id_token"),
		password: text(),
		metadata: jsonb(),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		uniqueIndex("accounts_provider_account_idx").using(
			"btree",
			table.providerId.asc().nullsLast().op("text_ops"),
			table.accountId.asc().nullsLast().op("text_ops"),
		),
		foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "accounts_user_id_users_id_fk",
		}).onDelete("cascade"),
	],
)

export const sessions = pgTable(
	"sessions",
	{
		id: text().primaryKey().notNull(),
		userId: text("user_id").notNull(),
		token: text().notNull(),
		expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
		ipAddress: text("ip_address"),
		userAgent: text("user_agent"),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "sessions_user_id_users_id_fk",
		}).onDelete("cascade"),
		unique("sessions_token_unique").on(table.token),
	],
)

export const conversationThreads = pgTable(
	"conversation_threads",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		conversationId: uuid("conversation_id").notNull(),
		source: text().notNull(),
		externalThreadKey: text("external_thread_key"),
		label: text(),
		synopsis: text(),
		keywords: text().array(),
		isDefault: boolean("is_default").default(false).notNull(),
		status: text().default("open").notNull(),
		lastActiveAt: timestamp("last_active_at", { withTimezone: true, mode: "string" })
			.defaultNow()
			.notNull(),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		index("threads_conversation_active_idx").using(
			"btree",
			table.conversationId.asc().nullsLast().op("text_ops"),
			table.status.asc().nullsLast().op("text_ops"),
			table.lastActiveAt.asc().nullsLast().op("text_ops"),
		),
		uniqueIndex("threads_default_unique_idx")
			.using("btree", table.conversationId.asc().nullsLast().op("uuid_ops"))
			.where(sql`(is_default = true)`),
		uniqueIndex("threads_external_key_idx")
			.using(
				"btree",
				table.conversationId.asc().nullsLast().op("text_ops"),
				table.externalThreadKey.asc().nullsLast().op("text_ops"),
			)
			.where(sql`(external_thread_key IS NOT NULL)`),
		foreignKey({
			columns: [table.conversationId],
			foreignColumns: [conversations.id],
			name: "conversation_threads_conversation_id_conversations_id_fk",
		}).onDelete("cascade"),
	],
)

export const verifications = pgTable("verifications", {
	id: text().primaryKey().notNull(),
	identifier: text().notNull(),
	value: text().notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
})

export const users = pgTable(
	"users",
	{
		id: text().primaryKey().notNull(),
		name: text().notNull(),
		email: text(),
		emailVerified: boolean("email_verified").default(false).notNull(),
		phoneNumber: text("phone_number"),
		phoneNumberVerified: boolean("phone_number_verified").default(false).notNull(),
		image: text(),
		timezone: text().default("UTC").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		unique("users_email_unique").on(table.email),
		unique("users_phone_number_unique").on(table.phoneNumber),
	],
)

export const integrationAccounts = pgTable(
	"integration_accounts",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		userId: text("user_id").notNull(),
		provider: text().notNull(),
		externalAccountId: text("external_account_id"),
		status: text().default("pending").notNull(),
		isPreferred: boolean("is_preferred").default(false).notNull(),
		metadataJson: jsonb("metadata_json"),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		uniqueIndex("integration_accounts_external_idx").using(
			"btree",
			table.userId.asc().nullsLast().op("text_ops"),
			table.provider.asc().nullsLast().op("text_ops"),
			table.externalAccountId.asc().nullsLast().op("text_ops"),
		),
		index("integration_accounts_provider_idx").using(
			"btree",
			table.userId.asc().nullsLast().op("text_ops"),
			table.provider.asc().nullsLast().op("text_ops"),
		),
		index("integration_accounts_user_idx").using(
			"btree",
			table.userId.asc().nullsLast().op("text_ops"),
		),
		foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "integration_accounts_user_id_users_id_fk",
		}).onDelete("cascade"),
	],
)

export const memories = pgTable(
	"memories",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		userId: text("user_id").notNull(),
		content: text().notNull(),
		category: text().default("dynamic").notNull(),
		isActive: boolean("is_active").default(true).notNull(),
		source: text(),
		embedding: vector({ dimensions: 1536 }),
		metadata: jsonb(),
		version: integer().default(1).notNull(),
		parentId: uuid("parent_id"),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		index("memories_user_active_idx").using(
			"btree",
			table.userId.asc().nullsLast().op("text_ops"),
			table.isActive.asc().nullsLast().op("text_ops"),
		),
		foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "memories_user_id_users_id_fk",
		}).onDelete("cascade"),
		foreignKey({
			columns: [table.parentId],
			foreignColumns: [table.id],
			name: "memories_parent_id_memories_id_fk",
		}).onDelete("set null"),
	],
)

export const runEvents = pgTable(
	"run_events",
	{
		id: uuid().defaultRandom().primaryKey().notNull(),
		runId: uuid("run_id").notNull(),
		seq: integer().notNull(),
		kind: text().notNull(),
		payload: jsonb().notNull(),
		createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
			.defaultNow()
			.notNull(),
	},
	(table) => [
		index("run_events_kind_idx").using("btree", table.kind.asc().nullsLast().op("text_ops")),
		index("run_events_run_seq_idx").using(
			"btree",
			table.runId.asc().nullsLast().op("int4_ops"),
			table.seq.asc().nullsLast().op("int4_ops"),
		),
		foreignKey({
			columns: [table.runId],
			foreignColumns: [runs.id],
			name: "run_events_run_id_runs_id_fk",
		}).onDelete("cascade"),
	],
)
