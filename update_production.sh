#!/bin/bash
echo "🚀 Actualizando Entorno de Producción..."

# Asegurarse de que estamos en el directorio del proyecto
cd /opt/ragenodes-ultimate || exit 1

# Descargar los últimos cambios de GitHub
echo "📦 Descargando cambios de GitHub..."
git pull origin main

# Reconstruir imágenes y levantar contenedores limpiando huérfanos
echo "🐳 Reconstruyendo imágenes de Docker y aplicando cambios..."
docker compose up -d --build --remove-orphans

echo "✅ Entorno de Producción actualizado con éxito."
