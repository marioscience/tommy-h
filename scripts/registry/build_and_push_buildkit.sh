#!/bin/sh
set -eu

: "${REGISTRY_IMAGE_ROOT:?Set REGISTRY_IMAGE_ROOT to the GitLab registry project path}"
: "${RELEASE_TAG:?Set RELEASE_TAG to an immutable release tag, normally the commit SHA}"
: "${CI_REGISTRY:?Set CI_REGISTRY}"
: "${CI_REGISTRY_USER:?Set CI_REGISTRY_USER}"
: "${CI_REGISTRY_PASSWORD:?Set CI_REGISTRY_PASSWORD}"

case "$RELEASE_TAG" in
  latest|dev|staging|main|niko-local|"")
    echo "RELEASE_TAG must be immutable; use a commit SHA or signed release tag." >&2
    exit 2
    ;;
esac

PROJECT_ROOT="${PROJECT_ROOT:-${CI_PROJECT_DIR:-$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)}}"
OUTPUT_FILE="${REGISTRY_RELEASE_FILE:-$PROJECT_ROOT/registry-release.env}"
METADATA_DIR="${TMPDIR:-/tmp}/ragenodes-buildkit-metadata"
DOCKER_CONFIG_DIR="${DOCKER_CONFIG:-$HOME/.docker}"

mkdir -p "$METADATA_DIR" "$DOCKER_CONFIG_DIR"
registry_auth="$(printf '%s:%s' "$CI_REGISTRY_USER" "$CI_REGISTRY_PASSWORD" | base64 | tr -d '\n')"
printf '{"auths":{"%s":{"auth":"%s"}}}\n' "$CI_REGISTRY" "$registry_auth" > "$DOCKER_CONFIG_DIR/config.json"
chmod 600 "$DOCKER_CONFIG_DIR/config.json"

build_image() {
  component="$1"
  context="$2"
  image_ref="${REGISTRY_IMAGE_ROOT}/${component}:${RELEASE_TAG}"
  cache_ref="${REGISTRY_IMAGE_ROOT}/${component}:buildcache"
  metadata_file="$METADATA_DIR/${component}.json"

  buildctl-daemonless.sh build \
    --frontend dockerfile.v0 \
    --local "context=$PROJECT_ROOT/$context" \
    --local "dockerfile=$PROJECT_ROOT/$context" \
    --opt "label:org.opencontainers.image.revision=$RELEASE_TAG" \
    --opt "label:org.opencontainers.image.source=${CI_PROJECT_URL:-local}" \
    --import-cache "type=registry,ref=$cache_ref" \
    --export-cache "type=registry,ref=$cache_ref,mode=max" \
    --output "type=image,name=$image_ref,push=true" \
    --metadata-file "$metadata_file"
}

image_digest() {
  component="$1"
  sed -n 's/.*"containerimage.digest":"\([^"]*\)".*/\1/p' "$METADATA_DIR/${component}.json" | head -n 1
}

cd "$PROJECT_ROOT"
build_image backend backend
build_image bot bot
build_image oxideproxy oxideproxy
build_image oxide-control-panel oxideproxy/node_panel

backend_digest="$(image_digest backend)"
bot_digest="$(image_digest bot)"
oxide_digest="$(image_digest oxideproxy)"
panel_digest="$(image_digest oxide-control-panel)"

for value in "$backend_digest" "$bot_digest" "$oxide_digest" "$panel_digest"; do
  case "$value" in
    sha256:*) ;;
    *) echo "Unable to resolve an immutable BuildKit digest." >&2; exit 3 ;;
  esac
done

{
  printf 'RAGENODES_BACKEND_IMAGE=%s/backend@%s\n' "$REGISTRY_IMAGE_ROOT" "$backend_digest"
  printf 'RAGENODES_BOT_IMAGE=%s/bot@%s\n' "$REGISTRY_IMAGE_ROOT" "$bot_digest"
  printf 'RAGENODES_OXIDEPROXY_IMAGE=%s/oxideproxy@%s\n' "$REGISTRY_IMAGE_ROOT" "$oxide_digest"
  printf 'RAGENODES_OXIDE_CONTROL_PANEL_IMAGE=%s/oxide-control-panel@%s\n' "$REGISTRY_IMAGE_ROOT" "$panel_digest"
  printf 'RAGENODES_RELEASE_REVISION=%s\n' "$RELEASE_TAG"
} > "$OUTPUT_FILE"

echo "Immutable release manifest written to $OUTPUT_FILE"
