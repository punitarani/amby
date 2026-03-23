import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
	COMPUTER_DOCKER_IMAGE,
	COMPUTER_IMAGE_VERSION,
	COMPUTER_SNAPSHOT,
} from "./computer-snapshot"

describe("computer snapshot metadata", () => {
	it("derives snapshot and docker image names from docker/computer/VERSION.json", () => {
		const versionFromFile = JSON.parse(
			readFileSync(join(import.meta.dir, "../../../docker/computer/VERSION.json"), "utf-8"),
		).version

		expect(COMPUTER_IMAGE_VERSION).toMatch(/^\d+\.\d+$/)
		expect(versionFromFile).toBe(COMPUTER_IMAGE_VERSION)
		expect(COMPUTER_SNAPSHOT).toBe(`amby/computer:${COMPUTER_IMAGE_VERSION}`)
		expect(COMPUTER_DOCKER_IMAGE).toBe(
			`docker.io/punitarani/amby:computer-${COMPUTER_IMAGE_VERSION}`,
		)
	})
})
