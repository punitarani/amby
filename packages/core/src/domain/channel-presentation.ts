import type { Platform } from "./platform"

export type ChannelModelOutputFormat = "markdown"

export type ChannelTransportFormat = "plain-text" | "telegram-html"

export interface ChannelPresentation {
	readonly platform: Platform
	readonly modelOutputFormat: ChannelModelOutputFormat
	readonly transportFormat: ChannelTransportFormat
	readonly supportsStreaming: boolean
}

export function getChannelPresentation(platform: Platform): ChannelPresentation {
	switch (platform) {
		case "telegram":
			return {
				platform,
				modelOutputFormat: "markdown",
				transportFormat: "telegram-html",
				supportsStreaming: false,
			}
		case "cli":
		case "slack":
		case "discord":
			return {
				platform,
				modelOutputFormat: "markdown",
				transportFormat: "plain-text",
				supportsStreaming: true,
			}
	}
}
