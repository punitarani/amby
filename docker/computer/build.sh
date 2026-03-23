#!/usr/bin/env bash
set -euo pipefail

DOCKER_REPO="punitarani/amby"
IMAGE_TAG="computer"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VERSION_FILE="${SCRIPT_DIR}/version.json"
VERSION="${1:-$(jq -r .version "${VERSION_FILE}")}"

if [[ -z "${VERSION}" ]]; then
	echo "Error: failed to read computer image version from ${VERSION_FILE}" >&2
	exit 1
fi

if ! [[ "${VERSION}" =~ ^[0-9]+\.[0-9]+$ ]]; then
	echo "Error: version must be x.y (e.g. 0.2)" >&2
	exit 1
fi

echo "Building ${DOCKER_REPO}:${IMAGE_TAG} (linux/amd64)..."
docker buildx build \
	--platform linux/amd64 \
	-t "${DOCKER_REPO}:${IMAGE_TAG}" \
	-t "${DOCKER_REPO}:${IMAGE_TAG}-${VERSION}" \
	--load \
	"${SCRIPT_DIR}"

echo ""
echo "Built: ${DOCKER_REPO}:${IMAGE_TAG}"
echo "Built: ${DOCKER_REPO}:${IMAGE_TAG}-${VERSION}"
