#!/usr/bin/env bash
set -Eeuo pipefail

: "${RAGENODES_BACKEND_IMAGE:?Missing RAGENODES_BACKEND_IMAGE}"
: "${RAGENODES_BOT_IMAGE:?Missing RAGENODES_BOT_IMAGE}"
: "${RAGENODES_OXIDEPROXY_IMAGE:?Missing RAGENODES_OXIDEPROXY_IMAGE}"
: "${RAGENODES_OXIDE_CONTROL_PANEL_IMAGE:?Missing RAGENODES_OXIDE_CONTROL_PANEL_IMAGE}"
: "${RAGENODES_RELEASE_REVISION:?Missing RAGENODES_RELEASE_REVISION}"

if [[ ! "$RAGENODES_RELEASE_REVISION" =~ ^[0-9a-f]{40}$ ]]; then
  echo "ERROR: invalid registry release revision." >&2
  exit 2
fi

validate_image_ref() {
  local ref="$1" component="$2"
  case "$ref" in
    "registry.gitlab.com/mariomatos/ragenodesultimate/$component@sha256:"????????????????????????????????????????????????????????????????) ;;
    *) echo "ERROR: invalid immutable image reference for $component." >&2; return 1 ;;
  esac
}

validate_image_ref "$RAGENODES_BACKEND_IMAGE" backend
validate_image_ref "$RAGENODES_BOT_IMAGE" bot
validate_image_ref "$RAGENODES_OXIDEPROXY_IMAGE" oxideproxy
validate_image_ref "$RAGENODES_OXIDE_CONTROL_PANEL_IMAGE" oxide-control-panel

if [ -n "${RAGENODES_REGISTRY_USER:-}" ] || [ -n "${RAGENODES_REGISTRY_PASSWORD:-}" ]; then
  : "${RAGENODES_REGISTRY_USER:?Set both registry credential variables}"
  : "${RAGENODES_REGISTRY_PASSWORD:?Set both registry credential variables}"
  printf '%s' "$RAGENODES_REGISTRY_PASSWORD" \
    | docker login registry.gitlab.com --username "$RAGENODES_REGISTRY_USER" --password-stdin >/dev/null
fi

for ref in \
  "$RAGENODES_BACKEND_IMAGE" \
  "$RAGENODES_BOT_IMAGE" \
  "$RAGENODES_OXIDEPROXY_IMAGE" \
  "$RAGENODES_OXIDE_CONTROL_PANEL_IMAGE"; do
  docker pull "$ref"
  docker image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "$ref" \
    | grep -Fx "$ref" >/dev/null || {
    echo "ERROR: pulled image digest does not match the reviewed release." >&2
    exit 3
  }
  image_revision="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$ref")"
  if [ "$image_revision" != "$RAGENODES_RELEASE_REVISION" ]; then
    echo "ERROR: image revision $image_revision does not match reviewed release $RAGENODES_RELEASE_REVISION." >&2
    exit 4
  fi
done

echo "Registry release $RAGENODES_RELEASE_REVISION downloaded, digest-verified and revision-verified."
