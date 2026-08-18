#!/bin/bash
# Script de auto-actualización para el entorno de Staging (Pre-producción)
# Este script está diseñado para ser ejecutado por un Cron Job.

PROJECT_DIR="/opt/ragenodes-ultimate"
BRANCH="staging"
LOG_FILE="/var/log/ragenodes_staging_update.log"

# Asegurarse de que el directorio del proyecto exista
cd "$PROJECT_DIR" || { echo "$(date): Error - No se encontró el directorio $PROJECT_DIR" >> "$LOG_FILE"; exit 1; }

# Descargar información de nuevas actualizaciones sin aplicarlas aún
git fetch origin "$BRANCH"

# Comparar hash del commit local con el remoto
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/"$BRANCH")

if [ "$LOCAL" != "$REMOTE" ]; then
    echo "--------------------------------------------------------" >> "$LOG_FILE"
    echo "$(date): Nuevos cambios detectados en la rama $BRANCH. Iniciando actualización..." >> "$LOG_FILE"

    # Traer los cambios forzadamente (para evitar conflictos si alguien tocó código en el servidor)
    git reset --hard origin/"$BRANCH"
    git pull origin "$BRANCH"

    # Ejecutar el script de despliegue de staging
    if [ -x "./deploy_staging.sh" ]; then
        bash ./deploy_staging.sh >> "$LOG_FILE" 2>&1
        echo "$(date): Actualización de pre-producción completada con éxito." >> "$LOG_FILE"
    else
        echo "$(date): Error - deploy_staging.sh no tiene permisos de ejecución o no existe." >> "$LOG_FILE"
    fi
else
    # Opcional: Descomentar la siguiente línea para depurar que el cron está corriendo correctamente
    # echo "$(date): Sin cambios." >> "$LOG_FILE"
    exit 0
fi
