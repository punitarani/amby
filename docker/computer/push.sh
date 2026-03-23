#!/usr/bin/env bash
set -euo pipefail

DOCKER_REPO="punitarani/amby"
IMAGE_TAG="computer"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VERSION_FILE="${SCRIPT_DIR}/version.json"
VERSION="${1:-$(python3 -c 'import json, sys; print(json.load(open(sys.argv[1], encoding="utf-8"))["version"])' "${VERSION_FILE}")}"
REGISTRY_TOKEN=""
MANIFEST_ACCEPT_HEADER="application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json"

if [[ -z "${VERSION}" ]]; then
	echo "Error: failed to read computer image version from ${VERSION_FILE}" >&2
	exit 1
fi

if ! [[ "${VERSION}" =~ ^[0-9]+\.[0-9]+$ ]]; then
	echo "Error: version must be x.y (e.g. 0.2)" >&2
	exit 1
fi

TAGS=("${DOCKER_REPO}:${IMAGE_TAG}" "${DOCKER_REPO}:${IMAGE_TAG}-${VERSION}")

get_registry_token() {
	if [[ -n "${REGISTRY_TOKEN}" ]]; then
		echo "${REGISTRY_TOKEN}"
		return 0
	fi

	REGISTRY_TOKEN="$(
		curl -fsSL "https://auth.docker.io/token?service=registry.docker.io&scope=repository:${DOCKER_REPO}:pull" |
			python3 -c 'import json, sys; print(json.load(sys.stdin)["token"])'
	)"

	if [[ -z "${REGISTRY_TOKEN}" ]]; then
		echo "Error: failed to fetch Docker Hub registry token." >&2
		exit 1
	fi

	echo "${REGISTRY_TOKEN}"
}

dockerhub_tag_exists() {
	local image_ref="$1"
	local tag_name="${image_ref#${DOCKER_REPO}:}"
	local token
	local status

	token="$(get_registry_token)"
	status="$(
		curl -sS -o /dev/null -w "%{http_code}" \
			-H "Authorization: Bearer ${token}" \
			-H "Accept: ${MANIFEST_ACCEPT_HEADER}" \
			"https://registry-1.docker.io/v2/${DOCKER_REPO}/manifests/${tag_name}"
	)"

	case "${status}" in
	200)
		return 0
		;;
	404)
		return 1
		;;
	*)
		echo "Error: Docker Hub manifest check for ${image_ref} returned HTTP ${status}." >&2
		exit 1
		;;
	esac
}

MISSING_TAGS=()
for tag in "${TAGS[@]}"; do
	if dockerhub_tag_exists "${tag}"; then
		echo "Image ${tag} already exists on Docker Hub — skipping."
		continue
	fi
	MISSING_TAGS+=("${tag}")
done

if [[ "${#MISSING_TAGS[@]}" -eq 0 ]]; then
	echo "All target image tags already exist on Docker Hub — skipping push."
	exit 0
fi

# Verify only the tags that still need publishing exist locally
for tag in "${MISSING_TAGS[@]}"; do
	if ! docker image inspect "${tag}" >/dev/null 2>&1; then
		echo "Error: Image ${tag} not found locally." >&2
		echo "Run 'bun run computer:docker:build' first." >&2
		exit 1
	fi
done

echo "Pushing to Docker Hub..."
for tag in "${MISSING_TAGS[@]}"; do
	echo "  Pushing ${tag}..."
	docker push "${tag}"
done

echo ""
echo "Pushed: ${MISSING_TAGS[*]}"
