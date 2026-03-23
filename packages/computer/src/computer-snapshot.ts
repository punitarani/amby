import computerVersion from "../../../docker/computer/version.json"

/** Runtime snapshot metadata derived from docker/computer/version.json. */
export const COMPUTER_IMAGE_VERSION = computerVersion.version

if (!/^\d+\.\d+$/.test(COMPUTER_IMAGE_VERSION)) {
	throw new Error(
		`Invalid computer image version '${COMPUTER_IMAGE_VERSION}'. Expected x.y in docker/computer/version.json.`,
	)
}

export const COMPUTER_SNAPSHOT = `amby/computer:${COMPUTER_IMAGE_VERSION}`
export const COMPUTER_DOCKER_IMAGE = `docker.io/punitarani/amby:computer-${COMPUTER_IMAGE_VERSION}`
