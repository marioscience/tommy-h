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

COMPOSE=(docker compose -f docker-compose.staging.yml)
REGISTRY_DEPLOY=false
REGISTRY_RELEASE_FILE="${RAGENODES_REGISTRY_RELEASE_FILE:-deploy/registry-release.lock}"

if [ "${RAGENODES_REGISTRY_DEPLOY_ENABLED:-true}" = "true" ] && [ -f "$REGISTRY_RELEASE_FILE" ]; then
  load_env_file "$REGISTRY_RELEASE_FILE"
  if bash ./scripts/registry/prepare_runtime_images.sh; then
    COMPOSE+=(-f docker-compose.registry.staging.yml)
    REGISTRY_DEPLOY=true
  elif [ "${RAGENODES_REGISTRY_REQUIRED:-false}" = "true" ]; then
    echo "ERROR: Registry deployment is required and the reviewed images are unavailable." >&2
    exit 1
  else
    echo "WARNING: Registry unavailable; falling back to a local application build." >&2
  fi
fi

STATE_SERVICES=(
  redis-staging
)

wait_for_service() {
  local service="$1" timeout_seconds="$2" elapsed=0 container_id status
  container_id="$("${COMPOSE[@]}" ps -q "$service")"
  [ -n "$container_id" ] || { echo "ERROR: no existe $service" >&2; return 1; }

  while [ "$elapsed" -lt "$timeout_seconds" ]; do
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id")"
    case "$status" in
      healthy|running) echo "   OK $service: $status"; return 0 ;;
      unhealthy|exited|dead)
        "${COMPOSE[@]}" logs --tail=80 "$service"
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

"${COMPOSE[@]}" config --quiet
"${COMPOSE[@]}" up -d "${STATE_SERVICES[@]}"
wait_for_service redis-staging 60
RUNTIME_DOCKER_NETWORK=ragenodes_net_staging bash ./scripts/ensure_base_images.sh
if [ "$REGISTRY_DEPLOY" = "true" ]; then
  echo "Using precompiled, digest-pinned GitLab Registry images."
else
  "${COMPOSE[@]}" build "${APP_SERVICES[@]}"
fi
"${COMPOSE[@]}" up -d --no-deps "${APP_SERVICES[@]}"

wait_for_service backend-staging 90
wait_for_service oxide_control_panel 60
wait_for_service oxide_game_staging 60
wait_for_service oxide_web_staging 60
wait_for_http http://127.0.0.1:3011/healthz 90
wait_for_http http://127.0.0.1:3011/readyz 90
"${COMPOSE[@]}" exec -T backend-staging node src/verify_production_readiness.js

echo "Staging actualizado y verificado."
