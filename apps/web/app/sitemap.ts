import type { MetadataRoute } from "next"

import { APP_URL } from "@/lib/app-url"

export default function sitemap(): MetadataRoute.Sitemap {
	return [
		{
			url: `${APP_URL}/`,
			lastModified: new Date(),
			changeFrequency: "weekly",
			priority: 1,
		},
		{
			url: `${APP_URL}/vision`,
			lastModified: new Date(),
			changeFrequency: "weekly",
			priority: 0.9,
		},
		{
			url: `${APP_URL}/github`,
			lastModified: new Date(),
			changeFrequency: "monthly",
			priority: 0.7,
		},
		{
			url: `${APP_URL}/telegram-access`,
			lastModified: new Date(),
			changeFrequency: "monthly",
			priority: 0.7,
		},
	]
}
