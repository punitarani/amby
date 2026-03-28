import { defineConfig } from "drizzle-kit"

const url = process.env.DATABASE_URL

const isLocalDatabaseUrl = (databaseUrl: string | undefined) => {
	if (!databaseUrl) {
		return false
	}

	try {
		const hostname = new URL(databaseUrl).hostname
		return hostname === "localhost" || hostname === "127.0.0.1"
	} catch {
		return false
	}
}

export default defineConfig({
	dialect: "postgresql",
	schema: "./src/schema/index.ts",
	out: "./drizzle",
	dbCredentials: {
		...(url ? { url } : {}),
		ssl: isLocalDatabaseUrl(url) ? false : { rejectUnauthorized: true },
	},
})
