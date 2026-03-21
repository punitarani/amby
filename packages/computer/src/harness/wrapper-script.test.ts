import { describe, expect, it } from "bun:test"
import vm from "node:vm"
import { buildCallbackJsScript, buildNotifyJsScript, buildRunShScript } from "./wrapper-script"

describe("buildCallbackJsScript", () => {
	it("produces valid JavaScript", () => {
		const code = buildCallbackJsScript()
		expect(() => new vm.Script(code)).not.toThrow()
	})
})

describe("buildNotifyJsScript", () => {
	it("produces valid JavaScript", () => {
		const code = buildNotifyJsScript()
		expect(() => new vm.Script(code)).not.toThrow()
	})
})

describe("buildRunShScript", () => {
	const script = buildRunShScript()

	it("starts with a shebang", () => {
		expect(script.startsWith("#!/bin/sh\n")).toBe(true)
	})

	it("contains write_status function", () => {
		expect(script).toContain("write_status")
	})

	it("contains task lifecycle markers", () => {
		expect(script).toContain("task.started")
		expect(script).toContain("task.completed")
	})

	it("references CODEX_PID", () => {
		expect(script).toContain("CODEX_PID")
	})
})
