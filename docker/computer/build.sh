#!/usr/bin/env bash
set -euo pipefail

IMAGE_NAME="amby-computer"
VERSION="${1:-0.1.0}"
TAG="${IMAGE_NAME}:${VERSION}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Building ${TAG}..."
docker build --platform linux/amd64 -t "${TAG}" -t "${IMAGE_NAME}:latest" "${SCRIPT_DIR}"

echo ""
echo "Built: ${TAG}"
echo "Built: ${IMAGE_NAME}:latest"
echo ""
echo "To push to Daytona:"
echo "  daytona snapshot push ${TAG} --name ${TAG} --cpu 2 --memory 4 --disk 5"
