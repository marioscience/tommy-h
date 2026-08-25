#!/usr/bin/env bash
set -u

PROJECT_DIR="/opt/ragenodes-ultimate"
LOG_FILE="$PROJECT_DIR/scripts/autoheal_proxy.log"
ENV_FILE="$PROJECT_DIR/.env"

staging_mode="false"
if [ -r "$ENV_FILE" ]; then
    staging_mode="$(
        sed -n 's/^[[:space:]]*STAGING_MODE[[:space:]]*=[[:space:]]*\([^#[:space:]]*\).*/\1/p' "$ENV_FILE" \
            | tail -n 1 \
            | tr '[:upper:]' '[:lower:]'
    )"
fi

case "$staging_mode" in
    1|true|yes)
        container_name="ragenodes-ultimate-oxide_web_staging-1"
        compose_file="docker-compose.staging.yml"
        compose_service="oxide_web_staging"
        ;;
    *)
        container_name="ragenodes-ultimate-oxide_web-1"
        compose_file="docker-compose.yml"
        compose_service="oxide_web"
        ;;
esac

# Mantiene disponible el proxy web directo. El túnel Cloudflare ya no forma
# parte de la arquitectura y no debe recrearse ni reiniciarse.
if [ "$(docker container inspect -f '{{.State.Running}}' "$container_name" 2>/dev/null)" != "true" ]; then
    printf '%s: %s is down, recreating...\n' \
        "$(date --iso-8601=seconds)" "$compose_service" >> "$LOG_FILE"
    cd "$PROJECT_DIR" || exit 1
    docker compose --env-file "$ENV_FILE" -f "$compose_file" \
        up -d --no-deps "$compose_service" >> "$LOG_FILE" 2>&1
fi
