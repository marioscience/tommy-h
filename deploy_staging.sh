#!/usr/bin/env bash
set -Eeuo pipefail

[ -f .env ] || { echo "ERROR: falta .env" >&2; exit 1; }
PREFLIGHT_INSTANCE_DATA_ROOT="${STAGING_INSTANCE_DATA_ROOT:-/srv/ragenodes-staging-data}" \
  bash ./scripts/security/production_preflight.sh

set -a
source .env
set +a

STAGING_DATA_ROOT="${STAGING_INSTANCE_DATA_ROOT:-/srv/ragenodes-staging-data}"
mkdir -p "$STAGING_DATA_ROOT/templates"

APP_SERVICES=(
  backend-staging
  worker-docker-events-staging
  oxide_control_panel
  oxide_web_staging
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

docker compose -f docker-compose.staging.yml config --quiet
docker compose -f docker-compose.staging.yml build "${APP_SERVICES[@]}"
docker compose -f docker-compose.staging.yml up -d --no-deps "${APP_SERVICES[@]}"

wait_for_service backend-staging 90
wait_for_service oxide_control_panel 60
wait_for_service oxide_web_staging 60
curl --fail --silent --show-error --max-time 10 http://127.0.0.1:3011/healthz >/dev/null
curl --fail --silent --show-error --max-time 10 http://127.0.0.1:3011/readyz >/dev/null
docker compose -f docker-compose.staging.yml exec -T backend-staging node src/verify_production_readiness.js

echo "Staging actualizado y verificado."
