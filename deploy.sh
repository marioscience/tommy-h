#!/usr/bin/env bash
set -euo pipefail

if [ ! -f .env ]; then
  cp .env.example .env
  echo "⚠️ Creado .env base. Por favor, edita FIVEM_PUBLIC_HOST o las contraseñas en el archivo .env y vuelve a ejecutar."
  exit 0
fi

set -a
source .env
set +a

mkdir -p "${INSTANCE_DATA_ROOT}"

echo "==> 🛡️ MODO SAFE UPDATE ACTIVADO..."
echo "==> Los servidores FiveM de los clientes NO serán destruidos ni interrumpidos."
echo "==> Los volúmenes de base de datos (Postgres/MariaDB) están protegidos."

echo "==> 🚀 Reconstruyendo imágenes base y servicios del panel..."
docker compose build --no-cache backend
docker compose build fivem-base blender-web

echo "==> 🌐 Desplegando servicios de RageNodes..."
docker compose up -d --remove-orphans

echo "==> 🛡️ Verificando integridad de producción y migraciones SQL..."
docker compose exec -T backend node src/verify_production_readiness.js

echo ""
echo "🔥 RAGENODES V0.0.1 ACTUALIZADO CON ÉXITO 🔥"
echo "👉 Panel Web: ${PUBLIC_BASE_URL}"
echo "👉 Admin User: ${ADMIN_BOOTSTRAP_USER}"
echo "✅ Las instancias de juego no han sido afectadas."
echo ""
