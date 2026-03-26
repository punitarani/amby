import type {
	AmbyPlugin,
	ContextContributor,
	EventHandler,
	PlannerHintProvider,
	PluginRegistry,
	TaskRunner,
	ToolProvider,
} from "./plugin"

/**
 * Default in-memory plugin registry implementation.
 * Plugins self-register their capabilities during startup.
 */
export function createPluginRegistry(): PluginRegistry {
	const contributors: ContextContributor[] = []
	const tools: ToolProvider[] = []
	const hints: PlannerHintProvider[] = []
	const runners: TaskRunner[] = []
	const handlers: EventHandler[] = []

	return {
		addContextContributor(contributor) {
			contributors.push(contributor)
		},
		addToolProvider(provider) {
			tools.push(provider)
		},
		addPlannerHintProvider(provider) {
			hints.push(provider)
		},
		addTaskRunner(runner) {
			runners.push(runner)
		},
		addEventHandler(handler) {
			handlers.push(handler)
		},

		get contextContributors() {
			return contributors
		},
		get toolProviders() {
			return tools
		},
		get plannerHintProviders() {
			return hints
		},
		get taskRunners() {
			return runners
		},
		get eventHandlers() {
			return handlers
		},
	}
}

/**
 * Register multiple plugins into a registry.
 */
export function registerPlugins(registry: PluginRegistry, plugins: AmbyPlugin[]): void {
	for (const plugin of plugins) {
		plugin.register(registry)
	}
}
