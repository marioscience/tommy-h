#!/bin/bash
# scripts/backup_to_gdrive.sh

set -e

PROJECT_ROOT="/home/niko/ragenodes-ultimate"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_NAME="ragenodes_ultimate_backup_${TIMESTAMP}.tar.gz"
TEMP_DIR="/tmp/ragenodes_backup"

# Detectar contenedores dinámicamente
PG_CONTAINER=$(docker ps --filter "name=postgres" --format "{{.Names}}" | grep ragenodes-ultimate-postgres | head -n 1)
MY_CONTAINER=$(docker ps --filter "name=mariadb" --format "{{.Names}}" | grep ragenodes-ultimate-mariadb | head -n 1)

if [ -z "$PG_CONTAINER" ] || [ -z "$MY_CONTAINER" ]; then
    echo "❌ Error: No se pudieron encontrar los contenedores de base de datos."
    exit 1
fi

echo "==> Contenedores detectados: PG ($PG_CONTAINER), MariaDB ($MY_CONTAINER)"

echo "==> 📦 Iniciando copia de seguridad para Google Drive..."

mkdir -p "$TEMP_DIR"

# 1. Volcar bases de datos
echo "==> 💾 Volcando bases de datos..."
docker exec "$PG_CONTAINER" pg_dumpall -U ragenodes > "$TEMP_DIR/postgres_dump.sql"

# Obtenemos la pass de MariaDB del .env
MY_PASS=$(grep CENTRAL_DB_PASS "$PROJECT_ROOT/.env" | cut -d'=' -f2)
docker exec "$MY_CONTAINER" mariadb-dump -u root -p"$MY_PASS" --all-databases > "$TEMP_DIR/mariadb_dump.sql"

# 2. Comprimir código y dumps
echo "==> 📚 Comprimiendo código y bases de datos..."
tar -czf "/tmp/$BACKUP_NAME" \
    -C "$PROJECT_ROOT" . \
    --exclude="node_modules" \
    --exclude=".git" \
    --exclude="backups" \
    --exclude="backend/node_modules" \
    --exclude="frontend/node_modules" \
    -C "$TEMP_DIR" .

# 3. Subir a Google Drive
echo "==> ☁️ Subiendo a Google Drive (remote: gdrive)..."
rclone copy "/tmp/$BACKUP_NAME" gdrive:

# 4. Actualizar el puntero 'latest'
echo "==> 🔄 Actualizando ragenodes_full_backup.tar.gz..."
rclone copyto "/tmp/$BACKUP_NAME" gdrive:ragenodes_full_backup.tar.gz

# 5. Limpieza
echo "==> 🧹 Limpiando archivos temporales..."
rm -rf "$TEMP_DIR"
rm "/tmp/$BACKUP_NAME"

echo "✅ Copia de seguridad COMPLETADA: $BACKUP_NAME"
