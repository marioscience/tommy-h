#!/bin/bash
# Script de auto-actualización para el entorno de Producción
# Este script está diseñado para ser ejecutado por un Cron Job (Opcional).

PROJECT_DIR="/opt/ragenodes-ultimate"
BRANCH="main"
LOG_FILE="/var/log/ragenodes_prod_update.log"

# Asegurarse de que el directorio del proyecto exista
cd "$PROJECT_DIR" || { echo "$(date): Error - No se encontró el directorio $PROJECT_DIR" >> "$LOG_FILE"; exit 1; }

# Descargar información de nuevas actualizaciones sin aplicarlas aún
git fetch origin "$BRANCH"

# Comparar hash del commit local con el remoto
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/"$BRANCH")

if [ "$LOCAL" != "$REMOTE" ]; then
    echo "--------------------------------------------------------" >> "$LOG_FILE"
    echo "$(date): Nuevos cambios detectados en la rama $BRANCH. Iniciando actualización de PRODUCCIÓN..." >> "$LOG_FILE"

    # Traer los cambios forzadamente
    git reset --hard origin/"$BRANCH"
    git pull origin "$BRANCH"

    # Ejecutar el script de despliegue de producción
    if [ -x "./deploy.sh" ]; then
        bash ./deploy.sh >> "$LOG_FILE" 2>&1
        echo "$(date): Actualización de Producción completada con éxito." >> "$LOG_FILE"
    else
        echo "$(date): Error - deploy.sh no tiene permisos de ejecución o no existe." >> "$LOG_FILE"
    fi
else
    exit 0
fi
