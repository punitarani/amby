import { makeAgentServiceLive } from "@amby/agent"
import { AuthServiceLive } from "@amby/auth"
import { SandboxServiceLive, TaskSupervisorLive } from "@amby/computer"
import { DbServiceLive } from "@amby/db"
import { EnvServiceLive } from "@amby/env/local"
import { MemoryServiceLive } from "@amby/memory"
import { ModelServiceLive } from "@amby/models"
import { Layer, ManagedRuntime } from "effect"

const VoiceBaseLive = Layer.mergeAll(
	MemoryServiceLive,
	TaskSupervisorLive,
	ModelServiceLive,
	AuthServiceLive,
).pipe(
	Layer.provideMerge(SandboxServiceLive),
	Layer.provideMerge(DbServiceLive),
	Layer.provideMerge(EnvServiceLive),
)

export const makeVoiceBaseRuntime = () => ManagedRuntime.make(VoiceBaseLive)

export const makeVoiceAgentRuntime = (userId: string) =>
	ManagedRuntime.make(makeAgentServiceLive(userId).pipe(Layer.provideMerge(VoiceBaseLive)))
