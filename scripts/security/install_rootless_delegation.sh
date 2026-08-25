#!/usr/bin/env bash
set -Eeuo pipefail

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

[ "${EUID:-$(id -u)}" = "0" ] \
  || fail "Ejecuta este instalador con sudo."

target_uid="${1:-1000}"
[[ "$target_uid" =~ ^[0-9]+$ ]] \
  || fail "El UID objetivo debe ser numerico."

source_file="ops/systemd/ragenodes-rootless-delegation.conf"
[ -f "$source_file" ] \
  || fail "Ejecuta el instalador desde la raiz del repositorio."

target_file="/etc/systemd/system/user@${target_uid}.service.d/ragenodes-rootless-delegation.conf"
install -D -m 0644 "$source_file" "$target_file"
systemctl daemon-reload

printf 'Delegacion rootless instalada para UID %s en %s.\n' "$target_uid" "$target_file"
printf 'Reinicia el host antes de ejecutar el preflight de produccion.\n'
