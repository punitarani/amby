import type { Sandbox } from "@daytonaio/sdk"
import { MANIFEST_PATH, NPM_INSTALL_TIMEOUT } from "../config"
import type { HarnessInstaller, InstallResult } from "./installer"

interface HarnessManifest {
	codex?: { version: string; installedAt: string }
}

export class CodexInstaller implements HarnessInstaller {
	readonly name = "codex"

	async ensureInstalled(sandbox: Sandbox): Promise<InstallResult> {
		// Check cached manifest first
		try {
			const buf = await sandbox.fs.downloadFile(MANIFEST_PATH)
			const manifest: HarnessManifest = JSON.parse(buf.toString("utf-8"))
			if (manifest.codex?.version) {
				return { installed: true, version: manifest.codex.version }
			}
		} catch {
			// Manifest doesn't exist or is invalid — continue
		}

		// Check if already installed at runtime
		const check = await sandbox.process.executeCommand("codex --version 2>/dev/null || true")
		let version = check.result.trim()

		if (!version) {
			// Install codex — sandbox runs as non-root agent user, so sudo is required for global installs
			const install = await sandbox.process.executeCommand(
				"sudo npm install -g @openai/codex",
				undefined,
				undefined,
				NPM_INSTALL_TIMEOUT,
			)
			if (install.exitCode !== 0) {
				return { installed: false }
			}
			const versionCheck = await sandbox.process.executeCommand("codex --version")
			version = versionCheck.result.trim()
		}

		// Write manifest
		const manifest: HarnessManifest = {
			codex: { version, installedAt: new Date().toISOString() },
		}
		await sandbox.process.executeCommand("mkdir -p /.amby")
		await sandbox.fs.uploadFile(Buffer.from(JSON.stringify(manifest, null, 2)), MANIFEST_PATH)

		return { installed: true, version }
	}
}
