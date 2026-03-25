import { Context } from "effect"

/**
 * A context contributor provides additional system prompt context
 * for a conversation turn (e.g. memory profile, active integrations).
 */
export interface ContextContributor {
	readonly id: string
	readonly contribute: (params: {
		userId: string
		conversationId: string
		threadId: string
	}) => Promise<string | undefined>
}

/**
 * A tool provider exposes AI SDK tools to the orchestrator.
 * Tools are grouped by capability for selective activation.
 */
export interface ToolProvider {
	readonly id: string
	readonly group: string
	readonly getTools: (params: {
		userId: string
		conversationId: string
		threadId: string
	}) => Promise<Record<string, unknown>>
}

/**
 * A planner hint provider gives the execution planner
 * additional context to inform its planning decisions.
 */
export interface PlannerHintProvider {
	readonly id: string
	readonly getHints: (params: {
		userId: string
		conversationId: string
		threadId: string
	}) => Promise<string | undefined>
}

/**
 * A task runner handles durable task execution for a specific capability.
 */
export interface TaskRunner {
	readonly id: string
	readonly canHandle: (pluginId: string, runnerKind: string) => boolean
	readonly execute: (params: {
		taskId: string
		input: unknown
		userId: string
	}) => Promise<{ status: string; output?: unknown; error?: string }>
}

/**
 * An event handler responds to lifecycle events (e.g. turn completed, task finished).
 */
export interface EventHandler {
	readonly id: string
	readonly handle: (event: { kind: string; payload: Record<string, unknown> }) => Promise<void>
}

/**
 * The plugin registry is populated during plugin registration.
 * The orchestrator reads from it to assemble context, tools, and routing.
 */
export interface PluginRegistry {
	addContextContributor(contributor: ContextContributor): void
	addToolProvider(provider: ToolProvider): void
	addPlannerHintProvider(provider: PlannerHintProvider): void
	addTaskRunner(runner: TaskRunner): void
	addEventHandler(handler: EventHandler): void

	readonly contextContributors: ReadonlyArray<ContextContributor>
	readonly toolProviders: ReadonlyArray<ToolProvider>
	readonly plannerHintProviders: ReadonlyArray<PlannerHintProvider>
	readonly taskRunners: ReadonlyArray<TaskRunner>
	readonly eventHandlers: ReadonlyArray<EventHandler>
}

/**
 * The AmbyPlugin contract. Each built-in plugin implements this.
 */
export interface AmbyPlugin {
	readonly id: string
	register(registry: PluginRegistry): void
}

/**
 * Effect service tag for the plugin registry.
 */
export class PluginRegistryService extends Context.Tag("PluginRegistryService")<
	PluginRegistryService,
	PluginRegistry
>() {}
