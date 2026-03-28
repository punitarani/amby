import { z } from "zod"

export const telegramWidgetAuthDataSchema = z.object({
	id: z.coerce.string().min(1),
	first_name: z.string().min(1),
	last_name: z.string().optional(),
	username: z.string().optional(),
	photo_url: z.string().url().optional(),
	auth_date: z.coerce.string().min(1),
	hash: z.string().min(1),
})

export const telegramMiniAppSignInSchema = z.object({
	initData: z.string().min(1),
})

export const telegramWidgetEndpointBodySchema = telegramWidgetAuthDataSchema.extend({
	rememberMe: z.boolean().optional(),
})
