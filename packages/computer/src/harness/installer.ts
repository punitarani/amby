import type { Sandbox } from "@daytonaio/sdk"

export interface InstallResult {
	installed: boolean
	version?: string
}

export interface HarnessInstaller {
	readonly name: string
	ensureInstalled(sandbox: Sandbox): Promise<InstallResult>
}
