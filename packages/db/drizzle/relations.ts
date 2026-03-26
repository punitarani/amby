import { relations } from "drizzle-orm/relations"
import {
	accounts,
	automations,
	computeInstances,
	computeVolumes,
	connectorAuthRequests,
	connectorPreferences,
	conversations,
	conversationThreads,
	integrationAccounts,
	memories,
	messages,
	runEvents,
	runs,
	sessions,
	taskEvents,
	tasks,
	traceEvents,
	traces,
	users,
} from "./schema"

export const computeInstancesRelations = relations(computeInstances, ({ one }) => ({
	user: one(users, {
		fields: [computeInstances.userId],
		references: [users.id],
	}),
	computeVolume: one(computeVolumes, {
		fields: [computeInstances.volumeId],
		references: [computeVolumes.id],
	}),
}))

export const usersRelations = relations(users, ({ many }) => ({
	computeInstances: many(computeInstances),
	computeVolumes: many(computeVolumes),
	connectorAuthRequests: many(connectorAuthRequests),
	connectorPreferences: many(connectorPreferences),
	conversations: many(conversations),
	automations: many(automations),
	tasks: many(tasks),
	accounts: many(accounts),
	sessions: many(sessions),
	integrationAccounts: many(integrationAccounts),
	memories: many(memories),
}))

export const computeVolumesRelations = relations(computeVolumes, ({ one, many }) => ({
	computeInstances: many(computeInstances),
	user: one(users, {
		fields: [computeVolumes.userId],
		references: [users.id],
	}),
}))

export const connectorAuthRequestsRelations = relations(connectorAuthRequests, ({ one }) => ({
	user: one(users, {
		fields: [connectorAuthRequests.userId],
		references: [users.id],
	}),
}))

export const connectorPreferencesRelations = relations(connectorPreferences, ({ one }) => ({
	user: one(users, {
		fields: [connectorPreferences.userId],
		references: [users.id],
	}),
}))

export const conversationsRelations = relations(conversations, ({ one, many }) => ({
	user: one(users, {
		fields: [conversations.userId],
		references: [users.id],
	}),
	messages: many(messages),
	traces: many(traces),
	runs: many(runs),
	tasks: many(tasks),
	conversationThreads: many(conversationThreads),
}))

export const messagesRelations = relations(messages, ({ one, many }) => ({
	conversation: one(conversations, {
		fields: [messages.conversationId],
		references: [conversations.id],
	}),
	conversationThread: one(conversationThreads, {
		fields: [messages.threadId],
		references: [conversationThreads.id],
	}),
	traces: many(traces),
	runs: many(runs),
}))

export const conversationThreadsRelations = relations(conversationThreads, ({ one, many }) => ({
	messages: many(messages),
	traces: many(traces),
	runs: many(runs),
	tasks: many(tasks),
	conversation: one(conversations, {
		fields: [conversationThreads.conversationId],
		references: [conversations.id],
	}),
}))

export const tracesRelations = relations(traces, ({ one, many }) => ({
	conversation: one(conversations, {
		fields: [traces.conversationId],
		references: [conversations.id],
	}),
	conversationThread: one(conversationThreads, {
		fields: [traces.threadId],
		references: [conversationThreads.id],
	}),
	message: one(messages, {
		fields: [traces.messageId],
		references: [messages.id],
	}),
	traceEvents: many(traceEvents),
}))

export const traceEventsRelations = relations(traceEvents, ({ one }) => ({
	trace: one(traces, {
		fields: [traceEvents.traceId],
		references: [traces.id],
	}),
}))

export const automationsRelations = relations(automations, ({ one }) => ({
	user: one(users, {
		fields: [automations.userId],
		references: [users.id],
	}),
}))

export const runsRelations = relations(runs, ({ one, many }) => ({
	conversation: one(conversations, {
		fields: [runs.conversationId],
		references: [conversations.id],
	}),
	conversationThread: one(conversationThreads, {
		fields: [runs.threadId],
		references: [conversationThreads.id],
	}),
	message: one(messages, {
		fields: [runs.triggerMessageId],
		references: [messages.id],
	}),
	runEvents: many(runEvents),
}))

export const tasksRelations = relations(tasks, ({ one, many }) => ({
	user: one(users, {
		fields: [tasks.userId],
		references: [users.id],
	}),
	conversationThread: one(conversationThreads, {
		fields: [tasks.threadId],
		references: [conversationThreads.id],
	}),
	conversation: one(conversations, {
		fields: [tasks.conversationId],
		references: [conversations.id],
	}),
	task_parentTaskId: one(tasks, {
		fields: [tasks.parentTaskId],
		references: [tasks.id],
		relationName: "tasks_parentTaskId_tasks_id",
	}),
	tasks_parentTaskId: many(tasks, {
		relationName: "tasks_parentTaskId_tasks_id",
	}),
	task_rootTaskId: one(tasks, {
		fields: [tasks.rootTaskId],
		references: [tasks.id],
		relationName: "tasks_rootTaskId_tasks_id",
	}),
	tasks_rootTaskId: many(tasks, {
		relationName: "tasks_rootTaskId_tasks_id",
	}),
	taskEvents: many(taskEvents),
}))

export const taskEventsRelations = relations(taskEvents, ({ one }) => ({
	task: one(tasks, {
		fields: [taskEvents.taskId],
		references: [tasks.id],
	}),
}))

export const accountsRelations = relations(accounts, ({ one }) => ({
	user: one(users, {
		fields: [accounts.userId],
		references: [users.id],
	}),
}))

export const sessionsRelations = relations(sessions, ({ one }) => ({
	user: one(users, {
		fields: [sessions.userId],
		references: [users.id],
	}),
}))

export const integrationAccountsRelations = relations(integrationAccounts, ({ one }) => ({
	user: one(users, {
		fields: [integrationAccounts.userId],
		references: [users.id],
	}),
}))

export const memoriesRelations = relations(memories, ({ one, many }) => ({
	user: one(users, {
		fields: [memories.userId],
		references: [users.id],
	}),
	memory: one(memories, {
		fields: [memories.parentId],
		references: [memories.id],
		relationName: "memories_parentId_memories_id",
	}),
	memories: many(memories, {
		relationName: "memories_parentId_memories_id",
	}),
}))

export const runEventsRelations = relations(runEvents, ({ one }) => ({
	run: one(runs, {
		fields: [runEvents.runId],
		references: [runs.id],
	}),
}))
