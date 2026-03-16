import { EnvService } from "@amby/env"
import { createOpenRouter } from "@openrouter/ai-sdk-provider"
import type { LanguageModel } from "ai"
import { Context, Effect, Layer } from "effect"

export const DEFAULT_MODEL_ID = "google/gemini-3.1-flash-lite-preview" as const

export class ModelService extends Context.Tag("ModelService")<
	ModelService,
	{
		readonly getModel: (id?: string) => LanguageModel
		readonly defaultModelId: string
	}
>() {}

export const ModelServiceLive = Layer.effect(
	ModelService,
	Effect.gen(function* () {
		const env = yield* EnvService
		const openrouter = createOpenRouter({ apiKey: env.OPENROUTER_API_KEY })

		return {
			getModel: (id = DEFAULT_MODEL_ID) => openrouter.languageModel(id),
			defaultModelId: DEFAULT_MODEL_ID,
		}
	}),
)
