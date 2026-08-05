#!/bin/bash
# 🚀 RageNodes - Total Migration Tool
# Este script prepara TODO para mover el panel a Proxmox.

set -e

PROJECT_ROOT="/home/niko/ragenodes-ultimate"
DATA_ROOT="/srv/ragenodes-data"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
MIGRATION_DIR="migration_$TIMESTAMP"
TEMP_DIR="/tmp/$MIGRATION_DIR"

# Colores
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}==> 📦 Iniciando PREPARACIÓN DE MIGRACIÓN TOTAL...${NC}"

mkdir -p "$TEMP_DIR"

# 1. Volcar bases de datos (Panel y Juegos)
echo -e "${YELLOW}==> 💾 Volcando bases de datos...${NC}"
PG_CONTAINER=$(docker ps --filter "name=postgres" --format "{{.Names}}" | grep ragenodes-ultimate-postgres | head -n 1)
MY_CONTAINER=$(docker ps --filter "name=mariadb" --format "{{.Names}}" | grep ragenodes-ultimate-mariadb | head -n 1)

if [ -z "$PG_CONTAINER" ] || [ -z "$MY_CONTAINER" ]; then
    echo "❌ Error: Los contenedores de DB no están corriendo."
    exit 1
fi

MY_PASS=$(grep CENTRAL_DB_PASS "$PROJECT_ROOT/.env" | cut -d'=' -f2)

docker exec "$PG_CONTAINER" pg_dumpall -U ragenodes > "$TEMP_DIR/panel_postgres.sql"
docker exec "$MY_CONTAINER" mariadb-dump -u root -p"$MY_PASS" --all-databases > "$TEMP_DIR/games_mariadb.sql"

echo -e "${YELLOW}==> 📚 Comprimiendo código del panel...${NC}"
tar -czf "$TEMP_DIR/project_source.tar.gz" \
    --exclude="node_modules" \
    --exclude=".git" \
    --exclude="backups" \
    --exclude="backend/node_modules" \
    --exclude="frontend/node_modules" \
    -C "$PROJECT_ROOT" .

# 4. Sincronizar Datos de Juego
echo -e "${YELLOW}==> 🎮 Sincronizando /srv/ragenodes-data con Google Drive...${NC}"
rclone sync "$DATA_ROOT" gdrive:migration_proxmox/data -P

# 5. Subir el paquete de sistema
echo -e "${YELLOW}==> ☁️ Subiendo base del sistema a Google Drive...${NC}"
rclone copy "$TEMP_DIR" gdrive:migration_proxmox/system

# 6. Limpieza
rm -rf "$TEMP_DIR"

echo -e "${BLUE}-------------------------------------------------------${NC}"
echo -e "${GREEN}✅ ¡MIGRACIÓN PREPARADA CON ÉXITO!${NC}"
echo -e "${BLUE}-------------------------------------------------------${NC}"
echo -e "Los archivos están en tu Google Drive bajo la carpeta: ${YELLOW}migration_proxmox${NC}"
echo -e "\nPara restaurar en el nuevo Proxmox:"
echo -e "1. Instala rclone y restaura el archivo de configuración."
echo -e "2. rclone copy gdrive:migration_proxmox/system ."
echo -e "3. rclone sync gdrive:migration_proxmox/data /srv/ragenodes-data -P"
echo -e "4. Descomprime project_source.tar.gz en tu carpeta de proyecto."
echo -e "5. docker compose up -d"
echo -e "6. Importa los archivos .sql en los contenedores correspondientes."
echo -e "${BLUE}-------------------------------------------------------${NC}"
