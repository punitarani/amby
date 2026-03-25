import { describe, expect, it } from "bun:test"
import type { AmbyPlugin, PluginRegistry } from "./plugin"
import { createPluginRegistry, registerPlugins } from "./registry"

function makeContextContributor(id: string) {
	return {
		id,
		contribute: async () => `context from ${id}`,
	}
}

function makeToolProvider(id: string, group: string) {
	return {
		id,
		group,
		getTools: async () => ({ [`tool_${id}`]: {} }),
	}
}

function makePlannerHintProvider(id: string) {
	return {
		id,
		getHints: async () => `hints from ${id}`,
	}
}

function makeTaskRunner(id: string) {
	return {
		id,
		canHandle: (pluginId: string) => pluginId === id,
		execute: async () => ({ status: "completed" }),
	}
}

function makeEventHandler(id: string) {
	return {
		id,
		handle: async () => {},
	}
}

describe("createPluginRegistry", () => {
	it("starts with empty collections", () => {
		const registry = createPluginRegistry()
		expect(registry.contextContributors).toHaveLength(0)
		expect(registry.toolProviders).toHaveLength(0)
		expect(registry.plannerHintProviders).toHaveLength(0)
		expect(registry.taskRunners).toHaveLength(0)
		expect(registry.eventHandlers).toHaveLength(0)
	})

	it("accumulates context contributors", () => {
		const registry = createPluginRegistry()
		registry.addContextContributor(makeContextContributor("a"))
		registry.addContextContributor(makeContextContributor("b"))
		expect(registry.contextContributors).toHaveLength(2)
		expect(registry.contextContributors[0]?.id).toBe("a")
		expect(registry.contextContributors[1]?.id).toBe("b")
	})

	it("accumulates tool providers", () => {
		const registry = createPluginRegistry()
		registry.addToolProvider(makeToolProvider("mem-tools", "memory"))
		registry.addToolProvider(makeToolProvider("int-tools", "integration"))
		expect(registry.toolProviders).toHaveLength(2)
		expect(registry.toolProviders[0]?.group).toBe("memory")
		expect(registry.toolProviders[1]?.group).toBe("integration")
	})

	it("accumulates planner hint providers", () => {
		const registry = createPluginRegistry()
		registry.addPlannerHintProvider(makePlannerHintProvider("hints-a"))
		expect(registry.plannerHintProviders).toHaveLength(1)
	})

	it("accumulates task runners", () => {
		const registry = createPluginRegistry()
		registry.addTaskRunner(makeTaskRunner("runner-a"))
		registry.addTaskRunner(makeTaskRunner("runner-b"))
		expect(registry.taskRunners).toHaveLength(2)
	})

	it("accumulates event handlers", () => {
		const registry = createPluginRegistry()
		registry.addEventHandler(makeEventHandler("handler-a"))
		expect(registry.eventHandlers).toHaveLength(1)
	})
})

describe("registerPlugins", () => {
	it("registers a single plugin with all 5 capability types", () => {
		const plugin: AmbyPlugin = {
			id: "full-plugin",
			register(registry: PluginRegistry) {
				registry.addContextContributor(makeContextContributor("full:ctx"))
				registry.addToolProvider(makeToolProvider("full:tools", "full"))
				registry.addPlannerHintProvider(makePlannerHintProvider("full:hints"))
				registry.addTaskRunner(makeTaskRunner("full:runner"))
				registry.addEventHandler(makeEventHandler("full:events"))
			},
		}

		const registry = createPluginRegistry()
		registerPlugins(registry, [plugin])

		expect(registry.contextContributors).toHaveLength(1)
		expect(registry.toolProviders).toHaveLength(1)
		expect(registry.plannerHintProviders).toHaveLength(1)
		expect(registry.taskRunners).toHaveLength(1)
		expect(registry.eventHandlers).toHaveLength(1)
	})

	it("accumulates across multiple plugins", () => {
		const pluginA: AmbyPlugin = {
			id: "plugin-a",
			register(registry) {
				registry.addContextContributor(makeContextContributor("a:ctx"))
				registry.addToolProvider(makeToolProvider("a:tools", "memory"))
			},
		}

		const pluginB: AmbyPlugin = {
			id: "plugin-b",
			register(registry) {
				registry.addContextContributor(makeContextContributor("b:ctx"))
				registry.addToolProvider(makeToolProvider("b:tools", "integration"))
				registry.addPlannerHintProvider(makePlannerHintProvider("b:hints"))
			},
		}

		const registry = createPluginRegistry()
		registerPlugins(registry, [pluginA, pluginB])

		expect(registry.contextContributors).toHaveLength(2)
		expect(registry.toolProviders).toHaveLength(2)
		expect(registry.plannerHintProviders).toHaveLength(1)
		expect(registry.taskRunners).toHaveLength(0)
		expect(registry.eventHandlers).toHaveLength(0)
	})

	it("handles empty plugin list", () => {
		const registry = createPluginRegistry()
		registerPlugins(registry, [])
		expect(registry.contextContributors).toHaveLength(0)
	})

	it("preserves insertion order", () => {
		const registry = createPluginRegistry()
		registerPlugins(registry, [
			{
				id: "first",
				register(r) {
					r.addContextContributor(makeContextContributor("first:ctx"))
				},
			},
			{
				id: "second",
				register(r) {
					r.addContextContributor(makeContextContributor("second:ctx"))
				},
			},
			{
				id: "third",
				register(r) {
					r.addContextContributor(makeContextContributor("third:ctx"))
				},
			},
		])

		const ids = registry.contextContributors.map((c) => c.id)
		expect(ids).toEqual(["first:ctx", "second:ctx", "third:ctx"])
	})
})
