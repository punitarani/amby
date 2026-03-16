#!/usr/bin/env bash
set -euo pipefail

IMAGE_NAME="amby-computer"
VERSION="${1:-0.1.0}"
TAG="${IMAGE_NAME}:${VERSION}"

# Verify image exists locally
if ! docker image inspect "${TAG}" >/dev/null 2>&1; then
	echo "Error: Image ${TAG} not found locally."
	echo "Run ./docker/computer/build.sh ${VERSION} first."
	exit 1
fi

# Verify daytona CLI is available and logged in
if ! command -v daytona >/dev/null 2>&1; then
	echo "Error: daytona CLI not found. Install it from https://app.daytona.io"
	exit 1
fi

echo "Pushing ${TAG} to Daytona..."
daytona snapshot push "${TAG}" \
	--name "${TAG}" \
	--cpu 2 \
	--memory 4 \
	--disk 5 \
	--entrypoint "sleep infinity"

echo ""
echo "Snapshot pushed: ${TAG}"
echo "Use snapshot: '${TAG}' in sandbox creation."
