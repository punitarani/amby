import type { AmbyPlugin, BrowserProvider, PluginRegistry } from "@amby/core"
import { tool } from "ai"
import { Effect } from "effect"
import { z } from "zod"

export interface BrowserToolsPluginConfig {
	readonly browserProvider: BrowserProvider
}

export function createBrowserToolsPlugin(config: BrowserToolsPluginConfig): AmbyPlugin {
	const { browserProvider } = config

	return {
		id: "browser-tools",

		register(registry: PluginRegistry) {
			registry.addToolProvider({
				id: "browser-tools:browse",
				group: "browser",
				getTools: async () => ({
					browse_web: tool({
						description:
							"Browse a web page to extract information, perform actions, or take screenshots. Use for research, data extraction, and web interaction tasks.",
						inputSchema: z.object({
							task: z.string().describe("What to do on the web page"),
							url: z.string().optional().describe("Starting URL to navigate to"),
						}),
						execute: async ({ task, url }) => {
							const result = await Effect.runPromise(browserProvider.execute({ task, url }))
							return {
								status: result.status,
								output: result.output,
								screenshot: result.screenshot,
								error: result.error,
							}
						},
					}),
				}),
			})

			registry.addPlannerHintProvider({
				id: "browser-tools:hints",
				getHints: async () => {
					const available = await Effect.runPromise(browserProvider.isAvailable())
					return available
						? "Browser capability is available for web browsing, extraction, and page actions."
						: undefined
				},
			})
		},
	}
}
