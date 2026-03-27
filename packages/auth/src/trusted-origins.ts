import type { Env } from "@amby/env"

const LOCAL_AUTH_ORIGINS = [
	"http://localhost:3000",
	"http://127.0.0.1:3000",
	"http://localhost:3001",
	"http://127.0.0.1:3001",
	"http://localhost:3100",
	"http://127.0.0.1:3100",
]

export const getAuthTrustedOrigins = (
	env: Pick<Env, "APP_URL" | "API_URL" | "BETTER_AUTH_URL" | "NODE_ENV">,
) => {
	const origins = new Set<string>()
	for (const value of [env.APP_URL, env.API_URL, env.BETTER_AUTH_URL]) {
		if (value) {
			origins.add(value.replace(/\/$/, ""))
		}
	}
	if (env.NODE_ENV !== "production") {
		for (const origin of LOCAL_AUTH_ORIGINS) {
			origins.add(origin)
		}
	}
	return [...origins]
}
