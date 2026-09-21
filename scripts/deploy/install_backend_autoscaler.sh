#!/usr/bin/env bash
set -Eeuo pipefail

project_dir="$(readlink -f "${1:-$PWD}")"
target_user="${2:-${SUDO_USER:-$USER}}"
target_group="$(id -gn "$target_user")"
target_uid="$(id -u "$target_user")"
compose_project_name="${COMPOSE_PROJECT_NAME:-$(basename "$project_dir")}"
docker_host="${DOCKER_HOST:-}"

if [ -z "$docker_host" ] && [ -f "$project_dir/.env" ]; then
  docker_host="$(sed -n 's/^DOCKER_HOST=//p' "$project_dir/.env" | tail -n 1)"
fi
docker_host="${docker_host:-unix:///run/user/$target_uid/docker.sock}"

[ -f "$project_dir/docker-compose.yml" ] || { echo "Directorio RageNodes inválido: $project_dir" >&2; exit 2; }
[[ "$target_user" =~ ^[a-z_][a-z0-9_-]*[$]?$ ]] || { echo "Usuario inválido" >&2; exit 2; }

sudo install -d -m 0755 /usr/local/lib/ragenodes /etc/ragenodes
sudo install -m 0755 "$project_dir/scripts/deploy/backend_autoscaler.mjs" /usr/local/lib/ragenodes/backend_autoscaler.mjs
sudo sed \
  -e "s/__RAGENODES_USER__/$target_user/g" \
  -e "s/__RAGENODES_GROUP__/$target_group/g" \
  "$project_dir/ops/systemd/ragenodes-backend-autoscaler.service" \
  | sudo tee /etc/systemd/system/ragenodes-backend-autoscaler.service >/dev/null
sudo install -m 0644 "$project_dir/ops/systemd/ragenodes-backend-autoscaler.timer" /etc/systemd/system/ragenodes-backend-autoscaler.timer

env_file=/etc/ragenodes/backend-autoscaler.env
if [ ! -f "$env_file" ]; then
  printf '%s\n' \
    "RAGENODES_PROJECT_DIR=$project_dir" \
    "COMPOSE_PROJECT_NAME=$compose_project_name" \
    "DOCKER_HOST=$docker_host" \
    "BACKEND_AUTOSCALE_ENABLED=false" \
    | sudo tee "$env_file" >/dev/null
  sudo chmod 0640 "$env_file"
fi

sudo systemctl daemon-reload
sudo systemctl enable --now ragenodes-backend-autoscaler.timer
echo "Autoscaler instalado. Revisa $env_file y activa BACKEND_AUTOSCALE_ENABLED=true tras validar staging."
