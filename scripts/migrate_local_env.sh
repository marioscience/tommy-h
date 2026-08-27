#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ENV_FILE="${1:-.env}"
[ -f "$ENV_FILE" ] || { printf 'ERROR: no existe %s\n' "$ENV_FILE" >&2; exit 1; }
command -v awk >/dev/null 2>&1 || { echo 'ERROR: awk es obligatorio.' >&2; exit 1; }
command -v openssl >/dev/null 2>&1 || { echo 'ERROR: openssl es obligatorio.' >&2; exit 1; }

set_key() {
  local key="$1" value="$2" temporary
  temporary="$(mktemp "${ENV_FILE}.tmp.XXXXXX")"
  awk -v key="$key" -v value="$value" '
    BEGIN { found = 0 }
    index($0, key "=") == 1 {
      if (!found) print key "=" value
      found = 1
      next
    }
    { print }
    END { if (!found) print key "=" value }
  ' "$ENV_FILE" > "$temporary"
  chmod 600 "$temporary"
  mv -f "$temporary" "$ENV_FILE"
}

remove_key() {
  local key="$1" temporary
  temporary="$(mktemp "${ENV_FILE}.tmp.XXXXXX")"
  awk -v key="$key" 'index($0, key "=") != 1 { print }' "$ENV_FILE" > "$temporary"
  chmod 600 "$temporary"
  mv -f "$temporary" "$ENV_FILE"
}

read_key() {
  local key="$1"
  awk -v key="$key" 'index($0, key "=") == 1 { sub("^[^=]*=", ""); print; exit }' "$ENV_FILE"
}

discord_key="$(read_key DISCORD_API_KEY)"
enrollment_key="$(read_key NODE_ENROLLMENT_API_KEY)"
[ -n "$discord_key" ] || discord_key="$(openssl rand -hex 32)"
[ -n "$enrollment_key" ] || enrollment_key="$(openssl rand -hex 32)"
[ "$discord_key" != "$enrollment_key" ] || enrollment_key="$(openssl rand -hex 32)"

docker_socket="$(read_key DOCKER_SOCKET)"
[ -S "$docker_socket" ] || docker_socket=/var/run/docker.sock
[ -S "$docker_socket" ] || { echo 'ERROR: no se encontro el socket Docker local.' >&2; exit 1; }

game_data_gid="$(read_key GAME_DATA_GID)"
[ -n "$game_data_gid" ] || game_data_gid="$(id -g)"

set_key NODE_ENV development
set_key DISCORD_API_KEY "$discord_key"
set_key NODE_ENROLLMENT_API_KEY "$enrollment_key"
set_key APP_UID "$(id -u)"
set_key APP_GID "$(id -g)"
set_key DOCKER_GID "$(stat -c '%g' "$docker_socket")"
set_key GAME_DATA_GID "$game_data_gid"
set_key DOCKER_SOCKET "$docker_socket"
set_key BACKUP_REMOTE_ENABLED false
set_key ALLOW_ROOTFUL_DOCKER_SOCKET true
set_key FRONTEND_BIND_IP 127.0.0.1
set_key COOKIE_SECURE false
remove_key API_KEY
chmod 600 "$ENV_FILE"

printf 'Entorno local migrado sin mostrar secretos: %s\n' "$ENV_FILE"
