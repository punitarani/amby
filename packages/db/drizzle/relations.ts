import { relations } from "drizzle-orm/relations"
import {
	accounts,
	automations,
	computeInstances,
	computeVolumes,
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
	tasks: many(tasks),
	automations: many(automations),
	conversations: many(conversations),
	accounts: many(accounts),
	memories: many(memories),
	sessions: many(sessions),
	computeVolumes: many(computeVolumes),
	integrationAccounts: many(integrationAccounts),
}))

export const computeVolumesRelations = relations(computeVolumes, ({ one, many }) => ({
	computeInstances: many(computeInstances),
	user: one(users, {
		fields: [computeVolumes.userId],
		references: [users.id],
	}),
}))

export const tasksRelations = relations(tasks, ({ one, many }) => ({
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
	conversationThread: one(conversationThreads, {
		fields: [tasks.threadId],
		references: [conversationThreads.id],
	}),
	user: one(users, {
		fields: [tasks.userId],
		references: [users.id],
	}),
	taskEvents: many(taskEvents),
}))

export const conversationsRelations = relations(conversations, ({ one, many }) => ({
	tasks: many(tasks),
	user: one(users, {
		fields: [conversations.userId],
		references: [users.id],
	}),
	messages: many(messages),
	conversationThreads: many(conversationThreads),
	runs: many(runs),
}))

export const conversationThreadsRelations = relations(conversationThreads, ({ one, many }) => ({
	tasks: many(tasks),
	messages: many(messages),
	conversation: one(conversations, {
		fields: [conversationThreads.conversationId],
		references: [conversations.id],
	}),
	runs: many(runs),
}))

export const taskEventsRelations = relations(taskEvents, ({ one }) => ({
	task: one(tasks, {
		fields: [taskEvents.taskId],
		references: [tasks.id],
	}),
}))

export const automationsRelations = relations(automations, ({ one }) => ({
	user: one(users, {
		fields: [automations.userId],
		references: [users.id],
	}),
}))

export const accountsRelations = relations(accounts, ({ one }) => ({
	user: one(users, {
		fields: [accounts.userId],
		references: [users.id],
	}),
}))

export const memoriesRelations = relations(memories, ({ one, many }) => ({
	memory: one(memories, {
		fields: [memories.parentId],
		references: [memories.id],
		relationName: "memories_parentId_memories_id",
	}),
	memories: many(memories, {
		relationName: "memories_parentId_memories_id",
	}),
	user: one(users, {
		fields: [memories.userId],
		references: [users.id],
	}),
}))

export const sessionsRelations = relations(sessions, ({ one }) => ({
	user: one(users, {
		fields: [sessions.userId],
		references: [users.id],
	}),
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
	runs_messageId: many(runs, {
		relationName: "runs_messageId_messages_id",
	}),
	runs_triggerMessageId: many(runs, {
		relationName: "runs_triggerMessageId_messages_id",
	}),
}))

export const integrationAccountsRelations = relations(integrationAccounts, ({ one }) => ({
	user: one(users, {
		fields: [integrationAccounts.userId],
		references: [users.id],
	}),
}))

export const runEventsRelations = relations(runEvents, ({ one }) => ({
	run: one(runs, {
		fields: [runEvents.runId],
		references: [runs.id],
	}),
}))

export const runsRelations = relations(runs, ({ one, many }) => ({
	runEvents: many(runEvents),
	conversation: one(conversations, {
		fields: [runs.conversationId],
		references: [conversations.id],
	}),
	message_messageId: one(messages, {
		fields: [runs.messageId],
		references: [messages.id],
		relationName: "runs_messageId_messages_id",
	}),
	conversationThread: one(conversationThreads, {
		fields: [runs.threadId],
		references: [conversationThreads.id],
	}),
	message_triggerMessageId: one(messages, {
		fields: [runs.triggerMessageId],
		references: [messages.id],
		relationName: "runs_triggerMessageId_messages_id",
	}),
}))
