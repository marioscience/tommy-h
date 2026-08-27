#!/usr/bin/env bash
set -Eeuo pipefail

[ -f .env ] || { echo "ERROR: falta .env" >&2; exit 1; }
# shellcheck disable=SC1091
source ./scripts/load_env.sh
load_env_file "${RAGENODES_ENV_FILE:-.env}"

PREFLIGHT_INSTANCE_DATA_ROOT="${STAGING_INSTANCE_DATA_ROOT:-/srv/ragenodes-staging-data}" \
  bash ./scripts/security/production_preflight.sh

STAGING_DATA_ROOT="${STAGING_INSTANCE_DATA_ROOT:-/srv/ragenodes-staging-data}"
mkdir -p "$STAGING_DATA_ROOT/templates"

APP_SERVICES=(
  backend-staging
  worker-docker-events-staging
  worker-stats-staging
  oxide_control_panel
  oxide_game_staging
  oxide_web_staging
)

STATE_SERVICES=(
  redis-staging
)

wait_for_service() {
  local service="$1" timeout_seconds="$2" elapsed=0 container_id status
  container_id="$(docker compose -f docker-compose.staging.yml ps -q "$service")"
  [ -n "$container_id" ] || { echo "ERROR: no existe $service" >&2; return 1; }

  while [ "$elapsed" -lt "$timeout_seconds" ]; do
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id")"
    case "$status" in
      healthy|running) echo "   OK $service: $status"; return 0 ;;
      unhealthy|exited|dead)
        docker compose -f docker-compose.staging.yml logs --tail=80 "$service"
        return 1
        ;;
    esac
    sleep 2
    elapsed=$((elapsed + 2))
  done
  return 1
}

wait_for_http() {
  local url="$1" timeout_seconds="$2" elapsed=0
  while [ "$elapsed" -lt "$timeout_seconds" ]; do
    if curl --fail --silent --show-error --max-time 5 "$url" >/dev/null 2>&1; then
      echo "   OK $url"
      return 0
    fi
    sleep 2
    elapsed=$((elapsed + 2))
  done
  echo "ERROR: $url no respondio correctamente en ${timeout_seconds}s" >&2
  return 1
}

docker compose -f docker-compose.staging.yml config --quiet
docker compose -f docker-compose.staging.yml up -d "${STATE_SERVICES[@]}"
wait_for_service redis-staging 60
RUNTIME_DOCKER_NETWORK=ragenodes_net_staging bash ./scripts/ensure_base_images.sh
docker compose -f docker-compose.staging.yml build "${APP_SERVICES[@]}"
docker compose -f docker-compose.staging.yml up -d --no-deps "${APP_SERVICES[@]}"

wait_for_service backend-staging 90
wait_for_service oxide_control_panel 60
wait_for_service oxide_game_staging 60
wait_for_service oxide_web_staging 60
wait_for_http http://127.0.0.1:3011/healthz 90
wait_for_http http://127.0.0.1:3011/readyz 90
docker compose -f docker-compose.staging.yml exec -T backend-staging node src/verify_production_readiness.js

echo "Staging actualizado y verificado."
