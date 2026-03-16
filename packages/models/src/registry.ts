import { EnvService } from "@amby/env"
import { createOpenRouter } from "@openrouter/ai-sdk-provider"
import { createProviderRegistry, type LanguageModel } from "ai"
import { Context, Effect, Layer } from "effect"

export const DEFAULT_MODEL_ID = "openrouter:anthropic/claude-haiku-4.5" as const

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
		const registry = createProviderRegistry({
			openrouter: openrouter as Parameters<typeof createProviderRegistry>[0][string],
		})

		return {
			getModel: (id = DEFAULT_MODEL_ID) => registry.languageModel(id as `openrouter:${string}`),
			defaultModelId: DEFAULT_MODEL_ID,
		}
	}),
)
