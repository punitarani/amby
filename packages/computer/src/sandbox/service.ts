import { DbService } from "@amby/db"
import { EnvService } from "@amby/env"
import type { Sandbox } from "@daytonaio/sdk"
import { Daytona } from "@daytonaio/sdk"
import { Context, Effect, Layer } from "effect"
import { AGENT_WORKDIR, COMMAND_EXEC_TIMEOUT } from "../config"
import { SandboxError } from "../errors"
import { ensureMainSandbox, kickOffSandboxProvisionIfNeeded } from "./resolve-volume"

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
		const kickOffSandboxProvision = (userId: string) =>
			Effect.tryPromise({
				try: async () => {
					if (!env.SANDBOX_WORKFLOW) return
					await kickOffSandboxProvisionIfNeeded(db, userId, () =>
						env.SANDBOX_WORKFLOW!.create({ params: { userId } }),
					)
				},
				catch: (cause) =>
					new SandboxError({
						message: `Failed to start sandbox provisioning workflow: ${cause instanceof Error ? cause.message : String(cause)}`,
						cause,
					}),
			}).pipe(
				Effect.catchAll((error) =>
					Effect.sync(() => {
						console.error("[sandbox] Failed to start provisioning workflow:", error.message)
					}),
				),
			)

		return {
			enabled: true,

			ensure: (userId) =>
				ensureMainSandbox({ daytona, db, userId, isDev, cache }).pipe(
					Effect.tapError((error) =>
						error.transient ? kickOffSandboxProvision(userId) : Effect.void,
					),
				),

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
