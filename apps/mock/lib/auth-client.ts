"use client"

import { createAmbyAuthClient } from "@amby/auth/client"

export const createMockAuthClient = (backendUrl: string) =>
	createAmbyAuthClient({
		baseURL: backendUrl,
		fetchOptions: {
			credentials: "include",
		},
	})
