/**
 * Platform represents the external messaging surface.
 * With CLI removed, Telegram is the only active channel.
 * The union is kept open for future channels.
 */
export type Platform = "telegram"

/**
 * Channel type for transport layer routing.
 */
export type ChannelType = "telegram"
