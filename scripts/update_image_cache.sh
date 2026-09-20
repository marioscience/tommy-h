#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_ROOT="${PROJECT_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
ENV_FILE="${RAGENODES_ENV_FILE:-$PROJECT_ROOT/.env}"

# Carga dotenv sin ejecutarlo como codigo shell.
# shellcheck source=load_env.sh
source "$PROJECT_ROOT/scripts/load_env.sh"
load_env_file "$ENV_FILE"

cd "$PROJECT_ROOT"
export PROJECT_ROOT
export RUNTIME_DOCKER_NETWORK="${RUNTIME_DOCKER_NETWORK:-${DOCKER_NETWORK:-ragenodes_net}}"
bash "$PROJECT_ROOT/scripts/ensure_base_images.sh"
refresh_status=0
bash "$PROJECT_ROOT/scripts/refresh_game_templates.sh" || refresh_status=$?

# Una plantilla dañada no impide precalentar las demás que ya fueron
# validadas. El estado final conserva el fallo para que systemd/monitorización
# lo hagan visible.
warm_status=0
bash "$PROJECT_ROOT/scripts/warm_game_template_cache.sh" || warm_status=$?

if [ "$refresh_status" -ne 0 ] || [ "$warm_status" -ne 0 ]; then
  exit 1
fi
