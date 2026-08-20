#!/bin/bash
# Script de auto-actualización para el entorno de Producción
exec 9>/tmp/ragenodes_prod_update.lock
if ! flock -n 9; then
    exit 0
fi

PROJECT_DIR="/opt/ragenodes-ultimate"
BRANCH="main"
LOG_FILE="/opt/ragenodes-ultimate/update.log"

cd "$PROJECT_DIR" || exit 1

git fetch origin "$BRANCH" >/dev/null 2>&1
LOCAL=$(git rev-parse HEAD 2>/dev/null)
REMOTE=$(git rev-parse origin/"$BRANCH" 2>/dev/null)

if [ "$LOCAL" != "$REMOTE" ] && [ -n "$REMOTE" ]; then
    echo "--------------------------------------------------------" >> "$LOG_FILE"
    echo "$(date): Nuevos cambios detectados en la rama $BRANCH. Iniciando actualización de PRODUCCIÓN..." >> "$LOG_FILE"

    git reset --hard origin/"$BRANCH" >> "$LOG_FILE" 2>&1
    git pull origin "$BRANCH" >> "$LOG_FILE" 2>&1

    if [ -x "./deploy.sh" ]; then
        if bash ./deploy.sh >> "$LOG_FILE" 2>&1; then
            echo "$(date): Despliegue completado. Esperando 10s para pruebas de salud..." >> "$LOG_FILE"
            sleep 10
            
            if docker compose ps | grep -qEi "Exit|restarting|unhealthy"; then
                echo "$(date): ERROR CRÍTICO - Contenedores inestables. Iniciando ROLLBACK a $LOCAL..." >> "$LOG_FILE"
                git reset --hard "$LOCAL"
                bash ./deploy.sh >> "$LOG_FILE" 2>&1
                echo "$(date): ROLLBACK completado. Se restauró la versión anterior." >> "$LOG_FILE"
            else
                echo "$(date): Pruebas pasadas exitosamente. Actualización de Producción completada." >> "$LOG_FILE"
            fi
        else
            echo "$(date): ERROR FATAL - deploy.sh falló. Iniciando ROLLBACK a $LOCAL..." >> "$LOG_FILE"
            git reset --hard "$LOCAL"
            bash ./deploy.sh >> "$LOG_FILE" 2>&1
            echo "$(date): ROLLBACK completado." >> "$LOG_FILE"
        fi
    fi
fi
