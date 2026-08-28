#!/bin/sh
set -eu

: "${REGISTRY_IMAGE_ROOT:?Set REGISTRY_IMAGE_ROOT to the GitLab registry project path}"
: "${RELEASE_TAG:?Set RELEASE_TAG to an immutable release tag, normally the commit SHA}"

PROJECT_ROOT="${PROJECT_ROOT:-$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)}"
OUTPUT_FILE="${REGISTRY_RELEASE_FILE:-$PROJECT_ROOT/registry-release.env}"
PUSH_IMAGES="${PUSH_IMAGES:-true}"

case "$RELEASE_TAG" in
  latest|dev|staging|main|niko-local|"")
    echo "RELEASE_TAG must be immutable; use a commit SHA or signed release tag." >&2
    exit 2
    ;;
esac

if [ -n "${REGISTRY_PASSWORD:-}" ] && [ -n "${REGISTRY_USER:-}" ]; then
  printf '%s' "$REGISTRY_PASSWORD" | docker login "${CI_REGISTRY:-registry.gitlab.com}" \
    --username "$REGISTRY_USER" --password-stdin
fi

build_image() {
  component="$1"
  context="$2"
  dockerfile="$3"
  image_ref="${REGISTRY_IMAGE_ROOT}/${component}:${RELEASE_TAG}"

  docker build \
    --label "org.opencontainers.image.revision=${RELEASE_TAG}" \
    --label "org.opencontainers.image.source=${CI_PROJECT_URL:-local}" \
    --file "$PROJECT_ROOT/$dockerfile" \
    --tag "$image_ref" \
    "$PROJECT_ROOT/$context"

  if [ "$PUSH_IMAGES" = "true" ]; then
    docker push "$image_ref"
  fi
}

resolve_digest() {
  component="$1"
  image_ref="${REGISTRY_IMAGE_ROOT}/${component}:${RELEASE_TAG}"
  docker image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "$image_ref" \
    | awk -v prefix="${REGISTRY_IMAGE_ROOT}/${component}@" 'index($0, prefix) == 1 { print; exit }'
}

cd "$PROJECT_ROOT"
build_image backend backend backend/Dockerfile
build_image bot bot bot/Dockerfile
build_image oxideproxy oxideproxy oxideproxy/Dockerfile
build_image oxide-control-panel oxideproxy/node_panel oxideproxy/node_panel/Dockerfile

if [ "$PUSH_IMAGES" = "true" ]; then
  backend_digest="$(resolve_digest backend)"
  bot_digest="$(resolve_digest bot)"
  oxide_digest="$(resolve_digest oxideproxy)"
  panel_digest="$(resolve_digest oxide-control-panel)"

  for value in "$backend_digest" "$bot_digest" "$oxide_digest" "$panel_digest"; do
    if [ -z "$value" ]; then
      echo "Unable to resolve an immutable registry digest after push." >&2
      exit 3
    fi
  done

  {
    printf 'RAGENODES_BACKEND_IMAGE=%s\n' "$backend_digest"
    printf 'RAGENODES_BOT_IMAGE=%s\n' "$bot_digest"
    printf 'RAGENODES_OXIDEPROXY_IMAGE=%s\n' "$oxide_digest"
    printf 'RAGENODES_OXIDE_CONTROL_PANEL_IMAGE=%s\n' "$panel_digest"
    printf 'RAGENODES_RELEASE_REVISION=%s\n' "$RELEASE_TAG"
  } > "$OUTPUT_FILE"

  echo "Immutable release manifest written to $OUTPUT_FILE"
fi
