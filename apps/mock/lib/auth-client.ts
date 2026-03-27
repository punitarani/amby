"use client"

import { createAmbyAuthClient } from "@amby/auth"

export const createMockAuthClient = (backendUrl: string) =>
	createAmbyAuthClient({
		baseURL: backendUrl,
		fetchOptions: {
			credentials: "include",
		},
	})
