#!/usr/bin/env bash
set -Eeuo pipefail

if [ ! -f .env ]; then
  cp .env.example .env
  echo "⚠️ Creado .env base. Por favor, edita FIVEM_PUBLIC_HOST o las contraseñas en el archivo .env y vuelve a ejecutar."
  exit 0
fi

# shellcheck disable=SC1091
source ./scripts/load_env.sh
load_env_file "${RAGENODES_ENV_FILE:-.env}"

bash ./scripts/security/production_preflight.sh

: "${INSTANCE_DATA_ROOT:?INSTANCE_DATA_ROOT es obligatorio}"
mkdir -p "${INSTANCE_DATA_ROOT}"

APP_SERVICES=(
  backend
  bot
  worker-stats
  worker-backups
  worker-docker-events
  worker-deployments
  oxide_control_panel
  oxide_game
  oxide_web
)

STATE_SERVICES=(
  redis
)

COMPOSE=(docker compose -f docker-compose.yml)
if [ "${BACKUP_REMOTE_ENABLED:-false}" = "true" ]; then
  COMPOSE+=(-f docker-compose.backup-remote.yml)
fi
if [ "${EDGE_TLS_ENABLED:-false}" = "true" ]; then
  PDNS_API_KEY_FILE="${PDNS_API_KEY_FILE:-/etc/ragenodes/powerdns-api-key}"
  if [ -z "${PDNS_API_KEY:-}" ] && [ -r "$PDNS_API_KEY_FILE" ]; then
    PDNS_API_KEY="$(tr -d '\r\n' < "$PDNS_API_KEY_FILE")"
    export PDNS_API_KEY
  fi
  : "${PDNS_API_KEY:?PDNS_API_KEY or readable PDNS_API_KEY_FILE is required when EDGE_TLS_ENABLED=true}"
  COMPOSE+=(-f docker-compose.edge-tls.yml)
fi

REGISTRY_DEPLOY=false
REGISTRY_RELEASE_FILE="${RAGENODES_REGISTRY_RELEASE_FILE:-deploy/registry-release.lock}"
if [ "${RAGENODES_REGISTRY_DEPLOY_ENABLED:-true}" = "true" ] && [ -f "$REGISTRY_RELEASE_FILE" ]; then
  load_env_file "$REGISTRY_RELEASE_FILE"
  if bash ./scripts/registry/prepare_runtime_images.sh; then
    COMPOSE+=(-f docker-compose.registry.yml)
    REGISTRY_DEPLOY=true
  elif [ "${RAGENODES_REGISTRY_REQUIRED:-false}" = "true" ]; then
    echo "ERROR: Registry deployment is required and the reviewed images are unavailable." >&2
    exit 1
  else
    echo "WARNING: Registry unavailable; falling back to a local application build." >&2
  fi
fi

wait_for_service() {
  local service="$1"
  local timeout_seconds="$2"
  local container_id status elapsed=0 all_ready
  local -a container_ids

  mapfile -t container_ids < <("${COMPOSE[@]}" ps -q "$service")
  if [ "${#container_ids[@]}" -eq 0 ]; then
    echo "❌ No se encontró el contenedor del servicio $service."
    return 1
  fi

  while [ "$elapsed" -lt "$timeout_seconds" ]; do
    all_ready=true
    for container_id in "${container_ids[@]}"; do
      status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id")"
      case "$status" in
        healthy|running) ;;
        unhealthy|exited|dead)
          echo "❌ $service ($container_id) entró en estado $status."
          "${COMPOSE[@]}" logs --tail=80 "$service"
          return 1
          ;;
        *) all_ready=false ;;
      esac
    done
    if [ "$all_ready" = true ]; then
      echo "   ✅ $service: ${#container_ids[@]} réplica(s) disponibles"
      return 0
    fi
    sleep 2
    elapsed=$((elapsed + 2))
  done

  echo "❌ $service no quedó disponible tras ${timeout_seconds}s."
  "${COMPOSE[@]}" logs --tail=80 "$service"
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

wait_for_backend_ready() {
  local timeout_seconds="$1" elapsed=0
  while [ "$elapsed" -lt "$timeout_seconds" ]; do
    if "${COMPOSE[@]}" exec -T backend node -e \
      "fetch('http://127.0.0.1:3006/readyz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"; then
      echo "   OK backend /readyz"
      return 0
    fi
    sleep 2
    elapsed=$((elapsed + 2))
  done
  echo "ERROR: backend /readyz no respondio correctamente en ${timeout_seconds}s" >&2
  return 1
}

verify_running_release_revision() {
  local service container_id image_revision
  local -a container_ids
  for service in "${APP_SERVICES[@]}"; do
    mapfile -t container_ids < <("${COMPOSE[@]}" ps -q "$service")
    [ "${#container_ids[@]}" -gt 0 ] || { echo "ERROR: no running container for $service." >&2; return 1; }
    for container_id in "${container_ids[@]}"; do
      image_revision="$(docker inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$container_id")"
      if [ "$image_revision" != "$RAGENODES_RELEASE_REVISION" ]; then
        echo "ERROR: $service ($container_id) runs revision $image_revision; expected $RAGENODES_RELEASE_REVISION." >&2
        return 1
      fi
    done
  done
  echo "   OK: all application containers run release $RAGENODES_RELEASE_REVISION"
}

echo "==> 🛡️ MODO SAFE UPDATE ACTIVADO..."
echo "==> Los servidores FiveM de los clientes NO serán destruidos ni interrumpidos."
echo "==> Los volúmenes de base de datos (Postgres/MariaDB) están protegidos."

echo "==> 🔎 Validando la configuración de Docker Compose..."
"${COMPOSE[@]}" config --quiet

echo "==> 🗄️ Aplicando y verificando servicios de estado requeridos..."
"${COMPOSE[@]}" up -d "${STATE_SERVICES[@]}"
wait_for_service redis 60

echo "==> 🧱 Verificando imágenes base para nuevas instancias..."
RUNTIME_DOCKER_NETWORK="${DOCKER_NETWORK:-ragenodes_net}" bash ./scripts/ensure_base_images.sh

if [ "$REGISTRY_DEPLOY" = "true" ]; then
  echo "==> Using precompiled, digest-pinned GitLab Registry images."
else
  echo "==> Reconstruyendo unicamente los servicios de aplicacion..."
  "${COMPOSE[@]}" build "${APP_SERVICES[@]}"
fi

echo "==> 🌐 Aplicando solo las imágenes o configuraciones que cambiaron..."
if [ "${EDGE_TLS_ENABLED:-false}" = "true" ]; then
  export POWERDNS_ZONE EDGE_TLS_CERT_VOLUME
  # shellcheck disable=SC1091
  source ./scripts/ensure-edge-wildcard-certificate.sh
fi
echo "==> 🧰 Preparando el volumen de ejecución de OxideProxy..."
"${COMPOSE[@]}" run --rm --no-deps oxide_game_runtime_init
BACKEND_REPLICAS="$(bash ./scripts/deploy/select_backend_replicas.sh)"
echo "==> ⚖️ Réplicas backend seleccionadas para este nodo: $BACKEND_REPLICAS"
"${COMPOSE[@]}" up -d --no-deps --scale backend="$BACKEND_REPLICAS" "${APP_SERVICES[@]}"

echo "==> 🩺 Esperando servicios críticos..."
wait_for_service backend 90
wait_for_service worker-deployments 60
wait_for_service oxide_control_panel 60
wait_for_service oxide_game 60
wait_for_service oxide_web 60
wait_for_http http://127.0.0.1/healthz 90
wait_for_backend_ready 90
if [ "$REGISTRY_DEPLOY" = "true" ]; then
  verify_running_release_revision
fi

echo "==> 🛡️ Verificando integridad de producción y migraciones SQL..."
"${COMPOSE[@]}" exec -T backend node src/verify_production_readiness.js

echo ""
echo "🔥 RAGENODES ACTUALIZADO CON ÉXITO 🔥"
echo "👉 Panel Web: ${PUBLIC_BASE_URL}"
echo "✅ Las instancias de juego no han sido afectadas."
echo ""
