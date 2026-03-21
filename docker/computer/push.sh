#!/usr/bin/env bash
set -euo pipefail

DOCKER_REPO="punitarani/amby"
IMAGE_TAG="computer"
VERSION="${1:?Usage: $0 <version> (e.g. 0.1.0)}"

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
