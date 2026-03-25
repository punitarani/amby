export type VolumeStatus = "creating" | "ready" | "error" | "deleted"

export type ComputeInstanceStatus =
	| "volume_creating"
	| "creating"
	| "running"
	| "stopped"
	| "archived"
	| "error"
	| "deleted"

export type ComputeInstanceRole = "main" | "secondary"

export interface ComputeVolume {
	readonly id: string
	readonly userId: string
	readonly externalVolumeId: string
	readonly status: VolumeStatus
	readonly authConfig?: Record<string, unknown>
	readonly createdAt: Date
	readonly updatedAt: Date
}

export interface ComputeInstance {
	readonly id: string
	readonly userId: string
	readonly volumeId: string
	readonly externalInstanceId?: string
	readonly role: ComputeInstanceRole
	readonly status: ComputeInstanceStatus
	readonly snapshot?: string
	readonly lastActivityAt: Date
	readonly createdAt: Date
	readonly updatedAt: Date
}
