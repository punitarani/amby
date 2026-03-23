import versionText from "../../../docker/computer/VERSION" with { type: "text" }

/** Runtime snapshot metadata derived from docker/computer/VERSION. */
export const COMPUTER_IMAGE_VERSION = versionText.trim()

if (!/^\d+\.\d+$/.test(COMPUTER_IMAGE_VERSION)) {
	throw new Error(
		`Invalid computer image version '${COMPUTER_IMAGE_VERSION}'. Expected x.y in docker/computer/VERSION.`,
	)
}

export const COMPUTER_SNAPSHOT = `amby/computer:${COMPUTER_IMAGE_VERSION}`
export const COMPUTER_DOCKER_IMAGE = `docker.io/punitarani/amby:computer-${COMPUTER_IMAGE_VERSION}`
