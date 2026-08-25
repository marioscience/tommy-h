#!/usr/bin/env sh
set -eu

project_dir="${PROJECT_ROOT:-/opt/ragenodes-ultimate}"
cd "$project_dir"

LEGO_ACTION=renew docker compose \
  -f docker-compose.yml \
  -f docker-compose.powerdns.yml \
  --profile dns-authority \
  --profile dns-certificate \
  run --rm oxide_wildcard_certificate

# OxideProxy carga las claves una sola vez al iniciar. El reinicio controlado
# sucede sólo después de que lego haya terminado correctamente.
docker compose \
  -f docker-compose.yml \
  -f docker-compose.powerdns.yml \
  restart oxide_web
