#!/usr/bin/env bash
set -Eeuo pipefail

ENV_FILE="${RAGENODES_ENV_FILE:-.env}"

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

[ -f "$ENV_FILE" ] || fail "No existe el archivo de entorno: $ENV_FILE"

set -a
# El archivo de entorno del proyecto sigue formato shell y no se imprime nunca.
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

: "${APP_UID:?APP_UID es obligatorio}"
: "${APP_GID:?APP_GID es obligatorio}"
: "${DOCKER_GID:?DOCKER_GID es obligatorio}"
: "${DOCKER_SOCKET:?DOCKER_SOCKET es obligatorio}"
: "${INSTANCE_DATA_ROOT:?INSTANCE_DATA_ROOT es obligatorio}"
: "${BACKUP_ROOT:?BACKUP_ROOT es obligatorio}"

effective_data_root="${PREFLIGHT_INSTANCE_DATA_ROOT:-$INSTANCE_DATA_ROOT}"

[ "$APP_UID" != "0" ] || fail "La aplicacion no puede ejecutarse como root."
[[ "$DOCKER_SOCKET" =~ ^/run/user/[0-9]+/docker\.sock$ ]] \
  || fail "Produccion y staging requieren un socket Docker rootless."
[ "${ALLOW_ROOTFUL_DOCKER_SOCKET:-false}" = "false" ] \
  || fail "ALLOW_ROOTFUL_DOCKER_SOCKET debe permanecer deshabilitado."
[ -S "$DOCKER_SOCKET" ] || fail "El socket Docker rootless no existe: $DOCKER_SOCKET"

socket_gid="$(stat -c '%g' "$DOCKER_SOCKET")"
[ "$socket_gid" = "$DOCKER_GID" ] \
  || fail "DOCKER_GID no coincide con el grupo propietario del socket Docker."

security_options="$(DOCKER_HOST="unix://$DOCKER_SOCKET" docker info --format '{{json .SecurityOptions}}')"
case "$security_options" in
  *rootless*) ;;
  *) fail "El daemon Docker conectado no anuncia modo rootless." ;;
esac

case "${FRONTEND_BIND_IP:-127.0.0.1}" in
  127.0.0.1|::1) ;;
  *) fail "FRONTEND_BIND_IP debe permanecer limitado a loopback." ;;
esac

for directory in "$effective_data_root" "$BACKUP_ROOT" "./oxideproxy/config" "./certs"; do
  [ -d "$directory" ] || fail "Falta el directorio requerido: $directory"
  owner_uid="$(stat -c '%u' "$directory")"
  owner_gid="$(stat -c '%g' "$directory")"
  [ "$owner_uid" = "$APP_UID" ] && [ "$owner_gid" = "$APP_GID" ] \
    || fail "$directory debe pertenecer a APP_UID:APP_GID ($APP_UID:$APP_GID)."
done

if [ "${BACKUP_REMOTE_ENABLED:-false}" = "true" ]; then
  : "${RCLONE_CONFIG_PATH:?RCLONE_CONFIG_PATH es obligatorio para backups remotos}"
  rclone_host_path="${RCLONE_CONFIG_HOST_PATH:-./config/rclone/rclone.conf}"
  [ -f "$rclone_host_path" ] \
    || fail "El backup remoto requiere un archivo rclone regular: $rclone_host_path"
fi

if command -v ss >/dev/null 2>&1 \
  && ss -H -lntu '( sport = :111 )' 2>/dev/null | grep -q . \
  && [ "${ALLOW_RPC_PORTMAPPER:-false}" != "true" ]; then
  fail "RPC/portmapper escucha en el puerto 111. Deshabilitalo o documenta ALLOW_RPC_PORTMAPPER=true."
fi

printf 'Preflight de produccion superado.\n'
