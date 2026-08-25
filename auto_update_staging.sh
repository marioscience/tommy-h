#!/usr/bin/env bash
set -Eeuo pipefail

exec 9>/tmp/ragenodes_staging_update.lock
flock -n 9 || exit 0

PROJECT_DIR="/opt/ragenodes-ultimate"
BRANCH="staging"
LOG_FILE="$PROJECT_DIR/update_staging.log"
FAILED_COMMIT_FILE="$PROJECT_DIR/.git/ragenodes_last_failed_staging_commit"

log() { printf '%s: %s\n' "$(date --iso-8601=seconds)" "$1" >> "$LOG_FILE"; }

rollback() {
  local previous_commit="$1" failed_commit="$2"
  log "ERROR: despliegue $failed_commit fallido; volviendo a $previous_commit."
  git reset --hard "$previous_commit" >> "$LOG_FILE" 2>&1
  if bash ./deploy_staging.sh >> "$LOG_FILE" 2>&1; then
    log "Rollback de staging completado en $previous_commit."
  else
    log "ERROR CRITICO: tambien fallo el rollback de staging."
  fi
  printf '%s\n' "$failed_commit" > "$FAILED_COMMIT_FILE"
}

cd "$PROJECT_DIR"
git fetch origin "$BRANCH" >> "$LOG_FILE" 2>&1 \
  || { log "No se pudo consultar origin/$BRANCH."; exit 1; }

LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse "origin/$BRANCH")"
[ "$LOCAL" != "$REMOTE" ] || exit 0

if [ -f "$FAILED_COMMIT_FILE" ] && [ "$(cat "$FAILED_COMMIT_FILE")" = "$REMOTE" ]; then
  exit 0
fi

git merge-base --is-ancestor "$LOCAL" "$REMOTE" \
  || { log "Actualizacion rechazada: no es avance directo."; printf '%s\n' "$REMOTE" > "$FAILED_COMMIT_FILE"; exit 1; }

if ! git diff --quiet || ! git diff --cached --quiet; then
  log "Actualizacion cancelada: staging contiene cambios locales rastreados."
  exit 1
fi

git merge --ff-only "$REMOTE" >> "$LOG_FILE" 2>&1 \
  || { log "No se pudo avanzar hasta $REMOTE."; printf '%s\n' "$REMOTE" > "$FAILED_COMMIT_FILE"; exit 1; }

if bash ./deploy_staging.sh >> "$LOG_FILE" 2>&1; then
  rm -f "$FAILED_COMMIT_FILE"
  log "Staging actualizado y verificado en $REMOTE."
else
  rollback "$LOCAL" "$REMOTE"
  exit 1
fi
