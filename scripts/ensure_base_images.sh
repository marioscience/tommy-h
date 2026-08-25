#!/usr/bin/env bash
set -Eeuo pipefail

: "${FIVEM_BASE_IMAGE:?FIVEM_BASE_IMAGE es obligatorio}"
: "${BLENDER_BASE_IMAGE:?BLENDER_BASE_IMAGE es obligatorio}"
: "${DOCKER_SOCKET:?DOCKER_SOCKET es obligatorio}"

case "$DOCKER_SOCKET" in
  unix://*) RUNTIME_DOCKER_HOST="$DOCKER_SOCKET" ;;
  /*) RUNTIME_DOCKER_HOST="unix://$DOCKER_SOCKET" ;;
  *)
    echo "ERROR: DOCKER_SOCKET debe ser una ruta absoluta o un endpoint unix://" >&2
    exit 1
    ;;
esac

build_base_image() {
  local image="$1"
  local context="$2"

  [ -f "$context/Dockerfile" ] || {
    echo "ERROR: falta $context/Dockerfile para construir $image" >&2
    return 1
  }

  echo "==> Construyendo imagen base $image desde $context..."
  # Las imagenes de juegos deben existir en el mismo daemon rootless que usa
  # el backend. El compose de la aplicacion puede seguir en el daemon del host.
  docker --host "$RUNTIME_DOCKER_HOST" build --tag "$image" "$context"
  docker --host "$RUNTIME_DOCKER_HOST" image inspect "$image" >/dev/null
}

build_base_image "$FIVEM_BASE_IMAGE" ./fivem-base
build_base_image "$BLENDER_BASE_IMAGE" ./blender-web

echo "Imagenes base verificadas."
