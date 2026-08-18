#!/bin/bash
echo "🚀 Levantando el entorno de Staging (Pruebas)..."
echo "Asegurándose de que existan los directorios de datos de staging..."
mkdir -p /srv/ragenodes-staging-data/templates

# Copiamos las plantillas de producción para que staging las pueda usar
if [ -d "/srv/ragenodes-data/templates" ]; then
    echo "Sincronizando plantillas desde producción a staging..."
    rsync -a /srv/ragenodes-data/templates/ /srv/ragenodes-staging-data/templates/
fi

docker compose -f docker-compose.staging.yml up -d --build --remove-orphans --remove-orphans

echo "✅ Entorno de Staging iniciado."
echo "Puedes acceder al panel de pruebas localmente en: http://127.0.0.1:3011"
echo "Las bases de datos, redes y contenedores están 100% aislados de producción."
