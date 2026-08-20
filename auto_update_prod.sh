#!/bin/bash
# Script de auto-actualización para el entorno de Producción
# Este script está diseñado para ser ejecutado por un Cron Job (Opcional).

# Prevenir ejecuciones simultáneas (Evita corrupción si el despliegue tarda más de 1 minuto)
exec 9>/tmp/ragenodes_prod_update.lock
if ! flock -n 9; then
    # Ya hay una actualización en curso, salir silenciosamente
    exit 0
fi

PROJECT_DIR="/opt/ragenodes-ultimate"
BRANCH="main"
LOG_FILE="/opt/ragenodes-ultimate/update.log"

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
        if bash ./deploy.sh >> "$LOG_FILE" 2>&1; then
            echo "$(date): Despliegue completado. Esperando 30s para pruebas de salud..." >> "$LOG_FILE"
            sleep 30
            
            # Verificación básica
            if docker compose ps | grep -qEi "Exit|restarting|unhealthy"; then
                echo "$(date): ERROR CRÍTICO - Contenedores fallaron o están inestables. Iniciando ROLLBACK a $LOCAL..." >> "$LOG_FILE"
                git reset --hard "$LOCAL"
                bash ./deploy.sh >> "$LOG_FILE" 2>&1
                echo "$(date): ROLLBACK completado. Se restauró la versión funcional anterior." >> "$LOG_FILE"
            else
                echo "$(date): Pruebas pasadas exitosamente. Actualización de Producción completada." >> "$LOG_FILE"
            fi
        else
            echo "$(date): ERROR FATAL - deploy.sh falló. Iniciando ROLLBACK a $LOCAL..." >> "$LOG_FILE"
            git reset --hard "$LOCAL"
            bash ./deploy.sh >> "$LOG_FILE" 2>&1
            echo "$(date): ROLLBACK completado. Se restauró la versión funcional anterior." >> "$LOG_FILE"
        fi
    else
        echo "$(date): Error - deploy.sh no tiene permisos de ejecución o no existe." >> "$LOG_FILE"
    fi
else
    exit 0
fi
