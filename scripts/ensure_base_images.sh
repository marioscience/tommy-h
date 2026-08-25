#!/usr/bin/env bash
set -Eeuo pipefail

: "${FIVEM_BASE_IMAGE:?FIVEM_BASE_IMAGE es obligatorio}"
: "${BLENDER_BASE_IMAGE:?BLENDER_BASE_IMAGE es obligatorio}"

build_base_image() {
  local image="$1"
  local context="$2"

  [ -f "$context/Dockerfile" ] || {
    echo "ERROR: falta $context/Dockerfile para construir $image" >&2
    return 1
  }

  echo "==> Construyendo imagen base $image desde $context..."
  docker build --tag "$image" "$context"
  docker image inspect "$image" >/dev/null
}

build_base_image "$FIVEM_BASE_IMAGE" ./fivem-base
build_base_image "$BLENDER_BASE_IMAGE" ./blender-web

echo "Imagenes base verificadas."
