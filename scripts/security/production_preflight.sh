#!/usr/bin/env bash
set -Eeuo pipefail

ENV_FILE="${RAGENODES_ENV_FILE:-.env}"

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

[ -f "$ENV_FILE" ] || fail "No existe el archivo de entorno: $ENV_FILE"

# El cargador interpreta formato dotenv sin ejecutar el contenido del archivo.
# shellcheck disable=SC1091
source ./scripts/load_env.sh
load_env_file "$ENV_FILE"

: "${APP_UID:?APP_UID es obligatorio}"
: "${APP_GID:?APP_GID es obligatorio}"
: "${DOCKER_GID:?DOCKER_GID es obligatorio}"
: "${GAME_DATA_GID:?GAME_DATA_GID es obligatorio}"
: "${DOCKER_SOCKET:?DOCKER_SOCKET es obligatorio}"
: "${INSTANCE_DATA_ROOT:?INSTANCE_DATA_ROOT es obligatorio}"
: "${BACKUP_ROOT:?BACKUP_ROOT es obligatorio}"

effective_data_root="${PREFLIGHT_INSTANCE_DATA_ROOT:-$INSTANCE_DATA_ROOT}"
control_docker_context="${CONTROL_DOCKER_CONTEXT:-default}"

[ "$APP_UID" != "0" ] || fail "La aplicacion no puede ejecutarse como root."
[[ "$DOCKER_SOCKET" =~ ^/run/user/[0-9]+/docker\.sock$ ]] \
  || fail "Produccion y staging requieren un socket Docker rootless."
[ "${ALLOW_ROOTFUL_DOCKER_SOCKET:-false}" = "false" ] \
  || fail "ALLOW_ROOTFUL_DOCKER_SOCKET debe permanecer deshabilitado."
[ -S "$DOCKER_SOCKET" ] || fail "El socket Docker rootless no existe: $DOCKER_SOCKET"

# RageNodes deliberately uses two trust domains: Compose and OxideProxy run in
# the host daemon so the bounded XDP loader can reach the physical NIC, while
# the backend receives only the separate rootless runtime socket used for
# customer game containers.
control_security_options="$(docker --context "$control_docker_context" info --format '{{json .SecurityOptions}}')"
case "$control_security_options" in
  *rootless*) fail "El plano de control debe usar el daemon host; las instancias de clientes usan el socket rootless separado." ;;
esac

socket_gid="$(stat -c '%g' "$DOCKER_SOCKET")"
[ "$socket_gid" = "$DOCKER_GID" ] \
  || fail "DOCKER_GID no coincide con el grupo propietario del socket Docker."

case "$GAME_DATA_GID" in
  ''|*[!0-9]*) fail "GAME_DATA_GID debe ser un GID numérico del host." ;;
esac

security_options="$(DOCKER_HOST="unix://$DOCKER_SOCKET" docker info --format '{{json .SecurityOptions}}')"
case "$security_options" in
  *rootless*) ;;
  *) fail "El daemon Docker conectado no anuncia modo rootless." ;;
esac

docker_warnings="$(DOCKER_HOST="unix://$DOCKER_SOCKET" docker info --format '{{json .Warnings}}')"
docker_warnings_lower="${docker_warnings,,}"
for unsupported_control in \
  "no cpu cfs quota support" \
  "no cpu cfs period support" \
  "no cpu shares support" \
  "no memory limit support" \
  "no pids limit support"; do
  case "$docker_warnings_lower" in
    *"$unsupported_control"*)
      fail "El daemon Docker rootless no dispone de todos los controladores de recursos requeridos ($unsupported_control). Instala la delegacion systemd documentada antes de desplegar."
      ;;
  esac
done

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

# Un proxy de una instalación anterior (por ejemplo, Docker rootful) puede
# conservar 80/443 mientras el Compose rootless crea oxide_web sin poderlo
# iniciar. Eso deja HTTP parcialmente operativo y rompe TLS para txAdmin.
if command -v ss >/dev/null 2>&1; then
  managed_edge_running=false
  while IFS= read -r edge_id; do
    [ -n "$edge_id" ] || continue
    [ "$(docker inspect --format '{{.State.Running}}' "$edge_id" 2>/dev/null)" = true ] \
      && managed_edge_running=true
  done < <(docker compose -f docker-compose.yml ps -q oxide_web 2>/dev/null || true)

  if [ "$managed_edge_running" != true ] \
    && ss -H -lnt '( sport = :80 or sport = :443 )' 2>/dev/null | grep -q .; then
    fail "Los puertos 80/443 están ocupados por un proxy ajeno al Compose rootless administrado. Retira el runtime anterior antes de desplegar; no se permite un frontal TLS dividido."
  fi
fi

printf 'Preflight de produccion superado.\n'
