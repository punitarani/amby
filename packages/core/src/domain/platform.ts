/**
 * Platform represents the external messaging surface.
 * Telegram is the only fully implemented remote channel today.
 * The union stays aligned with persisted conversation platform values.
 */
export type Platform = "cli" | "telegram" | "slack" | "discord"

/**
 * Channel type for transport layer routing.
 */
export type ChannelType = "telegram" | "slack" | "discord"
