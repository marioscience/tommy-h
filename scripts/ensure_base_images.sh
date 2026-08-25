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

RUNTIME_DOCKER_NETWORK="${RUNTIME_DOCKER_NETWORK:-${DOCKER_NETWORK:-ragenodes_net}}"
[[ "$RUNTIME_DOCKER_NETWORK" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$ ]] || {
  echo "ERROR: nombre de red Docker no valido: $RUNTIME_DOCKER_NETWORK" >&2
  exit 1
}

docker --host "$RUNTIME_DOCKER_HOST" network inspect "$RUNTIME_DOCKER_NETWORK" >/dev/null 2>&1 \
  || docker --host "$RUNTIME_DOCKER_HOST" network create "$RUNTIME_DOCKER_NETWORK" >/dev/null

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
