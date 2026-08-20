#!/bin/bash
# Script de auto-actualización para el entorno de Staging (Pruebas)
exec 9>/tmp/ragenodes_staging_update.lock
if ! flock -n 9; then
    exit 0
fi

PROJECT_DIR="/opt/ragenodes-ultimate"
BRANCH="staging"
LOG_FILE="/opt/ragenodes-ultimate/update_staging.log"

cd "$PROJECT_DIR" || exit 1

git fetch origin "$BRANCH" >/dev/null 2>&1
LOCAL=$(git rev-parse HEAD 2>/dev/null)
REMOTE=$(git rev-parse origin/"$BRANCH" 2>/dev/null)

if [ "$LOCAL" != "$REMOTE" ] && [ -n "$REMOTE" ]; then
    echo "--------------------------------------------------------" >> "$LOG_FILE"
    echo "$(date): Nuevos cambios detectados en la rama $BRANCH. Actualizando Staging..." >> "$LOG_FILE"

    git reset --hard origin/"$BRANCH" >> "$LOG_FILE" 2>&1
    git pull origin "$BRANCH" >> "$LOG_FILE" 2>&1

    if [ -x "./deploy_staging.sh" ]; then
        bash ./deploy_staging.sh >> "$LOG_FILE" 2>&1
    fi
fi
