import { describe, expect, it } from "bun:test"
import {
	buildIntegrationStartPayload,
	parseIntegrationStartPayload,
	SUPPORTED_INTEGRATION_TOOLKITS,
} from "./constants"
import { buildComposioCallbackUrl, buildComposioSessionConfig } from "./service"

describe("connectors helpers", () => {
	it("builds the scoped session config with safety filters and overrides", () => {
		const config = buildComposioSessionConfig({
			authConfigs: {
				gmail: "ac_gmail",
			},
			connectedAccounts: {
				slack: "ca_slack",
			},
		})

		expect(config.manageConnections).toBe(false)
		expect(config.toolkits.enable).toEqual([...SUPPORTED_INTEGRATION_TOOLKITS])
		expect(config.tags.disable).toEqual(["destructiveHint"])
		expect(config.workbench.enableProxyExecution).toBe(false)
		expect(config.authConfigs).toEqual({ gmail: "ac_gmail" })
		expect(config.connectedAccounts).toEqual({ slack: "ca_slack" })
		expect(config.tools.gmail).toBeDefined()
		expect(config.tools.slack).toBeDefined()
	})

	it("builds callback urls without duplicate slashes", () => {
		expect(buildComposioCallbackUrl("https://hiamby.com/", "gmail")).toBe(
			"https://hiamby.com/integrations/callback?toolkit=gmail",
		)
	})

	it("round-trips telegram start payloads", () => {
		for (const toolkit of SUPPORTED_INTEGRATION_TOOLKITS) {
			const payload = buildIntegrationStartPayload(toolkit)
			expect(parseIntegrationStartPayload(payload)).toBe(toolkit)
		}

		expect(parseIntegrationStartPayload("connect-unknown")).toBeUndefined()
		expect(parseIntegrationStartPayload(undefined)).toBeUndefined()
	})
})
