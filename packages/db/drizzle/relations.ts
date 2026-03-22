import { relations } from "drizzle-orm/relations"
import {
	accounts,
	connectorAuthRequests,
	connectorPreferences,
	conversations,
	conversationThreads,
	jobs,
	memories,
	messages,
	sandboxes,
	sessions,
	taskEvents,
	tasks,
	traceEvents,
	traces,
	users,
} from "./schema"

export const connectorAuthRequestsRelations = relations(connectorAuthRequests, ({ one }) => ({
	user: one(users, {
		fields: [connectorAuthRequests.userId],
		references: [users.id],
	}),
}))

export const usersRelations = relations(users, ({ many }) => ({
	connectorAuthRequests: many(connectorAuthRequests),
	connectorPreferences: many(connectorPreferences),
	jobs: many(jobs),
	memories: many(memories),
	accounts: many(accounts),
	sessions: many(sessions),
	sandboxes: many(sandboxes),
	conversations: many(conversations),
	tasks: many(tasks),
}))

export const connectorPreferencesRelations = relations(connectorPreferences, ({ one }) => ({
	user: one(users, {
		fields: [connectorPreferences.userId],
		references: [users.id],
	}),
}))

export const jobsRelations = relations(jobs, ({ one }) => ({
	user: one(users, {
		fields: [jobs.userId],
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

export const accountsRelations = relations(accounts, ({ one }) => ({
	user: one(users, {
		fields: [accounts.userId],
		references: [users.id],
	}),
}))

export const taskEventsRelations = relations(taskEvents, ({ one }) => ({
	task: one(tasks, {
		fields: [taskEvents.taskId],
		references: [tasks.id],
	}),
}))

export const tasksRelations = relations(tasks, ({ one, many }) => ({
	taskEvents: many(taskEvents),
	user: one(users, {
		fields: [tasks.userId],
		references: [users.id],
	}),
	conversation: one(conversations, {
		fields: [tasks.conversationId],
		references: [conversations.id],
	}),
}))

export const sessionsRelations = relations(sessions, ({ one }) => ({
	user: one(users, {
		fields: [sessions.userId],
		references: [users.id],
	}),
}))

export const sandboxesRelations = relations(sandboxes, ({ one }) => ({
	user: one(users, {
		fields: [sandboxes.userId],
		references: [users.id],
	}),
}))

export const conversationsRelations = relations(conversations, ({ one, many }) => ({
	user: one(users, {
		fields: [conversations.userId],
		references: [users.id],
	}),
	traces: many(traces),
	conversationThreads: many(conversationThreads),
	messages: many(messages),
	tasks: many(tasks),
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

export const conversationThreadsRelations = relations(conversationThreads, ({ one, many }) => ({
	traces: many(traces),
	conversation: one(conversations, {
		fields: [conversationThreads.conversationId],
		references: [conversations.id],
	}),
	messages: many(messages),
}))

export const messagesRelations = relations(messages, ({ one, many }) => ({
	traces: many(traces),
	conversation: one(conversations, {
		fields: [messages.conversationId],
		references: [conversations.id],
	}),
	conversationThread: one(conversationThreads, {
		fields: [messages.threadId],
		references: [conversationThreads.id],
	}),
}))

export const traceEventsRelations = relations(traceEvents, ({ one }) => ({
	trace: one(traces, {
		fields: [traceEvents.traceId],
		references: [traces.id],
	}),
}))
