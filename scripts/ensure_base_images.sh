#!/usr/bin/env bash
set -Eeuo pipefail

: "${FIVEM_BASE_IMAGE:?FIVEM_BASE_IMAGE es obligatorio}"
: "${BLENDER_BASE_IMAGE:?BLENDER_BASE_IMAGE es obligatorio}"
: "${DOCKER_SOCKET:?DOCKER_SOCKET es obligatorio}"

case "$DOCKER_SOCKET" in
  unix://*) RUNTIME_DOCKER_HOST="$DOCKER_SOCKET" ;;
  /*) RUNTIME_DOCKER_HOST="unix://$DOCKER_SOCKET" ;;
  *) echo "ERROR: DOCKER_SOCKET debe ser una ruta absoluta o un endpoint unix://" >&2; exit 1 ;;
esac

RUNTIME_DOCKER_NETWORK="${RUNTIME_DOCKER_NETWORK:-${DOCKER_NETWORK:-ragenodes_net}}"
IMAGE_CACHE_ROOT="${IMAGE_CACHE_ROOT:-${PROJECT_ROOT:-$PWD}/.image-cache}"
IMAGE_ARCHIVE_ENABLED="${IMAGE_ARCHIVE_ENABLED:-true}"
FIVEM_VERSION_API="${FIVEM_VERSION_API:-https://changelogs-live.fivem.net/api/changelog/versions/linux/server}"

[[ "$RUNTIME_DOCKER_NETWORK" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$ ]] || {
  echo "ERROR: nombre de red Docker no valido: $RUNTIME_DOCKER_NETWORK" >&2; exit 1;
}

mkdir -p "$IMAGE_CACHE_ROOT"
lock_dir="$IMAGE_CACHE_ROOT/.update.lock"
if ! mkdir "$lock_dir" 2>/dev/null; then
  echo "ERROR: ya existe una actualizacion de imagenes en curso" >&2
  exit 1
fi
trap 'rmdir "$lock_dir" 2>/dev/null || true' EXIT

docker_runtime() { docker --host "$RUNTIME_DOCKER_HOST" "$@"; }
image_exists() { docker_runtime image inspect "$1" >/dev/null 2>&1; }
safe_name() { printf '%s' "$1" | tr '/:@' '____' | tr -cd 'A-Za-z0-9._-'; }

load_archive_if_available() {
  local image="$1" archive="$IMAGE_CACHE_ROOT/$(safe_name "$1").tar.gz"
  image_exists "$image" && return 0
  if [ -f "$archive" ]; then
    echo "==> Restaurando $image desde cache maestra local..."
    gzip -dc "$archive" | docker_runtime load >/dev/null
  fi
}

archive_image() {
  local image="$1" archive tmp
  [ "$IMAGE_ARCHIVE_ENABLED" = "true" ] || return 0
  archive="$IMAGE_CACHE_ROOT/$(safe_name "$image").tar.gz"
  tmp="${archive}.tmp.$$"
  echo "==> Actualizando cache maestra de $image..."
  docker_runtime save "$image" | gzip -1 > "$tmp"
  mv "$tmp" "$archive"
  chmod 600 "$archive"
}

docker_runtime network inspect "$RUNTIME_DOCKER_NETWORK" >/dev/null 2>&1 \
  || docker_runtime network create "$RUNTIME_DOCKER_NETWORK" >/dev/null

command -v curl >/dev/null || { echo "ERROR: curl es obligatorio" >&2; exit 1; }
command -v python3 >/dev/null || { echo "ERROR: python3 es obligatorio" >&2; exit 1; }

fivem_url="$(curl --fail --show-error --silent --location --retry 4 "$FIVEM_VERSION_API" \
  | python3 -c 'import json, sys; value=json.load(sys.stdin).get("recommended_download"); value or sys.exit(1); print(value)')"
case "$fivem_url" in
  https://runtime.fivem.net/artifacts/fivem/build_proot_linux/master/*) ;;
  *) echo "ERROR: URL recomendada de FiveM fuera del origen autorizado" >&2; exit 1 ;;
esac
fivem_artifact="$(basename "$(dirname "$fivem_url")")"
[[ "$fivem_artifact" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "ERROR: identificador FiveM invalido" >&2; exit 1; }
fivem_repo="${FIVEM_BASE_IMAGE%:*}"
fivem_versioned="${fivem_repo}:artifact-${fivem_artifact}"
load_archive_if_available "$FIVEM_BASE_IMAGE"
current_fivem="$(docker_runtime image inspect -f '{{ index .Config.Labels "org.ragenodes.fivem.artifact" }}' "$FIVEM_BASE_IMAGE" 2>/dev/null || true)"
if [ "$current_fivem" != "$fivem_artifact" ]; then
  echo "==> FiveM $current_fivem -> $fivem_artifact; construyendo una sola vez..."
  docker_runtime build \
    --build-arg "FIVEM_DOWNLOAD_URL=$fivem_url" \
    --build-arg "FIVEM_ARTIFACT_ID=$fivem_artifact" \
    --tag "$fivem_versioned" --tag "$FIVEM_BASE_IMAGE" ./runtime-images/fivem
  archive_image "$FIVEM_BASE_IMAGE"
else
  echo "==> FiveM $fivem_artifact ya esta en la cache local."
fi

blender_fingerprint="$(find ./runtime-images/blender-web -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum | cut -d' ' -f1)"
load_archive_if_available "$BLENDER_BASE_IMAGE"
current_blender="$(docker_runtime image inspect -f '{{ index .Config.Labels "org.ragenodes.context.sha256" }}' "$BLENDER_BASE_IMAGE" 2>/dev/null || true)"
if [ "$current_blender" != "$blender_fingerprint" ]; then
  echo "==> Contexto Blender actualizado; construyendo imagen maestra..."
  docker_runtime build \
    --label "org.ragenodes.image.kind=blender-base" \
    --label "org.ragenodes.context.sha256=$blender_fingerprint" \
    --tag "$BLENDER_BASE_IMAGE" ./runtime-images/blender-web
  archive_image "$BLENDER_BASE_IMAGE"
else
  echo "==> Blender ya esta en la cache local."
fi

# Las imagenes externas permanecen fijadas por digest. Cuando el repositorio
# promociona un digest nuevo, se descarga aqui antes de publicar el backend.
external_vars=(
  MINECRAFT_BASE_IMAGE RUST_BASE_IMAGE PALWORLD_BASE_IMAGE CS2_BASE_IMAGE
  VALHEIM_BASE_IMAGE ZOMBOID_BASE_IMAGE ARK_BASE_IMAGE SDTD_BASE_IMAGE
  DISCORD_BOT_BASE_IMAGE WORDPRESS_BASE_IMAGE DATABASE_BASE_IMAGE
)

# Manifiesto seguro por defecto. Los operadores pueden promocionar otro digest
# desde .env, pero nunca se sigue una etiqueta mutable de forma silenciosa.
: "${MINECRAFT_BASE_IMAGE:=itzg/minecraft-server:java25@sha256:997e32aeb8742a4904d900140f684cf6a2723aa713ae431c7327adeb62faf25d}"
: "${RUST_BASE_IMAGE:=indifferentbroccoli/rust-server-docker@sha256:65d0b48cb2130041c59837a25351e985a680e5289f6219619ae2c4771e6c797a}"
: "${PALWORLD_BASE_IMAGE:=thijsvanloef/palworld-server-docker@sha256:39059e157ea5148f7c4f66c2913c9e844fd62b9fd9de1e7200de8bb4d9bd7a8f}"
: "${CS2_BASE_IMAGE:=cm2network/cs2@sha256:182f37326df93a8893d3c604a2c2c2a2164e40d126d4d5a71835b2610b913af7}"
: "${VALHEIM_BASE_IMAGE:=lloesche/valheim-server@sha256:20fde516ce311e6084f82f295c9eb6934af57b357c657937a04f62bdf5946149}"
: "${ZOMBOID_BASE_IMAGE:=renegademaster/zomboid-dedicated-server@sha256:5e3479ea2ef66a4f14686fd3abc3286cf31a82c0e37f737b4b5976ff37da9951}"
: "${ARK_BASE_IMAGE:=auhrus/arksurvivalascended-server@sha256:b823987de2e84a2af73e74ee2cdb6e7bc0fc01bdf79409abe930bb091e93927a}"
: "${SDTD_BASE_IMAGE:=didstopia/7dtd-server@sha256:b7d5822cbcb73116d6d1a04948f27e2edb38739dd62af0fdc41f8dbffb7af9ed}"
: "${DISCORD_BOT_BASE_IMAGE:=nikolaik/python-nodejs:python3.10-nodejs18@sha256:107fb5d4b4dc625b8c3b38186655a1368673d47a26db1f6f502de17c1658d5a7}"
: "${WORDPRESS_BASE_IMAGE:=wordpress@sha256:b427cec767f5de2aa649390cb8805aa1fe320e1e0d57fc1f467754edb6cc0a49}"
: "${DATABASE_BASE_IMAGE:=mariadb:10.11@sha256:de61fed4a40d3842f3ee09944ba52792156cfd9adf489b2cc670fc6ded28df8d}"

for variable in "${external_vars[@]}"; do
  image="${!variable:-}"
  [ -n "$image" ] || continue
  if ! image_exists "$image"; then
    echo "==> Precargando imagen fijada $image..."
    docker_runtime pull "$image"
  fi
done

docker_runtime image inspect "$FIVEM_BASE_IMAGE" "$BLENDER_BASE_IMAGE" >/dev/null
printf 'Imagenes maestras listas. FiveM=%s Blender=%s\n' "$fivem_artifact" "$blender_fingerprint"
