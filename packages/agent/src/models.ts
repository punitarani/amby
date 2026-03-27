import { EnvService } from "@amby/env"
import { createOpenRouter } from "@openrouter/ai-sdk-provider"
import type { LanguageModel } from "ai"
import { Context, Effect, Layer } from "effect"

export const DEFAULT_MODEL_ID = "google/gemini-3.1-flash-lite-preview" as const
export const HIGH_INTELLIGENCE_MODEL_ID = "google/gemini-3-flash-preview" as const
export const ROUTER_MODEL_ID = HIGH_INTELLIGENCE_MODEL_ID

export class ModelService extends Context.Tag("ModelService")<
	ModelService,
	{
		readonly getModel: (id?: string) => LanguageModel
		readonly defaultModelId: string
	}
>() {}

export function makeModelServiceLive(routerModelOverride?: string) {
	return Layer.effect(
		ModelService,
		Effect.gen(function* () {
			const env = yield* EnvService
			const openrouter = createOpenRouter({ apiKey: env.OPENROUTER_API_KEY })

			// Pre-built router model (with optional override for benchmarking)
			const routerId = routerModelOverride ?? ROUTER_MODEL_ID
			const routerModel = openrouter.languageModel(routerId)

			return {
				getModel: (id = DEFAULT_MODEL_ID as string) => {
					if (id === ROUTER_MODEL_ID || id === routerId) return routerModel
					return openrouter.languageModel(id)
				},
				defaultModelId: DEFAULT_MODEL_ID,
			}
		}),
	)
}

export const ModelServiceLive = makeModelServiceLive()
