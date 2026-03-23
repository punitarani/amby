#!/usr/bin/env bash
set -euo pipefail

DOCKER_REPO="punitarani/amby"
IMAGE_TAG="computer"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VERSION_FILE="${SCRIPT_DIR}/VERSION"
VERSION="${1:-$(cat "${VERSION_FILE}")}"

if [[ -z "${VERSION}" ]]; then
	echo "Error: failed to read computer image version from ${VERSION_FILE}" >&2
	exit 1
fi

if ! [[ "${VERSION}" =~ ^[0-9]+\.[0-9]+$ ]]; then
	echo "Error: version must be x.y (e.g. 0.2)" >&2
	exit 1
fi

TAGS=("${DOCKER_REPO}:${IMAGE_TAG}" "${DOCKER_REPO}:${IMAGE_TAG}-${VERSION}")

# Verify image exists locally
if ! docker image inspect "${TAGS[0]}" >/dev/null 2>&1; then
	echo "Error: Image ${TAGS[0]} not found locally."
	echo "Run 'bun run computer:docker:build' first."
	exit 1
fi

echo "Pushing to Docker Hub..."
for tag in "${TAGS[@]}"; do
	echo "  Pushing ${tag}..."
	docker push "${tag}"
done

echo ""
echo "Pushed: ${TAGS[*]}"
