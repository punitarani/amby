#!/usr/bin/env bash
set -euo pipefail

DOCKER_REPO="punitarani/amby"
IMAGE_TAG="computer"
VERSION="${1:?Usage: $0 <version> (e.g. 0.1.0)}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

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
