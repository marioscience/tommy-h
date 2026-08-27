#!/usr/bin/env bash
set -Eeuo pipefail

exec 9>/tmp/ragenodes_staging_update.lock
flock -n 9 || exit 0

PROJECT_DIR="/opt/ragenodes-ultimate"
BRANCH="staging"
LOG_FILE="$PROJECT_DIR/update_staging.log"
FAILED_COMMIT_FILE="$PROJECT_DIR/.git/ragenodes_last_failed_staging_commit"
RUNTIME_CONFIG="oxideproxy/game_config/oxide_proxy.yml"
RUNTIME_CONFIG_BACKUP=""

log() { printf '%s: %s\n' "$(date --iso-8601=seconds)" "$1" >> "$LOG_FILE"; }

restore_runtime_config() {
  if [ -n "$RUNTIME_CONFIG_BACKUP" ] && [ -f "$RUNTIME_CONFIG_BACKUP" ]; then
    cp -- "$RUNTIME_CONFIG_BACKUP" "$RUNTIME_CONFIG"
  fi
}

cleanup_runtime_config() {
  restore_runtime_config
  if [ -n "$RUNTIME_CONFIG_BACKUP" ]; then
    rm -f -- "$RUNTIME_CONFIG_BACKUP"
  fi
}

trap cleanup_runtime_config EXIT

rollback() {
  local previous_commit="$1" failed_commit="$2"
  log "ERROR: despliegue $failed_commit fallido; volviendo a $previous_commit."
  git reset --hard "$previous_commit" >> "$LOG_FILE" 2>&1
  restore_runtime_config
  if bash ./deploy_staging.sh >> "$LOG_FILE" 2>&1; then
    log "Rollback de staging completado en $previous_commit."
  else
    log "ERROR CRITICO: tambien fallo el rollback de staging."
  fi
  printf '%s\n' "$failed_commit" > "$FAILED_COMMIT_FILE"
}

cd "$PROJECT_DIR"
# Avoid background auto-gc inheriting the deployment lock. A long repack would
# otherwise block every later updater run even after fetch has returned.
git -c gc.auto=0 fetch origin "$BRANCH" >> "$LOG_FILE" 2>&1 \
  || { log "No se pudo consultar origin/$BRANCH."; exit 1; }

LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse "origin/$BRANCH")"
[ "$LOCAL" != "$REMOTE" ] || exit 0

if [ -f "$FAILED_COMMIT_FILE" ] && [ "$(cat "$FAILED_COMMIT_FILE")" = "$REMOTE" ]; then
  exit 0
fi

git merge-base --is-ancestor "$LOCAL" "$REMOTE" \
  || { log "Actualizacion rechazada: no es avance directo."; printf '%s\n' "$REMOTE" > "$FAILED_COMMIT_FILE"; exit 1; }

if ! git diff --cached --quiet \
  || ! git diff --quiet -- . ":(exclude)$RUNTIME_CONFIG"; then
  log "Actualizacion cancelada: staging contiene cambios locales rastreados."
  exit 1
fi

# The Oxide control plane persists live routes in this tracked seed file. Keep
# that runtime state across a fast-forward without allowing any other tracked
# change to bypass the clean-worktree guard.
if ! git diff --quiet -- "$RUNTIME_CONFIG"; then
  RUNTIME_CONFIG_BACKUP="$(mktemp)"
  cp -- "$RUNTIME_CONFIG" "$RUNTIME_CONFIG_BACKUP"
  git restore -- "$RUNTIME_CONFIG"
  log "Configuracion runtime de OxideProxy preservada para la actualizacion."
fi

git merge --ff-only "$REMOTE" >> "$LOG_FILE" 2>&1 \
  || { restore_runtime_config; log "No se pudo avanzar hasta $REMOTE."; printf '%s\n' "$REMOTE" > "$FAILED_COMMIT_FILE"; exit 1; }

restore_runtime_config

if bash ./deploy_staging.sh >> "$LOG_FILE" 2>&1; then
  rm -f "$FAILED_COMMIT_FILE"
  log "Staging actualizado y verificado en $REMOTE."
else
  rollback "$LOCAL" "$REMOTE"
  exit 1
fi
