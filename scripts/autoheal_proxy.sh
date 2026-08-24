#!/usr/bin/env bash
set -u

PROJECT_DIR="/opt/ragenodes-ultimate"
LOG_FILE="$PROJECT_DIR/scripts/autoheal_proxy.log"

# Mantiene disponible el proxy web directo. El túnel Cloudflare ya no forma
# parte de la arquitectura y no debe recrearse ni reiniciarse.
if [ "$(docker container inspect -f '{{.State.Running}}' ragenodes-ultimate-oxide_web-1 2>/dev/null)" != "true" ]; then
    printf '%s: oxide_web is down, recreating...\n' "$(date --iso-8601=seconds)" >> "$LOG_FILE"
    cd "$PROJECT_DIR" || exit 1
    docker compose up -d --no-deps oxide_web >> "$LOG_FILE" 2>&1
fi

# Limpieza automática de logs: elimina únicamente logs con más de 30 días.
if [ -d /opt/ragenodes_logs_globales ]; then
    find /opt/ragenodes_logs_globales/ -type f -name "*.log*" -mtime +30 -delete
fi
