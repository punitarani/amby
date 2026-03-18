import type { Database } from "@amby/db"
import { DbService, eq, schema } from "@amby/db"
import { EnvService } from "@amby/env"
import type { Sandbox } from "@daytonaio/sdk"
import { Daytona, Image } from "@daytonaio/sdk"
import { Context, Effect, Layer } from "effect"
import {
	AGENT_USER,
	AGENT_WORKDIR,
	AUTO_ARCHIVE_MINUTES,
	AUTO_STOP_MINUTES,
	COMMAND_EXEC_TIMEOUT,
	SANDBOX_CREATE_TIMEOUT,
	SANDBOX_RESOURCES,
	SANDBOX_START_TIMEOUT,
	sandboxLabels,
	sandboxName,
} from "../config"
import { SandboxError } from "../errors"

type SandboxStatus = "creating" | "running" | "stopped" | "archived" | "error"

// TODO: Once Daytona plan supports snapshot push, switch to:
//   snapshot: "amby-computer:0.1.0"
// The Dockerfile at docker/computer/Dockerfile is the source of truth.
// Build & push with: bun run computer:build && bun run computer:push
export const sandboxImage = Image.base("ubuntu:24.04")
	.runCommands(
		"apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends " +
			"curl wget git ca-certificates gnupg sudo " +
			"build-essential pkg-config " +
			"python3 python3-pip python3-venv " +
			"openssh-client jq unzip zip htop less nano ripgrep " +
			"iputils-ping bind9-dnsutils " +
			"libx11-6 libxrandr2 libxext6 libxrender1 libxfixes3 " +
			"libxss1 libxtst6 libxi6 " +
			"libxcb1 libxcb-shm0 libxcb-shape0 libxcb-xfixes0 " +
			"ffmpeg xvfb x11vnc novnc " +
			"xfce4 xfce4-terminal dbus-x11 " +
			"locales " +
			"&& locale-gen en_US.UTF-8 " +
			"&& rm -rf /var/lib/apt/lists/*",
	)
	.runCommands(
		"curl -fsSL https://deb.nodesource.com/setup_22.x | bash - " +
			"&& apt-get install -y --no-install-recommends nodejs " +
			"&& rm -rf /var/lib/apt/lists/*",
	)
	.runCommands("npm install -g typescript@5 ts-node bun@1.3")
	.runCommands("python3 -m pip install --no-cache-dir --break-system-packages pipx uv")
	// user — default human user (VNC sessions, browser, limited access)
	.runCommands(
		"useradd -m -s /bin/bash -d /home/user user " +
			"&& mkdir -p /home/user/Downloads /home/user/Documents /home/user/Desktop " +
			"&& chown -R user:user /home/user",
	)
	// agent — tool-calling user for the AI agent
	.runCommands(
		"useradd -m -s /bin/bash -d /home/agent agent " +
			"&& mkdir -p /home/agent/workspace /home/agent/data /home/agent/.local/bin " +
			"&& chown -R agent:agent /home/agent",
	)
	// agent can read user's home (not write)
	.runCommands("chmod 755 /home/user")
	// agent sudo: can act as user, and install packages as root
	.runCommands(
		'echo "agent ALL=(user) NOPASSWD: ALL" >> /etc/sudoers.d/agent ' +
			'&& echo "agent ALL=(root) NOPASSWD: /usr/bin/apt-get, /usr/bin/apt, /usr/bin/dpkg, /usr/bin/npm, /usr/local/bin/npm" >> /etc/sudoers.d/agent ' +
			"&& chmod 0440 /etc/sudoers.d/agent",
	)
	.runCommands("chmod 1777 /tmp " + "&& mkdir -p /opt/amby && chown agent:agent /opt/amby")
	.env({
		LANG: "en_US.UTF-8",
		LC_ALL: "en_US.UTF-8",
		DISPLAY: ":1",
		HOME: "/home/agent",
		PATH: "/home/agent/.local/bin:/usr/local/bin:/usr/bin:/bin",
	})
	.workdir(AGENT_WORKDIR)

export const createDaytonaClient = (opts: { apiKey: string; apiUrl?: string; target?: string }) =>
	new Daytona(opts)

export class SandboxService extends Context.Tag("SandboxService")<
	SandboxService,
	{
		readonly enabled: boolean
		readonly ensure: (userId: string) => Effect.Effect<Sandbox, SandboxError>
		readonly exec: (
			sandbox: Sandbox,
			command: string,
			cwd?: string,
		) => Effect.Effect<{ stdout: string; exitCode: number }, SandboxError>
		readonly readFile: (sandbox: Sandbox, path: string) => Effect.Effect<string, SandboxError>
		readonly writeFile: (
			sandbox: Sandbox,
			path: string,
			content: string,
		) => Effect.Effect<void, SandboxError>
		readonly stop: (sandbox: Sandbox) => Effect.Effect<void, SandboxError>
	}
>() {}

const notConfigured = Effect.fail(
	new SandboxError({
		message:
			"Sandbox not configured. Set DAYTONA_API_KEY in .env to enable computer access. Sign up at https://app.daytona.io to get an API key.",
	}),
)

/** Upsert a sandbox record in the DB */
const upsertSandbox = (
	db: Database,
	userId: string,
	daytonaSandboxId: string,
	status: SandboxStatus,
) =>
	db
		.insert(schema.sandboxes)
		.values({ userId, daytonaSandboxId, status })
		.onConflictDoUpdate({
			target: schema.sandboxes.userId,
			set: { daytonaSandboxId, status, lastActivityAt: new Date() },
		})

export const SandboxServiceLive = Layer.effect(
	SandboxService,
	Effect.gen(function* () {
		const env = yield* EnvService
		const { db } = yield* DbService

		if (!env.DAYTONA_API_KEY) {
			return {
				enabled: false,
				ensure: () => notConfigured,
				exec: () => notConfigured,
				readFile: () => notConfigured,
				writeFile: () => notConfigured,
				stop: () => Effect.void,
			}
		}

		const daytona = new Daytona({
			apiKey: env.DAYTONA_API_KEY,
			apiUrl: env.DAYTONA_API_URL,
			target: env.DAYTONA_TARGET,
		})
		const cache = new Map<string, Sandbox>()
		const isDev = env.NODE_ENV !== "production"

		/** Get a Daytona sandbox by name, start if needed, cache it */
		const getAndStart = async (name: string, userId: string): Promise<Sandbox> => {
			const existing = await daytona.get(name)
			await existing.refreshData()
			if (existing.state !== "started") {
				await existing.start(SANDBOX_START_TIMEOUT)
			}
			cache.set(userId, existing)
			return existing
		}

		return {
			enabled: true,

			ensure: (userId) =>
				Effect.tryPromise({
					try: async () => {
						const name = sandboxName(userId, isDev)

						// Fast path: return cached instance if still running
						const cached = cache.get(userId)
						if (cached) {
							try {
								await cached.refreshData()
								if (cached.state === "started") return cached
								if (cached.state === "stopped" || cached.state === "error") {
									await cached.start(SANDBOX_START_TIMEOUT)
									await upsertSandbox(db, userId, cached.id, "running")
									return cached
								}
							} catch {
								cache.delete(userId)
							}
						}

						// Check DB for an existing sandbox record
						const [record] = await db
							.select()
							.from(schema.sandboxes)
							.where(eq(schema.sandboxes.userId, userId))
							.limit(1)

						if (record) {
							try {
								const sandbox = await getAndStart(name, userId)
								await upsertSandbox(db, userId, sandbox.id, "running")
								return sandbox
							} catch {
								if (record.status === "creating") {
									throw new SandboxError({
										message:
											"Your sandbox is being set up — this usually takes a few minutes. Please try again shortly.",
									})
								}
								// Stale record (sandbox deleted externally) — clear and recreate
								await db.delete(schema.sandboxes).where(eq(schema.sandboxes.userId, userId))
							}
						}

						// No sandbox exists — create one
						await upsertSandbox(db, userId, "pending", "creating")
						try {
							const sandbox = await daytona.create(
								{
									name,
									image: sandboxImage,
									resources: SANDBOX_RESOURCES,
									autoStopInterval: AUTO_STOP_MINUTES,
									autoArchiveInterval: AUTO_ARCHIVE_MINUTES,
									labels: sandboxLabels(userId, isDev),
									user: AGENT_USER,
								},
								{ timeout: SANDBOX_CREATE_TIMEOUT },
							)
							cache.set(userId, sandbox)
							await upsertSandbox(db, userId, sandbox.id, "running")
							return sandbox
						} catch (cause) {
							await upsertSandbox(db, userId, "pending", "error")
							throw cause
						}
					},
					catch: (cause) =>
						cause instanceof SandboxError
							? cause
							: new SandboxError({
									message: `Failed to ensure sandbox: ${cause instanceof Error ? cause.message : String(cause)}`,
									cause,
								}),
				}),

			exec: (sandbox, command, cwd?) =>
				Effect.tryPromise({
					try: async () => {
						await sandbox.refreshActivity()
						const result = await sandbox.process.executeCommand(
							command,
							cwd ?? AGENT_WORKDIR,
							undefined,
							COMMAND_EXEC_TIMEOUT,
						)
						return { stdout: result.result, exitCode: result.exitCode }
					},
					catch: (cause) => new SandboxError({ message: `Exec failed: ${command}`, cause }),
				}),

			readFile: (sandbox, path) =>
				Effect.tryPromise({
					try: async () => {
						const buf = await sandbox.fs.downloadFile(path)
						return buf.toString("utf-8")
					},
					catch: (cause) => new SandboxError({ message: `Failed to read file: ${path}`, cause }),
				}),

			writeFile: (sandbox, path, content) =>
				Effect.tryPromise({
					try: () => sandbox.fs.uploadFile(Buffer.from(content), path),
					catch: (cause) => new SandboxError({ message: `Failed to write file: ${path}`, cause }),
				}),

			stop: (sandbox) =>
				Effect.tryPromise({
					try: async () => {
						await sandbox.stop()
						for (const [key, val] of cache) {
							if (val.id === sandbox.id) cache.delete(key)
						}
					},
					catch: (cause) => new SandboxError({ message: "Failed to stop sandbox", cause }),
				}),
		}
	}),
)
