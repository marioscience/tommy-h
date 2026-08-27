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

wait_for_service() {
  local service="$1"
  local timeout_seconds="$2"
  local container_id status elapsed=0

  container_id="$("${COMPOSE[@]}" ps -q "$service")"
  if [ -z "$container_id" ]; then
    echo "❌ No se encontró el contenedor del servicio $service."
    return 1
  fi

  while [ "$elapsed" -lt "$timeout_seconds" ]; do
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id")"
    case "$status" in
      healthy|running)
        echo "   ✅ $service: $status"
        return 0
        ;;
      unhealthy|exited|dead)
        echo "❌ $service entró en estado $status."
        "${COMPOSE[@]}" logs --tail=80 "$service"
        return 1
        ;;
    esac
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

echo "==> 🚀 Reconstruyendo únicamente los servicios de aplicación..."
"${COMPOSE[@]}" build "${APP_SERVICES[@]}"

echo "==> 🌐 Aplicando solo las imágenes o configuraciones que cambiaron..."
"${COMPOSE[@]}" up -d --no-deps "${APP_SERVICES[@]}"

echo "==> 🩺 Esperando servicios críticos..."
wait_for_service backend 90
wait_for_service oxide_control_panel 60
wait_for_service oxide_game 60
wait_for_service oxide_web 60
wait_for_http http://127.0.0.1:3010/healthz 90
wait_for_http http://127.0.0.1:3010/readyz 90

echo "==> 🛡️ Verificando integridad de producción y migraciones SQL..."
"${COMPOSE[@]}" exec -T backend node src/verify_production_readiness.js

echo ""
echo "🔥 RAGENODES ACTUALIZADO CON ÉXITO 🔥"
echo "👉 Panel Web: ${PUBLIC_BASE_URL}"
echo "✅ Las instancias de juego no han sido afectadas."
echo ""
